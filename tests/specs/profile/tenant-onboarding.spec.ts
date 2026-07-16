import { and, eq, inArray } from 'drizzle-orm';

import {
  adminStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';

test('a tenant admin publishes a version and is immediately required to re-accept it @admin', async ({
  browser,
  database,
  registerDatabaseCleanup,
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

  registerDatabaseCleanup(async (cleanupDatabase) => {
    const createdPolicies =
      await cleanupDatabase.query.tenantPrivacyPolicyVersions.findMany({
        where: { tenantId: tenant.id },
      });
    const createdQuestions =
      await cleanupDatabase.query.tenantOnboardingQuestions.findMany({
        where: { tenantId: tenant.id },
      });
    const createdPolicyIds = createdPolicies
      .filter((policy) => !originalPolicyIds.has(policy.id))
      .map((policy) => policy.id);
    const createdQuestionIds = createdQuestions
      .filter((question) => !originalQuestionIds.has(question.id))
      .map((question) => question.id);
    if (createdQuestionIds.length > 0) {
      await cleanupDatabase
        .delete(schema.tenantOnboardingQuestionAnswers)
        .where(
          inArray(
            schema.tenantOnboardingQuestionAnswers.questionId,
            createdQuestionIds,
          ),
        );
      await cleanupDatabase
        .delete(schema.tenantOnboardingQuestions)
        .where(
          inArray(schema.tenantOnboardingQuestions.id, createdQuestionIds),
        );
    }
    if (createdPolicyIds.length > 0) {
      await cleanupDatabase
        .delete(schema.tenantPrivacyPolicyAcceptances)
        .where(
          inArray(
            schema.tenantPrivacyPolicyAcceptances.policyVersionId,
            createdPolicyIds,
          ),
        );
      await cleanupDatabase
        .delete(schema.tenantPrivacyPolicyVersions)
        .where(
          inArray(schema.tenantPrivacyPolicyVersions.id, createdPolicyIds),
        );
    }
    if (originalActiveQuestionIds.size > 0) {
      await cleanupDatabase
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
      await cleanupDatabase
        .update(schema.tenants)
        .set({
          privacyPolicyText: originalTenant.privacyPolicyText,
          privacyPolicyUrl: originalTenant.privacyPolicyUrl,
        })
        .where(eq(schema.tenants.id, tenant.id));
    }
  });
  registerDatabaseCleanup(async () => admin.context.close());

  await admin.page.goto('/admin/onboarding');
  const settings = admin.page.locator('app-onboarding-settings');
  await expect(
    settings.getByRole('heading', {
      level: 1,
      name: 'Member onboarding',
    }),
  ).toBeVisible();
  await expect(settings.getByRole('note')).toContainText(
    'Publishing changed policy text or a changed link immediately requires every member, including you, to accept the new version before continuing in this organization.',
  );
  await expect(settings).not.toHaveAttribute('ngh', /.*/);
  if (!originalTenant?.privacyPolicyText) {
    throw new Error('Expected seeded tenant privacy policy text');
  }
  const privacyPolicyText = settings.getByRole('textbox', {
    name: 'Privacy policy text',
  });
  await expect(privacyPolicyText).toHaveValue(originalTenant.privacyPolicyText);
  await privacyPolicyText.fill(
    'Updated privacy policy for the current academic year.',
  );
  const questionInputs = settings.getByRole('textbox', { name: 'Question' });
  const previousQuestionCount = await questionInputs.count();
  await settings.getByRole('button', { name: 'Add question' }).click();
  await expect(questionInputs).toHaveCount(previousQuestionCount + 1);
  await questionInputs
    .nth(previousQuestionCount)
    .fill('Which member group should welcome you?');
  await settings.getByRole('combobox', { name: 'Answer type' }).last().click();
  await admin.page.getByRole('option', { name: 'Selection list' }).click();
  await settings
    .getByRole('textbox', { name: 'Selection options' })
    .last()
    .fill('Buddy team\nEvents team');
  await settings.getByRole('button', { name: 'Publish settings' }).click();
  await expect(
    admin.page.getByText(/members must accept it before continuing/i),
  ).toBeVisible();

  const allPolicies = await database.query.tenantPrivacyPolicyVersions.findMany(
    {
      where: { tenantId: tenant.id },
    },
  );
  const publishedPolicy = allPolicies.find(
    (policy) => !originalPolicyIds.has(policy.id),
  );
  expect(publishedPolicy?.createdByUserId).toBeTruthy();

  await admin.page.goto('/admin');
  await expect(admin.page).toHaveURL(/\/create-account$/);
  const onboarding = admin.page.locator('app-create-account');
  await expect(
    onboarding.getByRole('heading', { name: 'Complete organization setup' }),
  ).toBeVisible();
  await expect(
    onboarding.getByRole('heading', {
      name: `Privacy policy version ${publishedPolicy?.version}`,
    }),
  ).toBeVisible();
  const onboardingQuestion = onboarding.getByRole('combobox', {
    name: 'Which member group should welcome you?',
  });
  await expect(onboardingQuestion).toBeVisible();
  await onboardingQuestion.focus();
  await expect(onboardingQuestion).toBeFocused();
  await onboardingQuestion.press('Space');
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
});
