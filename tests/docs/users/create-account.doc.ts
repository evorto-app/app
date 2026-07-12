import { and, eq } from 'drizzle-orm';
import { ConfigProvider, Effect } from 'effect';
import { expect } from '@playwright/test';

import * as schema from '../../../src/db/schema';
import {
  createAccountErrorMessage,
  createAccountModelFromAuthData,
  createAccountPayloadFromModel,
  createAccountSubmitDisabled,
  isAuthEmailVerifiedForAccountCreation,
} from '../../../src/app/core/create-account/create-account.helpers';
import { test } from '../../support/fixtures/base-test';
import { hasAuth0ManagementEnvironment } from '../../support/config/environment';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

// test.use({ storageState: defaultStateFile });

// Keep credential discovery separate from test registration. The integration
// journey fails its explicit precondition instead of being skipped or omitted.
const hasManagementEnvironment = Effect.runSync(
  hasAuth0ManagementEnvironment.pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnv(),
    ),
  ),
);

test('Understand tenant account creation', async ({}, testInfo) => {
  expect(
    createAccountModelFromAuthData(
      {
        acceptedPrivacyPolicy: false,
        answers: [],
        communicationEmail: '',
        firstName: '',
        lastName: '',
        policyVersionId: '',
      },
      {
        email: ' new-user@example.org ',
        email_verified: true,
        family_name: ' User ',
        given_name: ' New ',
      },
    ),
  ).toEqual({
    acceptedPrivacyPolicy: false,
    answers: [],
    communicationEmail: 'new-user@example.org',
    firstName: 'New',
    lastName: 'User',
    policyVersionId: '',
  });
  expect(
    createAccountPayloadFromModel({
      acceptedPrivacyPolicy: true,
      answers: [{ questionId: 'question-1', value: ' Exchange student ' }],
      communicationEmail: ' notify@example.org ',
      firstName: ' New ',
      lastName: ' User ',
      policyVersionId: 'policy-1',
    }),
  ).toEqual({
    acceptedPrivacyPolicy: true,
    answers: [{ questionId: 'question-1', value: 'Exchange student' }],
    communicationEmail: 'notify@example.org',
    firstName: 'New',
    lastName: 'User',
    policyVersionId: 'policy-1',
  });
  expect(isAuthEmailVerifiedForAccountCreation({ email_verified: true })).toBe(
    true,
  );
  expect(isAuthEmailVerifiedForAccountCreation({ email_verified: false })).toBe(
    false,
  );
  expect(
    createAccountSubmitDisabled({
      formInvalid: false,
      formSubmitting: false,
      mutationPending: true,
    }),
  ).toBe(true);
  expect(
    createAccountErrorMessage({
      _tag: 'TenantOnboardingRequirementsChangedError',
      message: 'Requirements changed; review and submit again',
    }),
  ).toBe('Requirements changed; review and submit again');

  await testInfo.attach('markdown', {
    body: `
# Tenant Setup and Privacy Acceptance

Authenticated users who have not completed the current tenant requirements are sent to **Complete tenant setup** before protected tenant pages. This applies to a first tenant join, newly published privacy-policy versions, and newly required tenant questions. The form is shown only after the Auth0 email address is explicitly verified.

The account form pre-fills first name, last name, and **Notification email** from Auth0 data when available. Evorto stores the notification email as the user-managed communication address for event and finance messages; it may differ from the Auth0 login email shown later on the profile page.

Before submitting, the form trims first name, last name, notification email, and question answers. It stays disabled while invalid, already submitting, waiting for the onboarding mutation, or until the current privacy policy is accepted, so slow tenant-join writes cannot be double-submitted. If setup fails or the requirements changed in another tab, the page shows a retryable server error instead of silently losing the submit attempt.

Completing setup records the exact privacy-policy version and the submitted answers before joining the current tenant and granting its default user roles. Existing global users with the same Auth0 id join the current tenant instead of creating a duplicate global user. A user's original home tenant stays unchanged when they join another tenant; they can deliberately change it from the profile page afterward.
`,
  });
});

test.describe('Auth0-backed account creation docs', () => {
  test.beforeAll(() => {
    expect(
      hasManagementEnvironment,
      'AUTH0_MANAGEMENT_CLIENT_ID and AUTH0_MANAGEMENT_CLIENT_SECRET are required for this integration doc',
    ).toBe(true);
  });

  test('Create your account @needs-auth0-management', async ({
    database,
    newUser,
    page,
    tenantDomain,
  }, testInfo) => {
    let createdUserId: string | undefined;
    let createdTenantUserId: string | undefined;

    try {
      await testInfo.attach('markdown', {
        body: `
{% callout type="note" title="For first time visits" %}
This guide assumes that you are authenticated by Auth0 but have not completed setup for the current tenant. Completing setup records the current privacy-policy acceptance, connects your global login to this tenant, and grants the tenant's default user roles.
{% /callout %}
## Login
Open the app page and click on the **Login** link.`,
      });
      await page.context().clearCookies();
      await page.goto('/logout');
      await page.goto('.');
      const loginLink = page.getByRole('link', { name: 'Login' }).first();
      if (!(await loginLink.isVisible())) {
        const logoutLink = page.getByRole('link', { name: 'Logout' }).first();
        if (await logoutLink.isVisible()) {
          await logoutLink.click();
          await page.waitForURL(/\/(login|$)/);
        }
      }
      await page.getByRole('link', { name: 'Login' }).first().waitFor({
        state: 'visible',
      });
      await takeScreenshot(
        testInfo,
        page.getByRole('link', { name: 'Login' }),
        page,
        'Login link on desktop browsers',
      );
      await page.getByRole('link', { name: 'Login' }).click();
      await testInfo.attach('markdown', {
        body: `
After starting the login flow, sign in with the account you want to use for this tenant. This integration guide uses a generated demo user because Auth0 account creation requires Auth0 Management credentials.

If your Auth0 email address is not verified yet, Evorto asks you to verify it before the tenant account form is shown.`,
      });
      await page.getByLabel('Email address').waitFor({ state: 'visible' });
      await takeScreenshot(testInfo, page.getByLabel('Email address'), page);
      await page.getByLabel('Email address').fill(newUser.email);
      await page
        .getByRole('textbox', { name: 'Password' })
        .fill(newUser.password);
      await page.getByRole('button', { exact: true, name: 'Continue' }).click();
      const acceptButton = page.getByRole('button', {
        exact: true,
        name: 'Accept',
      });
      const joinTenantButton = page.getByRole('button', {
        exact: true,
        name: 'Join tenant',
      });
      await expect(acceptButton.or(joinTenantButton).first()).toBeVisible({
        timeout: 15000,
      });
      if (await acceptButton.isVisible()) {
        await acceptButton.click();
      }
      await expect(joinTenantButton).toBeVisible({ timeout: 15000 });

      await testInfo.attach('markdown', {
        body: `
Review the prefilled first name, last name, and **Notification email** address. Read the tenant's current privacy policy and accept it before clicking **Join tenant**. Evorto stores both the exact accepted policy version and the notification email as your editable communication address for event and finance messages.

If the tenant asks onboarding questions, every current question must be answered. If the same global login already exists for another tenant, this step joins the current tenant instead of creating a duplicate global user. If setup fails or the policy changes while the form is open, the form shows the server error and lets you review the current requirements before retrying.`,
      });
      const createAccountForm = page
        .locator('form')
        .filter({ has: joinTenantButton })
        .first();
      await createAccountForm.waitFor({ state: 'visible' });
      await expect(
        createAccountForm.getByRole('textbox', { name: 'Notification email' }),
      ).toBeVisible();
      await takeScreenshot(testInfo, createAccountForm, page);
      await createAccountForm
        .getByRole('checkbox', { name: /I accept .* current privacy policy/ })
        .check();
      await joinTenantButton.click();
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: `${newUser.firstName} ${newUser.lastName}`,
        }),
      ).toBeVisible();

      const createdUser = await database.query.users.findFirst({
        where: { email: newUser.email },
      });
      if (!createdUser) {
        throw new Error(
          'Expected account creation docs to persist a global user',
        );
      }
      createdUserId = createdUser.id;
      expect(createdUser).toMatchObject({
        communicationEmail: newUser.email,
        email: newUser.email,
        firstName: newUser.firstName,
        homeTenantId: expect.any(String),
        lastName: newUser.lastName,
      });

      const currentTenant = await database.query.tenants.findFirst({
        where: { domain: tenantDomain ?? 'localhost' },
      });
      if (!currentTenant) {
        throw new Error('Expected seeded tenant for current host');
      }

      const tenantUser = await database.query.usersToTenants.findFirst({
        where: { tenantId: currentTenant.id, userId: createdUser.id },
      });
      if (!tenantUser) {
        throw new Error(
          'Expected account creation docs to join current tenant',
        );
      }
      createdTenantUserId = tenantUser.id;
      expect(createdUser.homeTenantId).toBe(currentTenant.id);

      const currentPolicy =
        await database.query.tenantPrivacyPolicyVersions.findFirst({
          orderBy: { version: 'desc' },
          where: { tenantId: currentTenant.id },
        });
      if (!currentPolicy) {
        throw new Error('Expected seeded tenant privacy policy');
      }
      expect(
        await database.query.tenantPrivacyPolicyAcceptances.findFirst({
          where: {
            policyVersionId: currentPolicy.id,
            tenantId: currentTenant.id,
            userId: createdUser.id,
          },
        }),
      ).toBeDefined();

      const roleAssignments = await database.query.rolesToTenantUsers.findMany({
        where: { userTenantId: tenantUser.id },
      });
      expect(roleAssignments.length).toBeGreaterThan(0);

      await testInfo.attach('markdown', {
        body: `
You should now be on your profile page for the current tenant. The tenant membership, default role assignment, exact policy acceptance, and first home-tenant selection are persisted together. From here you can review your profile, manage discount cards when the tenant supports them, and register for events.`,
      });
    } finally {
      if (createdUserId) {
        await database
          .delete(schema.tenantOnboardingQuestionAnswers)
          .where(
            eq(schema.tenantOnboardingQuestionAnswers.userId, createdUserId),
          );
        await database
          .delete(schema.tenantPrivacyPolicyAcceptances)
          .where(
            eq(schema.tenantPrivacyPolicyAcceptances.userId, createdUserId),
          );
        const tenantUsers = await database.query.usersToTenants.findMany({
          where: { userId: createdUserId },
        });
        for (const tenantUser of tenantUsers) {
          await database
            .delete(schema.rolesToTenantUsers)
            .where(eq(schema.rolesToTenantUsers.userTenantId, tenantUser.id));
          await database
            .delete(schema.usersToTenants)
            .where(eq(schema.usersToTenants.id, tenantUser.id));
        }
        await database
          .delete(schema.users)
          .where(
            and(
              eq(schema.users.id, createdUserId),
              eq(schema.users.email, newUser.email),
            ),
          );
      } else if (createdTenantUserId) {
        await database
          .delete(schema.rolesToTenantUsers)
          .where(
            eq(schema.rolesToTenantUsers.userTenantId, createdTenantUserId),
          );
        await database
          .delete(schema.usersToTenants)
          .where(eq(schema.usersToTenants.id, createdTenantUserId));
      }
    }
  });
});
