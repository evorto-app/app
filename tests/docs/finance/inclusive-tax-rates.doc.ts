import { and, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { adminStateFile } from '../../../helpers/user-data';
import { taxRateRegionLabel } from '../../../src/app/core/geography-labels';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.describe.configure({ mode: 'default' });

test.describe('Manage tax rates', () => {
  test.use({ storageState: adminStateFile });

  test('Add a tax rate included in the shown price', async ({
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
    if (!documentedRate?.displayName || documentedRate.percentage === null) {
      throw new Error(
        'Expected a named Stripe tax rate with a percentage included in the price',
      );
    }
    await database
      .delete(schema.tenantStripeTaxRates)
      .where(eq(schema.tenantStripeTaxRates.id, documentedRate.id));

    await page.goto('.');

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Who can do this" %}
Sign in as an organization administrator with **Manage tax rates** access. Paid sign-ups must be ready. The rate you want to add must already exist in this organization's payment settings, be active, and include tax in the shown price. Rates from other organizations are not available.
{% /callout %}


Tax rates such as VAT are managed under **Admin Tools** → **Tax rates**. Start from **Events** and open the admin area.
`,
    });

    await page.getByRole('link', { name: 'Admin Tools' }).click();
    await expect(
      page.getByRole('heading', { name: /Admin settings/i }),
    ).toBeVisible();

    await testInfo.attach('markdown', {
      body: `
The admin overview links to each settings page. Select **Tax rates** to manage the rates available for paid sign-ups.
`,
    });

    await page.getByRole('link', { name: 'Tax rates' }).click();
    await expect(
      page
        .locator('app-tax-rates-settings')
        .getByRole('heading', { level: 1, name: 'Tax rates' }),
    ).toBeVisible();
    await expect(page.locator('[ngh]')).toHaveCount(0, { timeout: 20_000 });
    await expect(
      page.getByRole('button', { name: 'Add tax rates' }).first(),
    ).toBeEnabled();

    await takeScreenshot(
      testInfo,
      page.locator('app-tax-rates-settings'),
      page,
      'Available and unavailable tax rates for paid sign-ups',
    );

    await testInfo.attach('markdown', {
      body: `
## Available and unavailable tax rates

- **Available tax rates** lists active rates with tax included in the shown price. These can be selected for paid sign-ups.
- **Unavailable tax rates** lists rates that are archived or add tax when paying.
- Use **Add tax rates** to add rates that already exist in the organization's payment settings. To create or change a rate, select **Open tax rate settings**; this opens those settings in a new tab and requires access to the organization's payment account.
`,
    });

    const importButton = page
      .getByRole('button', { name: 'Add tax rates' })
      .first();
    await expect(importButton).toBeVisible();
    await importButton.click();

    await expect(
      page.getByRole('heading', { name: 'Add tax rates' }),
    ).toBeVisible();

    const documentedRateName = documentedRate.displayName;
    const documentedRatePercentage = documentedRate.percentage;
    const documentedRateDisplay =
      documentedRatePercentage === '0'
        ? 'Tax-free'
        : `${documentedRatePercentage}%`;
    const rateCheckbox = page.getByRole('checkbox', {
      name: new RegExp(
        `${documentedRateName}.*${documentedRatePercentage}%`,
        'i',
      ),
    });
    await expect(rateCheckbox).toBeVisible();
    await expect(rateCheckbox).toBeEnabled();

    await takeScreenshot(
      testInfo,
      page.locator('mat-dialog-container'),
      page,
      'Add tax rates',
    );

    await testInfo.attach('markdown', {
      body: `
The dialog shows tax rates that can be added:

- Rates marked **Tax included in the shown price** can be selected.
- Rates marked **Tax added when paying** or **Archived** remain unavailable.
- Rates that have already been added show **Already added**.

Select the rates you need and choose **Add selected**. Review the name, percentage, and region first. Adding a rate makes it available to paid event and template sign-up choices, but does not change prices or select the rate for you.
`,
    });

    await rateCheckbox.check();
    await page.getByRole('button', { name: 'Add selected' }).click();
    await expect(
      page.getByRole('heading', { name: 'Add tax rates' }),
    ).not.toBeVisible();

    const compatibleRates = page.locator('app-tax-rates-settings').filter({
      has: page.getByRole('heading', {
        level: 2,
        name: 'Available tax rates',
      }),
    });
    const availableRateRow = compatibleRates
      .getByRole('row')
      .filter({
        has: page.getByRole('cell', {
          exact: true,
          name: documentedRateName,
        }),
      })
      .filter({
        has: page.getByRole('cell', {
          exact: true,
          name: documentedRateDisplay,
        }),
      });
    await expect(availableRateRow).toBeVisible();
    await expect(
      availableRateRow.getByRole('cell', {
        exact: true,
        name: taxRateRegionLabel(documentedRate.country, documentedRate.state),
      }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      compatibleRates,
      page,
      'Added tax rate available for sign-ups',
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
        name: 'Add tax rates',
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
      importedRateRow.getByText('Already added', { exact: true }),
    ).toBeVisible();
    await expect(
      reopenedDialog.getByRole('button', { name: 'Add selected' }),
    ).toBeDisabled();
    await takeScreenshot(
      testInfo,
      importedRateRow,
      page,
      'A tax rate already added cannot be selected twice',
    );
    await reopenedDialog.getByRole('button', { name: 'Cancel' }).click();

    await testInfo.attach('markdown', {
      body: `
## After adding a rate

After the rate is added, it appears under **Available tax rates** and can be used for paid events. Opening **Add tax rates** again marks it as **Already added**, so it cannot be selected twice.

If rates cannot be loaded, select **Try again**; nothing is added until the list loads and you confirm a selection. Use **Open tax rate settings** to create or change an unsuitable rate, then return and add an active rate marked **Tax included in the shown price**.
`,
    });
  });
});

test.describe('Use tax rates for paid sign-ups', () => {
  test.use({ storageState: adminStateFile });

  test('Choose tax rates for paid sign-ups', async ({
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
    if (
      !templateTaxRate?.displayName ||
      !eventTaxRate?.displayName ||
      templateTaxRate.percentage === null ||
      eventTaxRate.percentage === null
    ) {
      throw new Error(
        'Expected distinct seeded 19% and 0% tax rates included in prices',
      );
    }
    const templateTaxRateLabel = `${templateTaxRate.displayName} — ${templateTaxRate.percentage}%`;
    const eventTaxRateLabel = `${eventTaxRate.displayName} — ${eventTaxRate.percentage}%`;
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
    const draftEventTitle = 'Community sports afternoon';

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
{% callout type="note" title="Who can do this" %}
Sign in to the organization you intend to edit. You need **View templates**, **Edit all templates**, and **Create events** access. Paid sign-ups must be ready, with at least one active rate where tax is included in the shown price under **Admin Tools** → **Tax rates**.
{% /callout %}


Every paid event or template sign-up choice needs an available tax rate where tax is included in the shown price. Free choices hide the price and tax-rate fields; select **Enable payment** on a template or **Charge for this choice** on an event to reveal them.

Open **Templates** and choose an existing paid template. If the tax-rate list says **No tax rates available for shown prices**, ask an organization administrator with **Manage tax rates** access to add one, then return to the editor. If the list does not load, you cannot save a paid choice. Select **Try again** once; if the same message remains, ask Evorto support to investigate. Keep the choice free until a rate is available.
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
          name: 'Sign-up choices',
        }),
      })
      .first();
    await expect(registrationSection).toBeVisible();
    await takeScreenshot(
      testInfo,
      registrationSection,
      page,
      'Template sign-up choices with tax included in the shown price',
    );

    await testInfo.attach('markdown', {
      body: `
Each paid choice displays the final price and how much tax it includes, for example **19% VAT included in the shown price**. Rates that are unavailable do not appear here.
`,
    });

    await page.getByRole('button', { name: 'Edit template' }).click();
    const editForm = page.locator('app-template-edit form');
    await expect(editForm).toBeVisible();

    const organizerSection = editForm
      .locator('app-template-registration-option-editor')
      .filter({
        has: page.getByRole('textbox', {
          name: 'Sign-up choice name',
        }),
      })
      .filter({
        has: page.getByRole('combobox', {
          name: 'Tax included in the shown price',
        }),
      })
      .first();
    await expect(
      organizerSection.getByRole('textbox', {
        name: 'Sign-up choice name',
      }),
    ).toHaveValue(templateOrganizerOption.title);
    const templateTaxRateSelect = organizerSection.getByRole('combobox', {
      name: 'Tax included in the shown price',
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
      'Tax rate selected for the paid template choice',
    );

    await testInfo.attach('markdown', {
      body: `
Paid organizer choices need an available rate where tax is included in the shown price. Select the intended rate, review its percentage, then choose **Update template**. This changes the reusable template for future events; it does not change events already created from that template.
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
      .getByRole('heading', {
        exact: true,
        level: 3,
        name: templateOrganizerOption.title,
      })
      .locator('../..');
    await expect(
      savedOrganizerCard.getByText(
        `${templateTaxRate.percentage}% VAT included in the shown price`,
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

While an event is still editable, open **Edit Event** to change its tax rates if regulations or pricing change.
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
        .getByRole('textbox', { exact: true, name: 'Sign-up choice name' }),
    ).toBeVisible();
    const matchingOrganizerEditors = [];
    for (const editor of await eventOptionEditors.all()) {
      const optionName = editor.getByRole('textbox', {
        exact: true,
        name: 'Sign-up choice name',
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
      eventOrganizerSection.getByRole('textbox', {
        name: 'Sign-up choice name',
      }),
    ).toHaveValue(eventOrganizerOption.title);
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
      'Tax rate selected for the paid event choice',
    );

    await testInfo.attach('markdown', {
      body: `
Existing paid sign-up choices still need a rate where tax is included in the shown price. Select the intended available rate and choose **Save changes**. The event keeps its own selection independently from the original template.
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
## After saving

Returning to the event detail page confirms that **Save changes** completed. The event now uses the selected tax rate, while the reusable template keeps its own saved choice. Existing tickets keep the price and tax shown when their owners signed up.

If Evorto says the tax rate is unavailable, the sign-up choice stays unchanged. Return to **Admin Tools** → **Tax rates**, add an available rate, return to the editor, select **Try again**, and choose the rate before saving.
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
      'Paid event after saving its tax rate',
    );
  });
});
