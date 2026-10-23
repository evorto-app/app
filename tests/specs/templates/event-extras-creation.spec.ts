import { getId } from '../../../helpers/get-id';
import { organizerStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: organizerStateFile });

for (const mode of ['omit', 'customize', 'add'] as const) {
  test(`can ${mode} template add-ons and questions before creating an event`, async ({
    database,
    page,
    templates,
    tenant,
    permissionOverride,
  }) => {
    if (mode === 'omit') {
      await permissionOverride({
        remove: ['events:seeDrafts', 'events:review', 'events:editAll'],
        roleName: 'Section member',
      });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    const template = templates.find(
      (candidate) => candidate.seedKey === 'city-trip',
    );
    if (!template) throw new Error('Expected the city-trip template');
    const option = await database.query.templateRegistrationOptions.findFirst({
      where: { templateId: template.id, organizingRegistration: false },
    });
    if (!option) throw new Error('Expected an attendee choice');
    const sourceAddons = await database
      .insert(schema.templateEventAddons)
      .values(
        [0, 1].map((index) => ({
          id: getId(),
          templateId: template.id,
          title: `Optional kit ${index}`,
          description: 'Template kit description',
          allowMultiple: true,
          allowPurchaseDuringRegistration: true,
          allowPurchaseBeforeEvent: false,
          allowPurchaseDuringEvent: false,
          isPaid: false,
          price: 0,
          maxQuantityPerUser: 2,
          totalAvailableQuantity: 20,
        })),
      )
      .returning();
    await database.insert(schema.addonToTemplateRegistrationOptions).values(
      sourceAddons.map((addOn) => ({
        addonId: addOn.id,
        templateId: template.id,
        registrationOptionId: option.id,
        includedQuantity: 1,
        optionalPurchaseQuantity: 1,
      })),
    );
    const sourceQuestions = await database
      .insert(schema.templateRegistrationQuestions)
      .values(
        [0, 1].map((index) => ({
          id: getId(),
          templateId: template.id,
          registrationOptionId: option.id,
          title: `Template question ${index}`,
          description: 'Template help',
          required: true,
          sortOrder: index,
        })),
      )
      .returning();
    const title = `Event extras ${mode} ${getId().slice(0, 6)}`;
    await page.goto(`/templates/${template.id}/create-event`);
    await expect(
      page.getByRole('button', { name: 'Change Icon', exact: true }),
    ).not.toHaveAttribute('jsaction', /click/, { timeout: 20_000 });
    await page.getByLabel('Event title', { exact: true }).fill(title);
    const addOns = page.locator('app-template-addon-editor');
    const questions = page.locator('app-template-question-editor');
    await expect(addOns).toHaveCount(2);
    await expect(questions).toHaveCount(2);
    if (mode === 'omit' || mode === 'add') {
      for (let index = 0; index < 2; index++) {
        await addOns
          .first()
          .getByRole('button', { name: 'Remove add-on', exact: true })
          .click();
        await questions
          .first()
          .getByRole('button', { name: 'Remove question', exact: true })
          .click();
      }
    } else {
      await addOns
        .nth(1)
        .getByRole('button', { name: 'Remove add-on', exact: true })
        .click();
      await questions
        .nth(1)
        .getByRole('button', { name: 'Remove question', exact: true })
        .click();
    }
    if (mode === 'add') {
      await page
        .getByRole('button', { name: 'Add add-on', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Add question', exact: true })
        .click();
      await addOns
        .first()
        .getByRole('combobox', { name: 'Sign-up choice', exact: true })
        .click();
      await page
        .getByRole('option', { name: option.title, exact: true })
        .click();
      await questions
        .first()
        .getByRole('combobox', { name: 'Ask during', exact: true })
        .click();
      await page
        .getByRole('option', { name: option.title, exact: true })
        .click();
    }
    if (mode !== 'omit') {
      await addOns
        .first()
        .getByLabel('Add-on name', { exact: true })
        .fill('Custom event kit');
      await addOns
        .first()
        .getByLabel('Description', { exact: true })
        .fill('Only for this event');
      await addOns
        .first()
        .getByLabel('Items available', { exact: true })
        .fill('12');
      await questions
        .first()
        .getByLabel('Question', { exact: true })
        .fill('Which session suits you?');
      await questions
        .first()
        .getByLabel('Help text', { exact: true })
        .fill('Event-specific help');
      await questions
        .first()
        .getByRole('checkbox', { name: 'Require an answer' })
        .uncheck();
    }
    const create = page.getByRole('button', {
      name: 'Create event',
      exact: true,
    });
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page).toHaveURL(/\/events\/[a-z0-9]+$/);
    const event = await database.query.eventInstances.findFirst({
      where: { title, tenantId: tenant.id },
    });
    if (!event) throw new Error('Expected the new event');
    if (mode === 'omit') {
      const ownEvent = page
        .getByRole('region', { name: 'Event list', exact: true })
        .locator(`a[href="/events/${event.id}"]`);
      await expect(ownEvent).toContainText(title);
      await expect(ownEvent).toContainText('draft');
      await expect(
        page.getByRole('link', { name: 'Edit Event', exact: true }),
      ).toBeVisible();
      const submit = page.getByRole('button', {
        name: 'Submit for Review',
        exact: true,
      });
      await expect(submit).toBeEnabled();
      await expect(submit).not.toHaveAttribute('jsaction', /click/);
      await submit.click();
      const dialog = page.getByRole('dialog', {
        name: 'Submit Event for Review',
        exact: true,
      });
      await dialog
        .getByRole('button', { name: 'Submit for Review', exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect(ownEvent).toContainText('pending review');
      await page.reload();
      await expect(ownEvent).toContainText('pending review');
      await page.screenshot({
        path: 'test-results/own-submitted-event-in-list.png',
      });
    }
    const savedAddons = await database.query.eventAddons.findMany({
      where: { eventId: event.id },
    });
    const savedQuestions =
      await database.query.eventRegistrationQuestions.findMany({
        where: { eventId: event.id },
      });
    if (mode === 'omit') {
      expect(savedAddons).toEqual([]);
      expect(savedQuestions).toEqual([]);
    } else {
      expect(savedAddons).toMatchObject([
        {
          title: 'Custom event kit',
          description: 'Only for this event',
          totalAvailableQuantity: 12,
        },
      ]);
      expect(savedQuestions).toMatchObject([
        {
          title: 'Which session suits you?',
          description: 'Event-specific help',
          required: false,
        },
      ]);
      const savedOption =
        await database.query.eventRegistrationOptions.findFirst({
          where: { eventId: event.id, organizingRegistration: false },
        });
      expect(savedQuestions[0]?.registrationOptionId).toBe(savedOption?.id);
      const mapping =
        await database.query.addonToEventRegistrationOptions.findFirst({
          where: { eventId: event.id },
        });
      expect(mapping).toMatchObject({
        registrationOptionId: savedOption?.id,
        includedQuantity: 1,
        optionalPurchaseQuantity: mode === 'add' ? 0 : 1,
      });
    }
    expect(
      await database.query.templateEventAddons.findMany({
        where: { templateId: template.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual([...sourceAddons].sort((a, b) => a.id.localeCompare(b.id)));
    expect(
      await database.query.templateRegistrationQuestions.findMany({
        where: { templateId: template.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual([...sourceQuestions].sort((a, b) => a.id.localeCompare(b.id)));
  });
}
