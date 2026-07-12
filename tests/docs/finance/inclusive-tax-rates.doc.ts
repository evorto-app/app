import { and, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.describe.configure({ mode: 'default' });

test.describe('Inclusive tax rates documentation (admin)', () => {
  test.use({ storageState: adminStateFile });

  test('Import a Stripe tax rate and verify it', async ({
    database,
    page,
    tenant,
  }, testInfo) => {
    const tenantRecord = await database.query.tenants.findFirst({
      columns: { stripeAccountId: true },
      where: { id: tenant.id },
    });
    if (!tenantRecord?.stripeAccountId) {
      throw new Error('Expected the tax-rate docs tenant to use Stripe');
    }
    const documentedRate = await database.query.tenantStripeTaxRates.findFirst({
      where: {
        active: true,
        inclusive: true,
        stripeAccountId: tenantRecord.stripeAccountId,
        tenantId: tenant.id,
      },
    });
    if (!documentedRate) {
      throw new Error('Expected an inclusive Stripe tax rate to document');
    }
    await database
      .delete(schema.tenantStripeTaxRates)
      .where(eq(schema.tenantStripeTaxRates.id, documentedRate.id));

    await page.goto('.');

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="User permissions" %}
To manage tax rates you need the **admin:tax** permission. Sign in as a tenant administrator for the tenant you intend to change. The tenant must have a connected Stripe account, and the inclusive tax rate must already exist in that connected account. Importing never copies a rate from another tenant or Stripe account.
{% /callout %}

# Manage Inclusive Tax Rates

Inclusive (VAT-style) tax rates are configured under **Admin Tools** → **Tax Rates**. Start from **Events** and open the admin area.
`,
    });

    await page.getByRole('link', { name: 'Admin Tools' }).click();
    await expect(
      page.getByRole('heading', { name: /Admin settings/i }),
    ).toBeVisible();

    await testInfo.attach('markdown', {
      body: `
The admin overview links to all configuration areas. Select **Tax Rates** to manage the rates imported from your payment provider.
`,
    });

    await page.getByRole('link', { name: 'Tax Rates' }).click();
    await expect(
      page
        .locator('app-tax-rates-settings')
        .getByRole('heading', { level: 1, name: 'Tax Rates' }),
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
The import dialog loads tax rates directly from the tenant's connected Stripe account:

- Inclusive & active rates are selectable.
- Exclusive or archived rates remain blocked with clear chips.
- Already-imported rates show the **imported** badge.

Select the rates you need and choose **Import selected**. Review the name, percentage, and region before committing: this action makes the selected rate available to paid event and template registration options, but it does not change prices or assign the rate automatically.
`,
    });

    const documentedRateName = documentedRate.displayName || 'Unnamed Rate';
    const documentedRatePercentage = documentedRate.percentage ?? '?';
    const rateCheckbox = page.getByRole('checkbox', {
      name: new RegExp(
        `${documentedRateName}.*${documentedRatePercentage}%`,
        'i',
      ),
    });
    await expect(rateCheckbox).toBeVisible();
    await expect(rateCheckbox).toBeEnabled();
    await rateCheckbox.check();
    await page.getByRole('button', { name: 'Import selected' }).click();
    await expect(
      page.getByRole('heading', { name: 'Import Stripe tax rates' }),
    ).not.toBeVisible();

    const compatibleRates = page.locator('app-tax-rates-settings').filter({
      has: page.getByRole('heading', {
        level: 2,
        name: 'Compatible Tax Rates',
      }),
    });
    await expect(
      compatibleRates.getByText(documentedRate.stripeTaxRateId, {
        exact: true,
      }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      compatibleRates,
      page,
      'Imported compatible Stripe tax rate',
    );

    await expect
      .poll(async () =>
        database.query.tenantStripeTaxRates.findFirst({
          columns: {
            active: true,
            inclusive: true,
            stripeAccountId: true,
            stripeTaxRateId: true,
          },
          where: {
            stripeAccountId: tenantRecord.stripeAccountId,
            stripeTaxRateId: documentedRate.stripeTaxRateId,
            tenantId: tenant.id,
          },
        }),
      )
      .toEqual({
        active: true,
        inclusive: true,
        stripeAccountId: tenantRecord.stripeAccountId,
        stripeTaxRateId: documentedRate.stripeTaxRateId,
      });

    await importButton.click();
    const reopenedDialog = page.locator('mat-dialog-container');
    await expect(
      reopenedDialog.getByRole('heading', {
        name: 'Import Stripe tax rates',
      }),
    ).toBeVisible();
    const importedRateCheckboxMatcher = page.getByRole('checkbox', {
      name: new RegExp(
        `${documentedRateName}.*${documentedRatePercentage}%`,
        'i',
      ),
    });
    const importedRateRow = reopenedDialog
      .locator('mat-dialog-content > div > div')
      .filter({ has: importedRateCheckboxMatcher });
    const importedRateCheckbox = importedRateRow.getByRole('checkbox', {
      name: new RegExp(
        `${documentedRateName}.*${documentedRatePercentage}%`,
        'i',
      ),
    });
    await expect(importedRateCheckbox).toBeChecked();
    await expect(importedRateCheckbox).toBeDisabled();
    await expect(
      importedRateRow.getByText('imported', { exact: true }),
    ).toBeVisible();
    await expect(
      reopenedDialog.getByRole('button', { name: 'Import selected' }),
    ).toBeDisabled();
    await takeScreenshot(
      testInfo,
      importedRateRow,
      page,
      'Imported Stripe tax rate cannot be selected twice',
    );
    await reopenedDialog.getByRole('button', { name: 'Cancel' }).click();

    await testInfo.attach('markdown', {
      body: `
## Completion and recovery

The dialog closes after Stripe and Evorto accept the import. The rate must then appear under **Compatible Tax Rates** with the same provider id; that readback proves it is available to this tenant. Opening **Import Tax Rates** again shows it as **imported** and prevents a duplicate selection.

If Stripe cannot be reached, Evorto shows **Failed to load rates from Stripe** and imports nothing. Retry after the provider or connection recovers. If a rate is exclusive or archived, manage or replace it in Stripe; Evorto deliberately keeps it unavailable for new paid event configuration. If the connected Stripe account changes while the dialog is open, reload the page and import only from the current account.
`,
    });
  });
});

test.describe('Inclusive tax rates documentation (creators)', () => {
  test.use({ storageState: adminStateFile });

  test('Assign compatible tax rates to paid registrations', async ({
    database,
    page,
    registerDatabaseCleanup,
    seedDate,
    seeded,
    tenant,
  }, testInfo) => {
    const paidTemplate = seeded.templates.find(
      (template) => template.seedKey === 'sports',
    );
    if (!paidTemplate) {
      throw new Error('Seeded paid sports template was not found');
    }
    const tenantRecord = await database.query.tenants.findFirst({
      columns: { stripeAccountId: true },
      where: { id: tenant.id },
    });
    if (!tenantRecord?.stripeAccountId) {
      throw new Error('Expected the tax-rate creator tenant to use Stripe');
    }
    const compatibleRates = await database.query.tenantStripeTaxRates.findMany({
      orderBy: (table, { asc }) => [
        asc(table.percentage),
        asc(table.stripeTaxRateId),
      ],
      where: {
        active: true,
        inclusive: true,
        stripeAccountId: tenantRecord.stripeAccountId,
        tenantId: tenant.id,
      },
    });
    const templateTaxRate = compatibleRates.find(
      (rate) => rate.percentage === '19',
    );
    const eventTaxRate = compatibleRates.find(
      (rate) => rate.percentage === '0',
    );
    if (!templateTaxRate || !eventTaxRate) {
      throw new Error(
        'Expected distinct seeded 19% and 0% inclusive tax rates',
      );
    }
    const templateTaxRateLabel = `${templateTaxRate.displayName || templateTaxRate.stripeTaxRateId} — ${templateTaxRate.percentage ?? '?'}%`;
    const eventTaxRateLabel = `${eventTaxRate.displayName || eventTaxRate.stripeTaxRateId} — ${eventTaxRate.percentage ?? '?'}%`;
    const templateOrganizerOption =
      await database.query.templateRegistrationOptions.findFirst({
        where: {
          organizingRegistration: true,
          templateId: paidTemplate.id,
        },
      });
    if (!templateOrganizerOption) {
      throw new Error('Expected a paid organizer template option');
    }
    const originalTemplateTaxRateId = templateOrganizerOption.stripeTaxRateId;
    expect(templateOrganizerOption.stripeTaxRateId).not.toBe(
      templateTaxRate.stripeTaxRateId,
    );
    const draftEventTitle = `Tax Rate Edit ${seedDate.toISOString().slice(0, 10)} ${paidTemplate.id.slice(-6)}`;

    registerDatabaseCleanup(async (cleanupDatabase) => {
      try {
        const createdEvents = await cleanupDatabase
          .select({ id: schema.eventInstances.id })
          .from(schema.eventInstances)
          .where(
            and(
              eq(schema.eventInstances.tenantId, tenant.id),
              eq(schema.eventInstances.title, draftEventTitle),
            ),
          );
        const createdEventIds = createdEvents.map((event) => event.id);

        if (createdEventIds.length > 0) {
          const createdOptions = await cleanupDatabase
            .select({ id: schema.eventRegistrationOptions.id })
            .from(schema.eventRegistrationOptions)
            .where(
              inArray(schema.eventRegistrationOptions.eventId, createdEventIds),
            );
          const createdOptionIds = createdOptions.map((option) => option.id);

          if (createdOptionIds.length > 0) {
            await cleanupDatabase
              .delete(schema.eventRegistrationOptionDiscounts)
              .where(
                inArray(
                  schema.eventRegistrationOptionDiscounts.registrationOptionId,
                  createdOptionIds,
                ),
              );
          }
          await cleanupDatabase
            .delete(schema.eventRegistrationQuestions)
            .where(
              inArray(
                schema.eventRegistrationQuestions.eventId,
                createdEventIds,
              ),
            );
          await cleanupDatabase
            .delete(schema.addonToEventRegistrationOptions)
            .where(
              inArray(
                schema.addonToEventRegistrationOptions.eventId,
                createdEventIds,
              ),
            );
          await cleanupDatabase
            .delete(schema.eventAddons)
            .where(inArray(schema.eventAddons.eventId, createdEventIds));
          await cleanupDatabase
            .delete(schema.eventRegistrationOptions)
            .where(
              inArray(schema.eventRegistrationOptions.eventId, createdEventIds),
            );
          await cleanupDatabase
            .delete(schema.eventInstances)
            .where(
              and(
                eq(schema.eventInstances.tenantId, tenant.id),
                inArray(schema.eventInstances.id, createdEventIds),
              ),
            );
        }
      } finally {
        await cleanupDatabase
          .update(schema.templateRegistrationOptions)
          .set({ stripeTaxRateId: originalTemplateTaxRateId })
          .where(
            and(
              eq(
                schema.templateRegistrationOptions.id,
                templateOrganizerOption.id,
              ),
              eq(
                schema.templateRegistrationOptions.templateId,
                paidTemplate.id,
              ),
            ),
          );
      }
    });

    await page.goto('.');

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Account, permissions, and payment prerequisites" %}
Sign in to the tenant you intend to edit. This journey needs **View templates**, **Edit all templates**, and **Create events** access. The tenant must have a connected Stripe account and at least one active, inclusive rate imported under **Admin Tools** → **Tax Rates**.
{% /callout %}

# Require and assign a tax rate for paid registration options

Paid event and template registration options must reference a compatible inclusive tax rate. Free options hide the price and tax-rate fields; select **Enable payment** or **Paid option** to reveal them.

Navigate to **Templates** and open an existing paid template. If the selector says **No active inclusive tax rates**, ask a tenant administrator with **Manage tax rates** access to import one from the tenant's connected Stripe account, then reload the editor. If loading failed, retry after the provider or connection recovers. Keep the option free until a compatible rate is available.
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
    ).toBeVisible({ timeout: 20_000 });

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
      .locator('app-template-registration-option-editor')
      .filter({
        has: page.getByRole('textbox', {
          name: 'Registration option name',
        }),
      })
      .filter({
        has: page.getByRole('combobox', { name: 'Inclusive tax rate' }),
      })
      .first();
    await expect(
      organizerSection.getByRole('textbox', {
        name: 'Registration option name',
      }),
    ).toHaveValue('Organizer');
    const templateTaxRateSelect = organizerSection.getByRole('combobox', {
      name: 'Inclusive tax rate',
    });
    await expect(templateTaxRateSelect).toBeVisible();
    await templateTaxRateSelect.click();
    await page
      .getByRole('option', { exact: true, name: templateTaxRateLabel })
      .click();
    await expect(templateTaxRateSelect).toContainText(templateTaxRateLabel);

    await takeScreenshot(
      testInfo,
      organizerSection,
      page,
      'Compatible tax rate selected for the paid template option',
    );

    await testInfo.attach('markdown', {
      body: `
Paid organizer registrations require a compatible inclusive tax rate. Select the intended imported rate, review its percentage, then choose **Update template**. This changes the reusable template for future events; it does not rewrite events already created from that template.
`,
    });

    const updateTemplate = page.getByRole('button', {
      name: 'Update template',
    });
    await expect(updateTemplate).toBeEnabled();
    await updateTemplate.click();
    await expect(page).toHaveURL(`/templates/${paidTemplate.id}`, {
      timeout: 15_000,
    });
    await expect(
      page.getByRole('heading', { level: 1, name: paidTemplate.title }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const savedOption =
          await database.query.templateRegistrationOptions.findFirst({
            columns: { stripeTaxRateId: true },
            where: {
              id: templateOrganizerOption.id,
              templateId: paidTemplate.id,
            },
          });
        return savedOption?.stripeTaxRateId;
      })
      .toBe(templateTaxRate.stripeTaxRateId);
    const savedOrganizerCard = page
      .getByRole('heading', { exact: true, level: 3, name: 'Organizer' })
      .locator('../..');
    await expect(
      savedOrganizerCard.getByText(
        `Incl. ${templateTaxRate.percentage ?? '?'}% VAT`,
        { exact: true },
      ),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Create event' }).click();

    const eventForm = page.locator('app-event-general-form');
    const futureStart = DateTime.fromJSDate(seedDate).plus({ days: 7 });
    await eventForm
      .getByRole('textbox', { name: 'Start date' })
      .fill(futureStart.setLocale('de-DE').toLocaleString(DateTime.DATE_SHORT));
    await eventForm.getByRole('combobox', { name: 'Start time' }).fill('13:00');
    await eventForm
      .getByRole('textbox', { name: 'End date' })
      .fill(futureStart.setLocale('de-DE').toLocaleString(DateTime.DATE_SHORT));
    await eventForm.getByRole('combobox', { name: 'End time' }).fill('17:00');
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
    const createdEventId = page.url().split('/').at(-1);
    if (!createdEventId) {
      throw new Error('Expected the created tax-rate event id');
    }
    const eventOrganizerOption =
      await database.query.eventRegistrationOptions.findFirst({
        where: {
          event: { tenantId: tenant.id },
          eventId: createdEventId,
          organizingRegistration: true,
        },
      });
    if (!eventOrganizerOption) {
      throw new Error('Expected the copied paid organizer event option');
    }
    expect(eventOrganizerOption.stripeTaxRateId).toBe(
      templateTaxRate.stripeTaxRateId,
    );

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

    const eventOptionEditors = eventEditForm.locator(
      'app-event-registration-option-editor',
    );
    await expect(
      eventOptionEditors
        .first()
        .getByRole('textbox', { exact: true, name: 'Option name' }),
    ).toBeVisible();
    const matchingOrganizerEditors = [];
    for (const editor of await eventOptionEditors.all()) {
      const optionName = editor.getByRole('textbox', {
        exact: true,
        name: 'Option name',
      });
      if ((await optionName.inputValue()) === eventOrganizerOption.title) {
        matchingOrganizerEditors.push(editor);
      }
    }
    const eventOrganizerSection = matchingOrganizerEditors[0];
    if (matchingOrganizerEditors.length !== 1 || !eventOrganizerSection) {
      throw new Error('Expected one matching organizer option editor');
    }
    await expect(
      eventOrganizerSection.getByRole('textbox', { name: 'Option name' }),
    ).toHaveValue('Organizer');
    const eventEditTax = eventOrganizerSection.getByRole('combobox', {
      name: 'Tax rate',
    });
    await eventEditTax.click();
    await page
      .getByRole('option', { exact: true, name: eventTaxRateLabel })
      .click();
    await expect(eventEditTax).toContainText(eventTaxRateLabel);

    await takeScreenshot(
      testInfo,
      eventOrganizerSection,
      page,
      'Compatible tax rate selected for the paid event option',
    );

    await testInfo.attach('markdown', {
      body: `
Existing paid registration options keep their inclusive tax requirement. Select the intended compatible imported rate and choose **Save changes**. The event keeps its own selection independently from the source template.
`,
    });

    const saveEvent = page.getByRole('button', { name: 'Save changes' });
    await expect(saveEvent).toBeEnabled();
    await saveEvent.click();
    await expect(page).toHaveURL(`/events/${createdEventId}`, {
      timeout: 15_000,
    });
    await expect(
      page.getByRole('heading', { level: 1, name: draftEventTitle }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const savedOption =
          await database.query.eventRegistrationOptions.findFirst({
            columns: { stripeTaxRateId: true },
            where: {
              event: { tenantId: tenant.id },
              eventId: createdEventId,
              id: eventOrganizerOption.id,
            },
          });
        return savedOption?.stripeTaxRateId;
      })
      .toBe(eventTaxRate.stripeTaxRateId);

    await testInfo.attach('markdown', {
      body: `
## Completion and recovery

Returning to the event detail page confirms that **Save changes** completed. The persisted registration option now references the selected imported rate, while the reusable template keeps its separately saved rate. Existing registrations retain their recorded monetary and tax data.

If saving reports that the rate is missing, inactive, exclusive, or belongs to another Stripe account, leave the option unchanged. Return to **Admin Tools** → **Tax Rates**, import a compatible rate from the tenant's current connected account, reload the editor, and select it deliberately before retrying.
`,
    });
    const eventDetail = page.locator(
      'app-event-list router-outlet + ng-component',
    );
    await expect(eventDetail).toBeVisible();
    await takeScreenshot(
      testInfo,
      eventDetail,
      page,
      'Paid event after saving its compatible tax rate',
    );
  });
});
