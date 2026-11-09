import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { routeLocalTenantRequests } from '../../support/utils/tenant-request-routing';

test.use({ storageState: adminStateFile });

test('publishes and removes an external Home link for members and server-rendered visitors', async ({
  browser,
  database,
  page,
  tenant,
}) => {
  await page.goto('/admin/settings/appearance');
  const settings = page.locator('app-appearance-settings');
  const mode = settings.getByRole('combobox', {
    name: 'Home page',
    exact: true,
  });
  const home = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Home', exact: true });
  const save = settings.getByRole('button', {
    name: 'Save appearance settings',
  });
  await expect(mode).toContainText('No home page');
  await expect(home).toHaveCount(0);
  await mode.click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await page
    .getByRole('option', { name: 'External link', exact: true })
    .click();
  const address = settings.getByRole('textbox', {
    name: 'Home page web address',
  });
  await address.fill('javascript:alert(1)');
  await expect(save).toBeDisabled();
  const homeUrl = 'https://section.example.org/about';
  await address.fill(homeUrl);
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText('Appearance settings updated')).toBeVisible({
    timeout: 20_000,
  });
  await expect(home).toHaveAttribute('href', homeUrl);
  await expect(home).toHaveAttribute('target', '_blank');
  await expect(home).toHaveAttribute('rel', 'noopener noreferrer');
  await page.reload();
  await expect(mode).toContainText('External link');
  await expect(address).toHaveValue(homeUrl);

  const baseUrl = new URL(page.url()).origin;
  const visitor = await browser.newContext({
    baseURL: baseUrl,
    javaScriptEnabled: false,
    storageState: { cookies: [], origins: [] },
    viewport: { width: 390, height: 844 },
  });
  try {
    await routeLocalTenantRequests({
      baseUrl,
      context: visitor,
      tenantDomain: tenant.domain,
    });
    const visitorPage = await visitor.newPage();
    await visitorPage.goto('/events');
    const visitorHome = visitorPage
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Home', exact: true });
    await expect(visitorHome).toBeVisible();
    await expect(visitorHome).toHaveAttribute('href', homeUrl);
    await mode.click();
    await page
      .getByRole('option', { name: 'No home page', exact: true })
      .click();
    await expect(address).toHaveCount(0);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(home).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await database.query.tenants.findFirst({
              columns: { homePageUrl: true },
              where: { id: tenant.id },
            })
          )?.homePageUrl,
      )
      .toBeNull();
    await visitorPage.reload();
    await expect(visitorHome).toHaveCount(0);
  } finally {
    await visitor.close();
  }
});
