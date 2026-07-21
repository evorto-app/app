import { expect, test } from '../../support/fixtures/parallel-test';

test('load application', async ({ page }) => {
  await page.goto('.');
});

test('navigate to events list', async ({ page }) => {
  await page.goto('.');
  await page.getByRole('link', { name: 'Events' }).click();
  await expect(page).toHaveURL(/\/events/);
});

test('redirect anonymous protected deep links to login during SSR', async ({
  page,
}) => {
  const response = await page.request.get(
    '/registration-transfers/example-token?from=email',
    { maxRedirects: 0 },
  );

  expect(response.status()).toBe(303);
  expect(response.headers()['location']).toBe(
    '/forward-login?redirectUrl=%2Fregistration-transfers%2Fexample-token%3Ffrom%3Demail',
  );
  expect(await response.text()).not.toContain('Unknown tenant');
});
