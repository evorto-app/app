import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { Pool } from 'pg';

import { databaseLayer } from '../../../../db';
import { createId } from '../../../../db/create-id';
import { createNodePgPoolConfig } from '../../../../db/pg-connection-config';
import { relations } from '../../../../db/relations';
import {
  roles,
  rolesToTenantUsers,
  tenantPrivacyPolicyAcceptances,
  tenantPrivacyPolicyVersions,
  tenants,
  users,
  usersToTenants,
} from '../../../../db/schema';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import { onboardingHandlers } from './onboarding.handlers';
import { RpcAccess } from './shared/rpc-access.service';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const neonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';
const pool = new Pool(createNodePgPoolConfig({ databaseUrl, neonLocalProxy }));
const database = drizzle<typeof relations>({ client: pool, relations });

const tenantId = createId();
const policyVersionId = createId();
const defaultRoleId = createId();
const existingUserId = createId();
const existingMembershipId = createId();
const newMemberUserId = createId();
const userIds = [existingUserId, newMemberUserId];

const createRequestContext = (input: {
  auth0Id: string;
  email: string;
}): RpcRequestContextShape => ({
  authData: {
    email: input.email,
    email_verified: true,
    sub: input.auth0Id,
  },
  authenticated: true,
  permissions: [],
  platformAuthority: null,
  tenant: {
    currency: 'EUR',
    defaultLocation: null,
    discountProviders: {
      esnCard: { config: {}, status: 'disabled' },
    },
    domain: `${tenantId}.onboarding.example`,
    id: tenantId,
    locale: 'de-DE',
    name: 'Onboarding role assignment tenant',
    receiptSettings: {
      allowOther: false,
      receiptCountries: ['NL'],
    },
    stripeAccountId: null,
    theme: 'evorto',
    timezone: 'Europe/Berlin',
  },
  user: null,
  userAssigned: false,
});

const configLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: {
      DATABASE_URL: databaseUrl,
      NEON_LOCAL_PROXY: String(neonLocalProxy),
    },
  }),
);
const handlerLayer = Layer.mergeAll(
  databaseLayer.pipe(Layer.provide(configLayer)),
  RpcAccess.Default,
);

const completeOnboarding = (context: RpcRequestContextShape) =>
  Effect.gen(function* () {
    const communicationEmail = context.authData['email'];
    if (typeof communicationEmail !== 'string') {
      return yield* Effect.die(
        new Error('Expected onboarding test identity email'),
      );
    }
    yield* onboardingHandlers['onboarding.complete']({
      acceptedPrivacyPolicy: true,
      answers: [],
      communicationEmail,
      firstName: 'Onboarding',
      lastName: 'Member',
      policyVersionId,
    });
  }).pipe(Effect.provideService(RpcRequestContext, context));

describe('tenant onboarding membership role assignment', () => {
  beforeAll(async () => {
    await database.insert(tenants).values({
      domain: `${tenantId}.onboarding.example`,
      id: tenantId,
      name: 'Onboarding role assignment tenant',
    });
    await database.insert(users).values([
      {
        auth0Id: `auth0|${existingUserId}`,
        communicationEmail: `${existingUserId}@example.com`,
        email: `${existingUserId}@example.com`,
        firstName: 'Existing',
        id: existingUserId,
        lastName: 'Member',
      },
      {
        auth0Id: `auth0|${newMemberUserId}`,
        communicationEmail: `${newMemberUserId}@example.com`,
        email: `${newMemberUserId}@example.com`,
        firstName: 'New',
        id: newMemberUserId,
        lastName: 'Member',
      },
    ]);
    await database.insert(roles).values({
      defaultUserRole: true,
      id: defaultRoleId,
      name: 'Default member',
      tenantId,
    });
    await database.insert(tenantPrivacyPolicyVersions).values({
      id: policyVersionId,
      privacyPolicyText: 'Onboarding integration test policy',
      tenantId,
      version: 1,
    });
    await database.insert(usersToTenants).values({
      id: existingMembershipId,
      tenantId,
      userId: existingUserId,
    });
    await database.insert(tenantPrivacyPolicyAcceptances).values({
      policyVersionId,
      tenantId,
      userId: existingUserId,
    });
  });

  afterAll(async () => {
    await database
      .delete(rolesToTenantUsers)
      .where(eq(rolesToTenantUsers.tenantId, tenantId));
    await database
      .delete(tenantPrivacyPolicyAcceptances)
      .where(eq(tenantPrivacyPolicyAcceptances.tenantId, tenantId));
    await database
      .delete(usersToTenants)
      .where(eq(usersToTenants.tenantId, tenantId));
    await database
      .delete(tenantPrivacyPolicyVersions)
      .where(eq(tenantPrivacyPolicyVersions.tenantId, tenantId));
    await database.delete(roles).where(eq(roles.tenantId, tenantId));
    await database.delete(users).where(inArray(users.id, userIds));
    await database.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it.effect(
    'does not restore defaults for a roleless member and grants them to a new membership',
    () =>
      Effect.gen(function* () {
        const existingContext = createRequestContext({
          auth0Id: `auth0|${existingUserId}`,
          email: `${existingUserId}@example.com`,
        });
        yield* completeOnboarding(existingContext);

        const existingAssignments = yield* Effect.promise(() =>
          database
            .select({ roleId: rolesToTenantUsers.roleId })
            .from(rolesToTenantUsers)
            .where(eq(rolesToTenantUsers.userTenantId, existingMembershipId)),
        );
        expect(existingAssignments).toEqual([]);

        const newMemberContext = createRequestContext({
          auth0Id: `auth0|${newMemberUserId}`,
          email: `${newMemberUserId}@example.com`,
        });
        yield* completeOnboarding(newMemberContext);

        const newMemberships = yield* Effect.promise(() =>
          database
            .select({ id: usersToTenants.id })
            .from(usersToTenants)
            .where(eq(usersToTenants.userId, newMemberUserId)),
        );
        expect(newMemberships).toHaveLength(1);
        const newMembershipId = newMemberships[0]?.id;
        if (!newMembershipId) {
          return yield* Effect.die(
            new Error('Expected onboarding to create a membership'),
          );
        }
        const newMembershipAssignments = yield* Effect.promise(() =>
          database
            .select({ roleId: rolesToTenantUsers.roleId })
            .from(rolesToTenantUsers)
            .where(eq(rolesToTenantUsers.userTenantId, newMembershipId)),
        );
        expect(newMembershipAssignments).toEqual([{ roleId: defaultRoleId }]);
      }).pipe(Effect.provide(handlerLayer)),
  );
});
