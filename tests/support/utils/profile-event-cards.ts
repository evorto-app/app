import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import type { SeedTenantResult } from '../../../helpers/seed-tenant';
import { usersToAuthenticate } from '../../../helpers/user-data';
import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';
import { seedFreeRegistrationAddon } from './seed-registration-addons';

// Shared fixture for profile docs/specs so every profile-card state uses the
// same persisted registrations, add-ons, checkout URL, and cleanup path.
export type SeededProfileEventCards = {
  checkedIn: {
    addOnPurchaseId: string;
    addOnTitle: string;
    addonId: string;
    eventId: string;
    eventTitle: string;
    registrationId: string;
  };
  confirmed: {
    addOnPurchaseId: string;
    addOnTitle: string;
    addonId: string;
    eventId: string;
    eventTitle: string;
    registrationId: string;
  };
  cleanup: () => Promise<void>;
  pendingCheckout: {
    checkoutUrl: string;
    eventId: string;
    optionId: string;
    registrationId: string;
    title: string;
    transactionId: string;
  };
  waitlist: {
    eventId: string;
    optionId: string;
    registrationId: string;
    title: string;
  };
};

export const seedProfileEventCards = async ({
  database,
  seedDate,
  seeded,
  userId,
}: {
  database: NodePgDatabase<typeof relations>;
  seedDate: Date;
  seeded: SeedTenantResult;
  userId: string;
}): Promise<SeededProfileEventCards> => {
  const confirmedRegistrationId = getId();
  const confirmedEventId = getId();
  const confirmedEventOptionId = getId();
  const confirmedEventTitle = `Profile docs confirmed ${seedDate.getTime()}`;
  const confirmedAddonId = getId();
  const confirmedAddonPurchaseId = getId();
  const confirmedAddonTitle = `Profile docs snack ${seedDate.getTime()}`;
  const checkedInRegistrationId = getId();
  const checkedInEventId = getId();
  const checkedInEventOptionId = getId();
  const checkedInEventTitle = `Profile docs checked in ${seedDate.getTime()}`;
  const checkedInAddonId = getId();
  const checkedInAddonPurchaseId = getId();
  const checkedInAddonTitle = `Profile docs checked snack ${seedDate.getTime()}`;
  const pendingCheckoutEventId = getId();
  const pendingCheckoutOptionId = getId();
  const pendingCheckoutRegistrationId = getId();
  const pendingCheckoutTransactionId = getId();
  const pendingCheckoutSessionId = `cs_profile_docs_${seedDate.getTime()}`;
  const pendingCheckoutTitle = `Profile docs pending checkout ${seedDate.getTime()}`;
  const pendingCheckoutUrl = `https://checkout.stripe.com/c/pay/${pendingCheckoutSessionId}`;
  const waitlistEventId = getId();
  const waitlistOptionId = getId();
  const waitlistRegistrationId = getId();
  const waitlistTitle = `Profile docs waitlist ${seedDate.getTime()}`;
  const sourceEventId = seeded.scenario.events.freeOpen.eventId;
  const sourceOptionId = seeded.scenario.events.freeOpen.optionId;
  const paidSourceEventId = seeded.scenario.events.paidOpen.eventId;
  const paidSourceOptionId = seeded.scenario.events.paidOpen.optionId;
  const [sourceEvent, paidSourceEvent] = await Promise.all([
    database.query.eventInstances.findFirst({
      where: {
        id: sourceEventId,
        tenantId: seeded.tenant.id,
      },
      with: { registrationOptions: true },
    }),
    database.query.eventInstances.findFirst({
      where: {
        id: paidSourceEventId,
        tenantId: seeded.tenant.id,
      },
      with: { registrationOptions: true },
    }),
  ]);
  const sourceOption = sourceEvent?.registrationOptions.find(
    (option) => option.id === sourceOptionId,
  );
  const paidSourceOption = paidSourceEvent?.registrationOptions.find(
    (option) => option.id === paidSourceOptionId,
  );
  const reviewer = usersToAuthenticate.find((user) => user.roles === 'admin');
  if (
    !sourceEvent ||
    !sourceOption ||
    sourceOption.isPaid ||
    sourceOption.price !== 0 ||
    sourceOption.stripeTaxRateId !== null ||
    !paidSourceEvent ||
    !paidSourceOption ||
    !paidSourceOption.isPaid ||
    paidSourceOption.price <= 0 ||
    !paidSourceOption.stripeTaxRateId ||
    !reviewer
  ) {
    throw new Error(
      'Expected canonical free and paid profile source options and reviewer',
    );
  }
  const paidTaxRate = await database.query.tenantStripeTaxRates.findFirst({
    where: {
      stripeTaxRateId: paidSourceOption.stripeTaxRateId,
      tenantId: seeded.tenant.id,
    },
  });
  if (!paidTaxRate) {
    throw new Error('Expected canonical paid profile source tax rate');
  }

  await database.insert(schema.eventInstances).values([
    {
      creatorId: userId,
      description: 'Profile docs event for confirmed registration coverage.',
      end: new Date(seedDate.getTime() + 8 * 60 * 60 * 1000),
      icon: sourceEvent.icon,
      id: confirmedEventId,
      listingAudience: 'participant',
      location: sourceEvent.location,
      reviewedAt: seedDate,
      reviewedBy: reviewer.id,
      start: new Date(seedDate.getTime() + 6 * 60 * 60 * 1000),
      status: 'APPROVED',
      templateId: sourceEvent.templateId,
      tenantId: seeded.tenant.id,
      title: confirmedEventTitle,
    },
    {
      creatorId: userId,
      description: 'Profile docs event for checked-in registration coverage.',
      end: new Date(seedDate.getTime() + 60 * 60 * 1000),
      icon: sourceEvent.icon,
      id: checkedInEventId,
      listingAudience: 'participant',
      location: sourceEvent.location,
      reviewedAt: seedDate,
      reviewedBy: reviewer.id,
      start: new Date(seedDate.getTime() - 2 * 60 * 60 * 1000),
      status: 'APPROVED',
      templateId: sourceEvent.templateId,
      tenantId: seeded.tenant.id,
      title: checkedInEventTitle,
    },
    {
      creatorId: userId,
      description:
        'Profile docs event for pending checkout continuation coverage.',
      end: new Date(seedDate.getTime() + 3 * 60 * 60 * 1000),
      icon: sourceEvent.icon,
      id: pendingCheckoutEventId,
      listingAudience: 'participant',
      location: sourceEvent.location,
      reviewedAt: seedDate,
      reviewedBy: reviewer.id,
      start: new Date(seedDate.getTime() + 2 * 60 * 60 * 1000),
      status: 'APPROVED',
      templateId: sourceEvent.templateId,
      tenantId: seeded.tenant.id,
      title: pendingCheckoutTitle,
    },
    {
      creatorId: userId,
      description: 'Profile docs event for waitlist card coverage.',
      end: new Date(seedDate.getTime() + 5 * 60 * 60 * 1000),
      icon: sourceEvent.icon,
      id: waitlistEventId,
      listingAudience: 'participant',
      location: sourceEvent.location,
      reviewedAt: seedDate,
      reviewedBy: reviewer.id,
      start: new Date(seedDate.getTime() + 4 * 60 * 60 * 1000),
      status: 'APPROVED',
      templateId: sourceEvent.templateId,
      tenantId: seeded.tenant.id,
      title: waitlistTitle,
    },
  ]);
  await database.insert(schema.eventRegistrationOptions).values([
    {
      closeRegistrationTime: new Date(seedDate.getTime() + 5 * 60 * 60 * 1000),
      eventId: confirmedEventId,
      id: confirmedEventOptionId,
      isPaid: sourceOption.isPaid,
      openRegistrationTime: new Date(seedDate.getTime() - 60 * 60 * 1000),
      organizingRegistration: false,
      price: sourceOption.price,
      registrationMode: 'fcfs',
      roleIds: [],
      spots: 20,
      stripeTaxRateId: sourceOption.stripeTaxRateId,
      title: 'Confirmed participant',
    },
    {
      closeRegistrationTime: seedDate,
      eventId: checkedInEventId,
      id: checkedInEventOptionId,
      isPaid: sourceOption.isPaid,
      openRegistrationTime: new Date(seedDate.getTime() - 3 * 60 * 60 * 1000),
      organizingRegistration: false,
      price: sourceOption.price,
      registrationMode: 'fcfs',
      roleIds: [],
      spots: 20,
      stripeTaxRateId: sourceOption.stripeTaxRateId,
      title: 'Checked-in participant',
    },
    {
      closeRegistrationTime: new Date(seedDate.getTime() + 60 * 60 * 1000),
      eventId: pendingCheckoutEventId,
      id: pendingCheckoutOptionId,
      isPaid: paidSourceOption.isPaid,
      openRegistrationTime: new Date(seedDate.getTime() - 60 * 60 * 1000),
      organizingRegistration: false,
      price: paidSourceOption.price,
      registrationMode: 'fcfs',
      roleIds: [],
      spots: 20,
      stripeTaxRateId: paidSourceOption.stripeTaxRateId,
      title: 'Participant checkout',
    },
    {
      closeRegistrationTime: new Date(seedDate.getTime() + 60 * 60 * 1000),
      eventId: waitlistEventId,
      id: waitlistOptionId,
      isPaid: sourceOption.isPaid,
      openRegistrationTime: new Date(seedDate.getTime() - 60 * 60 * 1000),
      organizingRegistration: false,
      price: sourceOption.price,
      registrationMode: 'fcfs',
      roleIds: [],
      spots: 1,
      stripeTaxRateId: sourceOption.stripeTaxRateId,
      title: 'Participant waitlist',
    },
  ]);
  await seedFreeRegistrationAddon({
    addonId: confirmedAddonId,
    database,
    eventId: confirmedEventId,
    registrationOptionId: confirmedEventOptionId,
    title: confirmedAddonTitle,
  });
  await seedFreeRegistrationAddon({
    addonId: checkedInAddonId,
    database,
    eventId: checkedInEventId,
    registrationOptionId: checkedInEventOptionId,
    title: checkedInAddonTitle,
  });
  await database.insert(schema.eventRegistrations).values([
    {
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      basePriceAtRegistration: sourceOption.price,
      discountAmount: 0,
      eventId: confirmedEventId,
      guestCount: 1,
      id: confirmedRegistrationId,
      registrationOptionId: confirmedEventOptionId,
      status: 'CONFIRMED',
      tenantId: seeded.tenant.id,
      userId,
    },
    {
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      basePriceAtRegistration: sourceOption.price,
      checkInTime: seedDate,
      discountAmount: 0,
      eventId: checkedInEventId,
      id: checkedInRegistrationId,
      registrationOptionId: checkedInEventOptionId,
      status: 'CONFIRMED',
      tenantId: seeded.tenant.id,
      userId,
    },
    {
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      basePriceAtRegistration: paidSourceOption.price,
      discountAmount: 0,
      eventId: pendingCheckoutEventId,
      id: pendingCheckoutRegistrationId,
      registrationOptionId: pendingCheckoutOptionId,
      status: 'PENDING',
      stripeTaxRateId: paidSourceOption.stripeTaxRateId,
      taxRateDisplayName: paidTaxRate.displayName,
      taxRateInclusive: paidTaxRate.inclusive,
      taxRatePercentage: paidTaxRate.percentage,
      tenantId: seeded.tenant.id,
      userId,
    },
    {
      eventId: waitlistEventId,
      id: waitlistRegistrationId,
      registrationOptionId: waitlistOptionId,
      status: 'WAITLIST',
      tenantId: seeded.tenant.id,
      userId,
    },
  ]);
  await database.insert(schema.eventRegistrationAddonPurchases).values([
    {
      addonId: confirmedAddonId,
      eventId: confirmedEventId,
      id: confirmedAddonPurchaseId,
      purchasedQuantity: 2,
      quantity: 2,
      registrationId: confirmedRegistrationId,
      registrationOptionId: confirmedEventOptionId,
      tenantId: seeded.tenant.id,
      unitPrice: 0,
    },
    {
      addonId: checkedInAddonId,
      eventId: checkedInEventId,
      id: checkedInAddonPurchaseId,
      purchasedQuantity: 1,
      quantity: 1,
      registrationId: checkedInRegistrationId,
      registrationOptionId: checkedInEventOptionId,
      tenantId: seeded.tenant.id,
      unitPrice: 0,
    },
  ]);
  await database.insert(schema.transactions).values({
    amount: paidSourceOption.price,
    comment: 'Profile docs pending checkout card',
    currency: seeded.tenant.currency,
    eventId: pendingCheckoutEventId,
    eventRegistrationId: pendingCheckoutRegistrationId,
    executiveUserId: userId,
    id: pendingCheckoutTransactionId,
    method: 'stripe',
    status: 'pending',
    stripeCheckoutSessionId: pendingCheckoutSessionId,
    stripeCheckoutUrl: pendingCheckoutUrl,
    targetUserId: userId,
    tenantId: seeded.tenant.id,
    type: 'registration',
  });

  return {
    checkedIn: {
      addOnPurchaseId: checkedInAddonPurchaseId,
      addOnTitle: checkedInAddonTitle,
      addonId: checkedInAddonId,
      eventId: checkedInEventId,
      eventTitle: checkedInEventTitle,
      registrationId: checkedInRegistrationId,
    },
    cleanup: async () => {
      await database
        .delete(schema.transactions)
        .where(eq(schema.transactions.id, pendingCheckoutTransactionId));
      await database
        .delete(schema.eventRegistrationAddonPurchases)
        .where(
          eq(
            schema.eventRegistrationAddonPurchases.id,
            confirmedAddonPurchaseId,
          ),
        );
      await database
        .delete(schema.eventRegistrationAddonPurchases)
        .where(
          eq(
            schema.eventRegistrationAddonPurchases.id,
            checkedInAddonPurchaseId,
          ),
        );
      await database
        .delete(schema.eventRegistrations)
        .where(eq(schema.eventRegistrations.id, confirmedRegistrationId));
      await database
        .delete(schema.eventRegistrations)
        .where(eq(schema.eventRegistrations.id, checkedInRegistrationId));
      await database
        .delete(schema.eventRegistrations)
        .where(eq(schema.eventRegistrations.id, pendingCheckoutRegistrationId));
      await database
        .delete(schema.eventRegistrations)
        .where(eq(schema.eventRegistrations.id, waitlistRegistrationId));
      await database
        .delete(schema.eventRegistrationOptions)
        .where(eq(schema.eventRegistrationOptions.id, pendingCheckoutOptionId));
      await database
        .delete(schema.eventRegistrationOptions)
        .where(eq(schema.eventRegistrationOptions.id, waitlistOptionId));
      await database
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.id, pendingCheckoutEventId));
      await database
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.id, waitlistEventId));
      await database
        .delete(schema.addonToEventRegistrationOptions)
        .where(
          eq(schema.addonToEventRegistrationOptions.addonId, confirmedAddonId),
        );
      await database
        .delete(schema.addonToEventRegistrationOptions)
        .where(
          eq(schema.addonToEventRegistrationOptions.addonId, checkedInAddonId),
        );
      await database
        .delete(schema.eventAddons)
        .where(eq(schema.eventAddons.id, confirmedAddonId));
      await database
        .delete(schema.eventAddons)
        .where(eq(schema.eventAddons.id, checkedInAddonId));
      await database
        .delete(schema.eventRegistrationOptions)
        .where(eq(schema.eventRegistrationOptions.id, confirmedEventOptionId));
      await database
        .delete(schema.eventRegistrationOptions)
        .where(eq(schema.eventRegistrationOptions.id, checkedInEventOptionId));
      await database
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.id, confirmedEventId));
      await database
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.id, checkedInEventId));
    },
    confirmed: {
      addOnPurchaseId: confirmedAddonPurchaseId,
      addOnTitle: confirmedAddonTitle,
      addonId: confirmedAddonId,
      eventId: confirmedEventId,
      eventTitle: confirmedEventTitle,
      registrationId: confirmedRegistrationId,
    },
    pendingCheckout: {
      checkoutUrl: pendingCheckoutUrl,
      eventId: pendingCheckoutEventId,
      optionId: pendingCheckoutOptionId,
      registrationId: pendingCheckoutRegistrationId,
      title: pendingCheckoutTitle,
      transactionId: pendingCheckoutTransactionId,
    },
    waitlist: {
      eventId: waitlistEventId,
      optionId: waitlistOptionId,
      registrationId: waitlistRegistrationId,
      title: waitlistTitle,
    },
  };
};
