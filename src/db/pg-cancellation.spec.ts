import * as PgClient from '@effect/sql-pg/PgClient';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { Cause, Deferred, Effect, Fiber } from 'effect';
import * as TestClock from 'effect/testing/TestClock';
import * as Reactivity from 'effect/unstable/reactivity/Reactivity';
import { Client, Pool, type PoolClient } from 'pg';

interface PendingQuery {
  readonly backend: number;
  readonly complete: (error?: Error) => void;
  completed: boolean;
  readonly text: string;
}

const createPoolFixture = () => {
  const pool = new Pool({ max: 2 });
  const queries: PendingQuery[] = [];
  const releases: { backend: number; destroyed: boolean }[] = [];
  const clients: {
    backend: number;
    client: PoolClient;
    ended: boolean;
    leased: boolean;
  }[] = [];
  const waiting: (() => void)[] = [];
  const queryStarted = new Map<string, Deferred.Deferred<undefined>>();
  const cancellationStarted = Deferred.makeUnsafe<undefined>();
  const acquisitionHeld = Deferred.makeUnsafe<undefined>();
  let nextBackend = 4242;
  let holdNext = false;
  let heldAcquisition: (() => void) | undefined;
  let draining = false;

  const queryText = (input: unknown): string => {
    if (typeof input === 'string') return input;
    if (
      typeof input === 'object' &&
      input !== null &&
      'text' in input &&
      typeof input.text === 'string'
    )
      return input.text;
    throw new Error('Expected a PostgreSQL query text');
  };

  const makeClient = () => {
    const client = Object.assign(new Client(), {
      release: (_error?: boolean | Error) => {
        throw new Error('Client has no active lease');
      },
    });
    const state = {
      backend: nextBackend++,
      client,
      ended: false,
      leased: false,
    };
    Object.defineProperty(client, 'processID', { value: state.backend });
    vi.spyOn(client, 'end').mockImplementation((callback) => {
      state.ended = true;
      if (callback) Reflect.apply(callback, client, []);
      return Promise.resolve();
    });
    vi.spyOn(client, 'query').mockImplementation((...args: unknown[]) => {
      const text = queryText(args[0]);
      const callback = args.at(-1);
      if (typeof callback !== 'function')
        throw new Error('Expected a driver callback');
      const closedAtSubmission = state.ended;
      const query: PendingQuery = {
        backend: state.backend,
        complete: (error) => {
          if (query.completed)
            throw new Error('Query callback completed twice');
          query.completed = true;
          // node-postgres supplies undefined for successful callback errors.
          Reflect.apply(callback, client, [
            error,
            {
              command: 'SELECT',
              fields: [],
              rowCount: 1,
              rows: [{ ok: true }],
            },
          ]);
        },
        completed: false,
        text,
      };
      queries.push(query);
      const started = queryStarted.get(text);
      if (started) Deferred.doneUnsafe(started, Effect.succeed(undefined));
      if (text.startsWith('SELECT pg_cancel_backend('))
        Deferred.doneUnsafe(cancellationStarted, Effect.succeed(undefined));
      if (closedAtSubmission)
        query.complete(new Error('Client was closed and is not queryable'));
      else if (
        draining ||
        text === 'BEGIN' ||
        text === 'ROLLBACK' ||
        text === 'COMMIT'
      )
        query.complete();
    });
    clients.push(state);
    return state;
  };

  vi.spyOn(pool, 'connect').mockImplementation((callback) => {
    const acquire = () => {
      let state = clients.find((entry) => !entry.leased && !entry.ended);
      if (!state && clients.filter((entry) => !entry.ended).length < 2)
        state = makeClient();
      if (!state) {
        waiting.push(acquire);
        return;
      }
      const selected = state;
      selected.leased = true;
      let released = false;
      const release = (error?: boolean | Error) => {
        if (released) throw new Error('Lease released twice');
        released = true;
        selected.leased = false;
        const destroyed = Boolean(error) || selected.ended;
        if (destroyed) selected.ended = true;
        releases.push({ backend: selected.backend, destroyed });
        const next = waiting.shift();
        if (next) queueMicrotask(next);
      };
      selected.client.release = release;
      callback(undefined, selected.client, release);
    };
    if (holdNext) {
      holdNext = false;
      heldAcquisition = acquire;
      Deferred.doneUnsafe(acquisitionHeld, Effect.succeed(undefined));
    } else acquire();
  });

  const complete = (text: string, error?: Error) => {
    const query = queries.find(
      (entry) => entry.text === text && !entry.completed,
    );
    if (!query) throw new Error(`Expected pending query: ${text}`);
    query.complete(error);
  };
  const acknowledgeCancel = (error?: Error) => {
    const query = queries.find(
      (entry) =>
        entry.text.startsWith('SELECT pg_cancel_backend(') && !entry.completed,
    );
    if (!query) throw new Error('Expected pending cancellation');
    query.complete(error);
  };
  const releaseHeldAcquisition = () => {
    const acquire = heldAcquisition;
    if (!acquire) throw new Error('Expected held acquisition');
    heldAcquisition = undefined;
    acquire();
  };
  return {
    acknowledgeCancel,
    acquisitionHeld: Deferred.await(acquisitionHeld),
    cancellationStarted: Deferred.await(cancellationStarted),
    clients,
    complete,
    drain: () => {
      draining = true;
      if (heldAcquisition) releaseHeldAcquisition();
      for (const query of queries) if (!query.completed) query.complete();
    },
    holdNextAcquisition: () => {
      holdNext = true;
    },
    pool,
    queries,
    releaseHeldAcquisition,
    releases,
    waitForQuery: (text: string) => {
      if (queries.some((entry) => entry.text === text)) return Effect.void;
      const gate = Deferred.makeUnsafe<undefined>();
      queryStarted.set(text, gate);
      return Deferred.await(gate);
    },
  };
};

const withPool = <E, R>(
  body: (
    fixture: ReturnType<typeof createPoolFixture>,
    sql: PgClient.PgClient,
  ) => Effect.Effect<void, E, R>,
) => {
  const fixture = createPoolFixture();
  return Effect.gen(function* () {
    const sql = yield* PgClient.fromPool({
      acquire: Effect.succeed(fixture.pool),
    });
    yield* body(fixture, sql);
  }).pipe(
    Effect.ensuring(Effect.sync(fixture.drain)),
    Effect.scoped,
    Effect.provide(Reactivity.layer),
  );
};

const interruptedQueryError = () =>
  Object.assign(new Error('canceling statement due to user request'), {
    code: '57014',
  });

afterEach(() => vi.restoreAllMocks());

describe('PostgreSQL query cancellation ownership', () => {
  it.effect(
    'normally completed queries reuse their healthy backend without issuing cancellation',
    () =>
      withPool((fixture, sql) =>
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(sql.unsafe('SELECT original'));
          yield* fixture.waitForQuery('SELECT original');
          fixture.complete('SELECT original');
          yield* Fiber.join(first);
          yield* Fiber.interrupt(first);
          const second = yield* Effect.forkChild(
            sql.unsafe('SELECT successor'),
          );
          yield* fixture.waitForQuery('SELECT successor');
          fixture.complete('SELECT successor');
          yield* Fiber.join(second);
          expect(fixture.queries.map((query) => query.backend)).toEqual([
            4242, 4242,
          ]);
          expect(fixture.releases).toEqual([
            { backend: 4242, destroyed: false },
            { backend: 4242, destroyed: false },
          ]);
        }),
      ),
  );

  for (const ordering of ['query-first', 'cancel-first']) {
    it.effect(
      `holds the pooled lease until both callbacks complete: ${ordering}`,
      () =>
        withPool((fixture, sql) =>
          Effect.gen(function* () {
            const first = yield* Effect.forkChild(
              sql.unsafe('SELECT original'),
            );
            yield* fixture.waitForQuery('SELECT original');
            const interrupt = yield* Effect.forkChild(Fiber.interrupt(first));
            yield* fixture.cancellationStarted;
            if (ordering === 'query-first') fixture.complete('SELECT original');
            else fixture.acknowledgeCancel();
            expect(first.pollUnsafe()).toBeUndefined();
            expect(
              fixture.releases.filter((entry) => entry.backend === 4242),
            ).toEqual([]);
            if (ordering === 'query-first') fixture.acknowledgeCancel();
            else fixture.complete('SELECT original', interruptedQueryError());
            yield* Fiber.join(interrupt);
            const exit = yield* Fiber.await(first);
            expect(exit._tag).toBe('Failure');
            if (exit._tag === 'Failure')
              expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
            const successor = yield* Effect.forkChild(
              sql.unsafe('SELECT successor'),
            );
            yield* fixture.waitForQuery('SELECT successor');
            fixture.complete('SELECT successor');
            yield* Fiber.join(successor);
            expect(
              fixture.releases.filter((entry) => entry.backend === 4242),
            ).toHaveLength(2);
            expect(fixture.clients[0]?.client.listenerCount('error')).toBe(0);
          }),
        ),
    );

    it.effect(
      `keeps transaction rollback behind both callbacks: ${ordering}`,
      () =>
        withPool((fixture, sql) =>
          Effect.gen(function* () {
            const transaction = yield* Effect.forkChild(
              sql.withTransaction(sql.unsafe('SELECT original')),
            );
            yield* fixture.waitForQuery('SELECT original');
            const interrupt = yield* Effect.forkChild(
              Fiber.interrupt(transaction),
            );
            yield* fixture.cancellationStarted;
            if (ordering === 'query-first') fixture.complete('SELECT original');
            else fixture.acknowledgeCancel();
            expect(
              fixture.queries.some((query) => query.text === 'ROLLBACK'),
            ).toBe(false);
            expect(
              fixture.releases.filter((entry) => entry.backend === 4242),
            ).toEqual([]);
            if (ordering === 'query-first') fixture.acknowledgeCancel();
            else fixture.complete('SELECT original', interruptedQueryError());
            yield* Fiber.join(interrupt);
            const exit = yield* Fiber.await(transaction);
            expect(exit._tag).toBe('Failure');
            if (exit._tag === 'Failure')
              expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
            expect(
              fixture.queries.filter((query) => query.text === 'ROLLBACK'),
            ).toHaveLength(1);
            expect(
              fixture.releases.filter((entry) => entry.backend === 4242),
            ).toEqual([{ backend: 4242, destroyed: false }]);
          }),
        ),
    );
  }

  it.effect(
    'does not dispatch a delayed cancellation after its original query has finished',
    () =>
      withPool((fixture, sql) =>
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(sql.unsafe('SELECT original'));
          yield* fixture.waitForQuery('SELECT original');
          fixture.holdNextAcquisition();
          const interrupt = yield* Effect.forkChild(Fiber.interrupt(first));
          yield* fixture.acquisitionHeld;
          fixture.complete('SELECT original');
          yield* Fiber.join(interrupt);
          const successor = yield* Effect.forkChild(
            sql.unsafe('SELECT successor'),
          );
          yield* fixture.waitForQuery('SELECT successor');
          fixture.releaseHeldAcquisition();
          expect(
            fixture.queries.some((query) =>
              query.text.startsWith('SELECT pg_cancel_backend('),
            ),
          ).toBe(false);
          fixture.complete('SELECT successor');
          yield* Fiber.join(successor);
        }),
      ),
  );

  it.effect(
    'releases a late original acquisition without running a canceled query',
    () =>
      withPool((fixture, sql) =>
        Effect.gen(function* () {
          fixture.holdNextAcquisition();
          const first = yield* Effect.forkChild(sql.unsafe('SELECT original'));
          yield* fixture.acquisitionHeld;
          yield* Fiber.interrupt(first);
          fixture.releaseHeldAcquisition();
          expect(fixture.queries).toEqual([]);
          expect(fixture.releases).toEqual([
            { backend: 4242, destroyed: false },
          ]);
          expect(fixture.clients[0]?.client.listenerCount('error')).toBe(0);
        }),
      ),
  );

  for (const dispatched of [false, true]) {
    it.effect(
      `retires an uncertain backend on cancellation timeout; dispatched=${dispatched}`,
      () =>
        withPool((fixture, sql) =>
          Effect.gen(function* () {
            const first = yield* Effect.forkChild(
              sql.unsafe('SELECT original'),
            );
            yield* fixture.waitForQuery('SELECT original');
            if (!dispatched) fixture.holdNextAcquisition();
            const interrupt = yield* Effect.forkChild(Fiber.interrupt(first));
            yield* dispatched
              ? fixture.cancellationStarted
              : fixture.acquisitionHeld;
            yield* TestClock.adjust('5 seconds');
            yield* Fiber.join(interrupt);
            expect(fixture.clients[0]?.ended).toBe(true);
            expect(
              fixture.releases.filter((entry) => entry.backend === 4242),
            ).toEqual([{ backend: 4242, destroyed: true }]);
            fixture.complete('SELECT original', interruptedQueryError());
            if (dispatched) fixture.acknowledgeCancel();
            else fixture.releaseHeldAcquisition();
            expect(
              fixture.releases.filter((entry) => entry.backend === 4242),
            ).toHaveLength(1);
            const successor = yield* Effect.forkChild(
              sql.unsafe('SELECT successor'),
            );
            yield* fixture.waitForQuery('SELECT successor');
            const successorQuery = fixture.queries.find(
              (query) => query.text === 'SELECT successor',
            );
            expect(successorQuery?.backend).not.toBe(4242);
            fixture.complete('SELECT successor');
            yield* Fiber.join(successor);
            if (!dispatched)
              expect(
                fixture.queries.some((query) =>
                  query.text.startsWith('SELECT pg_cancel_backend('),
                ),
              ).toBe(false);
            expect(fixture.clients[0]?.client.listenerCount('error')).toBe(0);
          }),
        ),
    );
  }

  it.effect(
    'fails closed instead of issuing rollback on an uncertain transaction backend',
    () =>
      withPool((fixture, sql) =>
        Effect.gen(function* () {
          const transaction = yield* Effect.forkChild(
            sql.withTransaction(sql.unsafe('SELECT original')),
          );
          yield* fixture.waitForQuery('SELECT original');
          const interrupt = yield* Effect.forkChild(
            Fiber.interrupt(transaction),
          );
          yield* fixture.cancellationStarted;
          yield* TestClock.adjust('5 seconds');
          yield* Fiber.join(interrupt);
          const exit = yield* Fiber.await(transaction);
          expect(exit._tag).toBe('Failure');
          if (exit._tag === 'Failure') {
            expect(Cause.hasDies(exit.cause)).toBe(true);
            expect(Cause.pretty(exit.cause)).toMatch(/cancellation/iu);
          }
          expect(
            fixture.queries.some((query) => query.text === 'ROLLBACK'),
          ).toBe(false);
          expect(
            fixture.releases.filter((entry) => entry.backend === 4242),
          ).toEqual([{ backend: 4242, destroyed: true }]);
          fixture.complete('SELECT original', interruptedQueryError());
          fixture.acknowledgeCancel();
          expect(
            fixture.releases.filter((entry) => entry.backend === 4242),
          ).toHaveLength(1);
        }),
      ),
  );

  it.effect(
    'releases once when a target error and its delayed query callback race cancellation',
    () =>
      withPool((fixture, sql) =>
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(sql.unsafe('SELECT original'));
          yield* fixture.waitForQuery('SELECT original');
          const interrupt = yield* Effect.forkChild(Fiber.interrupt(first));
          yield* fixture.cancellationStarted;
          const target = fixture.clients[0];
          if (!target) throw new Error('Expected the target backend');
          target.client.emit('error', new Error('Connection terminated'));
          fixture.complete(
            'SELECT original',
            new Error('Connection terminated'),
          );
          fixture.acknowledgeCancel();
          yield* Fiber.join(interrupt);
          expect(
            fixture.releases.filter((entry) => entry.backend === 4242),
          ).toEqual([{ backend: 4242, destroyed: true }]);
          expect(target.client.listenerCount('error')).toBe(0);
        }),
      ),
  );

  for (const failure of ['control-error', 'query-error']) {
    it.effect(
      `retires both connections when cancellation fails: ${failure}`,
      () =>
        withPool((fixture, sql) =>
          Effect.gen(function* () {
            const first = yield* Effect.forkChild(
              sql.unsafe('SELECT original'),
            );
            yield* fixture.waitForQuery('SELECT original');
            const interrupt = yield* Effect.forkChild(Fiber.interrupt(first));
            yield* fixture.cancellationStarted;
            const control = fixture.clients[1];
            if (!control) throw new Error('Expected the cancellation backend');
            const cancellation = fixture.queries.find((query) =>
              query.text.startsWith('SELECT pg_cancel_backend('),
            );
            if (!cancellation) throw new Error('Expected cancellation query');
            const error = new Error('Cancellation connection failed');
            if (failure === 'control-error')
              control.client.emit('error', error);
            else fixture.acknowledgeCancel(error);
            yield* Fiber.join(interrupt);
            expect(fixture.clients[0]?.ended).toBe(true);
            expect(fixture.releases).toEqual([
              { backend: 4243, destroyed: true },
              { backend: 4242, destroyed: true },
            ]);
            fixture.complete('SELECT original', interruptedQueryError());
            if (failure === 'control-error') cancellation.complete(error);
            expect(fixture.releases).toHaveLength(2);
            expect(control.client.listenerCount('error')).toBe(0);
            expect(fixture.clients[0]?.client.listenerCount('error')).toBe(0);
            const successor = yield* Effect.forkChild(
              sql.unsafe('SELECT successor'),
            );
            yield* fixture.waitForQuery('SELECT successor');
            expect(fixture.queries.at(-1)?.backend).not.toBe(4242);
            fixture.complete('SELECT successor');
            yield* Fiber.join(successor);
          }),
        ),
    );
  }

  it.effect(
    'keeps cancellation cleanup safe when the query receives another interrupt',
    () =>
      withPool((fixture, sql) =>
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(sql.unsafe('SELECT original'));
          yield* fixture.waitForQuery('SELECT original');
          const interrupt = yield* Effect.forkChild(Fiber.interrupt(first));
          yield* fixture.cancellationStarted;
          const secondInterrupt = yield* Effect.forkChild(
            Fiber.interrupt(first),
          );
          expect(fixture.releases).toEqual([]);
          fixture.complete('SELECT original', interruptedQueryError());
          fixture.acknowledgeCancel();
          yield* Fiber.join(interrupt);
          yield* Fiber.join(secondInterrupt);
          expect(fixture.clients[0]?.ended).toBe(false);
          expect(fixture.releases).toEqual([
            { backend: 4243, destroyed: false },
            { backend: 4242, destroyed: false },
          ]);
          expect(fixture.releases).toHaveLength(2);
          expect(fixture.clients[0]?.client.listenerCount('error')).toBe(0);
          expect(fixture.clients[1]?.client.listenerCount('error')).toBe(0);
        }),
      ),
  );
});
