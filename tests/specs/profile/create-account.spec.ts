import { and, eq } from 'drizzle-orm';
import { ConfigProvider, Effect } from 'effect';
import { expect } from '@playwright/test';

import * as schema from '../../../src/db/schema';
import { hasAuth0ManagementEnvironment } from '../../support/config/environment';
import { test } from '../../support/fixtures/base-test';
import { fillProtectedValue } from '../../support/utils/fill-protected-value';

const hasManagementEnvironment = Effect.runSync(
  hasAuth0ManagementEnvironment.pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnv(),
    ),
  ),
);

test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test('creates tenant account for a new Auth0 user @needs-auth0-management', async ({
  registerDatabaseCleanup,
  database,
  newUser,
  page,
  tenantDomain,
}) => {
  expect(
    hasManagementEnvironment,
    'AUTH0_MANAGEMENT_CLIENT_ID and AUTH0_MANAGEMENT_CLIENT_SECRET are required for create-account integration coverage',
  ).toBe(true);

  let createdUserId: string | undefined;
  let createdTenantUserId: string | undefined;

  const existingAccounts = await database.query.users.findMany({
    columns: { id: true },
    where: { email: newUser.email },
  });
  if (existingAccounts.length > 0) {
    throw new Error(
      'Transient account email already exists in the application',
    );
  }
  registerDatabaseCleanup(async (cleanupDatabase) => {
    if (createdUserId) {
      await cleanupDatabase
        .delete(schema.users)
        .where(
          and(
            eq(schema.users.id, createdUserId),
            eq(schema.users.email, newUser.email),
          ),
        );
    }
  });
  registerDatabaseCleanup(async (cleanupDatabase) => {
    const tenantUsers = createdUserId
      ? await cleanupDatabase.query.usersToTenants.findMany({
          columns: { id: true },
          where: { userId: createdUserId },
        })
      : createdTenantUserId
        ? [{ id: createdTenantUserId }]
        : [];
    const cleanupErrors: unknown[] = [];
    for (const tenantUser of tenantUsers) {
      try {
        await cleanupDatabase
          .delete(schema.usersToTenants)
          .where(eq(schema.usersToTenants.id, tenantUser.id));
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        'Transient account membership cleanup failed',
      );
    }
  });
  registerDatabaseCleanup(async (cleanupDatabase) => {
    const tenantUsers = createdUserId
      ? await cleanupDatabase.query.usersToTenants.findMany({
          columns: { id: true },
          where: { userId: createdUserId },
        })
      : createdTenantUserId
        ? [{ id: createdTenantUserId }]
        : [];
    const cleanupErrors: unknown[] = [];
    for (const tenantUser of tenantUsers) {
      try {
        await cleanupDatabase
          .delete(schema.rolesToTenantUsers)
          .where(eq(schema.rolesToTenantUsers.userTenantId, tenantUser.id));
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        'Transient account role cleanup failed',
      );
    }
  });
  registerDatabaseCleanup(async (cleanupDatabase) => {
    if (createdUserId) {
      await cleanupDatabase
        .delete(schema.tenantPrivacyPolicyAcceptances)
        .where(eq(schema.tenantPrivacyPolicyAcceptances.userId, createdUserId));
    }
  });
  registerDatabaseCleanup(async (cleanupDatabase) => {
    if (createdUserId) {
      await cleanupDatabase
        .delete(schema.tenantOnboardingQuestionAnswers)
        .where(
          eq(schema.tenantOnboardingQuestionAnswers.userId, createdUserId),
        );
    }
  });
  registerDatabaseCleanup(async (cleanupDatabase) => {
    if (createdUserId) return;
    const accounts = await cleanupDatabase.query.users.findMany({
      columns: { id: true },
      where: { email: newUser.email },
    });
    if (accounts.length > 1) {
      throw new Error(
        'Transient account cleanup found multiple application users',
      );
    }
    createdUserId = accounts[0]?.id;
  });
  {
    await page.context().clearCookies();
    await page.goto('/logout');
    await page.goto('.');

    const loginLink = page.getByRole('link', { name: 'Sign in' }).first();
    if (!(await loginLink.isVisible())) {
      const logoutLink = page.getByRole('link', { name: 'Sign out' }).first();
      if (await logoutLink.isVisible()) {
        await logoutLink.click();
        await page.waitForURL(/\/(login|$)/);
      }
    }

    await page.getByRole('link', { name: 'Sign in' }).first().waitFor({
      state: 'visible',
    });
    await page.getByRole('link', { name: 'Sign in' }).click();
    await page.getByLabel('Email address').waitFor({ state: 'visible' });
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
      timeout: 15_000,
    });
    if (await acceptButton.isVisible()) {
      await acceptButton.click();
    }
    await expect(joinTenantButton).toBeVisible({ timeout: 15_000 });

    const createAccountForm = page
      .locator('form')
      .filter({ has: joinTenantButton })
      .first();
    await expect(
      createAccountForm.getByRole('textbox', { name: 'First name' }),
    ).toHaveValue(newUser.firstName);
    await expect(
      createAccountForm.getByRole('textbox', { name: 'Last name' }),
    ).toHaveValue(newUser.lastName);
    await expect(
      createAccountForm.getByRole('textbox', { name: 'Email for updates' }),
    ).toHaveValue(newUser.email);

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
      throw new Error('Expected account creation to persist a global user');
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
      throw new Error('Expected account creation to join the current tenant');
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
  }
});
