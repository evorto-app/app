import { DateTime } from 'luxon';

import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.describe('Inclusive tax rates documentation (admin)', () => {
  test.use({ storageState: adminStateFile });

  test('Import tenant tax rates', async ({ page }, testInfo) => {
    await page.goto('.');

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="User permissions" %}
To manage tax rates you need the **admin:tax** permission. The screenshots below assume you are signed in as a tenant administrator.
{% /callout %}

# Manage Inclusive Tax Rates

Inclusive (VAT-style) tax rates are configured under **Admin → Tax Rates**. Start from the dashboard and open the admin area.
`,
    });

    await page.getByRole('link', { name: 'Admin' }).click();
    await expect(
      page.getByRole('heading', { name: /Admin settings/i }),
    ).toBeVisible();

    await testInfo.attach('markdown', {
      body: `
The admin overview links to all configuration areas. Select **Tax Rates** to manage the rates imported from your payment provider.
`,
    });

    await page.getByRole('heading', { level: 2, name: 'Tax Rates' }).click();
    await expect(
      page.getByRole('heading', { name: 'Tax Rates' }),
    ).toBeVisible();

    await takeScreenshot(
      testInfo,
      page.locator('app-tax-rates-settings'),
      page,
      'Tax rates overview',
    );

    await testInfo.attach('markdown', {
      body: `
## Imported tax rates

- **Compatible Tax Rates** lists inclusive & active rates that event creators can select.
- **Incompatible Rates** (exclusive/archived) are shown for context and stay disabled.
- Use the floating **Import Tax Rates** button to sync additional rates from Stripe.
`,
    });

    const importButton = page
      .getByRole('button', { name: 'Import Tax Rates' })
      .first();
    await expect(importButton).toBeVisible();
    await importButton.click();

    await expect(
      page.getByRole('heading', { name: 'Import Stripe tax rates' }),
    ).toBeVisible();

    await takeScreenshot(
      testInfo,
      page.locator('mat-dialog-container'),
      page,
      'Import Stripe tax rates dialog',
    );

    await testInfo.attach('markdown', {
      body: `
The import dialog loads tax rates directly from Stripe:

- Inclusive & active rates are selectable.
- Exclusive or archived rates remain blocked with clear chips.
- Already-imported rates show the **imported** badge.

Select the rates you need and choose **Import selected** to refresh the compatible list.
`,
    });

    await page.getByRole('button', { name: 'Cancel' }).click();
  });
});

test.describe('Inclusive tax rates documentation (creators)', () => {
  test.use({ storageState: adminStateFile });

  test('Assign compatible tax rates to paid registrations', async ({
    page,
    seedDate,
    seeded,
  }, testInfo) => {
    await page.goto('.');

    await testInfo.attach('markdown', {
      body: `
# Require a tax rate for paid registration options

Event templates enforce inclusive pricing: every paid registration must reference a compatible tax rate, while free registrations keep the field disabled.

Navigate to **Templates** and open an existing paid template to see the enforced controls.
`,
    });

    await page.getByRole('link', { name: 'Templates' }).click();
    await expect(
      page.getByRole('heading', { name: 'Event templates' }),
    ).toBeVisible();

    const paidTemplate = seeded.templates.find(
      (template) => template.seedKey === 'sports',
    );
    if (!paidTemplate) {
      throw new Error('Seeded paid sports template was not found');
    }
    await page
      .locator(`a[href="/templates/${paidTemplate.id}"]`)
      .first()
      .click();

    await expect(
      page.getByRole('heading', { level: 1, name: paidTemplate.title }),
    ).toBeVisible();

    const registrationSection = page
      .locator('section')
      .filter({
        has: page.getByRole('heading', {
          level: 2,
          name: 'Registration Options',
        }),
      })
      .first();
    await expect(registrationSection).toBeVisible();
    await takeScreenshot(
      testInfo,
      registrationSection,
      page,
      'Template registration options with inclusive labels',
    );

    await testInfo.attach('markdown', {
      body: `
Each paid registration displays the final price together with its inclusive tax label (for example “Incl. 19% VAT”). Exclusive or inactive rates never appear in this list.
`,
    });

    await page.getByRole('button', { name: 'Edit template' }).click();
    const editForm = page.locator('app-template-edit form');
    await expect(editForm).toBeVisible();

    const organizerSection = editForm
      .locator('app-template-registration-option-form')
      .filter({
        has: page.getByRole('textbox', {
          name: 'Registration option name',
        }),
      })
      .filter({ has: page.getByRole('combobox', { name: 'Tax rate' }) })
      .first();
    await expect(
      organizerSection.getByRole('textbox', {
        name: 'Registration option name',
      }),
    ).toHaveValue('Organizer');
    await expect(
      organizerSection.getByRole('combobox', { name: 'Tax rate' }),
    ).toBeVisible();

    await takeScreenshot(
      testInfo,
      organizerSection,
      page,
      'Organizer registration tax rate selector',
    );

    await testInfo.attach('markdown', {
      body: `
Paid organizer registrations require a compatible inclusive tax rate. The dropdown is populated from the imported rates and remains mandatory.
`,
    });

    await page.getByRole('link', { name: 'Templates' }).click();
    await expect(
      page.getByRole('heading', { name: 'Event templates' }),
    ).toBeVisible();
    await page
      .locator(`a[href="/templates/${paidTemplate.id}"]`)
      .first()
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: paidTemplate.title }),
    ).toBeVisible();
    await page.getByText('Create event', { exact: true }).click();

    const draftEventTitle = `Tax Rate Edit ${seedDate.toISOString().slice(0, 10)}`;
    const eventForm = page.locator('app-event-general-form');
    const futureStart = DateTime.fromJSDate(seedDate).plus({ days: 7 });
    await eventForm
      .getByRole('textbox', { name: 'Start date' })
      .fill(futureStart.toFormat('M/d/yyyy'));
    await eventForm
      .getByRole('combobox', { name: 'Start time' })
      .fill('1:00 PM');
    await eventForm
      .getByRole('textbox', { name: 'End date' })
      .fill(futureStart.toFormat('M/d/yyyy'));
    await eventForm.getByRole('combobox', { name: 'End time' }).fill('5:00 PM');
    await page.getByLabel('Event Title').fill(draftEventTitle);
    await page.getByRole('button', { name: 'Create Event' }).click();

    const createdEventHeading = page.getByRole('heading', {
      level: 1,
      name: draftEventTitle,
    });
    const createdEventCard = page.locator('a[href^="/events/"]').filter({
      has: page.getByRole('heading', {
        level: 2,
        name: draftEventTitle,
      }),
    });
    const openedCreatedDetail = await createdEventHeading
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!openedCreatedDetail) {
      await expect(createdEventCard).toBeVisible();
      await createdEventCard.click();
    }
    await expect(
      page.getByRole('heading', { level: 1, name: draftEventTitle }),
    ).toBeVisible();

    await testInfo.attach('markdown', {
      body: `
## Update tax rates in existing events

Event editors can revisit the same controls when updating an editable event.
Open **Edit Event** on a draft event to adjust tax rates if regulations or pricing change.
`,
    });

    await page.getByRole('link', { name: /Edit Event/i }).click();

    const eventEditForm = page.locator('app-event-edit form');
    await expect(eventEditForm).toBeVisible();

    const eventEditTax = eventEditForm.getByRole('combobox', {
      name: 'Tax rate',
    });

    await takeScreenshot(
      testInfo,
      eventEditTax.first(),
      page,
      'Event edit tax rate selector',
    );

    await testInfo.attach('markdown', {
      body: `
Existing paid registrations keep their inclusive tax requirements. Update the selected rate here—event creators cannot save the form without picking a compatible imported tax rate.
`,
    });
  });
});
