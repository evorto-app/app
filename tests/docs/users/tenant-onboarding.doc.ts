import { and, eq, inArray } from 'drizzle-orm';

import {
  adminStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';

test('Publish and complete tenant onboarding @admin', async ({
  browser,
  database,
  registerDatabaseCleanup,
  page,
  tenant,
  testClock,
}, testInfo) => {
  await page.goto('/');
  const admin = await openAuthenticatedTestPage({
    baseUrl: new URL(page.url()).origin,
    browser,
    storageState: adminStateFile,
    tenantDomain: tenant.domain,
    testClock,
  });
  const adminUser = usersToAuthenticate.find(
    (user) => user.stateFile === adminStateFile,
  );
  if (!adminUser) {
    throw new Error('Expected the documented tenant administrator');
  }

  const originalTenant = await database.query.tenants.findFirst({
    where: { id: tenant.id },
  });
  if (!originalTenant) {
    throw new Error('Expected the documented tenant');
  }
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
  const privacyPolicyText =
    'We process your profile and onboarding answers to provide section membership services.';
  const privacyPolicyUrl = `https://example.com/privacy/${tenant.id}`;

  registerDatabaseCleanup(async (cleanupDatabase) => {
    const currentPolicies =
      await cleanupDatabase.query.tenantPrivacyPolicyVersions.findMany({
        where: { tenantId: tenant.id },
      });
    const currentQuestions =
      await cleanupDatabase.query.tenantOnboardingQuestions.findMany({
        where: { tenantId: tenant.id },
      });
    const createdPolicyIds = currentPolicies
      .filter((policy) => !originalPolicyIds.has(policy.id))
      .map((policy) => policy.id);
    const createdQuestionIds = currentQuestions
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
    await cleanupDatabase
      .update(schema.tenants)
      .set({
        privacyPolicyText: originalTenant.privacyPolicyText,
        privacyPolicyUrl: originalTenant.privacyPolicyUrl,
      })
      .where(eq(schema.tenants.id, tenant.id));
  });
  registerDatabaseCleanup(async () => admin.context.close());

  await testInfo.attach('markdown', {
    body: `
# Tenant Onboarding

Tenant onboarding protects every tenant-specific feature with three current requirements: a valid profile, acceptance of the tenant's latest privacy-policy version, and an answer to every active tenant question.

{% callout type="warning" title="Publishing a policy takes effect immediately" %}
When an administrator changes the hosted policy text or external policy link, Evorto publishes an immutable new version. Every existing tenant user, including the administrator who publishes it, must accept that version before using protected tenant features again. Coordinate legal review and user communication before publishing.
{% /callout %}

## Open the onboarding settings

Use **Admin Tools** -> **Tenant onboarding**. The account needs **admin:changeSettings** for the current tenant.
`,
  });

  await admin.page.goto('/admin/onboarding');
  const settings = admin.page.locator('app-onboarding-settings');
  await expect(
    settings.getByRole('heading', { level: 1, name: 'Tenant onboarding' }),
  ).toBeVisible();
  await expect(settings.getByRole('note')).toContainText(
    'Publishing changed policy text or a changed link immediately requires every tenant user, including you, to accept the new version before using protected tenant features.',
  );
  await expect(settings).not.toHaveAttribute('ngh', /.*/);
  await takeScreenshot(
    testInfo,
    settings,
    admin.page,
    'Tenant onboarding settings and publication warning',
  );

  await testInfo.attach('markdown', {
    body: `
## Configure the policy and questions

Provide hosted **Privacy policy text**, an external HTTPS **Privacy policy URL**, or both. Text and URL saved together form one policy version with one publication time and author. On **Complete tenant setup**, Evorto shows the hosted text and an **Open the full privacy policy** link; the member's single checkbox accepts that whole version.

The public footer uses a separate display rule: while a URL is saved, **Privacy** opens that external URL and the local \`/legal/privacy\` route does not expose the stored hosted text. Clear the URL and publish again when the footer should use the hosted route instead.

Use **Add question** for tenant-wide information that every user must provide. **Short text** accepts up to 250 characters. **Selection list** requires 2 to 20 unique options, one per line. Publishing a changed question set retires the previous questions instead of rewriting their historical answers.
`,
  });

  await settings
    .getByRole('textbox', { name: 'Privacy policy text' })
    .fill(privacyPolicyText);
  await settings
    .getByRole('textbox', { name: 'Privacy policy URL' })
    .fill(privacyPolicyUrl);
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
  await takeScreenshot(
    testInfo,
    settings,
    admin.page,
    'Configured privacy policy and required selection question',
  );

  await settings.getByRole('button', { name: 'Publish settings' }).click();
  await expect(
    admin.page.getByText(/tenant users must accept it before continuing/i),
  ).toBeVisible();

  const allPolicies = await database.query.tenantPrivacyPolicyVersions.findMany(
    {
      where: { tenantId: tenant.id },
    },
  );
  const publishedPolicy = allPolicies.find(
    (policy) => !originalPolicyIds.has(policy.id),
  );
  if (!publishedPolicy) {
    throw new Error('Expected onboarding docs to publish a policy version');
  }
  expect(publishedPolicy).toMatchObject({
    createdByUserId: adminUser.id,
    privacyPolicyText,
    privacyPolicyUrl,
  });

  await testInfo.attach('markdown', {
    body: `
## Complete the current requirements

After publication, the next protected navigation returns the administrator to **Complete tenant setup**. Existing profile details and earlier answers are prefilled where they still apply. Review the exact policy version, answer every current question, and select the privacy acceptance checkbox.

Evorto does not create a tenant membership or grant default roles until all current requirements validate. If the policy or questions change while this page is open, submission stops and asks the user to review the new requirements.
`,
  });

  await admin.page.goto('/admin');
  await expect(admin.page).toHaveURL(/\/create-account$/);
  const onboarding = admin.page.locator('app-create-account');
  await expect(
    onboarding.getByRole('heading', { name: 'Complete tenant setup' }),
  ).toBeVisible();
  await expect(
    onboarding.getByRole('heading', {
      name: `Privacy policy version ${publishedPolicy.version}`,
    }),
  ).toBeVisible();
  await expect(
    onboarding.getByText(privacyPolicyText, { exact: true }),
  ).toBeVisible();
  await expect(
    onboarding.getByRole('link', { name: 'Open the full privacy policy' }),
  ).toHaveAttribute('href', privacyPolicyUrl);
  await takeScreenshot(
    testInfo,
    onboarding,
    admin.page,
    'Current tenant onboarding requirements',
  );

  const onboardingQuestion = onboarding.getByRole('combobox', {
    name: 'Which member group should welcome you?',
  });
  await expect(onboardingQuestion).toBeVisible();
  await onboardingQuestion.focus();
  await expect(onboardingQuestion).toBeFocused();
  await onboardingQuestion.press('Space');
  await admin.page.getByRole('option', { name: 'Buddy team' }).click();
  await onboarding
    .getByRole('checkbox', { name: /I accept .* current privacy policy/ })
    .check();
  await onboarding
    .getByRole('button', { name: 'Confirm and continue' })
    .click();
  await expect(admin.page).toHaveURL(/\/profile$/);
  expect(
    await database.query.tenantPrivacyPolicyAcceptances.findFirst({
      where: {
        policyVersionId: publishedPolicy.id,
        tenantId: tenant.id,
        userId: adminUser.id,
      },
    }),
  ).toBeDefined();
  const currentQuestion =
    await database.query.tenantOnboardingQuestions.findFirst({
      where: {
        prompt: 'Which member group should welcome you?',
        tenantId: tenant.id,
      },
    });
  if (!currentQuestion) {
    throw new Error('Expected the documented onboarding question');
  }
  expect(
    await database.query.tenantOnboardingQuestionAnswers.findFirst({
      where: {
        answer: 'Buddy team',
        questionId: currentQuestion.id,
        tenantId: tenant.id,
        userId: adminUser.id,
      },
    }),
  ).toBeDefined();

  await testInfo.attach('markdown', {
    body: `
## Home tenant behavior

Completing onboarding for another tenant joins that tenant without silently replacing the user's existing home tenant. On the profile page, Evorto explains when the current tenant differs from the home tenant and offers the deliberate **Make this my home tenant** action.

Privacy acceptances and question answers remain attached to their tenant and immutable policy or question records. Hosted text plus an external URL is still one accepted policy version, not two separate acceptances. A later policy version requires a new acceptance; unchanged policy content does not create another version.
`,
  });
});
