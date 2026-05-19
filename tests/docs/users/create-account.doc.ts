import { ConfigProvider, Effect } from 'effect';

import { expect, test } from '../../support/fixtures/parallel-test';
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

if (!hasManagementEnvironment) {
  test.skip(
    true,
    'AUTH0_MANAGEMENT_CLIENT_ID and AUTH0_MANAGEMENT_CLIENT_SECRET are required for this integration doc',
  );
}

test('Create your account @needs-auth0-management', async ({
  newUser,
  page,
  roles,
}, testInfo) => {
  void roles; // Ensure roles are created for this tenant
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
  await page.getByRole('textbox', { name: 'Password' }).fill(newUser.password);
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
Review the prefilled first name, last name, and notification email address, then click **Create Account**. Evorto stores the notification email as your editable communication address for event and finance messages.

If the same global login already exists for another tenant, this step joins the current tenant instead of creating a duplicate global user. If account creation fails, the form shows the server error and lets you retry after resolving the issue.`,
  });
  const createAccountForm = page
    .locator('form')
    .filter({ has: createAccountButton })
    .first();
  await createAccountForm.waitFor({ state: 'visible' });
  await takeScreenshot(testInfo, createAccountForm, page);
  await createAccountButton.click();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: `${newUser.firstName} ${newUser.lastName}`,
    }),
  ).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
You should now be on your profile page for the current tenant. From here you can review your profile, manage discount cards when the tenant supports them, and register for events.`,
  });
});
