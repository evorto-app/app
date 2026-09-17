import { describe, expect, it, vi } from 'vitest';

import { safeServerErrorSummary } from './safe-server-error-summary';

const sensitiveEmail = 'person@example.test';
const sensitiveIban = 'DE89370400440532013000';
const sensitiveSql = 'select * from users where email = $1';
const sensitiveTransferToken = 'transfer-token-do-not-log';

describe('safeServerErrorSummary', () => {
  it('keeps only allowlisted diagnostics from nested failures', () => {
    const summary = safeServerErrorSummary('registration.transfer.claim', {
      body: {
        token: sensitiveTransferToken,
      },
      cause: {
        code: '23505',
        constraint: 'registration_transfers_claim_code_unique',
        detail: `Key (email)=(${sensitiveEmail}) already exists`,
        parameters: [sensitiveEmail, sensitiveIban, sensitiveTransferToken],
        query: sensitiveSql,
      },
      raw: {
        providerBody: {
          email: sensitiveEmail,
          iban: sensitiveIban,
        },
        requestId: 'req_safe_123',
      },
      stack: `Error: ${sensitiveSql}`,
    });

    expect(summary).toEqual({
      constraint: 'registration_transfers_claim_code_unique',
      operation: 'registration.transfer.claim',
      requestId: 'req_safe_123',
      sqlState: '23505',
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(sensitiveEmail);
    expect(serialized).not.toContain(sensitiveIban);
    expect(serialized).not.toContain(sensitiveSql);
    expect(serialized).not.toContain(sensitiveTransferToken);
  });

  it('does not copy arbitrary values into diagnostic fields', () => {
    const summary = safeServerErrorSummary(sensitiveSql, {
      code: sensitiveSql,
      constraint: sensitiveTransferToken,
      requestId: sensitiveEmail,
    });

    expect(summary).toEqual({ operation: 'server.operation' });
  });

  it('does not invoke error getters while collecting diagnostics', () => {
    const error = Object.create(null, {
      code: { enumerable: true, value: '23505' },
      requestId: {
        enumerable: true,
        get: () => {
          throw new Error('must not be called');
        },
      },
    });

    expect(safeServerErrorSummary('database.insert', error)).toEqual({
      operation: 'database.insert',
      sqlState: '23505',
    });
  });

  it('preserves ordinary inherited data properties without invoking inherited getters', () => {
    const getter = vi.fn(() => {
      throw new Error('inherited getter must not be called');
    });
    const prototype = Object.create(null, {
      code: { value: '23505' },
      constraint: { value: 'registrations_user_unique' },
      requestId: { get: getter },
    });

    expect(
      safeServerErrorSummary('database.insert', Object.create(prototype)),
    ).toEqual({
      constraint: 'registrations_user_unique',
      operation: 'database.insert',
      sqlState: '23505',
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(['cycle', 'fresh'] as const)(
    'bounds a %s prototype chain without depending on a trap to terminate it',
    (kind) => {
      const prototypeReads = new Map<string | symbol, number>();
      let inspectedKey: string | symbol = '';
      const createPrototype = (): object => {
        const proxy = new Proxy(
          {},
          {
            getOwnPropertyDescriptor(target, key) {
              inspectedKey = key;
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
            getPrototypeOf(): object {
              const reads = (prototypeReads.get(inspectedKey) ?? 0) + 1;
              prototypeReads.set(inspectedKey, reads);
              // Fail finitely against the old unbounded loop instead of hanging Vitest.
              if (reads > 64) throw new Error('prototype traversal tripwire');
              return kind === 'cycle' ? proxy : createPrototype();
            },
          },
        );
        return proxy;
      };

      expect(
        safeServerErrorSummary('database.insert', createPrototype()),
      ).toEqual({
        operation: 'database.insert',
      });
      expect(prototypeReads.size).toBeGreaterThan(0);
      expect(Math.max(...prototypeReads.values())).toBeLessThanOrEqual(32);
    },
  );

  it('reads a reasons array length through its descriptor without invoking a get trap', () => {
    const get = vi.fn(() => {
      throw new Error('normal reasons property reads must not be used');
    });
    const reasons = new Proxy([{ code: '23505' }], { get });

    expect(safeServerErrorSummary('database.insert', { reasons })).toEqual({
      operation: 'database.insert',
      sqlState: '23505',
    });
    expect(get).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Infinity])(
    'ignores an invalid reasons length descriptor: %s',
    (length) => {
      const reasons = new Proxy([{ code: '23505' }], {
        getOwnPropertyDescriptor(target, key) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
          return key === 'length' && descriptor
            ? { ...descriptor, value: length }
            : descriptor;
        },
      });

      expect(safeServerErrorSummary('database.insert', { reasons })).toEqual({
        operation: 'database.insert',
      });
    },
  );

  it('does not coerce an untrusted reasons length descriptor', () => {
    const coerce = vi.fn(() => {
      throw new Error('length coercion must not be called');
    });
    const reasons = new Proxy([{ code: '23505' }], {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return key === 'length' && descriptor
          ? { ...descriptor, value: { [Symbol.toPrimitive]: coerce } }
          : descriptor;
      },
    });

    expect(safeServerErrorSummary('database.insert', { reasons })).toEqual({
      operation: 'database.insert',
    });
    expect(coerce).not.toHaveBeenCalled();
  });

  it.each(['root', 'headers', 'reasons', 'cause'] as const)(
    'ignores a revoked Proxy at %s while retaining other safe diagnostics',
    (location) => {
      const { proxy, revoke } = Proxy.revocable([], {});
      revoke();
      const error =
        location === 'root' ? proxy : { code: '23505', [location]: proxy };

      expect(safeServerErrorSummary('database.insert', error)).toEqual({
        operation: 'database.insert',
        ...(location !== 'root' && { sqlState: '23505' }),
      });
    },
  );

  it.each(['objects', 'primitives', 'sparse'])(
    'bounds reason entry reads for a large %s array',
    (kind) => {
      const entries: unknown[] = Array.from({ length: 10_000 }, () =>
        kind === 'objects' ? {} : null,
      );
      if (kind === 'sparse') {
        entries.length = 0;
        entries.length = 10_000;
      }
      let entryReads = 0;
      const recordEntryRead = (key: string | symbol) => {
        if (!(typeof key === 'string' && /^\d+$/u.test(key))) {
          return;
        }

        entryReads += 1;
        if (entryReads > 32) {
          throw new Error('reason entry scan exceeded its budget');
        }
      };
      const reasons = new Proxy(entries, {
        get(target, key, receiver) {
          recordEntryRead(key);
          return Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor(target, key) {
          recordEntryRead(key);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });

      expect(safeServerErrorSummary('database.insert', { reasons })).toEqual({
        operation: 'database.insert',
      });
      expect(entryReads).toBeGreaterThan(0);
      expect(entryReads).toBeLessThanOrEqual(32);
    },
  );

  it('shares the reason scan budget across nested failures', () => {
    let entryReads = 0;
    const trackEntries = (entries: unknown[]) =>
      new Proxy(entries, {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/u.test(key)) {
            entryReads += 1;
          }
          return Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor(target, key) {
          if (typeof key === 'string' && /^\d+$/u.test(key)) {
            entryReads += 1;
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
    const nested = {
      code: '23505',
      reasons: trackEntries(Array.from({ length: 24 }, () => null)),
    };
    const reasons = trackEntries([
      nested,
      ...Array.from({ length: 23 }, () => null),
    ]);

    expect(safeServerErrorSummary('database.insert', { reasons })).toEqual({
      operation: 'database.insert',
      sqlState: '23505',
    });
    expect(entryReads).toBeLessThanOrEqual(32);
  });

  it('does not invoke reason iterators or entry getters', () => {
    const reasons = [{ code: '23505' }];
    const getter = vi.fn(() => {
      throw new Error('reason getter must not be called');
    });
    const iterator = vi.fn(() => {
      throw new Error('reason iterator must not be called');
    });
    Object.defineProperties(reasons, {
      '1': { get: getter },
      [Symbol.iterator]: { value: iterator },
    });

    expect(safeServerErrorSummary('database.insert', { reasons })).toEqual({
      operation: 'database.insert',
      sqlState: '23505',
    });
    expect(getter).not.toHaveBeenCalled();
    expect(iterator).not.toHaveBeenCalled();
  });

  it('preserves diagnostics through cycles and repeated failure aliases', () => {
    const reasons: unknown[] = [];
    const failure = {
      code: '23505',
      constraint: 'registrations_user_unique',
      reasons,
    };
    const error = {
      cause: failure,
      error: failure,
      raw: failure,
      reason: failure,
      reasons,
    };
    reasons.push(error, failure, {
      headers: { 'request-id': 'req_safe_123' },
      message: sensitiveEmail,
    });

    expect(safeServerErrorSummary('database.insert', error)).toEqual({
      constraint: 'registrations_user_unique',
      operation: 'database.insert',
      requestId: 'req_safe_123',
      sqlState: '23505',
    });
  });
});
