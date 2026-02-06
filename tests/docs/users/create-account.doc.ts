import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

// test.use({ storageState: defaultStateFile });

// Skip this journey if Auth0 Management credentials are not configured
if (
  !process.env['AUTH0_MANAGEMENT_CLIENT_ID'] ||
  !process.env['AUTH0_MANAGEMENT_CLIENT_SECRET']
) {
  test.skip(true, 'Auth0 creds missing');
}

test('Create your account @needs-auth0 @track(playwright-specs-track-linking_20260126) @doc(CREATE-ACCOUNT-DOC-01)', async ({
  newUser,
  page,
  roles,
}, testInfo) => {
  void roles; // Ensure roles are created for this tenant
  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="For first time visits" %}
This guide assumes that you do not have an account already.
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
After starting the login flow, you can sign in. In general there are two options available to you:
- **Sign in with a social account**: This is the most common way to sign in. You can reuse your existing social account to sign in.
  _Note that your selection could be different from the image below._
- **Sign in with an email address**: You can also create a new account using your email address. You then sign in with your email address and password.
  _Email verification_ If you are using an email address to sign in, you will be asked to verify your email address. You will receive an email with a link to verify your email address. To continue, click the link from the email.

For this example we will sign in with a demo user.`,
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
  await expect(
    acceptButton.or(createAccountButton).first(),
  ).toBeVisible({
    timeout: 15000,
  });
  if (await acceptButton.isVisible()) {
    await acceptButton.click();
  }
  await expect(createAccountButton).toBeVisible({ timeout: 15000 });

  await testInfo.attach('markdown', {
    body: `
The next step is simple. Just fill in the data requested and click on **Create account**. _Note_ the data requested can change based on the application settings.`,
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
You should now be on your profile page and are ready to start using the app.
Why not Register for an event next?`,
  });
});
