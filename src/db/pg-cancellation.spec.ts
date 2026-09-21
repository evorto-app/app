import * as PgClient from '@effect/sql-pg/PgClient';
import * as PgPool from '@effect/sql-pg/PgPool';
import { Cause, Deferred, Effect, Fiber, Result } from 'effect';
import * as Reactivity from 'effect/unstable/reactivity/Reactivity';
import { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';

const integer = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value);
  return bytes;
};
const message = (tag: string, body: Buffer) =>
  Buffer.concat([Buffer.from(tag), integer(body.length + 4), body]);
const ready = (inTransaction: boolean) =>
  message('Z', Buffer.from(inTransaction ? 'T' : 'I'));

interface PendingQuery {
  readonly backend: number;
  readonly complete: (cancelled?: boolean) => void;
  completed: boolean;
  readonly text: string;
}

// A controlled PostgreSQL wire peer. The real native pool, protocol parser,
// query ownership and cancellation code run unchanged against these streams.
const createWireFixture = () => {
  const sessions: { backend: number; socket: Duplex }[] = [];
  const controls: { backend: number; socket: Duplex }[] = [];
  const sockets = new Set<Duplex>();
  const queries: PendingQuery[] = [];
  const started = new Map<string, Deferred.Deferred<undefined>>();
  const cancellationStarted = Deferred.makeUnsafe<undefined>();
  const acquisitionStarted = Deferred.makeUnsafe<undefined>();
  let holdStartup = false;
  let releaseStartup: (() => void) | undefined;
  let failControl = false;
  let serveSuccessor = false;
  let failNextStream = false;
  let nextBackend = 4242;

  const stream = () => {
    if (failNextStream) {
      failNextStream = false;
      throw new Error('Cancellation connection could not be created');
    }
    let first = true;
    let backend = 0;
    let inTransaction = false;
    let sql: string | undefined;
    const socket: Duplex = new Duplex({
      final(callback) {
        socket.push(null);
        callback();
      },
      read() {
        /* Responses are pushed when the test completes a query. */
      },
      write(chunk: Buffer, _encoding, callback) {
        if (first) {
          first = false;
          if (chunk.readInt32BE(4) === 80_877_102) {
            controls.push({ backend: chunk.readInt32BE(8), socket });
            Deferred.doneUnsafe(cancellationStarted, Effect.succeed(undefined));
            callback(
              failControl
                ? new Error('Cancellation transport failed')
                : undefined,
            );
            return;
          }
          if (chunk.readInt32BE(4) !== 196_608) {
            callback(new Error('Expected PostgreSQL startup'));
            return;
          }
          backend = nextBackend++;
          sessions.push({ backend, socket });
          const reply = () => {
            if (!socket.destroyed)
              socket.push(
                Buffer.concat([
                  message('R', integer(0)),
                  message(
                    'K',
                    Buffer.concat([integer(backend), integer(5678)]),
                  ),
                  ready(false),
                ]),
              );
          };
          if (holdStartup) {
            holdStartup = false;
            releaseStartup = reply;
            Deferred.doneUnsafe(acquisitionStarted, Effect.succeed(undefined));
          } else queueMicrotask(reply);
          callback();
          return;
        }
        let offset = 0;
        while (offset < chunk.length) {
          const tag = String.fromCodePoint(chunk[offset]);
          const length = chunk.readInt32BE(offset + 1);
          if (tag === 'P') {
            const nameEnd = chunk.indexOf(0, offset + 5);
            const sqlEnd = chunk.indexOf(0, nameEnd + 1);
            sql = chunk.subarray(nameEnd + 1, sqlEnd).toString();
          } else if (tag === 'S') {
            if (!sql) throw new Error('Expected a query before Sync');
            const text = sql;
            const query: PendingQuery = {
              backend,
              complete(cancelled = false) {
                if (query.completed) throw new Error('Query completed twice');
                query.completed = true;
                if (socket.destroyed) return;
                if (text === 'BEGIN') inTransaction = true;
                else if (text === 'COMMIT' || text === 'ROLLBACK')
                  inTransaction = false;
                socket.push(
                  cancelled
                    ? Buffer.concat([
                        message(
                          'E',
                          Buffer.from('SERROR\0C57014\0Mquery cancelled\0\0'),
                        ),
                        ready(inTransaction),
                      ])
                    : Buffer.concat([
                        message('1', Buffer.alloc(0)),
                        message('2', Buffer.alloc(0)),
                        message('n', Buffer.alloc(0)),
                        message(
                          'C',
                          Buffer.from(
                            `${text.startsWith('SELECT') ? 'SELECT 0' : text}\0`,
                          ),
                        ),
                        ready(inTransaction),
                      ]),
                );
              },
              completed: false,
              text,
            };
            queries.push(query);
            const gate = started.get(text);
            if (gate) Deferred.doneUnsafe(gate, Effect.succeed(undefined));
            if (
              ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text) ||
              (serveSuccessor && text === 'SELECT successor')
            )
              queueMicrotask(() => query.complete());
            sql = undefined;
          }
          offset += length + 1;
        }
        callback();
      },
    });
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };

  return {
    acknowledgeCancel: () => {
      const control = controls.at(-1);
      if (!control) throw new Error('No cancellation request');
      control.socket.destroy();
    },
    acquisitionStarted: Deferred.await(acquisitionStarted),
    cancellationStarted: Deferred.await(cancellationStarted),
    close: () => {
      for (const socket of sockets) socket.destroy();
    },
    complete: (text: string, cancelled = false) => {
      const query = queries.find(
        (query) => query.text === text && !query.completed,
      );
      if (!query) throw new Error(`No pending query: ${text}`);
      query.complete(cancelled);
    },
    controls,
    failControl: () => {
      failControl = true;
    },
    failControlCreation: () => {
      failNextStream = true;
    },
    holdNextAcquisition: () => {
      holdStartup = true;
    },
    queries,
    releaseAcquisition: () => {
      if (!releaseStartup) throw new Error('No held acquisition');
      releaseStartup();
      releaseStartup = undefined;
    },
    replyToSuccessor: () => {
      serveSuccessor = true;
    },
    sessions,
    stream,
    waitForQuery: (text: string) => {
      if (queries.some((query) => query.text === text)) return Effect.void;
      const gate = Deferred.makeUnsafe<undefined>();
      started.set(text, gate);
      return Deferred.await(gate);
    },
  };
};

type WireFixture = ReturnType<typeof createWireFixture>;
const withFixture = <A, E, R>(
  body: (fixture: WireFixture) => Effect.Effect<A, E, R>,
) => {
  const fixture = createWireFixture();
  return Effect.scoped(
    body(fixture).pipe(Effect.ensuring(Effect.sync(fixture.close))),
  );
};
const makeClient = (fixture: WireFixture) =>
  PgClient.make({
    maxConnections: 1,
    prepare: false,
    stream: fixture.stream,
    username: 'fixture-user',
  });
const run = <A, E>(effect: Effect.Effect<A, E, Reactivity.Reactivity>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(Reactivity.layer), Effect.timeout('12 seconds')),
  );
const successor = (fixture: WireFixture, sql: PgClient.PgClient) =>
  Effect.gen(function* () {
    const query = yield* Effect.forkChild(sql.unsafe('SELECT successor'));
    yield* fixture.waitForQuery('SELECT successor');
    fixture.complete('SELECT successor');
    yield* Fiber.join(query);
  });

describe('native PostgreSQL cancellation ownership', () => {
  it('cancels a queued pool acquisition before it can execute', () =>
    run(
      withFixture((fixture) =>
        Effect.gen(function* () {
          const sql = yield* makeClient(fixture);
          const original = yield* Effect.forkChild(
            sql.unsafe('SELECT original'),
          );
          yield* fixture.waitForQuery('SELECT original');
          const waiting = yield* Effect.forkChild(
            sql.unsafe('SELECT canceled-waiter'),
          );
          yield* Effect.yieldNow;
          yield* Fiber.interrupt(waiting);
          fixture.complete('SELECT original');
          yield* Fiber.join(original);
          yield* successor(fixture, sql);
          expect(fixture.queries.map((query) => query.text)).toEqual([
            'SELECT original',
            'SELECT successor',
          ]);
          expect(fixture.controls).toHaveLength(0);
          expect(fixture.sessions).toHaveLength(1);
        }),
      ),
    ));

  it('discards the backend when the cancellation connection cannot be created', () =>
    run(
      withFixture((fixture) =>
        Effect.gen(function* () {
          const sql = yield* makeClient(fixture);
          const query = yield* Effect.forkChild(sql.unsafe('SELECT original'));
          yield* fixture.waitForQuery('SELECT original');
          fixture.failControlCreation();
          yield* Fiber.interrupt(query);
          expect(fixture.controls).toHaveLength(0);
          expect(fixture.sessions[0]?.socket.destroyed).toBe(true);
          fixture.complete('SELECT original', true);
          yield* successor(fixture, sql);
          expect(fixture.queries.at(-1)?.backend).not.toBe(4242);
        }),
      ),
    ));

  it('reuses normally completed queries without dispatching cancellation', () =>
    run(
      withFixture((fixture) =>
        Effect.gen(function* () {
          const sql = yield* makeClient(fixture);
          const query = yield* Effect.forkChild(sql.unsafe('SELECT original'));
          yield* fixture.waitForQuery('SELECT original');
          fixture.complete('SELECT original');
          yield* Fiber.join(query);
          yield* Fiber.interrupt(query);
          yield* successor(fixture, sql);
          expect(fixture.controls).toHaveLength(0);
          expect(fixture.queries.map((query) => query.backend)).toEqual([
            4242, 4242,
          ]);
        }),
      ),
    ));

  for (const ordering of ['query-first', 'cancel-first']) {
    it(`retires the original backend after cancellation: ${ordering}`, () =>
      run(
        withFixture((fixture) =>
          Effect.gen(function* () {
            const sql = yield* makeClient(fixture);
            const query = yield* Effect.forkChild(
              sql.unsafe('SELECT original'),
            );
            yield* fixture.waitForQuery('SELECT original');
            const interruption = yield* Effect.forkChild(
              Fiber.interrupt(query),
            );
            yield* fixture.cancellationStarted;
            if (ordering === 'query-first') {
              fixture.complete('SELECT original');
              expect(query.pollUnsafe()).toBeUndefined();
            }
            fixture.acknowledgeCancel();
            yield* Fiber.join(interruption);
            const exit = yield* Fiber.await(query);
            expect(exit._tag).toBe('Failure');
            if (exit._tag === 'Failure')
              expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
            if (ordering === 'cancel-first')
              fixture.complete('SELECT original', true);
            expect(fixture.sessions[0]?.socket.destroyed).toBe(true);
            yield* successor(fixture, sql);
            expect(fixture.queries.at(-1)?.backend).not.toBe(4242);
            expect(fixture.controls.map((control) => control.backend)).toEqual([
              4242,
            ]);
          }),
        ),
      ));

    it(`never sends rollback on a backend with uncertain cancellation: ${ordering}`, () =>
      run(
        withFixture((fixture) =>
          Effect.gen(function* () {
            const sql = yield* makeClient(fixture);
            const transaction = yield* Effect.forkChild(
              sql.withTransaction(sql.unsafe('SELECT original')),
            );
            yield* fixture.waitForQuery('SELECT original');
            const interruption = yield* Effect.forkChild(
              Fiber.interrupt(transaction),
            );
            yield* fixture.cancellationStarted;
            if (ordering === 'query-first') fixture.complete('SELECT original');
            fixture.acknowledgeCancel();
            yield* Fiber.join(interruption);
            if (ordering === 'cancel-first')
              fixture.complete('SELECT original', true);
            expect(fixture.queries.map((query) => query.text)).toEqual([
              'BEGIN',
              'SELECT original',
            ]);
            expect(fixture.sessions[0]?.socket.destroyed).toBe(true);
            yield* successor(fixture, sql);
            expect(fixture.queries.at(-1)?.backend).not.toBe(4242);
          }),
        ),
      ));
  }

  it('does not dispatch cancellation for an already completed held query', () =>
    run(
      withFixture((fixture) =>
        Effect.gen(function* () {
          const pool = yield* PgPool.make({
            prepare: false,
            stream: fixture.stream,
            username: 'fixture-user',
          });
          const connection = yield* pool.get;
          const query = yield* Effect.forkChild(
            connection.query('SELECT original'),
          );
          yield* fixture.waitForQuery('SELECT original');
          fixture.complete('SELECT original');
          yield* Fiber.join(query);
          yield* connection.interrupt;
          const next = yield* Effect.forkChild(
            connection.query('SELECT successor'),
          );
          yield* fixture.waitForQuery('SELECT successor');
          fixture.complete('SELECT successor');
          yield* Fiber.join(next);
          expect(fixture.controls).toHaveLength(0);
          expect(fixture.queries.map((query) => query.backend)).toEqual([
            4242, 4242,
          ]);
        }),
      ),
    ));

  it('returns a late healthy acquisition to the pool without executing the canceled query', () =>
    run(
      withFixture((fixture) =>
        Effect.gen(function* () {
          const sql = yield* makeClient(fixture);
          fixture.holdNextAcquisition();
          const query = yield* Effect.forkChild(sql.unsafe('SELECT original'));
          yield* fixture.acquisitionStarted;
          yield* Fiber.interrupt(query);
          fixture.releaseAcquisition();
          expect(fixture.queries).toHaveLength(0);
          expect(fixture.controls).toHaveLength(0);
          // The pool owns connection setup independently of its canceled waiter.
          yield* successor(fixture, sql);
          expect(fixture.queries.at(-1)?.backend).toBe(4242);
          expect(fixture.sessions).toHaveLength(1);
          expect(fixture.sessions[0]?.socket.destroyed).toBe(false);
        }),
      ),
    ));

  for (const pinned of [false, true]) {
    it(`rejects a successor on a retained checkout after unconfirmed cancellation; pinned=${pinned}`, () =>
      run(
        withFixture((fixture) =>
          Effect.gen(function* () {
            const pool = yield* PgPool.make({
              prepare: false,
              stream: fixture.stream,
              username: 'fixture-user',
            });
            const connection = yield* pinned ? pool.reserve : pool.get;
            const query = yield* Effect.forkChild(
              connection.query('SELECT original'),
            );
            yield* fixture.waitForQuery('SELECT original');
            const interruption = yield* Effect.forkChild(
              Fiber.interrupt(query),
            );
            yield* fixture.cancellationStarted;
            // A completed control transport does not prove server cancellation delivery.
            fixture.complete('SELECT original');
            fixture.acknowledgeCancel();
            yield* Fiber.join(interruption);
            fixture.replyToSuccessor();
            const next = yield* Effect.result(
              connection.query('SELECT successor'),
            );
            expect(Result.isFailure(next)).toBe(true);
            expect(fixture.queries.map((query) => query.text)).toEqual([
              'SELECT original',
            ]);
            expect(fixture.sessions[0]?.socket.destroyed).toBe(true);
          }),
        ),
      ));
  }

  it('discards the original connection when the cancellation transport fails', () =>
    run(
      withFixture((fixture) =>
        Effect.gen(function* () {
          const sql = yield* makeClient(fixture);
          const query = yield* Effect.forkChild(sql.unsafe('SELECT original'));
          yield* fixture.waitForQuery('SELECT original');
          fixture.failControl();
          yield* Fiber.interrupt(query);
          expect(fixture.sessions[0]?.socket.destroyed).toBe(true);
          expect(fixture.controls[0]?.socket.destroyed).toBe(true);
          fixture.complete('SELECT original', true);
          yield* successor(fixture, sql);
          expect(fixture.queries.at(-1)?.backend).not.toBe(4242);
        }),
      ),
    ));

  for (const ordering of ['target-first', 'control-first'] as const) {
    it(`retires the target once when socket failure races cancellation: ${ordering}`, () =>
      run(
        withFixture((fixture) =>
          Effect.gen(function* () {
            const sql = yield* makeClient(fixture);
            const query = yield* Effect.forkChild(
              sql.unsafe('SELECT original'),
            );
            yield* fixture.waitForQuery('SELECT original');
            const target = fixture.sessions[0];
            if (!target) throw new Error('Expected the active target session');
            const closed = Deferred.makeUnsafe<undefined>();
            let closeCount = 0;
            target.socket.on('close', () => {
              closeCount += 1;
              Deferred.doneUnsafe(closed, Effect.succeed(undefined));
            });
            const interruption = yield* Effect.forkChild(
              Fiber.interrupt(query),
            );
            yield* fixture.cancellationStarted;
            const failTarget = () => {
              target.socket.destroy(
                new Error('Target connection failed during cancellation'),
              );
            };
            // Both terminal events are queued in the same turn. Do not add an
            // error listener here: the native connection must handle its error.
            if (ordering === 'target-first') {
              failTarget();
              fixture.acknowledgeCancel();
            } else {
              fixture.acknowledgeCancel();
              failTarget();
            }
            yield* Fiber.join(interruption);
            yield* Deferred.await(closed);
            yield* successor(fixture, sql);
            expect(closeCount).toBe(1);
            expect(fixture.controls).toHaveLength(1);
            expect(fixture.controls[0]?.socket.destroyed).toBe(true);
            expect(fixture.sessions).toHaveLength(2);
            expect(fixture.queries.map((entry) => entry.text)).toEqual([
              'SELECT original',
              'SELECT successor',
            ]);
            expect(fixture.queries.at(-1)?.backend).not.toBe(target.backend);
          }),
        ),
      ));
  }

  it(
    'bounds cancellation cleanup when the control connection never closes',
    { timeout: 15_000 },
    () =>
      run(
        withFixture((fixture) =>
          Effect.gen(function* () {
            const sql = yield* makeClient(fixture);
            const query = yield* Effect.forkChild(
              sql.unsafe('SELECT original'),
            );
            yield* fixture.waitForQuery('SELECT original');
            const interruption = yield* Effect.forkChild(
              Fiber.interrupt(query),
            );
            yield* fixture.cancellationStarted;
            yield* Fiber.join(interruption);
            expect(fixture.sessions[0]?.socket.destroyed).toBe(true);
            expect(fixture.controls[0]?.socket.destroyed).toBe(true);
            fixture.complete('SELECT original', true);
            yield* successor(fixture, sql);
            expect(fixture.queries.at(-1)?.backend).not.toBe(4242);
          }),
        ),
      ),
  );

  it('handles repeated interruption with one cancellation request', () =>
    run(
      withFixture((fixture) =>
        Effect.gen(function* () {
          const sql = yield* makeClient(fixture);
          const query = yield* Effect.forkChild(sql.unsafe('SELECT original'));
          yield* fixture.waitForQuery('SELECT original');
          const first = yield* Effect.forkChild(Fiber.interrupt(query));
          yield* fixture.cancellationStarted;
          const second = yield* Effect.forkChild(Fiber.interrupt(query));
          fixture.acknowledgeCancel();
          yield* Fiber.join(first);
          yield* Fiber.join(second);
          expect(fixture.controls).toHaveLength(1);
          expect(fixture.sessions[0]?.socket.destroyed).toBe(true);
          fixture.complete('SELECT original', true);
          yield* successor(fixture, sql);
          expect(fixture.queries.at(-1)?.backend).not.toBe(4242);
        }),
      ),
    ));
});
