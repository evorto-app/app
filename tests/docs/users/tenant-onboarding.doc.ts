import { and, eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import {
  adminStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';

test('Join another organization and choose your home organization', async ({
  browser,
  database,
  page,
  registerDatabaseCleanup,
  testClock,
}, testInfo) => {
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected the documented signed-in member');
  }
  const originalUser = await database.query.users.findFirst({
    where: { id: regularUser.id },
  });
  if (!originalUser?.homeTenantId) {
    throw new Error('Expected the documented member to have a home tenant');
  }
  const originalHomeTenant = await database.query.tenants.findFirst({
    where: { id: originalUser.homeTenantId },
  });
  if (!originalHomeTenant) {
    throw new Error('Expected the documented home tenant');
  }

  const joinedTenantId = getId();
  const joinedTenantDomain = 'lakeside-students.example.org';
  const roleId = getId();
  const policyVersionId = getId();
  const selectionQuestionId = getId();
  const shortTextQuestionId = getId();

  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .update(schema.users)
      .set({ homeTenantId: originalUser.homeTenantId })
      .where(eq(schema.users.id, regularUser.id));
    await cleanupDatabase
      .delete(schema.rolesToTenantUsers)
      .where(eq(schema.rolesToTenantUsers.tenantId, joinedTenantId));
    await cleanupDatabase
      .delete(schema.tenantOnboardingQuestionAnswers)
      .where(
        eq(schema.tenantOnboardingQuestionAnswers.tenantId, joinedTenantId),
      );
    await cleanupDatabase
      .delete(schema.tenantPrivacyPolicyAcceptances)
      .where(
        eq(schema.tenantPrivacyPolicyAcceptances.tenantId, joinedTenantId),
      );
    await cleanupDatabase
      .delete(schema.usersToTenants)
      .where(eq(schema.usersToTenants.tenantId, joinedTenantId));
    await cleanupDatabase
      .delete(schema.tenantOnboardingQuestions)
      .where(eq(schema.tenantOnboardingQuestions.tenantId, joinedTenantId));
    await cleanupDatabase
      .delete(schema.tenantPrivacyPolicyVersions)
      .where(eq(schema.tenantPrivacyPolicyVersions.tenantId, joinedTenantId));
    await cleanupDatabase
      .delete(schema.roles)
      .where(eq(schema.roles.id, roleId));
    await cleanupDatabase
      .delete(schema.tenants)
      .where(eq(schema.tenants.id, joinedTenantId));
  });

  await database.insert(schema.tenants).values({
    domain: joinedTenantDomain,
    id: joinedTenantId,
    name: 'Example Exchange Network',
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
      'We use the answers you provide while joining to provide organization membership services.',
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

  await page.goto('/');
  const member = await openAuthenticatedTestPage({
    baseUrl: new URL(page.url()).origin,
    browser,
    storageState: userStateFile,
    tenantDomain: joinedTenantDomain,
    testClock,
  });
  registerDatabaseCleanup(async () => member.context.close());

  await testInfo.attach('markdown', {
    body: `

Evorto uses one account across every organization, such as a local section or association. Joining another organization adds a separate membership to that same account. It does not create another account and it does not remove your existing memberships.

Your **home organization** is the organization Evorto treats as your preferred starting point. The first organization you join becomes your home organization. Joining another one never changes it silently.

{% callout type="note" title="Before you start" %}
Sign in with your existing Evorto account and open a trusted link for the organization you want to join. The organization must have published a privacy policy. It may also ask organization-specific questions.
{% /callout %}

## Review what the new organization asks

When you open a page for an organization you have not joined, Evorto shows **Finish setting up your account**. Check the organization name and policy before entering anything. Your existing name and **Email for updates** are already filled in because those profile details are shared across your organizations.
`,
  });

  await member.page.goto('/events');
  await expect(member.page).toHaveURL(/\/create-account$/);
  const onboarding = member.page.locator('app-create-account');
  await expect(
    onboarding.getByRole('heading', { name: 'Finish setting up your account' }),
  ).toBeVisible();
  await expect(
    onboarding.getByRole('textbox', { name: 'Email for updates' }),
  ).toHaveValue(originalUser.communicationEmail);
  const joinButton = onboarding.getByRole('button', {
    name: 'Join organization',
  });
  await expect(joinButton).toBeDisabled();
  await takeScreenshot(
    testInfo,
    onboarding,
    member.page,
    'Review the profile, questions, and current privacy policy',
  );

  await testInfo.attach('markdown', {
    body: `
## Complete every required field

1. Review the details already shown. Change **Email for updates** only if you want updates sent somewhere else across all your organizations.
2. Answer every organization question. For a question with a list, choose one of the shown options. Written answers can contain up to 250 characters.
3. Read the displayed privacy policy and select its acceptance checkbox.
4. Select **Join organization**.

**Join organization** stays disabled until the profile, every current question, and the current policy acceptance are valid. If the organization changes its policy or questions while this page is open, Evorto keeps answers that still apply and asks you to review the changes before trying again.
`,
  });

  await onboarding
    .getByRole('combobox', { name: 'How are you joining?' })
    .click();
  await member.page.getByRole('option', { name: 'Exchange student' }).click();
  await onboarding
    .getByRole('textbox', { name: 'What should the board know?' })
    .fill('I arrive in the autumn semester.');
  await onboarding
    .getByRole('checkbox', {
      name: "I accept Example Exchange Network's current privacy policy.",
    })
    .check();
  await expect(joinButton).toBeEnabled();
  await takeScreenshot(
    testInfo,
    onboarding,
    member.page,
    'Complete every required answer and accept the current policy',
  );
  await joinButton.click();

  await expect(member.page).toHaveURL(/\/profile$/);
  const profile = member.page.locator('app-user-profile');
  await expect(
    profile.getByRole('heading', {
      name: 'You are viewing another organization',
    }),
  ).toBeVisible();
  await expect(profile).toContainText(
    `Your home organization is ${originalHomeTenant.name}. Joining this organization did not make it your home organization.`,
  );
  const makeHomeTenantButton = profile.getByRole('button', {
    name: 'Make this my home organization',
  });
  await expect(makeHomeTenantButton).toBeVisible();

  const membership = await database.query.usersToTenants.findFirst({
    where: { tenantId: joinedTenantId, userId: regularUser.id },
  });
  expect(membership).toBeDefined();
  if (!membership) {
    throw new Error('Expected the documented cross-tenant membership');
  }
  expect(
    await database.query.rolesToTenantUsers.findFirst({
      where: { roleId, userTenantId: membership.id },
    }),
  ).toBeDefined();
  expect(
    await database.query.tenantPrivacyPolicyAcceptances.findFirst({
      where: {
        policyVersionId,
        tenantId: joinedTenantId,
        userId: regularUser.id,
      },
    }),
  ).toBeDefined();
  expect(
    await database.query.tenantOnboardingQuestionAnswers.findMany({
      where: { tenantId: joinedTenantId, userId: regularUser.id },
    }),
  ).toEqual(
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

  await testInfo.attach('markdown', {
    body: `
## Understand the home organization message

After you join, Evorto opens your profile in the new organization. **You are viewing another organization** means your previous home organization is still selected; you can nevertheless use the new organization normally.
`,
  });
  await takeScreenshot(
    testInfo,
    profile,
    member.page,
    'The new membership keeps the previous home organization',
  );

  await testInfo.attach('markdown', {
    body: `
## Deliberately change the home organization

Select **Make this my home organization** only when you want the organization currently shown in Evorto to become your preferred home. This only changes which organization opens as your home; it does not delete the previous organization membership, consent history, answers, roles, tickets, or payments.

Evorto confirms the saved organization by name. When you open the page again, the message about having a different home organization stays gone because the new home organization remains saved to your account.
`,
  });
  await expect(makeHomeTenantButton).not.toHaveAttribute('jsaction', /click/);
  await makeHomeTenantButton.click();
  await expect(
    member.page.getByText(
      'Example Exchange Network is now your home organization',
    ),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const persistedUser = await database.query.users.findFirst({
        where: { id: regularUser.id },
      });
      return persistedUser?.homeTenantId;
    })
    .toBe(joinedTenantId);
  await takeScreenshot(
    testInfo,
    profile,
    member.page,
    'The current organization is now the saved home organization',
  );

  await member.page.reload();
  await expect(
    profile.getByRole('heading', {
      name: 'You are viewing another organization',
    }),
  ).toHaveCount(0);
  await expect(
    profile.getByRole('button', {
      name: 'Make this my home organization',
    }),
  ).toHaveCount(0);
});

test('Choose what members need to provide @admin', async ({
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

  const tenantExists = await database.query.tenants.findFirst({
    columns: { id: true },
    where: { id: tenant.id },
  });
  if (!tenantExists) {
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
    'We process your profile and the answers you provide while joining to provide membership services.';
  const privacyPolicyUrl = 'https://lakeside-students.example.org/privacy';

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
  });
  registerDatabaseCleanup(async () => admin.context.close());

  await testInfo.attach('markdown', {
    body: `

Before someone can join or continue using an organization, they must complete their profile, accept the latest privacy policy, and answer every required question.

{% callout type="warning" title="Publishing a policy takes effect immediately" %}
When an administrator publishes a changed privacy policy, every existing member, including that administrator, must accept it before continuing. Complete legal review and tell members about the change before publishing.
{% /callout %}

## Open new member setup

Use **Admin Tools** → **New member setup**. You need **Change organization settings** access for the current organization.
`,
  });

  await admin.page.goto('/admin/onboarding');
  const settings = admin.page.locator('app-onboarding-settings');
  await expect(
    settings.getByRole('heading', { level: 1, name: 'New member setup' }),
  ).toBeVisible();
  await expect(settings.getByRole('note')).toContainText(
    'When you publish a policy change, every member, including you, must accept it before continuing in this organization.',
  );
  await expect(settings).not.toHaveAttribute('ngh', /.*/);
  await takeScreenshot(
    testInfo,
    settings,
    admin.page,
    'New member setup and publication warning',
  );

  await testInfo.attach('markdown', {
    body: `
## Choose the policy and questions

Enter **Privacy policy text**, a full **Privacy policy web address**, or both. If both are present, members see the text and an **Open the full privacy policy** link. One checkbox accepts the complete policy shown there.

When a web address is saved, selecting **Privacy** on a public page opens that address. Clear the address and publish again when **Privacy** should open the text published in Evorto instead.

Use **Add question** for information that every member must provide. **Write an answer** accepts up to 250 characters. **Choose from a list** requires 2 to 20 different choices, one per line, with at most 80 characters each. Changing the questions does not change answers members already submitted.
`,
  });

  await settings
    .getByRole('textbox', { name: 'Privacy policy text' })
    .fill(privacyPolicyText);
  await settings
    .getByRole('textbox', { name: 'Privacy policy web address' })
    .fill(privacyPolicyUrl);
  const questionInputs = settings.getByRole('textbox', { name: 'Question' });
  const previousQuestionCount = await questionInputs.count();
  await settings.getByRole('button', { name: 'Add question' }).click();
  await expect(questionInputs).toHaveCount(previousQuestionCount + 1);
  await questionInputs
    .nth(previousQuestionCount)
    .fill('Which member group should welcome you?');
  await settings
    .getByRole('combobox', { name: 'How members answer' })
    .last()
    .click();
  await admin.page.getByRole('option', { name: 'Choose from a list' }).click();
  await settings
    .getByRole('textbox', { name: 'Choices' })
    .last()
    .fill('Buddy team\nEvents team');
  await takeScreenshot(
    testInfo,
    settings,
    admin.page,
    'Privacy policy and required question',
  );

  await settings.getByRole('button', { name: 'Publish changes' }).click();
  await expect(
    admin.page.getByText(
      /members must accept the new policy before continuing/i,
    ),
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
## Finish setup after publishing the changes

After publishing, the next page you open returns you to **Finish setting up your account**. Existing profile details and earlier answers are already filled in where they still apply. Review the current policy, answer every current question, and select the privacy acceptance checkbox.

For a new member, Evorto creates the organization membership only after they complete the form. Existing members remain in the organization but cannot continue until they accept the current policy and answer the current required questions. If the policy or questions change while the form is open, Evorto asks them to review the latest version before submitting again.
`,
  });

  await admin.page.goto('/admin');
  await expect(admin.page).toHaveURL(/\/create-account$/);
  const onboarding = admin.page.locator('app-create-account');
  await expect(
    onboarding.getByRole('heading', { name: 'Finish setting up your account' }),
  ).toBeVisible();
  await expect(
    onboarding.getByRole('heading', {
      name: 'Current privacy policy',
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
    'Review the current policy and questions',
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
  await onboarding.getByRole('button', { name: 'Finish setup' }).click();
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
## Home organization behavior

Completing setup for another organization joins that organization without silently replacing the member's existing home organization. On the profile page, Evorto explains when the current organization differs from the home organization and offers the deliberate **Make this my home organization** action.

Privacy acceptance and answers stay with the organization and the policy the member accepted. Text published by Evorto and a separate web address belong to the same policy. Members must accept a changed policy again; saving the same content does not ask them twice.
`,
  });
});
