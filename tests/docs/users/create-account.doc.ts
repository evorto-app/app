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
import { fillProtectedValue } from '../../support/utils/fill-protected-value';

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

test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test('Understand organization account setup', async ({}, testInfo) => {
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
# Organization Setup and Privacy Acceptance

Signed-in users who have not completed the current organization requirements are sent to **Complete organization setup** before protected pages. This applies to a first organization join, newly published privacy-policy versions, and newly required questions. The form is shown only after the sign-in email address is verified.

The account form pre-fills first name, last name, and **Notification email** from the sign-in account when available. Evorto uses the notification email for event and finance messages; it may differ from the sign-in email shown later on the profile page.

Before submitting, the form trims first name, last name, notification email, and question answers. The button stays unavailable until every required field is valid and the current policy is accepted. If requirements change while the page is open, Evorto keeps matching answers and asks you to review the latest version.

Completing setup records the accepted privacy-policy version and submitted answers, adds you to the current organization, and grants its standard member access. If your login already belongs to another organization, Evorto adds the same account here instead of creating a duplicate. Your original home organization stays unchanged until you deliberately change it from your profile.
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
This guide assumes that you are signed in but have not completed setup for the current organization. Completing setup records the current privacy-policy acceptance and adds your account to the organization with its standard member access.
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
After starting the login flow, sign in with the account you want to use for this organization.

If your login email address is not verified yet, Evorto asks you to verify it before the organization setup form is shown.`,
      });
      await page.getByLabel('Email address').waitFor({ state: 'visible' });
      await takeScreenshot(testInfo, page.getByLabel('Email address'), page);
      await page.getByLabel('Email address').fill(newUser.email);
      await fillProtectedValue(
        page.getByRole('textbox', { name: 'Password' }),
        'E2E_TRANSIENT_AUTH0_USER_PASSWORD',
      );
      await page.getByRole('button', { exact: true, name: 'Continue' }).click();
      const acceptButton = page.getByRole('button', {
        exact: true,
        name: 'Accept',
      });
      const joinTenantButton = page.getByRole('button', {
        exact: true,
        name: 'Join organization',
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
Review the prefilled first name, last name, and **Notification email** address. Read the organization's current privacy policy and accept it before clicking **Join organization**. Evorto stores both the exact accepted policy version and the notification email as your editable communication address for event and finance messages.

If the organization asks onboarding questions, every current question must be answered. If your login already belongs to another organization, this step adds the same account here. If setup fails or the policy changes while the form is open, Evorto explains what needs attention and lets you review the current requirements before retrying.`,
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
You should now be on your profile page for the current organization. Your membership, standard access, policy acceptance, and first home organization are saved together. From here you can review your profile, manage discount cards when the organization supports them, and register for events.`,
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
