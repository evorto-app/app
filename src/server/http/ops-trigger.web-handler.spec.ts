import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';

import { OpsCommandError } from '../ops/schema-operations';
import { handleOpsJsonTriggerWebRequest } from './ops-trigger.web-handler';

describe('ops trigger web handler', () => {
  it.effect('returns only the bounded ops diagnostic on failure', () =>
    Effect.gen(function* () {
      const response = yield* handleOpsJsonTriggerWebRequest(
        new Request('https://ops.example/internal/ops/schema-explain', {
          body: '{}',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }),
        Schema.Struct({}),
        () =>
          Effect.fail(
            new OpsCommandError({
              diagnostic: 'database-authentication-failed',
              message:
                'sensitive database URL and provider output must remain private',
            }),
          ),
      );

      expect(response.status).toBe(500);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(yield* Effect.promise(() => response.json())).toEqual({
        detail: 'database-authentication-failed',
        error: 'ops-command-failed',
      });
    }),
  );

  it.effect('preserves successful bounded responses', () =>
    Effect.gen(function* () {
      const response = yield* handleOpsJsonTriggerWebRequest(
        new Request('https://ops.example/internal/ops/schema-explain', {
          body: '{}',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }),
        Schema.Struct({}),
        () => Effect.succeed({ safe: true }),
      );

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toEqual({
        safe: true,
      });
    }),
  );
});
