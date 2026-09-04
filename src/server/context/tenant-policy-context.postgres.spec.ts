import { describe, expect, it } from '@effect/vitest';
import { eq } from 'drizzle-orm';
import { Cause, ConfigProvider, Effect, Exit, Layer } from 'effect';

import { Database, databaseLayer } from '../../db';
import { createId } from '../../db/create-id';
import { tenantPrivacyPolicyVersions, tenants } from '../../db/schema';
import { resolveTenantContext } from './request-context-resolver';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const testDatabaseLayer = databaseLayer.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: {
          DATABASE_TLS_REQUIRED: 'false',
          DATABASE_URL: databaseUrl,
        },
      }),
    ),
  ),
);

describe('versioned organization privacy policy in request context', () => {
  it.effect(
    'requires a policy and reads the highest current version on every request',
    () =>
      Effect.gen(function* () {
        const database = yield* Database;
        yield* Effect.acquireUseRelease(
          Effect.sync(createId),
          (tenantId) =>
            Effect.gen(function* () {
              const domain = `${tenantId}.privacy-context.example`;
              yield* database.insert(tenants).values({
                currency: 'EUR',
                domain,
                id: tenantId,
                name: 'Privacy policy context',
              });
              const resolve = resolveTenantContext({
                protocol: 'https',
                requestHost: domain,
              });
              const withoutPolicy = yield* resolve.pipe(Effect.exit);
              expect(Exit.isFailure(withoutPolicy)).toBe(true);
              if (Exit.isFailure(withoutPolicy))
                expect(Cause.pretty(withoutPolicy.cause)).toContain(
                  'missing its required privacy policy version',
                );

              const latestPolicyId = createId();
              yield* database.insert(tenantPrivacyPolicyVersions).values([
                {
                  id: latestPolicyId,
                  privacyPolicyText: 'Latest policy',
                  tenantId,
                  version: 2,
                },
                { privacyPolicyText: 'Previous policy', tenantId, version: 1 },
              ]);
              const current = yield* resolve;
              expect(current.tenant).toMatchObject({
                id: tenantId,
                privacyPolicyText: 'Latest policy',
                privacyPolicyUrl: null,
              });
              expect(current.tenant).not.toHaveProperty(
                'privacyPolicyVersions',
              );

              yield* database
                .delete(tenantPrivacyPolicyVersions)
                .where(eq(tenantPrivacyPolicyVersions.id, latestPolicyId));
              const changed = yield* resolve;
              expect(changed.tenant?.privacyPolicyText).toBe('Previous policy');
            }),
          (tenantId) =>
            database
              .delete(tenantPrivacyPolicyVersions)
              .where(eq(tenantPrivacyPolicyVersions.tenantId, tenantId))
              .pipe(
                Effect.ensuring(
                  database
                    .delete(tenants)
                    .where(eq(tenants.id, tenantId))
                    .pipe(Effect.orDie),
                ),
                Effect.orDie,
              ),
        );
      }).pipe(Effect.provide(testDatabaseLayer)),
  );
});
