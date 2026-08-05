import { and, eq } from 'drizzle-orm';
import { ConfigProvider, Effect } from 'effect';
import { expect } from '@playwright/test';

import * as schema from '../../../src/db/schema';
import { TenantOnboardingRequirementsChangedError } from '../../../src/shared/rpc-contracts/app-rpcs/onboarding.errors';
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
    createAccountErrorMessage(
      new TenantOnboardingRequirementsChangedError({
        message: 'Requirements changed; review and submit again',
      }),
    ),
  ).toBe(
    'This organization changed its questions or privacy policy. Review the latest details and try again.',
  );

  await testInfo.attach('markdown', {
    body: `

After signing in, Evorto shows **Finish setting up your account** when you first join an organization, need to accept a changed privacy policy, or have a new required question. If **Verify your email** appears, verify the sign-in address and select **Check again**.

The form already fills in the first name, last name, and **Email for updates** from the sign-in account when available. Evorto tries to send event and reimbursement updates to that address. If an email does not arrive, check Evorto for the current information. The address may differ from the sign-in email shown later on the profile page.

**Join organization** for a new membership, or **Finish setup** for an existing member, stays unavailable until every required field is valid and the current policy is accepted. If the policy or questions change while the page is open, Evorto keeps answers that still apply and asks you to review the changes.

On first setup, you join as a member. If you already belong, setup updates your privacy acceptance and required answers. The same account can belong to several organizations. Your home organization changes only when you choose a different one from your profile.
`,
  });
});

test.describe('Create your account', () => {
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
This guide assumes that you are signed in but have not completed setup for the current organization. Completing setup saves your acceptance of the current privacy policy, and you join as a member.
{% /callout %}
## Sign in
Open the app page and select **Sign in**.`,
      });
      await page.context().clearCookies();
      await page.goto('/logout');
      await page.goto('.');
      const signInLink = page.getByRole('link', { name: 'Sign in' }).first();
      if (!(await signInLink.isVisible())) {
        const signOutLink = page
          .getByRole('link', { name: 'Sign out' })
          .first();
        if (await signOutLink.isVisible()) {
          await signOutLink.click();
          await page.waitForURL(/\/(login|$)/);
        }
      }
      await page.getByRole('link', { name: 'Sign in' }).first().waitFor({
        state: 'visible',
      });
      await takeScreenshot(
        testInfo,
        page.getByRole('link', { name: 'Sign in' }),
        page,
        'Select Sign in to begin account setup',
      );
      await page.getByRole('link', { name: 'Sign in' }).click();
      await testInfo.attach('markdown', {
        body: `
After selecting **Sign in**, use the account you want to join to this organization.

If that account's email address is not verified yet, Evorto asks you to verify it before showing the organization setup form.`,
      });
      await page.getByLabel('Email address').waitFor({ state: 'visible' });
      await takeScreenshot(
        testInfo,
        page.getByLabel('Email address'),
        page,
        'Enter the email address for the account',
      );
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
Review the first name, last name, and **Email for updates** already shown. Read the organization's current privacy policy and accept it before selecting **Join organization**. Evorto tries to send event and reimbursement updates to this address. If an email does not arrive, check Evorto for the current information. You can change the address later from your profile.

If the organization asks new members questions, every current question must be answered. If your account already belongs to another organization, this step adds the same account here. If setup fails or the policy changes while the form is open, Evorto explains what needs attention and shows the latest policy and questions before you try again.`,
      });
      const createAccountForm = page
        .locator('form')
        .filter({ has: joinTenantButton })
        .first();
      await createAccountForm.waitFor({ state: 'visible' });
      await expect(
        createAccountForm.getByRole('textbox', { name: 'Email for updates' }),
      ).toBeVisible();
      await takeScreenshot(
        testInfo,
        createAccountForm,
        page,
        'Review account details and accept the privacy policy',
      );
      await createAccountForm
        .getByRole('checkbox', { name: /I accept .* current privacy policy/ })
        .check();
      await joinTenantButton.click();
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: 'Profile',
        }),
      ).toBeVisible();
      await expect(
        page
          .locator('app-user-profile')
          .getByText(`${newUser.firstName} ${newUser.lastName}`, {
            exact: true,
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
You should now be on your profile page for the current organization. From here you can review your profile, manage discount cards when the organization supports them, and sign up for events.`,
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
