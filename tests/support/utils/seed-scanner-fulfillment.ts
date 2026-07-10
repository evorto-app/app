import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { relations } from '../../../src/db/relations';
import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
} from '../../../src/db/schema';

export const seedScannerFulfillmentAddon = async ({
  addOnId,
  database,
  eventId,
  includedQuantity,
  optionalQuantity,
  purchaseId,
  purchaseLotId,
  registrationId,
  registrationOptionId,
  tenant,
  title,
}: {
  addOnId: string;
  database: NodePgDatabase<typeof relations>;
  eventId: string;
  includedQuantity: number;
  optionalQuantity: number;
  purchaseId: string;
  purchaseLotId: string;
  registrationId: string;
  registrationOptionId: string;
  tenant: {
    currency: 'AUD' | 'CZK' | 'EUR';
    id: string;
  };
  title: string;
}) => {
  await database.insert(eventAddons).values({
    allowMultiple: true,
    allowPurchaseBeforeEvent: false,
    allowPurchaseDuringEvent: false,
    allowPurchaseDuringRegistration: true,
    description: `${title} for deterministic scanner fulfillment coverage.`,
    eventId,
    id: addOnId,
    isPaid: false,
    maxQuantityPerUser: includedQuantity + optionalQuantity,
    price: 0,
    stripeTaxRateId: null,
    title,
    totalAvailableQuantity: 10 - includedQuantity - optionalQuantity,
  });
  await database.insert(addonToEventRegistrationOptions).values({
    addonId: addOnId,
    eventId,
    includedQuantity,
    optionalPurchaseQuantity: optionalQuantity,
    registrationOptionId,
  });
  await database.insert(eventRegistrationAddonPurchases).values({
    addonId: addOnId,
    eventId,
    id: purchaseId,
    includedQuantity,
    purchasedQuantity: optionalQuantity,
    quantity: includedQuantity + optionalQuantity,
    registrationId,
    registrationOptionId,
    tenantId: tenant.id,
    unitPrice: 0,
  });
  if (optionalQuantity > 0) {
    await database.insert(eventRegistrationAddonPurchaseLots).values({
      baseAmount: 0,
      currency: tenant.currency,
      eventId,
      id: purchaseLotId,
      purchaseId,
      quantity: optionalQuantity,
      registrationId,
      registrationOptionId,
      sourceLineKey: `scanner-test:${purchaseId}`,
      tenantId: tenant.id,
      unitPrice: 0,
    });
  }
};
