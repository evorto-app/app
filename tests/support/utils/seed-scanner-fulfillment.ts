import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import type { relations } from '../../../src/db/relations';
import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  registrationAcquisitionComponents,
  registrationAcquisitions,
} from '../../../src/db/schema';

type TestDatabase = NodePgDatabase<typeof relations>;

export const seedScannerRegistrationAcquisition = async ({
  acquisitionId,
  database,
  eventId,
  registrationId,
  tenant,
}: {
  acquisitionId: string;
  database: TestDatabase;
  eventId: string;
  registrationId: string;
  tenant: {
    currency: 'AUD' | 'CZK' | 'EUR';
    id: string;
  };
}) => {
  const registration = await database.query.eventRegistrations.findFirst({
    columns: { guestCount: true, userId: true },
    where: {
      eventId,
      id: registrationId,
      tenantId: tenant.id,
    },
  });
  if (!registration) {
    throw new Error(
      `Expected registration "${registrationId}" before seeding scanner acquisition ownership`,
    );
  }

  const acquiredAt = new Date();
  await database.insert(registrationAcquisitions).values({
    acquiredAt,
    eventId,
    id: acquisitionId,
    kind: 'initial',
    operationKey: `scanner-fixture:${registrationId}`,
    ordinal: 0,
    ownerUserId: registration.userId,
    registrationId,
    spotCount: registration.guestCount + 1,
    tenantId: tenant.id,
  });
  await database.insert(registrationAcquisitionComponents).values({
    acquiredAt,
    acquisitionId,
    allocationKey: 'registration',
    applicationFeeAmount: 0,
    baseAmount: 0,
    currency: tenant.currency,
    eventId,
    grossAmount: 0,
    kind: 'registration',
    netAmount: 0,
    quantity: registration.guestCount + 1,
    registrationId,
    stripeFeeAmount: 0,
    taxAmount: 0,
    tenantId: tenant.id,
  });
};

export const cleanupScannerRegistrationAcquisition = async ({
  acquisitionId,
  database,
}: {
  acquisitionId: string;
  database: TestDatabase;
}) => {
  await database
    .delete(registrationAcquisitionComponents)
    .where(eq(registrationAcquisitionComponents.acquisitionId, acquisitionId));
  await database
    .delete(registrationAcquisitions)
    .where(eq(registrationAcquisitions.id, acquisitionId));
};

export const seedScannerFulfillmentAddon = async ({
  acquisitionId,
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
  acquisitionId: string;
  addOnId: string;
  database: TestDatabase;
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
    const acquiredAt = new Date();
    await database.insert(eventRegistrationAddonPurchaseLots).values({
      applicationFeeAmount: 0,
      baseAmount: 0,
      currency: tenant.currency,
      eventId,
      grossAmount: 0,
      id: purchaseLotId,
      netAmount: 0,
      paymentAllocationFinalizedAt: acquiredAt,
      purchaseId,
      quantity: optionalQuantity,
      registrationId,
      registrationOptionId,
      sourceLineKey: `scanner-test:${purchaseId}`,
      stripeFeeAmount: 0,
      taxAmount: 0,
      tenantId: tenant.id,
      unitPrice: 0,
    });
    await database.insert(registrationAcquisitionComponents).values({
      acquiredAt,
      acquisitionId,
      allocationKey: `addon-lot:${purchaseLotId}`,
      applicationFeeAmount: 0,
      baseAmount: 0,
      currency: tenant.currency,
      eventId,
      grossAmount: 0,
      kind: 'addon_lot',
      netAmount: 0,
      purchaseId,
      purchaseLotId,
      quantity: optionalQuantity,
      registrationId,
      stripeFeeAmount: 0,
      taxAmount: 0,
      tenantId: tenant.id,
    });
  }
};
