import { organizerStateFile } from '../../../helpers/user-data';
import { getId } from '../../../helpers/get-id';
import { expect, test } from '../../support/fixtures/parallel-test';
import { fillTemplateBasics } from '../../support/utils/template-form';
import { withNoCompatibleTaxRates } from '../../support/utils/tax-rates';
import type { Page } from '@playwright/test';

test.use({ storageState: organizerStateFile });

const enablePaymentForLastRegistrationOption = async (page: Page) => {
  const participantOptionForm = page
    .locator('app-template-registration-option-form')
    .last();
  await participantOptionForm
    .getByRole('switch', { name: 'Enable payment' })
    .click();
  await expect(
    priceInputForRegistrationOption(participantOptionForm),
  ).toBeVisible();
};

const priceInputForRegistrationOption = (
  participantOptionForm: ReturnType<Page['locator']>,
) =>
  participantOptionForm.getByRole('spinbutton', {
    exact: true,
    name: 'Price (in cents)',
  });

const taxRateSelectForRegistrationOption = (
  participantOptionForm: ReturnType<Page['locator']>,
) =>
  participantOptionForm
    .locator('mat-form-field')
    .filter({ hasText: 'Tax rate' })
    .locator('mat-select')
    .first();

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
    if (!category) {
      throw new Error(
        'Expected seeded template category before paid template validation',
      );
    }
    await page.goto(`/templates/create/${category.id}`);
    await fillTemplateBasics(page, {
      description: null,
      title: `Paid tax required ${getId().slice(0, 6)}`,
    });

    const saveButton = page.getByRole('button', { name: 'Save template' });
    await expect(page.getByLabel('Tax rate')).toHaveCount(0);

    await enablePaymentForLastRegistrationOption(page);

    const participantOptionForm = page
      .locator('app-template-registration-option-form')
      .last();
    await expect(
      priceInputForRegistrationOption(participantOptionForm),
    ).toBeVisible();
    await expect(
      taxRateSelectForRegistrationOption(participantOptionForm),
    ).toBeVisible();
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
    if (!category) {
      throw new Error(
        'Expected seeded template category before paid template save',
      );
    }
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
      description: null,
      title: templateTitle,
    });
    await enablePaymentForLastRegistrationOption(page);
    await ensureLastRegistrationOptionHasRole(page, defaultUserRole.name);
    const participantOptionForm = page
      .locator('app-template-registration-option-form')
      .last();
    await priceInputForRegistrationOption(participantOptionForm).fill('1000');
    await taxRateSelectForRegistrationOption(participantOptionForm).click();
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

  test('creator sees empty tax-rate feedback when no compatible inclusive rates exist', async ({
    database,
    page,
    templateCategories,
    tenant,
  }) => {
    const category = templateCategories[0];
    if (!category) {
      throw new Error(
        'Expected seeded template category before paid template empty tax-rate validation',
      );
    }

    await withNoCompatibleTaxRates(database, tenant.id, async () => {
      await page.goto('/templates/create');
      await fillTemplateBasics(page, {
        categoryTitle: category.title,
        title: `No tax rates ${getId().slice(0, 6)}`,
      });

      await enablePaymentForFirstParticipantRegistrationOption(page);
      const taxRateSelect = page.getByLabel('Tax rate').first();
      await expect(taxRateSelect).toBeVisible();
      await taxRateSelect.click();

      await expect(
        page.getByRole('option', {
          name: 'No active inclusive tax rates available',
        }),
      ).toBeVisible();
    });
  });
});
