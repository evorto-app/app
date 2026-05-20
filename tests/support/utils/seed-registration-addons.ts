import * as schema from '../../../src/db/schema';

export const seedFreeRegistrationAddon = async ({
  addonId,
  database,
  eventId,
  registrationOptionId,
  title = 'Snack voucher',
}: {
  addonId: string;
  database: {
    delete: (table: unknown) => {
      where: (condition: unknown) => Promise<unknown>;
    };
    insert: (table: unknown) => {
      values: (value: unknown) => Promise<unknown>;
    };
  };
  eventId: string;
  registrationOptionId: string;
  title?: string;
}) => {
  await database.insert(schema.eventAddons).values({
    allowMultiple: true,
    allowPurchaseBeforeEvent: false,
    allowPurchaseDuringEvent: false,
    allowPurchaseDuringRegistration: true,
    description: 'A free add-on for registration flow coverage.',
    eventId,
    id: addonId,
    isPaid: false,
    maxQuantityPerUser: 3,
    price: 0,
    stripeTaxRateId: null,
    title,
    totalAvailableQuantity: 5,
  });

  await database.insert(schema.addonToEventRegistrationOptions).values({
    addonId,
    quantity: 1,
    registrationOptionId,
  });
};
