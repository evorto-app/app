import { and, eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { organizerStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: organizerStateFile });

for (const scenario of [
  { enteredPrice: '3.00', expectedPrice: 300, title: 'edited discount' },
  { enteredPrice: '', expectedPrice: null, title: 'removed discount' },
]) {
  test(`event creation preserves the ${scenario.title} from the visible form`, async ({
    database,
    discounts,
    page,
    registerDatabaseCleanup,
    templates,
    tenant,
  }) => {
    void discounts;
    const template = templates.find(
      (candidate) => candidate.seedKey === 'city-tour',
    );
    if (!template) throw new Error('Expected the seeded city-tour template.');
    const participantOption =
      await database.query.templateRegistrationOptions.findFirst({
        where: { organizingRegistration: false, templateId: template.id },
      });
    const taxRate = await database.query.tenantStripeTaxRates.findFirst({
      where: { active: true, inclusive: true, tenantId: tenant.id },
    });
    if (!participantOption || !taxRate || taxRate.percentage === null) {
      throw new Error(
        'Expected a participant option and a usable seeded inclusive tax rate.',
      );
    }
    const originalDiscount =
      await database.query.templateRegistrationOptionDiscounts.findFirst({
        where: {
          discountType: 'esnCard',
          registrationOptionId: participantOption.id,
          templateId: template.id,
        },
      });
    const title = `Discount snapshot ${getId()}`;
    const discountId = originalDiscount?.id ?? getId();

    // Registered first so event cleanup runs before template restoration.
    registerDatabaseCleanup(async (cleanupDatabase) => {
      await cleanupDatabase.transaction(async (transaction) => {
        const [restoredOption] = await transaction
          .update(schema.templateRegistrationOptions)
          .set(participantOption)
          .where(
            and(
              eq(schema.templateRegistrationOptions.id, participantOption.id),
              eq(schema.templateRegistrationOptions.templateId, template.id),
            ),
          )
          .returning({ id: schema.templateRegistrationOptions.id });
        if (!restoredOption) {
          throw new Error(
            'The original template option could not be restored.',
          );
        }
        if (originalDiscount) {
          await transaction
            .insert(schema.templateRegistrationOptionDiscounts)
            .values(originalDiscount)
            .onConflictDoUpdate({
              set: originalDiscount,
              target: [
                schema.templateRegistrationOptionDiscounts.registrationOptionId,
                schema.templateRegistrationOptionDiscounts.discountType,
              ],
            });
          return;
        }
        await transaction
          .delete(schema.templateRegistrationOptionDiscounts)
          .where(
            and(
              eq(schema.templateRegistrationOptionDiscounts.id, discountId),
              eq(
                schema.templateRegistrationOptionDiscounts.registrationOptionId,
                participantOption.id,
              ),
              eq(
                schema.templateRegistrationOptionDiscounts.templateId,
                template.id,
              ),
              eq(
                schema.templateRegistrationOptionDiscounts.discountType,
                'esnCard',
              ),
            ),
          );
      });
    });
    registerDatabaseCleanup(async (cleanupDatabase) => {
      await cleanupDatabase.transaction(async (transaction) => {
        const createdEvents = await transaction.query.eventInstances.findMany({
          columns: { id: true },
          where: { templateId: template.id, tenantId: tenant.id, title },
        });
        for (const createdEvent of createdEvents) {
          await transaction
            .delete(schema.eventRegistrationOptionDiscounts)
            .where(
              eq(
                schema.eventRegistrationOptionDiscounts.eventId,
                createdEvent.id,
              ),
            );
          await transaction
            .delete(schema.eventRegistrationQuestions)
            .where(
              eq(schema.eventRegistrationQuestions.eventId, createdEvent.id),
            );
          await transaction
            .delete(schema.addonToEventRegistrationOptions)
            .where(
              eq(
                schema.addonToEventRegistrationOptions.eventId,
                createdEvent.id,
              ),
            );
          await transaction
            .delete(schema.eventAddons)
            .where(eq(schema.eventAddons.eventId, createdEvent.id));
          await transaction
            .delete(schema.eventRegistrationOptions)
            .where(
              eq(schema.eventRegistrationOptions.eventId, createdEvent.id),
            );
          await transaction
            .delete(schema.eventInstances)
            .where(
              and(
                eq(schema.eventInstances.id, createdEvent.id),
                eq(schema.eventInstances.tenantId, tenant.id),
                eq(schema.eventInstances.templateId, template.id),
                eq(schema.eventInstances.title, title),
              ),
            );
        }
      });
    });

    await database
      .update(schema.templateRegistrationOptions)
      .set({
        isPaid: true,
        price: 1000,
        stripeTaxRateId: taxRate.stripeTaxRateId,
      })
      .where(eq(schema.templateRegistrationOptions.id, participantOption.id));
    await database
      .insert(schema.templateRegistrationOptionDiscounts)
      .values({
        discountedPrice: 500,
        id: discountId,
        discountType: 'esnCard',
        registrationOptionId: participantOption.id,
        templateId: template.id,
      })
      .onConflictDoUpdate({
        set: { discountedPrice: 500 },
        target: [
          schema.templateRegistrationOptionDiscounts.registrationOptionId,
          schema.templateRegistrationOptionDiscounts.discountType,
        ],
      });

    await page.goto('/templates');
    const templateLink = page.getByRole('link').filter({
      has: page.getByText(template.title, { exact: true }),
    });
    await expect(templateLink).toHaveAttribute(
      'href',
      `/templates/${template.id}`,
    );
    await templateLink.click();
    await expect(page).toHaveURL(`/templates/${template.id}`);
    await page.getByRole('link', { name: 'Create event', exact: true }).click();
    await page.getByLabel('Event title', { exact: true }).fill(title);
    const optionForm = page.locator('app-registration-option-form').filter({
      has: page.getByRole('heading', {
        name: participantOption.title,
        exact: true,
      }),
    });
    const discountInput = optionForm.getByLabel('ESNcard price (EUR)', {
      exact: true,
    });
    await expect(discountInput).toHaveValue('5');
    await discountInput.fill(scenario.enteredPrice);

    // A later template edit must not override the price currently being submitted.
    await database
      .update(schema.templateRegistrationOptionDiscounts)
      .set({ discountedPrice: 900 })
      .where(
        and(
          eq(
            schema.templateRegistrationOptionDiscounts.registrationOptionId,
            participantOption.id,
          ),
          eq(
            schema.templateRegistrationOptionDiscounts.discountType,
            'esnCard',
          ),
        ),
      );
    const createButton = page.getByRole('button', {
      name: 'Create event',
      exact: true,
    });
    await expect(createButton).toBeEnabled();
    await createButton.click();
    await expect(page).toHaveURL(/\/events\/[^/]+$/, { timeout: 20_000 });
    await expect(
      page.getByRole('heading', { name: title, exact: true }).last(),
    ).toBeVisible();

    const createdEvent = await database.query.eventInstances.findFirst({
      where: { templateId: template.id, tenantId: tenant.id, title },
    });
    if (!createdEvent) throw new Error('Expected the event to be created.');
    const createdOption =
      await database.query.eventRegistrationOptions.findFirst({
        where: { eventId: createdEvent.id, organizingRegistration: false },
      });
    if (!createdOption)
      throw new Error('Expected the event participant option.');
    const savedDiscount =
      await database.query.eventRegistrationOptionDiscounts.findFirst({
        where: {
          discountType: 'esnCard',
          eventId: createdEvent.id,
          registrationOptionId: createdOption.id,
        },
      });
    expect(savedDiscount?.discountedPrice ?? null).toBe(scenario.expectedPrice);
    const templateDiscount =
      await database.query.templateRegistrationOptionDiscounts.findFirst({
        where: {
          discountType: 'esnCard',
          registrationOptionId: participantOption.id,
        },
      });
    expect(templateDiscount?.discountedPrice).toBe(900);
  });
}
