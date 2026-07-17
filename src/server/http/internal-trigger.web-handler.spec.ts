import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { handleInternalTriggerWebRequest } from './internal-trigger.web-handler';

const request = (body: unknown): Request =>
  new Request('https://worker.example.test/internal/worker/email-delivery', {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

describe('internal trigger handler', () => {
  it.effect('rejects excess and out-of-range arguments', () =>
    Effect.gen(function* () {
      const operation = () => Effect.succeed({ processed: 0 });
      const excess = yield* handleInternalTriggerWebRequest(
        request({ arbitraryCommand: 'rm -rf /' }),
        operation,
      );
      const outOfRange = yield* handleInternalTriggerWebRequest(
        request({ limit: 101 }),
        operation,
      );

      expect(excess.status).toBe(400);
      expect(outOfRange.status).toBe(400);
    }),
  );

  it.effect('runs a bounded authenticated operation', () =>
    Effect.gen(function* () {
      const response = yield* handleInternalTriggerWebRequest(
        request({ limit: 25 }),
        ({ limit }) => Effect.succeed({ processed: limit }),
      );

      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.json());
      expect(body).toEqual({ processed: 25 });
    }),
  );
});
