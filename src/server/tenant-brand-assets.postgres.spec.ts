import { Database, databaseLayer } from '@db/index';
import { createNodePgPoolConfig } from '@db/pg-connection-config';
import { relations } from '@db/relations';
import { tenantBrandAssetUploads, tenants } from '@db/schema';
import { describe, expect, it } from '@effect/vitest';
import {
  RpcBadRequestError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  Cause,
  ConfigProvider,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
} from 'effect';
import { TestClock } from 'effect/testing';
import { HttpRouter } from 'effect/unstable/http';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { DeploymentRuntimeConfig } from './config/deployment-config';
import {
  workerReceiptOrphanCleanupPath,
  workerReceiptOrphanCleanupRouteLayer,
} from './http/worker-media-cleanup.route';
import {
  ObjectStorage,
  ObjectStorageNotFoundError,
} from './integrations/object-storage';
import {
  associateTenantBrandAssets,
  processTenantBrandAssetOrphans,
  uploadTenantBrandAsset,
} from './tenant-brand-assets';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl)
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const serviceLayer = databaseLayer.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: { DATABASE_TLS_REQUIRED: 'false', DATABASE_URL: databaseUrl },
      }),
    ),
  ),
);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const retention = 24 * 60 * 60 * 1000;
const retry = 5 * 60 * 1000;

const fixture = () =>
  Effect.gen(function* () {
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => new Pool(createNodePgPoolConfig({ databaseUrl }))),
      (pool) => Effect.promise(() => pool.end()),
    );
    const database = drizzle({ client: pool, relations });
    const tenantId = `brand-${randomUUID().slice(0, 8)}`;
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        database
          .delete(tenantBrandAssetUploads)
          .where(eq(tenantBrandAssetUploads.tenantId, tenantId)),
      ).pipe(
        Effect.ensuring(
          Effect.promise(() =>
            database.delete(tenants).where(eq(tenants.id, tenantId)),
          ),
        ),
        Effect.asVoid,
      ),
    );
    yield* Effect.promise(() =>
      database.insert(tenants).values({
        currency: 'EUR',
        domain: `${tenantId}.test`,
        id: tenantId,
        name: 'Brand fixture',
      }),
    );
    const objects = new Set<string>();
    const deleted: string[] = [];
    const storage = (
      overrides: Partial<Effect.Success<typeof ObjectStorage.make>> = {},
    ) =>
      Layer.succeed(ObjectStorage, {
        deleteObject: (key) =>
          Effect.sync(() => {
            deleted.push(key);
            objects.delete(key);
          }),
        exists: (key) => Effect.succeed(objects.has(key)),
        get: () => Effect.die('Unexpected storage read'),
        metadata: () => Effect.die('Unexpected storage metadata'),
        presignGet: () => Effect.die('Unexpected signing'),
        presignPost: () => Effect.die('Unexpected signing'),
        put: ({ key }) =>
          Effect.sync(() => {
            objects.add(key);
            return {
              storageKey: key,
              storageUrl: `https://storage.test/${key}`,
            };
          }),
        ...overrides,
      });
    const upload = () =>
      uploadTenantBrandAsset({
        fileBase64: png.toString('base64'),
        fileName: 'logo.png',
        fileSizeBytes: png.length,
        kind: 'logo',
        mimeType: 'image/png',
        tenantId,
      });
    const rows = () =>
      Effect.promise(() =>
        database
          .select()
          .from(tenantBrandAssetUploads)
          .where(eq(tenantBrandAssetUploads.tenantId, tenantId)),
      );
    const expire = () =>
      Effect.promise(() =>
        database
          .update(tenantBrandAssetUploads)
          .set({ expiresAt: new Date(0), nextCleanupAt: new Date(0) })
          .where(eq(tenantBrandAssetUploads.tenantId, tenantId)),
      );
    const databaseService = yield* Database;
    const save = (logoUrl: null | string, afterAssociation = Effect.void) =>
      Database.use((database) =>
        database.transaction((transaction) =>
          Effect.gen(function* () {
            const [tenant] = yield* transaction
              .select()
              .from(tenants)
              .where(eq(tenants.id, tenantId))
              .for('update');
            if (!tenant)
              return yield* Effect.die('Missing fixture organization');
            const next = { faviconUrl: tenant.faviconUrl, logoUrl };
            yield* associateTenantBrandAssets(transaction, {
              next,
              previous: tenant,
              tenantId,
            });
            yield* afterAssociation;
            yield* transaction
              .update(tenants)
              .set(next)
              .where(eq(tenants.id, tenantId));
          }),
        ),
      ).pipe(Effect.provideService(Database, databaseService));
    return {
      database,
      deleted,
      expire,
      objects,
      pool,
      rows,
      save,
      storage,
      tenantId,
      upload,
    };
  });

describe('organization image ownership in PostgreSQL', () => {
  it.effect(
    'commits ownership before PUT without holding organization or asset locks',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const result = yield* f.upload().pipe(
          Effect.provide(
            f.storage({
              put: ({ key }) =>
                Effect.gen(function* () {
                  const [owned] = yield* f.rows();
                  expect(owned?.storageKey).toBe(key);
                  expect(owned?.status).toBe('uploading');
                  expect(owned?.putSucceededAt).toBeNull();
                  yield* Effect.promise(() =>
                    f.database.transaction(async (tx) => {
                      await tx
                        .select()
                        .from(tenants)
                        .where(eq(tenants.id, f.tenantId))
                        .for('update', { noWait: true });
                      await tx
                        .select()
                        .from(tenantBrandAssetUploads)
                        .where(eq(tenantBrandAssetUploads.storageKey, key))
                        .for('update', { noWait: true });
                    }),
                  );
                  f.objects.add(key);
                  return {
                    storageKey: key,
                    storageUrl: 'https://storage.test/image',
                  };
                }),
            }),
          ),
        );
        expect((yield* f.rows())[0]).toMatchObject({
          assetUrl: result.assetUrl,
          putSucceededAt: expect.any(Date),
          status: 'ready',
        });
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'retains uncertain failed PUT ownership through successful and missing-object cleanup',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const failure = yield* f.upload().pipe(
          Effect.provide(
            f.storage({
              put: () =>
                Effect.fail(
                  new RpcInternalServerError({
                    message: 'Unknown storage outcome',
                  }),
                ),
            }),
          ),
          Effect.exit,
        );
        expect(Exit.isFailure(failure)).toBe(true);
        yield* f.expire();
        const now = new Date();
        const first = yield* processTenantBrandAssetOrphans({ now }).pipe(
          Effect.provide(f.storage()),
        );
        expect(first).toMatchObject({ deleted: 0, retained: 1 });
        const second = yield* processTenantBrandAssetOrphans({
          now: new Date(now.getTime() + retry),
        }).pipe(
          Effect.provide(
            f.storage({
              deleteObject: () => Effect.fail(new ObjectStorageNotFoundError()),
            }),
          ),
        );
        expect(second.retained).toBe(1);
        expect((yield* f.rows())[0]).toMatchObject({
          putSucceededAt: null,
          status: 'cleaning',
        });
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'retains interrupted PUT ownership and deletes a late object on the next sweep',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const started = yield* Deferred.make<undefined>();
        let finish: (() => void) | undefined;
        const latePut = new Promise<{ storageKey: string; storageUrl: string }>(
          (resolve) => {
            finish = () => {
              f.objects.add('late');
              resolve({
                storageKey: 'late',
                storageUrl: 'https://storage.test/late',
              });
            };
          },
        );
        yield* Effect.addFinalizer(() => Effect.sync(() => finish?.()));
        let key = '';
        const fiber = yield* f.upload().pipe(
          Effect.provide(
            f.storage({
              put: (input) =>
                Effect.gen(function* () {
                  key = input.key;
                  yield* Deferred.succeed(started, undefined);
                  return yield* Effect.promise(() =>
                    latePut.then(() => {
                      f.objects.delete('late');
                      f.objects.add(key);
                      return {
                        storageKey: key,
                        storageUrl: 'https://storage.test/late',
                      };
                    }),
                  );
                }),
            }),
          ),
          Effect.forkScoped,
        );
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        yield* f.expire();
        const now = new Date();
        yield* processTenantBrandAssetOrphans({ now }).pipe(
          Effect.provide(f.storage()),
        );
        finish?.();
        yield* Effect.promise(() => latePut);
        yield* processTenantBrandAssetOrphans({
          now: new Date(now.getTime() + retry),
        }).pipe(Effect.provide(f.storage()));
        expect(f.objects.has(key)).toBe(false);
        expect(f.deleted).toEqual([key, key]);
        expect((yield* f.rows())[0]?.putSucceededAt).toBeNull();
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'keeps a cleanup claim that observed unknown PUT even when settlement races its deletion',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const started = yield* Deferred.make<undefined>();
        const finish = yield* Deferred.make<undefined>();
        const fiber = yield* f.upload().pipe(
          Effect.provide(
            f.storage({
              put: ({ key }) =>
                Effect.gen(function* () {
                  yield* Deferred.succeed(started, undefined);
                  yield* Deferred.await(finish);
                  f.objects.add(key);
                  return {
                    storageKey: key,
                    storageUrl: 'https://storage.test/image',
                  };
                }),
            }),
          ),
          Effect.exit,
          Effect.forkScoped,
        );
        yield* Deferred.await(started);
        yield* f.expire();
        const now = new Date();
        const result = yield* processTenantBrandAssetOrphans({ now }).pipe(
          Effect.provide(
            f.storage({
              deleteObject: (key) =>
                Effect.gen(function* () {
                  f.objects.delete(key);
                  yield* Deferred.succeed(finish, undefined);
                  const uploadResult = yield* Fiber.join(fiber);
                  expect(Exit.isFailure(uploadResult)).toBe(true);
                  expect(f.objects.has(key)).toBe(true);
                }),
            }),
          ),
        );
        expect(result.retained).toBe(1);
        expect((yield* f.rows())[0]).toMatchObject({
          putSucceededAt: expect.any(Date),
          status: 'cleaning',
        });
        const later = yield* processTenantBrandAssetOrphans({
          now: new Date(now.getTime() + retry),
        }).pipe(Effect.provide(f.storage()));
        expect(later.deleted).toBe(1);
        expect(yield* f.rows()).toEqual([]);
        expect(f.objects.size).toBe(0);
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'atomically attaches, preserves current images, and retains replaced images before cleanup',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const first = yield* f.upload().pipe(Effect.provide(f.storage()));
        yield* f.save(first.assetUrl);
        yield* processTenantBrandAssetOrphans({
          now: new Date(Date.now() + retention * 2),
        }).pipe(Effect.provide(f.storage()));
        expect(f.deleted).toEqual([]);
        const next = yield* f.upload().pipe(Effect.provide(f.storage()));
        yield* f.save(next.assetUrl);
        const owned = yield* f.rows();
        expect(
          owned.find((row) => row.assetUrl === first.assetUrl)?.status,
        ).toBe('ready');
        expect(
          owned.find((row) => row.assetUrl === next.assetUrl)?.status,
        ).toBe('attached');
        yield* processTenantBrandAssetOrphans().pipe(
          Effect.provide(f.storage()),
        );
        expect(f.deleted).toEqual([]);
        yield* processTenantBrandAssetOrphans({
          now: new Date(Date.now() + retention * 2),
        }).pipe(Effect.provide(f.storage()));
        expect(f.deleted).toEqual([first.storageKey]);
        expect((yield* f.rows()).map((row) => row.assetUrl)).toEqual([
          next.assetUrl,
        ]);
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'rolls association back on a failed settings write and preserves a committed association after a lost response',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const image = yield* f.upload().pipe(Effect.provide(f.storage()));
        const rejected = yield* f
          .save(image.assetUrl, Effect.die('settings write failed'))
          .pipe(Effect.exit);
        expect(Exit.isFailure(rejected)).toBe(true);
        expect((yield* f.rows())[0]?.status).toBe('ready');
        const uncertain = yield* f
          .save(image.assetUrl)
          .pipe(
            Effect.andThen(Effect.die('response lost after commit')),
            Effect.exit,
          );
        expect(Exit.isFailure(uncertain)).toBe(true);
        expect((yield* f.rows())[0]?.status).toBe('attached');
        yield* processTenantBrandAssetOrphans({
          now: new Date(Date.now() + retention * 2),
        }).pipe(Effect.provide(f.storage()));
        expect(f.deleted).toEqual([]);
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'rechecks current references and never adopts or deletes external configured images',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const image = yield* f.upload().pipe(Effect.provide(f.storage()));
        yield* f.expire();
        yield* Effect.promise(() =>
          f.database
            .update(tenants)
            .set({ logoUrl: image.assetUrl })
            .where(eq(tenants.id, f.tenantId)),
        );
        yield* processTenantBrandAssetOrphans().pipe(
          Effect.provide(f.storage()),
        );
        expect(f.deleted).toEqual([]);
        yield* f.save('https://external.test/logo.png');
        expect((yield* f.rows()).length).toBe(1);
        yield* f.save('https://external.test/replacement.png');
        expect((yield* f.rows()).length).toBe(1);
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'rejects unowned, wrong-kind, wrong-organization, and expired selections',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const other = yield* fixture();
        const image = yield* f.upload().pipe(Effect.provide(f.storage()));
        for (const url of [
          '/tenant-assets/absent/logo/no.png',
          image.assetUrl,
        ]) {
          const rejected = yield* other.save(url).pipe(Effect.exit);
          expect(Exit.isFailure(rejected)).toBe(true);
          if (Exit.isFailure(rejected))
            expect(Cause.squash(rejected.cause)).toBeInstanceOf(
              RpcBadRequestError,
            );
        }
        yield* Effect.promise(() =>
          f.database
            .update(tenantBrandAssetUploads)
            .set({ kind: 'favicon' })
            .where(eq(tenantBrandAssetUploads.tenantId, f.tenantId)),
        );
        const rejected = yield* f.save(image.assetUrl).pipe(Effect.exit);
        expect(Exit.isFailure(rejected)).toBe(true);
        if (Exit.isFailure(rejected))
          expect(Cause.squash(rejected.cause)).toBeInstanceOf(
            RpcBadRequestError,
          );
        yield* Effect.promise(() =>
          f.database
            .update(tenantBrandAssetUploads)
            .set({ kind: 'logo' })
            .where(eq(tenantBrandAssetUploads.tenantId, f.tenantId)),
        );
        yield* f.expire();
        const expired = yield* f.save(image.assetUrl).pipe(Effect.exit);
        expect(Exit.isFailure(expired)).toBe(true);
        if (Exit.isFailure(expired))
          expect(Cause.squash(expired.cause)).toBeInstanceOf(
            RpcBadRequestError,
          );
        expect((yield* f.rows())[0]?.status).toBe('ready');
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'keeps ownership on delete failure and refuses association once cleanup has claimed it',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const image = yield* f.upload().pipe(Effect.provide(f.storage()));
        yield* f.expire();
        const now = new Date();
        const result = yield* processTenantBrandAssetOrphans({ now }).pipe(
          Effect.provide(
            f.storage({
              deleteObject: () =>
                Effect.gen(function* () {
                  expect(
                    Exit.isFailure(
                      yield* f.save(image.assetUrl).pipe(Effect.exit),
                    ),
                  ).toBe(true);
                  return yield* Effect.fail(
                    new RpcInternalServerError({
                      message: 'Storage unavailable',
                    }),
                  );
                }),
            }),
          ),
          Effect.exit,
        );
        expect(Exit.isFailure(result)).toBe(true);
        expect((yield* f.rows())[0]).toMatchObject({
          cleanupClaimToken: expect.any(String),
          status: 'cleaning',
        });
        yield* processTenantBrandAssetOrphans({
          now: new Date(now.getTime() + 15 * 60 * 1000),
        }).pipe(Effect.provide(f.storage()));
        expect(yield* f.rows()).toEqual([]);
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'times out a hung storage deletion while retaining its durable cleaning claim',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* f.upload().pipe(Effect.provide(f.storage()));
        yield* f.expire();
        const started = yield* Deferred.make<undefined>();
        const worker = yield* processTenantBrandAssetOrphans({
          now: new Date(),
        }).pipe(
          Effect.provide(
            f.storage({
              deleteObject: () =>
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Effect.never),
                ),
            }),
          ),
          Effect.exit,
          Effect.forkScoped,
        );
        yield* Deferred.await(started);
        yield* TestClock.adjust('30 seconds');
        const result = yield* Fiber.join(worker);
        expect(Exit.isFailure(result)).toBe(true);
        expect((yield* f.rows())[0]).toMatchObject({
          cleanupClaimToken: expect.any(String),
          status: 'cleaning',
        });
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'runs both image cleanup passes through the deployed HTTP trigger and preserves role/body guards',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const image = yield* f.upload().pipe(Effect.provide(f.storage()));
        yield* f.expire();
        const makeHandler = (role: 'web' | 'worker') => {
          const deploymentLayer = DeploymentRuntimeConfig.Default.pipe(
            Layer.provide(
              ConfigProvider.layer(
                ConfigProvider.fromEnv({
                  env: {
                    APP_ENVIRONMENT: 'staging',
                    APP_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}`,
                    APP_REVISION: 'a'.repeat(40),
                    APP_ROLE: role,
                    COCKPIT_TRACES_ENDPOINT:
                      'https://test.traces.cockpit.fr-par.scw.cloud/otlp/v1/traces',
                    COCKPIT_TRACES_TOKEN: 'synthetic-token-'.repeat(3),
                    READINESS_TENANT_HOST: 'tenant.example.test',
                    TRUST_PLATFORM_PROXY: 'true',
                    WORKER_TRIGGER_MODE: 'http',
                  },
                }),
              ),
            ),
          );
          return Effect.acquireRelease(
            Effect.sync(() =>
              HttpRouter.toWebHandler(
                workerReceiptOrphanCleanupRouteLayer.pipe(
                  HttpRouter.provideRequest(
                    Layer.mergeAll(serviceLayer, deploymentLayer, f.storage()),
                  ),
                ),
                { disableLogger: true },
              ),
            ),
            ({ dispose }) => Effect.promise(dispose),
          );
        };
        const request = (body: string) =>
          new Request(
            `https://worker.internal${workerReceiptOrphanCleanupPath}`,
            {
              body,
              headers: { 'content-type': 'application/json' },
              method: 'POST',
            },
          );
        const worker = yield* makeHandler('worker');
        const invalid = yield* Effect.promise(() =>
          worker.handler(request('{"limit":0}')),
        );
        expect(invalid.status).toBe(400);
        expect(f.deleted).toEqual([]);
        const web = yield* makeHandler('web');
        expect(
          (yield* Effect.promise(() => web.handler(request('{"limit":1}'))))
            .status,
        ).toBe(404);
        expect(f.deleted).toEqual([]);
        const result = yield* Effect.promise(() =>
          worker.handler(request('{"limit":1}')),
        );
        expect(result.status).toBe(200);
        expect(result.headers.get('cache-control')).toBe('no-store');
        expect(yield* Effect.promise(() => result.json())).toEqual({
          brandAssets: { deleted: 1, retained: 0, scanned: 1 },
          deleted: 0,
          scanned: 0,
        });
        expect(f.deleted).toEqual([image.storageKey]);
        expect(yield* f.rows()).toEqual([]);
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'retains a cleaning claim after interruption and resumes only after its lease',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* f.upload().pipe(Effect.provide(f.storage()));
        yield* f.expire();
        const deleting = yield* Deferred.make<undefined>();
        const now = new Date();
        const worker = yield* processTenantBrandAssetOrphans({ now }).pipe(
          Effect.provide(
            f.storage({
              deleteObject: () =>
                Deferred.succeed(deleting, undefined).pipe(
                  Effect.andThen(Effect.never),
                ),
            }),
          ),
          Effect.forkScoped,
        );
        yield* Deferred.await(deleting);
        yield* Fiber.interrupt(worker);
        expect((yield* f.rows())[0]).toMatchObject({
          cleanupClaimToken: expect.any(String),
          status: 'cleaning',
        });
        const beforeLease = yield* processTenantBrandAssetOrphans({ now }).pipe(
          Effect.provide(f.storage()),
        );
        expect(beforeLease.scanned).toBe(0);
        const afterLease = yield* processTenantBrandAssetOrphans({
          now: new Date(now.getTime() + 15 * 60 * 1000),
        }).pipe(Effect.provide(f.storage()));
        expect(afterLease.deleted).toBe(1);
        expect(yield* f.rows()).toEqual([]);
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'fences an overlapping unknown-outcome old cleaner after a second cleaner takes its expired claim',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* f.upload().pipe(
          Effect.provide(
            f.storage({
              put: () =>
                Effect.fail(
                  new RpcInternalServerError({ message: 'Unknown upload' }),
                ),
            }),
          ),
          Effect.exit,
        );
        yield* f.expire();
        const started = yield* Deferred.make<undefined>();
        const release = yield* Deferred.make<undefined>();
        const now = new Date();
        const old = yield* processTenantBrandAssetOrphans({ now }).pipe(
          Effect.provide(
            f.storage({
              deleteObject: () =>
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                ),
            }),
          ),
          Effect.forkScoped,
        );
        yield* Deferred.await(started);
        const oldToken = (yield* f.rows())[0]?.cleanupClaimToken;
        const newer = yield* processTenantBrandAssetOrphans({
          now: new Date(now.getTime() + 15 * 60 * 1000),
        }).pipe(
          Effect.provide(
            f.storage({
              deleteObject: () =>
                Effect.fail(
                  new RpcInternalServerError({
                    message: 'New cleaner storage failure',
                  }),
                ),
            }),
          ),
          Effect.exit,
        );
        expect(Exit.isFailure(newer)).toBe(true);
        const newToken = (yield* f.rows())[0]?.cleanupClaimToken;
        expect(newToken).not.toBe(oldToken);
        yield* Deferred.succeed(release, undefined);
        expect(yield* Fiber.join(old)).toMatchObject({
          deleted: 0,
          retained: 0,
        });
        expect((yield* f.rows())[0]?.cleanupClaimToken).toBe(newToken);
        yield* processTenantBrandAssetOrphans({
          now: new Date(now.getTime() + 30 * 60 * 1000),
        }).pipe(Effect.provide(f.storage()));
        expect((yield* f.rows())[0]?.putSucceededAt).toBeNull();
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'rechecks a candidate after the settings transaction wins the organization lock',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const image = yield* f.upload().pipe(Effect.provide(f.storage()));
        const selected = yield* Deferred.make<undefined>();
        const release = yield* Deferred.make<undefined>();
        const save = yield* f
          .save(
            image.assetUrl,
            Deferred.succeed(selected, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
            ),
          )
          .pipe(Effect.forkScoped);
        yield* Deferred.await(selected);
        // A due snapshot is visible to the cleaner, while association has not committed.
        const cleanup = yield* processTenantBrandAssetOrphans({
          now: new Date(Date.now() + retention * 2),
        }).pipe(Effect.provide(f.storage()), Effect.forkScoped);
        const skipped = yield* Fiber.join(cleanup);
        expect(skipped).toMatchObject({ deleted: 0, retained: 0 });
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(save);
        expect(f.deleted).toEqual([]);
        expect((yield* f.rows())[0]?.status).toBe('attached');
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );

  it.effect(
    'retains unknown ownership with a non-cascading organization foreign key and bounded indexed candidates',
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* f.upload().pipe(Effect.provide(f.storage()));
        const deletion = yield* Effect.tryPromise(() =>
          f.database.delete(tenants).where(eq(tenants.id, f.tenantId)),
        ).pipe(Effect.exit);
        expect(Exit.isFailure(deletion)).toBe(true);
        yield* f.expire();
        const summary = yield* processTenantBrandAssetOrphans({
          batchSize: 1,
        }).pipe(Effect.provide(f.storage()));
        expect(summary.scanned).toBe(1);
        const indexes = yield* Effect.promise(() =>
          f.database.execute(
            sql`select indexdef from pg_indexes where tablename = 'tenant_brand_asset_uploads' and indexname = 'tenant_brand_asset_cleanup_due_idx'`,
          ),
        );
        expect(indexes.rows[0]?.['indexdef']).toContain('"nextCleanupAt", id');
        expect(indexes.rows[0]?.['indexdef']).toContain(
          'WHERE ("nextCleanupAt" IS NOT NULL)',
        );
      }).pipe(Effect.provide(serviceLayer), Effect.scoped),
  );
});
