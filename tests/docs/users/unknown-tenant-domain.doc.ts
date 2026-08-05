import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: { cookies: [], origins: [] } });

test('Recover from an unknown organization link', async ({
  baseURL,
  page,
}, testInfo) => {
  if (!baseURL) {
    throw new Error('Expected the configured Evorto base URL');
  }
  const unknownTenantUrl = new URL(baseURL);
  unknownTenantUrl.hostname = 'unknown.localhost';
  unknownTenantUrl.pathname = '/scan/registration/example-registration-from-qr';

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="No account is required" %}
This page is public. Signing in, changing accounts, or starting another sign-up will not fix an incorrect organization address.
{% /callout %}


You may reach this page after typing an organization address, opening an old bookmark, following an outdated event link, or scanning a QR code whose organization address has changed. Evorto shows **This link does not match an Evorto organization** when it cannot find an organization for the address.
`,
  });

  const response = await page.goto(unknownTenantUrl.toString(), {
    waitUntil: 'domcontentloaded',
  });
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle('Organization link not found | Evorto');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'This link does not match an Evorto organization',
    }),
  ).toBeVisible();
  await expect(
    page.getByText('Your account and tickets have not changed.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What to do' })).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('main'),
    page,
    'Help for an unknown organization link',
  );

  await testInfo.attach('markdown', {
    body: `
## What to do

1. Open the complete link from the latest email, invitation, or message that contained it without editing the organization part of the address.
2. If you typed the address, check it for a missing or misspelled organization name.
3. Ask the person or organization that shared the link for the current Evorto address.

If a QR code led here, ask the person running the activity for the current Evorto link for this event. **Your account and tickets have not changed** confirms that nothing was altered.
`,
  });
});
