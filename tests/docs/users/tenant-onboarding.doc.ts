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
  tenant,
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
  const joinedTenantDomain = `docs-onboarding-${joinedTenantId}.example.test`;
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
    privacyPolicyText:
      'We use your onboarding answers to provide organization membership services.',
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
      'We use your onboarding answers to provide organization membership services.',
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
# Join Another Organization and Choose Your Home Organization

Evorto uses one account across every organization, such as a local section or association. Joining another organization adds a separate membership to that same account. It does not create another login and it does not remove your existing memberships.

Your **home organization** is the organization Evorto treats as your preferred starting point. The first organization you join becomes your home organization. Joining another one never changes it silently.

{% callout type="note" title="Before you start" %}
Sign in with your existing Evorto account and open a trusted link for the organization you want to join. The organization must have published a privacy policy. It may also ask organization-specific questions.
{% /callout %}

## Review the new organization's requirements

Opening a protected page for an organization you have not joined sends you to **Complete organization setup**. Check the organization name and policy before entering anything. Your existing name and **Notification email** are prefilled because those profile details belong to your global account.
`,
  });

  await member.page.goto('/events');
  await expect(member.page).toHaveURL(/\/create-account$/);
  const onboarding = member.page.locator('app-create-account');
  await expect(
    onboarding.getByRole('heading', { name: 'Complete organization setup' }),
  ).toBeVisible();
  await expect(
    onboarding.getByRole('textbox', { name: 'Notification email' }),
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

1. Review the prefilled profile details. Change the notification address only if you want product messages sent somewhere else across all your organizations.
2. Answer every organization question. A selection question must use one of the listed choices; a short-text answer can contain up to 250 characters.
3. Read the displayed privacy-policy version and select its acceptance checkbox.
4. Select **Join organization**.

**Join organization** stays disabled until the profile, every active question, and the current policy acceptance are valid. If the organization changes its requirements while this page is open, Evorto stops the submission and asks you to review the new version instead of saving stale consent.
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
      name: 'You are browsing another organization',
    }),
  ).toBeVisible();
  await expect(profile).toContainText(
    `Your home organization is ${originalHomeTenant.name}. Joining this organization did not change that preference.`,
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
## Understand the home-organization warning

After the join, Evorto opens your profile in the new organization and shows **You are browsing another organization**. This is confirmation that all of the following were saved for the new organization:

- your membership and its default member role;
- acceptance of the exact policy version; and
- each submitted answer.

The warning names your unchanged home organization. You can use the new organization normally without changing that preference.
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

Select **Make this my home organization** only when you want the organization currently shown in Evorto to become your preferred home. The action changes one account preference; it does not delete the previous organization membership, consent history, answers, roles, registrations, or payments.

Evorto confirms the saved organization by name. After a refresh, the cross-organization warning stays gone because the new home organization remains saved to your account.
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
      name: 'You are browsing another organization',
    }),
  ).toHaveCount(0);
  await expect(
    profile.getByRole('button', {
      name: 'Make this my home organization',
    }),
  ).toHaveCount(0);
});

test('Publish and complete member onboarding @admin', async ({
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
# Member Onboarding

Member onboarding protects every organization-specific feature with three current requirements: a valid profile, acceptance of the organization's latest privacy-policy version, and an answer to every active organization question.

{% callout type="warning" title="Publishing a policy takes effect immediately" %}
When an administrator changes the hosted policy text or external policy link, Evorto publishes an immutable new version. Every existing member, including the administrator who publishes it, must accept that version before continuing in the organization. Coordinate legal review and member communication before publishing.
{% /callout %}

## Open the onboarding settings

Use **Admin Tools** -> **Member onboarding**. The account needs **Change organization settings** access for the current organization.
`,
  });

  await admin.page.goto('/admin/onboarding');
  const settings = admin.page.locator('app-onboarding-settings');
  await expect(
    settings.getByRole('heading', { level: 1, name: 'Member onboarding' }),
  ).toBeVisible();
  await expect(settings.getByRole('note')).toContainText(
    'Publishing changed policy text or a changed link immediately requires every member, including you, to accept the new version before continuing in this organization.',
  );
  await expect(settings).not.toHaveAttribute('ngh', /.*/);
  await takeScreenshot(
    testInfo,
    settings,
    admin.page,
    'Member onboarding settings and publication warning',
  );

  await testInfo.attach('markdown', {
    body: `
## Configure the policy and questions

Provide hosted **Privacy policy text**, an external HTTP or HTTPS **Privacy policy URL**, or both. Text and URL saved together form one policy version with one publication time and author. On **Complete organization setup**, Evorto shows the hosted text and an **Open the full privacy policy** link; the member's single checkbox accepts that whole version.

The public footer uses a separate display rule: while a URL is saved, **Privacy** opens that external page instead of the hosted text. Clear the URL and publish again when the footer should use the hosted privacy page instead.

Use **Add question** for organization-wide information that every member must provide. **Short text** accepts up to 250 characters. **Selection list** requires 2 to 20 unique options, one per line, with at most 80 characters per option. Publishing a changed question set retires the previous questions instead of rewriting their historical answers.
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

After publication, the next protected navigation returns the administrator to **Complete organization setup**. Existing profile details and earlier answers are prefilled where they still apply. Review the exact policy version, answer every current question, and select the privacy acceptance checkbox.

Evorto does not add the person to the organization or assign standard member access until every current requirement is complete. If the policy or questions change while this page is open, submission stops and asks the user to review the new requirements.
`,
  });

  await admin.page.goto('/admin');
  await expect(admin.page).toHaveURL(/\/create-account$/);
  const onboarding = admin.page.locator('app-create-account');
  await expect(
    onboarding.getByRole('heading', { name: 'Complete organization setup' }),
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
    'Current member onboarding requirements',
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
## Home organization behavior

Completing onboarding for another organization joins that organization without silently replacing the user's existing home organization. On the profile page, Evorto explains when the current organization differs from the home organization and offers the deliberate **Make this my home organization** action.

Privacy acceptance and answers remain linked to the organization and the version the member accepted. Hosted text plus an external URL count as one policy version. A later policy version requires a new acceptance; unchanged policy content does not create another version.
`,
  });
});
