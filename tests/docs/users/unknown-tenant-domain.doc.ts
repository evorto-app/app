import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: { cookies: [], origins: [] } });

test('Recover from an unknown tenant link', async ({
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
This recovery page is public. It appears before Evorto can select a tenant, so signing in, changing accounts, or creating another registration cannot repair the address.
{% /callout %}

# Recover from an unknown Evorto tenant link

You may reach this page after typing a tenant address, opening an old bookmark, following an outdated event link, or scanning a QR code whose tenant domain has changed. Evorto returns a real **404 Not Found** page and does not reveal whether another tenant or account exists.
`,
  });

  const response = await page.goto(unknownTenantUrl.toString(), {
    waitUntil: 'domcontentloaded',
  });
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle('Tenant link not found | Evorto');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'This link does not match an Evorto tenant',
    }),
  ).toBeVisible();
  await expect(
    page.getByText('Your account and registrations have not been changed.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What to do' })).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('main'),
    page,
    'Unknown tenant link recovery',
  );

  await testInfo.attach('markdown', {
    body: `
## What to do

1. Return to the latest event email or invitation and open its complete link without editing the tenant part of the address.
2. If you typed the address, check it for a missing or misspelled tenant name.
3. Ask the event organizer for the tenant's current Evorto link.

If a QR code led here, do not change the encoded URL and do not create a replacement registration. Show the error to an organizer so they can confirm whether the tenant domain changed and provide a current ticket link. The message **Your account and registrations have not been changed** is the completion state for this recovery check: the failed lookup is read-only.
`,
  });
});
