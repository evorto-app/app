import { and, eq } from 'drizzle-orm';
import { ConfigProvider, Effect } from 'effect';
import { expect } from '@playwright/test';

import * as schema from '../../../src/db/schema';
import { hasAuth0ManagementEnvironment } from '../../support/config/environment';
import { test } from '../../support/fixtures/base-test';

const hasManagementEnvironment = Effect.runSync(
  hasAuth0ManagementEnvironment.pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnv(),
    ),
  ),
);

test('creates tenant account for a new Auth0 user @needs-auth0-management', async ({
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

  try {
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
    await page.getByRole('link', { name: 'Login' }).click();
    await page.getByLabel('Email address').waitFor({ state: 'visible' });
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
      timeout: 15_000,
    });
    if (await acceptButton.isVisible()) {
      await acceptButton.click();
    }
    await expect(createAccountButton).toBeVisible({ timeout: 15_000 });

    const createAccountForm = page
      .locator('form')
      .filter({ has: createAccountButton })
      .first();
    await expect(
      createAccountForm.getByRole('textbox', { name: 'First name' }),
    ).toHaveValue(newUser.firstName);
    await expect(
      createAccountForm.getByRole('textbox', { name: 'Last name' }),
    ).toHaveValue(newUser.lastName);
    await expect(
      createAccountForm.getByRole('textbox', { name: 'Notification email' }),
    ).toHaveValue(newUser.email);

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
      throw new Error('Expected account creation to persist a global user');
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
      throw new Error('Expected account creation to join the current tenant');
    }
    createdTenantUserId = tenantUser.id;

    const roleAssignments = await database.query.rolesToTenantUsers.findMany({
      where: { userTenantId: tenantUser.id },
    });
    expect(roleAssignments.length).toBeGreaterThan(0);
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
        .where(eq(schema.rolesToTenantUsers.userTenantId, createdTenantUserId));
      await database
        .delete(schema.usersToTenants)
        .where(eq(schema.usersToTenants.id, createdTenantUserId));
    }
  }
});
