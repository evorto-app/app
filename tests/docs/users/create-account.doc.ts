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

// Skip this journey if Auth0 Management credentials are not configured
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
      { communicationEmail: '', firstName: '', lastName: '' },
      {
        email: ' new-user@example.org ',
        email_verified: true,
        family_name: ' User ',
        given_name: ' New ',
      },
    ),
  ).toEqual({
    communicationEmail: 'new-user@example.org',
    firstName: 'New',
    lastName: 'User',
  });
  expect(
    createAccountPayloadFromModel({
      communicationEmail: ' notify@example.org ',
      firstName: ' New ',
      lastName: ' User ',
    }),
  ).toEqual({
    communicationEmail: 'notify@example.org',
    firstName: 'New',
    lastName: 'User',
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
      _tag: 'UserConflictError',
      message: 'User account already exists',
    }),
  ).toBe('User account already exists');

  await testInfo.attach('markdown', {
    body: `
# Tenant Account Creation

Authenticated users who do not yet have an Evorto account for the current tenant are sent to **Create Account** before protected tenant pages. The form is shown only after the Auth0 email address is explicitly verified.

The account form pre-fills first name, last name, and **Notification email** from Auth0 data when available. Evorto stores the notification email as the user-managed communication address for event and finance messages; it may differ from the Auth0 login email shown later on the profile page.

Before submitting, the form trims first name, last name, and notification email. It stays disabled while invalid, already submitting, or waiting for the account-creation mutation, so slow tenant-join writes cannot be double-submitted. If account creation fails, the page shows a retryable server error instead of silently losing the submit attempt.

Creating the account joins the current tenant and grants the tenant's default user roles. Existing global users with the same Auth0 id join the current tenant instead of creating a duplicate global user.
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
This guide assumes that you are authenticated by Auth0 but do not yet have an Evorto account for the current tenant. Creating the account connects your global login to this tenant and grants the tenant's default user roles.
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
      const createAccountButton = page.getByRole('button', {
        exact: true,
        name: 'Create Account',
      });
      await expect(acceptButton.or(createAccountButton).first()).toBeVisible({
        timeout: 15000,
      });
      if (await acceptButton.isVisible()) {
        await acceptButton.click();
      }
      await expect(createAccountButton).toBeVisible({ timeout: 15000 });

      await testInfo.attach('markdown', {
        body: `
Review the prefilled first name, last name, and **Notification email** address, then click **Create Account**. Evorto stores the notification email as your editable communication address for event and finance messages, and the form only submits when that address has an email shape.

If the same global login already exists for another tenant, this step joins the current tenant instead of creating a duplicate global user. If account creation fails, the form shows the server error and lets you retry after resolving the issue.`,
      });
      const createAccountForm = page
        .locator('form')
        .filter({ has: createAccountButton })
        .first();
      await createAccountForm.waitFor({ state: 'visible' });
      await expect(
        createAccountForm.getByRole('textbox', { name: 'Notification email' }),
      ).toBeVisible();
      await takeScreenshot(testInfo, createAccountForm, page);
      await createAccountButton.click();
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

      const roleAssignments = await database.query.rolesToTenantUsers.findMany({
        where: { userTenantId: tenantUser.id },
      });
      expect(roleAssignments.length).toBeGreaterThan(0);

      await testInfo.attach('markdown', {
        body: `
You should now be on your profile page for the current tenant. From here you can review your profile, manage discount cards when the tenant supports them, and register for events.`,
      });
    } finally {
      if (createdUserId) {
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
