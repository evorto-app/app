import { organizerStateFile } from '../../../helpers/user-data';
import { getId } from '../../../helpers/get-id';
import { expect, test } from '../../support/fixtures/parallel-test';
import { fillTemplateBasics } from '../../support/utils/template-form';
import type { Page } from '@playwright/test';

test.use({ storageState: organizerStateFile });

const enablePaymentForLastRegistrationOption = async (page: Page) => {
  const participantOptionForm = page
    .locator('app-template-registration-option-editor')
    .last();
  const paymentCheckbox = participantOptionForm.getByRole('checkbox', {
    name: 'Enable payment',
  });
  await paymentCheckbox.check();
  await expect(
    priceInputForRegistrationOption(participantOptionForm),
  ).toBeVisible();
};

const priceInputForRegistrationOption = (
  participantOptionForm: ReturnType<Page['locator']>,
) => participantOptionForm.getByLabel('Price (in cents)');

const taxRateSelectForRegistrationOption = (
  participantOptionForm: ReturnType<Page['locator']>,
) => participantOptionForm.getByLabel('Inclusive tax rate');

const waitForLastRegistrationOptionRole = async (
  page: Page,
  roleName: string,
) => {
  const participantOptionForm = page
    .locator('app-template-registration-option-editor')
    .last();
  await expect(
    participantOptionForm.getByRole('button', {
      exact: true,
      name: `Remove ${roleName}`,
    }),
  ).toBeVisible({ timeout: 20_000 });
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
      title: `Paid tax required ${getId().slice(0, 6)}`,
    });

    const saveButton = page.getByRole('button', { name: 'Save template' });
    await expect(page.getByLabel('Inclusive tax rate')).toHaveCount(0);

    await enablePaymentForLastRegistrationOption(page);

    const participantOptionForm = page
      .locator('app-template-registration-option-editor')
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
      title: templateTitle,
    });
    await enablePaymentForLastRegistrationOption(page);
    await waitForLastRegistrationOptionRole(page, defaultUserRole.name);
    const participantOptionForm = page
      .locator('app-template-registration-option-editor')
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
    await expect(page).toHaveURL(/\/templates\/(?!create(?:\/|$))[^/]+$/, {
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: templateTitle })).toBeVisible();
  });
});
