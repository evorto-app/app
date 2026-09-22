import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Result,
  Schema,
} from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { Pool } from 'pg';

import { databaseLayer } from '../../../../db';
import { createId } from '../../../../db/create-id';
import { createNodePgPoolConfig } from '../../../../db/pg-connection-config';
import { relations } from '../../../../db/relations';
import { tenants, users, usersToTenants } from '../../../../db/schema';
import { RpcUnauthorizedError } from '../../../../shared/errors/rpc-errors';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
} from '../../../../shared/rpc-contracts/app-rpcs';
import { UsersSetHomeTenant } from '../../../../shared/rpc-contracts/app-rpcs/users.rpcs';
import { Tenant } from '../../../../types/custom/tenant';
import { User } from '../../../../types/custom/user';
import { RpcAccess } from './shared/rpc-access.service';
import { userHandlers } from './users.handlers';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
const database = drizzle({ client: pool, relations });
const originalTenantId = createId();
const targetTenantId = createId();
const userId = createId();
const membershipId = createId();
const tenant = Schema.decodeUnknownSync(Tenant)({
  cancellationDeadlineHoursBeforeStart: 120,
  currency: 'EUR',
  defaultLocation: null,
  discountProviders: { esnCard: { config: {}, status: 'disabled' } },
  domain: `${targetTenantId}.home-tenant.example`,
  id: targetTenantId,
  maxActiveRegistrationsPerUser: 0,
  name: 'New home organization',
  receiptSettings: { allowOther: false, receiptCountries: ['NL'] },
  refundFeesOnCancellation: true,
  stripeAccountId: null,
  theme: 'evorto',
  timezone: 'Europe/Berlin',
  transferDeadlineHoursBeforeStart: 0,
});
const user = Schema.decodeUnknownSync(User)({
  auth0Id: `home-tenant|${userId}`,
  communicationEmail: `${userId}@example.com`,
  email: `${userId}@example.com`,
  firstName: 'Home',
  id: userId,
  lastName: 'Tenant',
  permissions: [],
  roleIds: [],
});
const handlerLayer = Layer.mergeAll(
  databaseLayer.pipe(
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
  ),
  RpcAccess.Default,
  Layer.succeed(RpcRequestContext, {
    authData: {},
    authenticated: true,
    permissions: [],
    platformAuthority: null,
    tenant,
    user,
    userAssigned: true,
  }),
);

const changeHomeTenant = () =>
  Effect.runPromiseExit(
    userHandlers['users.setHomeTenant'](undefined, {
      client: new Rpc.ServerClient(1),
      headers: Headers.empty,
      requestId: RpcMessage.RequestId(1),
      rpc: UsersSetHomeTenant.middleware(RpcRequestContextMiddleware),
    }).pipe(Effect.result, Effect.provide(handlerLayer)),
  );

describe('home organization changes during registration', () => {
  beforeAll(async () => {
    await database.insert(tenants).values([
      {
        domain: `${originalTenantId}.home-tenant.example`,
        id: originalTenantId,
        name: 'Original home organization',
      },
      { domain: tenant.domain, id: targetTenantId, name: tenant.name },
    ]);
    await database.insert(users).values({
      auth0Id: user.auth0Id,
      communicationEmail: user.communicationEmail,
      email: user.email,
      firstName: user.firstName,
      homeTenantId: originalTenantId,
      id: userId,
      lastName: user.lastName,
    });
  });

  afterAll(async () => {
    try {
      await database
        .delete(usersToTenants)
        .where(eq(usersToTenants.id, membershipId));
      await database.delete(users).where(eq(users.id, userId));
      await database
        .delete(tenants)
        .where(inArray(tenants.id, [originalTenantId, targetTenantId]));
    } finally {
      await pool.end();
    }
  });

  for (const revokeMembership of [false, true]) {
    it(
      revokeMembership
        ? 'rejects membership removed while a home organization change waits'
        : 'allows registration and a home organization change to finish without a deadlock',
      async () => {
        await database
          .update(users)
          .set({ homeTenantId: originalTenantId })
          .where(eq(users.id, userId));
        await database
          .insert(usersToTenants)
          .values({ id: membershipId, tenantId: targetTenantId, userId })
          .onConflictDoNothing();

        const registration = await pool.connect();
        let pendingChange: ReturnType<typeof changeHomeTenant> | undefined;
        try {
          await registration.query('BEGIN');
          await registration.query("SET LOCAL lock_timeout = '3s'");
          await registration.query(
            'SELECT id FROM tenants WHERE id = $1 FOR UPDATE',
            [targetTenantId],
          );
          const backend = await registration.query<{ pid: number }>(
            'SELECT pg_backend_pid() AS pid',
          );
          const blockerPid = backend.rows[0]?.pid;
          if (blockerPid === undefined) {
            throw new Error('Missing registration PostgreSQL backend PID');
          }
          pendingChange = changeHomeTenant();
          await expect
            .poll(
              async () => {
                const blocked = await pool.query<{ blocked: boolean }>(
                  `SELECT EXISTS (
                    SELECT 1 FROM pg_stat_activity
                    WHERE datname = current_database()
                      AND wait_event_type = 'Lock'
                      AND $1 = ANY(pg_blocking_pids(pid))
                  ) AS blocked`,
                  [blockerPid],
                );
                return blocked.rows[0]?.blocked;
              },
              { interval: 10, timeout: 5000 },
            )
            .toBe(true);

          // Paid registration locks the tenant before the same membership.
          // The home-tenant FK check must not reverse that lock order.
          await registration.query(
            'SELECT id FROM users_to_tenants WHERE id = $1 FOR UPDATE',
            [membershipId],
          );
          if (revokeMembership) {
            await registration.query(
              'DELETE FROM users_to_tenants WHERE id = $1',
              [membershipId],
            );
          }
          await registration.query('COMMIT');
          const outcome = await pendingChange;
          if (Exit.isFailure(outcome)) throw Cause.squash(outcome.cause);
          const result = outcome.value;
          if (revokeMembership) {
            expect(Result.isFailure(result)).toBe(true);
            if (Result.isFailure(result)) {
              expect(result.failure).toBeInstanceOf(RpcUnauthorizedError);
            }
          } else {
            expect(result).toEqual(
              Result.succeed({
                homeTenantId: targetTenantId,
                homeTenantName: tenant.name,
              }),
            );
          }
          const persisted = await database.query.users.findFirst({
            columns: { homeTenantId: true },
            where: { id: userId },
          });
          expect(persisted?.homeTenantId).toBe(
            revokeMembership ? originalTenantId : targetTenantId,
          );
        } finally {
          try {
            await registration.query('ROLLBACK');
          } finally {
            registration.release();
            if (pendingChange) await pendingChange;
          }
        }
      },
      15_000,
    );
  }
});
