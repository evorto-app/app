import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { eq, inArray, sql } from 'drizzle-orm';
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
  tenantOnboardingQuestionAnswers,
  tenantOnboardingQuestions,
  tenantPrivacyPolicyAcceptances,
  tenantPrivacyPolicyVersions,
  tenants,
  tenantStripeTaxRates,
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
const pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
const database = drizzle<typeof relations>({ client: pool, relations });

const tenantId = createId();
const otherTenantId = createId();
const tenantIds = [tenantId, otherTenantId];
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
    cancellationDeadlineHoursBeforeStart: 120,
    currency: 'EUR',
    defaultLocation: undefined,
    discountProviders: {
      esnCard: { config: {}, status: 'disabled' },
    },
    domain: `${tenantId}.onboarding.example`,
    id: tenantId,
    maxActiveRegistrationsPerUser: 0,
    name: 'Onboarding role assignment tenant',
    receiptSettings: {
      allowOther: false,
      receiptCountries: ['NL'],
    },
    refundFeesOnCancellation: true,
    stripeAccountId: null,
    theme: 'evorto',
    timezone: 'Europe/Berlin',
    transferDeadlineHoursBeforeStart: 0,
  },
  user: null,
  userAssigned: false,
});

const configLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: {
      DATABASE_TLS_REQUIRED: 'false',
      DATABASE_URL: databaseUrl,
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

describe('tenant onboarding and profile persistence', () => {
  beforeAll(async () => {
    await database.insert(tenants).values({
      domain: `${tenantId}.onboarding.example`,
      id: tenantId,
      name: 'Onboarding role assignment tenant',
    });
    await database.insert(tenants).values({
      domain: `${otherTenantId}.onboarding.example`,
      id: otherTenantId,
      name: 'Other onboarding tenant',
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
      .delete(tenantOnboardingQuestionAnswers)
      .where(inArray(tenantOnboardingQuestionAnswers.tenantId, tenantIds));
    await database
      .delete(tenantOnboardingQuestions)
      .where(inArray(tenantOnboardingQuestions.tenantId, tenantIds));
    await database
      .delete(tenantStripeTaxRates)
      .where(inArray(tenantStripeTaxRates.tenantId, tenantIds));
    await database
      .delete(rolesToTenantUsers)
      .where(inArray(rolesToTenantUsers.tenantId, tenantIds));
    await database
      .delete(tenantPrivacyPolicyAcceptances)
      .where(inArray(tenantPrivacyPolicyAcceptances.tenantId, tenantIds));
    await database
      .delete(usersToTenants)
      .where(inArray(usersToTenants.tenantId, tenantIds));
    await database
      .delete(tenantPrivacyPolicyVersions)
      .where(inArray(tenantPrivacyPolicyVersions.tenantId, tenantIds));
    await database.delete(roles).where(inArray(roles.tenantId, tenantIds));
    await database.delete(users).where(inArray(users.id, userIds));
    await database.delete(tenants).where(inArray(tenants.id, tenantIds));
    await pool.end();
  });

  it('preserves tenant ownership and valid shapes for onboarding questions and policy acceptance', async () => {
    const otherPolicyId = createId();
    await database.insert(tenantPrivacyPolicyVersions).values({
      id: otherPolicyId,
      privacyPolicyText: 'Other policy',
      tenantId: otherTenantId,
      version: 1,
    });
    await expect(
      database.insert(tenantPrivacyPolicyVersions).values({
        privacyPolicyText: 'Duplicate version',
        tenantId: otherTenantId,
        version: 1,
      }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
    await expect(
      database
        .insert(tenantPrivacyPolicyVersions)
        .values({ tenantId: otherTenantId, version: 2 }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      database.insert(tenantPrivacyPolicyAcceptances).values({
        policyVersionId: otherPolicyId,
        tenantId,
        userId: existingUserId,
      }),
    ).rejects.toMatchObject({
      cause: {
        code: '23503',
        constraint: 'tenant_privacy_acceptance_policy_tenant_fk',
      },
    });
    await expect(
      database
        .insert(tenantPrivacyPolicyAcceptances)
        .values({
          policyVersionId: otherPolicyId,
          tenantId: otherTenantId,
          userId: existingUserId,
        })
        .returning({
          policyVersionId: tenantPrivacyPolicyAcceptances.policyVersionId,
          tenantId: tenantPrivacyPolicyAcceptances.tenantId,
        }),
    ).resolves.toEqual([
      { policyVersionId: otherPolicyId, tenantId: otherTenantId },
    ]);

    const questionId = createId();
    await database.insert(tenantOnboardingQuestions).values([
      {
        id: questionId,
        options: [],
        prompt: 'Your university',
        tenantId: otherTenantId,
        type: 'shortText',
      },
      {
        options: ['University A', 'University B'],
        prompt: 'Select a university',
        tenantId: otherTenantId,
        type: 'selection',
      },
    ]);
    for (const invalid of [
      { options: ['Unexpected option'], type: 'shortText' },
      { options: [], type: 'selection' },
      { options: ['Only one'], type: 'selection' },
    ] as const) {
      await expect(
        database.insert(tenantOnboardingQuestions).values({
          ...invalid,
          options: [...invalid.options],
          prompt: 'Invalid question',
          tenantId: otherTenantId,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    }
    await expect(
      database.insert(tenantOnboardingQuestionAnswers).values({
        answer: 'University A',
        questionId,
        tenantId,
        userId: existingUserId,
      }),
    ).rejects.toMatchObject({
      cause: {
        code: '23503',
        constraint: 'tenant_onboarding_answer_question_tenant_fk',
      },
    });
    await expect(
      database
        .insert(tenantOnboardingQuestionAnswers)
        .values({
          answer: 'University A',
          questionId,
          tenantId: otherTenantId,
          userId: existingUserId,
        })
        .returning({
          answer: tenantOnboardingQuestionAnswers.answer,
          tenantId: tenantOnboardingQuestionAnswers.tenantId,
        }),
    ).resolves.toEqual([{ answer: 'University A', tenantId: otherTenantId }]);
  });

  it('keeps tax-rate identity tenant scoped and refuses an unowned or reassigned provider ID', async () => {
    const stripeTaxRateId = `txr_${createId()}`;
    await database.insert(tenantStripeTaxRates).values(
      tenantIds.map((id) => ({
        stripeAccountId: `acct_${id}`,
        stripeTaxRateId,
        tenantId: id,
      })),
    );
    await expect(
      database.insert(tenantStripeTaxRates).values({
        stripeAccountId: 'acct_replacement',
        stripeTaxRateId,
        tenantId,
      }),
    ).rejects.toMatchObject({
      cause: {
        code: '23505',
        constraint: 'tenant_stripe_tax_rates_tenant_stripe_unique',
      },
    });
    await expect(
      database.insert(tenantStripeTaxRates).values({
        stripeAccountId: sql`NULL`,
        stripeTaxRateId: `txr_${createId()}`,
        tenantId,
      }),
    ).rejects.toMatchObject({
      cause: { code: '23502', column: 'stripeAccountId' },
    });
    expect(
      await database
        .select({
          account: tenantStripeTaxRates.stripeAccountId,
          tenantId: tenantStripeTaxRates.tenantId,
        })
        .from(tenantStripeTaxRates)
        .where(eq(tenantStripeTaxRates.stripeTaxRateId, stripeTaxRateId))
        .orderBy(tenantStripeTaxRates.tenantId),
    ).toEqual(
      tenantIds
        .toSorted()
        .map((id) => ({ account: `acct_${id}`, tenantId: id })),
    );
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
