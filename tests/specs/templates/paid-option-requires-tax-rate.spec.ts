import { and, eq } from 'drizzle-orm';
import { tenantStripeTaxRates } from '../../../src/db/schema';
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
  await expect(paymentCheckbox).toBeEnabled({ timeout: 20_000 });
  await paymentCheckbox.check();
  await expect(
    priceInputForRegistrationOption(participantOptionForm),
  ).toBeVisible({ timeout: 20_000 });
};

const priceInputForRegistrationOption = (
  participantOptionForm: ReturnType<Page['locator']>,
) => participantOptionForm.getByLabel(/^Price \([A-Z]{3}\)$/);

const taxRateSelectForRegistrationOption = (
  participantOptionForm: ReturnType<Page['locator']>,
) =>
  participantOptionForm.getByRole('combobox', {
    name: 'Tax included in the shown price',
  });

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

    const saveButton = page.getByTestId('save-template-graph');
    await expect(
      page.getByLabel('Tax included in the shown price'),
    ).toHaveCount(0);

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

  for (const unusableRate of [
    { label: 'inactive', change: { active: false } },
    { label: 'empty percentage', change: { percentage: '' } },
    { label: 'whitespace percentage', change: { percentage: ' \t\n' } },
  ]) {
    test(`creator saves a paid choice and replaces its ${unusableRate.label} tax rate`, async ({
      database,
      page,
      permissionOverride,
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
      await priceInputForRegistrationOption(participantOptionForm).fill(
        '10.00',
      );
      const taxRateSelect = taxRateSelectForRegistrationOption(
        participantOptionForm,
      );
      await taxRateSelect.press('Enter');
      await expect(taxRateSelect).toHaveAttribute('aria-expanded', 'true');
      await expect(
        page.getByRole('option', { exact: true, name: taxRateLabel }),
      ).toBeVisible();
      await page
        .getByRole('option', { exact: true, name: taxRateLabel })
        .click();

      const saveButton = page.getByTestId('save-template-graph');
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      await expect(page).toHaveURL(/\/templates\/(?!create(?:\/|$))[^/]+$/, {
        timeout: 15_000,
      });
      await expect(
        page.getByRole('link', { name: templateTitle }),
      ).toBeVisible();

      // The fixture grants editing only after proving an ordinary organizer can create it.
      await permissionOverride({
        add: ['templates:editAll'],
        roleName: 'Section member',
      });
      await database
        .update(tenantStripeTaxRates)
        .set(unusableRate.change)
        .where(
          and(
            eq(tenantStripeTaxRates.id, taxRate.id),
            eq(tenantStripeTaxRates.tenantId, tenant.id),
          ),
        );
      const templateUrl = page.url();
      await page.goto(`${templateUrl}/edit`);
      await expect(taxRateSelect).toHaveText(
        'Previously selected tax rate (no longer available)',
      );
      await expect(saveButton).toBeDisabled();
      const replacement = (
        await database.query.tenantStripeTaxRates.findMany({
          where: { active: true, inclusive: true, tenantId: tenant.id },
        })
      ).find((rate) => Boolean(rate.percentage?.trim()));
      if (!replacement)
        throw new Error('Expected another usable seeded tax rate');
      const replacementLabel = `${replacement.displayName || 'Tax rate name unavailable'} — ${replacement.percentage}%`;
      // The saved selection is visible in SSR before its keyboard listener is
      // hydrated. Pressing Enter then can target a control hydration replaces.
      await expect(taxRateSelect).not.toHaveAttribute('jsaction', /keydown/);
      await taxRateSelect.press('Enter');
      await expect(taxRateSelect).toHaveAttribute('aria-expanded', 'true');
      await page
        .getByRole('option', { exact: true, name: replacementLabel })
        .click();
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      await expect(page).toHaveURL(templateUrl);
      await page.goto(`${templateUrl}/edit`);
      await expect(taxRateSelect).toHaveText(replacementLabel);
      await expect(saveButton).toBeEnabled();
    });
  }
});
