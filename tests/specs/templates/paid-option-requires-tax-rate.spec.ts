import { organizerStateFile } from '../../../helpers/user-data';
import { getId } from '../../../helpers/get-id';
import { expect, test } from '../../support/fixtures/parallel-test';
import { fillTemplateBasics } from '../../support/utils/template-form';
import type { Page } from '@playwright/test';

test.use({ storageState: organizerStateFile });

const enablePaymentForLastRegistrationOption = async (page: Page) => {
  const participantOptionForm = page
    .locator('app-template-registration-option-form')
    .last();
  await participantOptionForm
    .getByRole('checkbox', { name: 'Enable payment' })
    .check();
  await expect(
    participantOptionForm.getByRole('spinbutton', {
      exact: true,
      name: 'Price (in cents)',
    }),
  ).toBeVisible();
};

const ensureLastRegistrationOptionHasRole = async (
  page: Page,
  roleName: string,
) => {
  const participantOptionForm = page
    .locator('app-template-registration-option-form')
    .last();
  if (
    (await participantOptionForm.getByText(roleName, { exact: true }).count()) >
    0
  ) {
    return;
  }

  await participantOptionForm.getByPlaceholder('Add Role...').fill(roleName);
  await page.getByRole('option', { exact: true, name: roleName }).click();
  await expect(
    participantOptionForm.getByText(roleName, { exact: true }),
  ).toBeVisible();
};

test.describe('Template Tax Rate Validation', () => {
  test('creator must select tax rate for paid registration option', async ({
    page,
    templateCategories,
  }) => {
    const category = templateCategories[0];
    await page.goto(`/templates/create/${category.id}`);
    await fillTemplateBasics(page, {
      description: null,
      title: `Paid tax required ${getId().slice(0, 6)}`,
    });

    const saveButton = page.getByRole('button', { name: 'Save template' });
    await expect(page.getByLabel('Tax rate')).toHaveCount(0);

    await enablePaymentForLastRegistrationOption(page);

    await expect(page.getByLabel('Price (in cents)').first()).toBeVisible();
    await expect(page.getByLabel('Tax rate').first()).toBeVisible();
    await expect(saveButton).toBeDisabled();
  });

  test('creator can save paid registration option with a seeded inclusive tax rate', async ({
    database,
    page,
    roles,
    templateCategories,
    tenant,
  }) => {
    const category = templateCategories[0];
    const taxRate = await database.query.tenantStripeTaxRates.findFirst({
      where: {
        active: true,
        inclusive: true,
        tenantId: tenant.id,
      },
    });
    if (!taxRate) {
      throw new Error('Expected seeded active inclusive tax rate');
    }
    const defaultUserRole = roles.find((role) => role.defaultUserRole);
    if (!defaultUserRole) {
      throw new Error('Expected seeded default user role');
    }
    const taxRateLabel = `${taxRate.displayName || taxRate.stripeTaxRateId} — ${
      taxRate.percentage ?? '?'
    }%`;
    const templateTitle = `Paid template ${getId().slice(0, 6)}`;

    await page.goto(`/templates/create/${category.id}`);
    await fillTemplateBasics(page, {
      title: templateTitle,
    });
    await enablePaymentForLastRegistrationOption(page);
    await ensureLastRegistrationOptionHasRole(page, defaultUserRole.name);
    await page.getByLabel('Price (in cents)').first().fill('1000');
    await page.getByLabel('Tax rate').first().click();
    await expect(
      page.getByRole('option', { exact: true, name: taxRateLabel }),
    ).toBeVisible();
    await page.getByRole('option', { exact: true, name: taxRateLabel }).click();

    const saveButton = page.getByRole('button', { name: 'Save template' });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page).toHaveURL(/\/templates/);
    await expect(page.getByRole('link', { name: templateTitle })).toBeVisible();
  });
});
