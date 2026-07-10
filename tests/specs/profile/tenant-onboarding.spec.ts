import { and, eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import {
  adminStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';

test.use({ storageState: userStateFile, trace: 'on-first-retry' });

test('collects current requirements before a cross-tenant join and preserves the home tenant', async ({
  database,
  page,
  tenant,
}) => {
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular authenticated user fixture');
  }
  const originalUser = await database.query.users.findFirst({
    where: { id: regularUser.id },
  });
  if (!originalUser?.homeTenantId) {
    throw new Error('Expected the seeded user to have a home tenant');
  }

  const joinedTenantId = getId();
  const joinedTenantDomain = `onboarding-${tenant.id}.example.test`;
  const roleId = getId();
  const policyVersionId = getId();
  const selectionQuestionId = getId();
  const shortTextQuestionId = getId();

  await database.insert(schema.tenants).values({
    domain: joinedTenantDomain,
    id: joinedTenantId,
    name: 'Example Exchange Network',
    privacyPolicyText:
      'We use your onboarding answers to provide tenant membership services.',
  });
  await database.insert(schema.roles).values({
    defaultUserRole: true,
    id: roleId,
    name: 'Member',
    permissions: ['events:viewPublic'],
    tenantId: joinedTenantId,
  });
  await database.insert(schema.tenantPrivacyPolicyVersions).values({
    id: policyVersionId,
    privacyPolicyText:
      'We use your onboarding answers to provide tenant membership services.',
    tenantId: joinedTenantId,
    version: 1,
  });
  await database.insert(schema.tenantOnboardingQuestions).values([
    {
      id: selectionQuestionId,
      options: ['Exchange student', 'Volunteer'],
      prompt: 'How are you joining?',
      sortOrder: 0,
      tenantId: joinedTenantId,
      type: 'selection',
    },
    {
      id: shortTextQuestionId,
      options: [],
      prompt: 'What should the board know?',
      sortOrder: 1,
      tenantId: joinedTenantId,
      type: 'shortText',
    },
  ]);

  try {
    await page.context().addCookies([
      {
        domain: 'localhost',
        expires: -1,
        name: 'evorto-tenant',
        path: '/',
        value: joinedTenantDomain,
      },
    ]);
    await page.goto('/events');
    await expect(page).toHaveURL(/\/create-account$/);
    await expect(
      page.getByRole('heading', { name: 'Complete tenant setup' }),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Notification email' }),
    ).toHaveValue(originalUser.communicationEmail);

    const joinButton = page.getByRole('button', { name: 'Join tenant' });
    await expect(joinButton).toBeDisabled();
    await page.getByRole('combobox', { name: 'How are you joining?' }).click();
    await page.getByRole('option', { name: 'Exchange student' }).click();
    await page
      .getByRole('textbox', { name: 'What should the board know?' })
      .fill('I arrive in the autumn semester.');
    await page
      .getByRole('checkbox', {
        name: "I accept Example Exchange Network's current privacy policy.",
      })
      .check();
    await expect(joinButton).toBeEnabled();
    await joinButton.click();

    await expect(page).toHaveURL(/\/profile$/);
    await expect(
      page.getByRole('heading', { name: 'You are browsing another tenant' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Make this my home tenant' }),
    ).toBeVisible();

    const membership = await database.query.usersToTenants.findFirst({
      where: { tenantId: joinedTenantId, userId: regularUser.id },
    });
    expect(membership).toBeDefined();
    if (!membership) {
      throw new Error('Expected the cross-tenant membership');
    }
    expect(
      await database.query.rolesToTenantUsers.findFirst({
        where: { roleId, userTenantId: membership.id },
      }),
    ).toBeDefined();
    const acceptance =
      await database.query.tenantPrivacyPolicyAcceptances.findFirst({
        where: {
          policyVersionId,
          tenantId: joinedTenantId,
          userId: regularUser.id,
        },
      });
    expect(acceptance).toBeDefined();
    const answers =
      await database.query.tenantOnboardingQuestionAnswers.findMany({
        where: { tenantId: joinedTenantId, userId: regularUser.id },
      });
    expect(answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          answer: 'Exchange student',
          questionId: selectionQuestionId,
        }),
        expect.objectContaining({
          answer: 'I arrive in the autumn semester.',
          questionId: shortTextQuestionId,
        }),
      ]),
    );
    const userAfterJoin = await database.query.users.findFirst({
      where: { id: regularUser.id },
    });
    expect(userAfterJoin?.homeTenantId).toBe(originalUser.homeTenantId);

    await page
      .getByRole('button', { name: 'Make this my home tenant' })
      .click();
    await expect(page.getByText('is now your home tenant')).toBeVisible();
    await expect
      .poll(async () => {
        const currentUser = await database.query.users.findFirst({
          where: { id: regularUser.id },
        });
        return currentUser?.homeTenantId;
      })
      .toBe(joinedTenantId);
  } finally {
    await database
      .update(schema.users)
      .set({ homeTenantId: originalUser.homeTenantId })
      .where(eq(schema.users.id, regularUser.id));
    await database
      .delete(schema.rolesToTenantUsers)
      .where(eq(schema.rolesToTenantUsers.tenantId, joinedTenantId));
    await database
      .delete(schema.tenantOnboardingQuestionAnswers)
      .where(
        eq(schema.tenantOnboardingQuestionAnswers.tenantId, joinedTenantId),
      );
    await database
      .delete(schema.tenantPrivacyPolicyAcceptances)
      .where(
        eq(schema.tenantPrivacyPolicyAcceptances.tenantId, joinedTenantId),
      );
    await database
      .delete(schema.usersToTenants)
      .where(eq(schema.usersToTenants.tenantId, joinedTenantId));
    await database
      .delete(schema.tenantOnboardingQuestions)
      .where(eq(schema.tenantOnboardingQuestions.tenantId, joinedTenantId));
    await database
      .delete(schema.tenantPrivacyPolicyVersions)
      .where(eq(schema.tenantPrivacyPolicyVersions.tenantId, joinedTenantId));
    await database.delete(schema.roles).where(eq(schema.roles.id, roleId));
    await database
      .delete(schema.tenants)
      .where(eq(schema.tenants.id, joinedTenantId));
    await page.context().addCookies([
      {
        domain: 'localhost',
        expires: -1,
        name: 'evorto-tenant',
        path: '/',
        value: tenant.domain,
      },
    ]);
  }
});

test('a tenant admin publishes a version and is immediately required to re-accept it @admin', async ({
  browser,
  database,
  page,
  tenant,
  testClock,
}) => {
  await page.goto('/');
  const admin = await openAuthenticatedTestPage({
    baseUrl: new URL(page.url()).origin,
    browser,
    storageState: adminStateFile,
    tenantDomain: tenant.domain,
    testClock,
  });
  const originalTenant = await database.query.tenants.findFirst({
    where: { id: tenant.id },
  });
  const originalPolicies =
    await database.query.tenantPrivacyPolicyVersions.findMany({
      where: { tenantId: tenant.id },
    });
  const originalQuestions =
    await database.query.tenantOnboardingQuestions.findMany({
      where: { tenantId: tenant.id },
    });
  const originalPolicyIds = new Set(
    originalPolicies.map((policy) => policy.id),
  );
  const originalQuestionIds = new Set(
    originalQuestions.map((question) => question.id),
  );
  const originalActiveQuestionIds = new Set(
    originalQuestions
      .filter((question) => question.retiredAt === null)
      .map((question) => question.id),
  );

  try {
    await admin.page.goto('/admin/onboarding');
    await expect(
      admin.page.getByRole('heading', { name: 'Tenant onboarding' }),
    ).toBeVisible();
    await expect(
      admin.page.getByText(
        'Every tenant user, including you, must accept that version',
      ),
    ).toBeVisible();
    await admin.page
      .getByRole('textbox', { name: 'Privacy policy text' })
      .fill('Updated privacy policy for the current academic year.');
    await admin.page.getByRole('button', { name: 'Add question' }).click();
    await admin.page
      .getByRole('textbox', { name: 'Question' })
      .fill('Which member group should welcome you?');
    await admin.page.getByRole('combobox', { name: 'Answer type' }).click();
    await admin.page.getByRole('option', { name: 'Selection list' }).click();
    await admin.page
      .getByRole('textbox', { name: 'Selection options' })
      .fill('Buddy team\nEvents team');
    await admin.page.getByRole('button', { name: 'Publish settings' }).click();
    await expect(
      admin.page.getByText(/tenant users must accept it before continuing/i),
    ).toBeVisible();

    const allPolicies =
      await database.query.tenantPrivacyPolicyVersions.findMany({
        where: { tenantId: tenant.id },
      });
    const publishedPolicy = allPolicies.find(
      (policy) => !originalPolicyIds.has(policy.id),
    );
    expect(publishedPolicy?.createdByUserId).toBeTruthy();

    await admin.page.goto('/admin');
    await expect(admin.page).toHaveURL(/\/create-account$/);
    await expect(
      admin.page.getByRole('heading', {
        name: `Privacy policy version ${publishedPolicy?.version}`,
      }),
    ).toBeVisible();
    await admin.page
      .getByRole('combobox', {
        name: 'Which member group should welcome you?',
      })
      .click();
    await admin.page.getByRole('option', { name: 'Buddy team' }).click();
    await admin.page
      .getByRole('checkbox', { name: /I accept .* current privacy policy/ })
      .check();
    await admin.page
      .getByRole('button', { name: 'Confirm and continue' })
      .click();
    await expect(admin.page).toHaveURL(/\/profile$/);

    const adminUser = usersToAuthenticate.find(
      (user) => user.stateFile === adminStateFile,
    );
    if (!adminUser || !publishedPolicy) {
      throw new Error('Expected admin user and published policy');
    }
    expect(
      await database.query.tenantPrivacyPolicyAcceptances.findFirst({
        where: {
          policyVersionId: publishedPolicy.id,
          tenantId: tenant.id,
          userId: adminUser.id,
        },
      }),
    ).toBeDefined();
  } finally {
    const createdPolicies =
      await database.query.tenantPrivacyPolicyVersions.findMany({
        where: { tenantId: tenant.id },
      });
    const createdQuestions =
      await database.query.tenantOnboardingQuestions.findMany({
        where: { tenantId: tenant.id },
      });
    const createdPolicyIds = createdPolicies
      .filter((policy) => !originalPolicyIds.has(policy.id))
      .map((policy) => policy.id);
    const createdQuestionIds = createdQuestions
      .filter((question) => !originalQuestionIds.has(question.id))
      .map((question) => question.id);
    if (createdQuestionIds.length > 0) {
      await database
        .delete(schema.tenantOnboardingQuestionAnswers)
        .where(
          inArray(
            schema.tenantOnboardingQuestionAnswers.questionId,
            createdQuestionIds,
          ),
        );
      await database
        .delete(schema.tenantOnboardingQuestions)
        .where(
          inArray(schema.tenantOnboardingQuestions.id, createdQuestionIds),
        );
    }
    if (createdPolicyIds.length > 0) {
      await database
        .delete(schema.tenantPrivacyPolicyAcceptances)
        .where(
          inArray(
            schema.tenantPrivacyPolicyAcceptances.policyVersionId,
            createdPolicyIds,
          ),
        );
      await database
        .delete(schema.tenantPrivacyPolicyVersions)
        .where(
          inArray(schema.tenantPrivacyPolicyVersions.id, createdPolicyIds),
        );
    }
    if (originalActiveQuestionIds.size > 0) {
      await database
        .update(schema.tenantOnboardingQuestions)
        .set({ retiredAt: null })
        .where(
          and(
            eq(schema.tenantOnboardingQuestions.tenantId, tenant.id),
            inArray(schema.tenantOnboardingQuestions.id, [
              ...originalActiveQuestionIds,
            ]),
          ),
        );
    }
    if (originalTenant) {
      await database
        .update(schema.tenants)
        .set({
          privacyPolicyText: originalTenant.privacyPolicyText,
          privacyPolicyUrl: originalTenant.privacyPolicyUrl,
        })
        .where(eq(schema.tenants.id, tenant.id));
    }
    await admin.context.close();
  }
});
