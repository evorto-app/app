import { describe, expect, it } from '@effect/vitest';
import { inArray, sql } from 'drizzle-orm';
import { ConfigProvider, Effect, Layer } from 'effect';

import { Database, databaseLayer } from '../../../../db';
import { createId } from '../../../../db/create-id';
import { platformAuditEntries } from '../../../../db/schema';
import { readGlobalAdminPlatformAuditPage } from './global-admin.handlers';

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

describe('platform audit cursor precision', () => {
  it.effect(
    'retains equal and adjacent microsecond timestamps across pages',
    () =>
      Effect.gen(function* () {
        const database = yield* Database;
        yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            const prefix = createId().slice(0, 17);
            return Array.from(
              { length: 53 },
              (_, index) => `${prefix}${String(index).padStart(3, '0')}`,
            );
          }),
          (ids) =>
            Effect.gen(function* () {
              const targetTenantId = createId();
              const insert = database.insert(platformAuditEntries);
              yield* insert.values(
                ids.map<Parameters<typeof insert.values>[0][number]>(
                  (id, index) => ({
                    action: 'tenant.create',
                    actorEmail: 'audit-pagination@example.org',
                    actorId: 'audit-pagination-test',
                    after: {
                      resourceId: targetTenantId,
                      resourceType: 'tenant',
                      state: { name: 'Audit pagination' },
                    },
                    before: null,
                    createdAt: sql`${index < 51 ? '9000-01-01T00:00:00.123456Z' : index === 51 ? '9000-01-01T00:00:00.123455Z' : '9000-01-01T00:00:00.123000Z'}::timestamp`,
                    id,
                    reason: 'Verify fractional timestamp pagination',
                    targetTenantId,
                  }),
                ),
              );

              const first = yield* readGlobalAdminPlatformAuditPage(null);
              expect(first.items.map((entry) => entry.id)).toEqual(
                ids.slice(0, 50),
              );
              if (!first.nextCursor)
                throw new Error('Expected a cursor after the first audit page');

              const second = yield* readGlobalAdminPlatformAuditPage(
                first.nextCursor,
              );
              expect(second.items.slice(0, 3).map((entry) => entry.id)).toEqual(
                ids.slice(50),
              );
              expect(first.nextCursor).toEqual({
                createdAt: '9000-01-01T00:00:00.123456Z',
                id: ids[49],
              });
              const ownedIds = [...first.items, ...second.items]
                .map((entry) => entry.id)
                .filter((id) => ids.includes(id));
              expect(ownedIds).toEqual(ids);
              expect(new Set(ownedIds).size).toBe(53);
            }),
          (ids) =>
            database
              .delete(platformAuditEntries)
              .where(inArray(platformAuditEntries.id, ids))
              .pipe(Effect.orDie),
        );
      }).pipe(Effect.provide(testDatabaseLayer)),
  );
});
