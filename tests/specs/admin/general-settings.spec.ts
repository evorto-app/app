import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: adminStateFile });

test('tenant admin updates relaunch general settings @admin', async ({
  database,
  page,
  seedDate,
  tenant,
}) => {
  const suffix = seedDate.getTime();
  const logoUrl = `https://assets.example.org/${tenant.id}/logo-${suffix}.png`;
  const faviconUrl = `https://assets.example.org/${tenant.id}/favicon-${suffix}.ico`;
  const seoTitle = `Tenant settings spec ${suffix}`;
  const seoDescription = `Search preview copy for tenant settings spec ${suffix}`;
  const legalNoticeText = `Hosted imprint text ${suffix}`;
  const privacyPolicyUrl = `https://legal.example.org/${tenant.id}/privacy`;
  const termsText = `Hosted terms text ${suffix}`;
  const buyEsnCardUrl = `https://esncard.example.org/${tenant.id}`;
  const receiptCountries = ['ES', 'FR'];

  await page.goto('/admin/settings');
  const generalSettings = page.locator('app-general-settings');

  await expect(
    generalSettings.getByRole('heading', { name: 'General settings' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Deferred settings' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Tenant identity' }),
  ).toBeVisible();
  await expect(page.getByText(tenant.domain)).toBeVisible();

  await page.getByLabel('Logo URL').fill(` ${logoUrl} `);
  await page.getByLabel('Favicon URL').fill(` ${faviconUrl} `);
  await page.getByLabel('SEO title').fill(` ${seoTitle} `);
  await page.getByLabel('SEO description').fill(` ${seoDescription} `);
  await page
    .getByLabel('Hosted imprint / legal notice text')
    .fill(` ${legalNoticeText} `);
  await page.getByLabel('Privacy policy URL').fill(` ${privacyPolicyUrl} `);
  await page.getByLabel('Hosted terms text').fill(` ${termsText} `);
  await page.getByLabel('Allowed receipt countries').click();
  await page.getByRole('option', { name: 'Spain (ES)' }).click();
  await page.getByRole('option', { name: 'France (FR)' }).click();
  await page.keyboard.press('Escape');
  const allowOtherCheckbox = page.getByRole('checkbox', {
    name: 'Allow other',
  });
  if (!(await allowOtherCheckbox.isChecked())) {
    await allowOtherCheckbox.click();
  }

  const esnCardToggle = page.getByRole('switch', {
    name: 'ESN Card discounts',
  });
  if (!(await esnCardToggle.isChecked())) {
    await esnCardToggle.click();
  }
  await page.getByLabel('Buy ESNcard URL').fill(` ${buyEsnCardUrl} `);

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Tenant settings updated')).toBeVisible();

  const updatedTenant = await database.query.tenants.findFirst({
    where: { id: tenant.id },
  });
  if (!updatedTenant) {
    throw new Error('Expected tenant row after general-settings update');
  }
  expect(updatedTenant.logoUrl).toBe(logoUrl);
  expect(updatedTenant.faviconUrl).toBe(faviconUrl);
  expect(updatedTenant.seoTitle).toBe(seoTitle);
  expect(updatedTenant.seoDescription).toBe(seoDescription);
  expect(updatedTenant.legalNoticeText).toBe(legalNoticeText);
  expect(updatedTenant.privacyPolicyUrl).toBe(privacyPolicyUrl);
  expect(updatedTenant.termsText).toBe(termsText);
  expect(updatedTenant.receiptSettings.allowOther).toBe(true);
  expect(updatedTenant.receiptSettings.receiptCountries).toEqual(
    expect.arrayContaining(receiptCountries),
  );
  expect(updatedTenant.discountProviders.esnCard).toEqual({
    config: { buyEsnCardUrl },
    status: 'enabled',
  });
});
