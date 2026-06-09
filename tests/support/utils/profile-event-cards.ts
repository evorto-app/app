import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { and, eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import type { SeedTenantResult } from '../../../helpers/seed-tenant';
import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';
import { seedFreeRegistrationAddon } from './seed-registration-addons';

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
  const confirmedAddonId = getId();
  const confirmedAddonPurchaseId = getId();
  const confirmedAddonTitle = `Profile docs snack ${seedDate.getTime()}`;
  const checkedInRegistrationId = getId();
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
  const profileEventId = seeded.scenario.events.freeOpen.eventId;
  const profileEventOptionId = seeded.scenario.events.freeOpen.optionId;
  const checkedInEventId = seeded.scenario.events.closedReg.eventId;
  const checkedInEventOptionId = seeded.scenario.events.closedReg.optionId;
  const profileEvent = seeded.events.find(
    (event) => event.id === profileEventId,
  );
  if (!profileEvent) {
    throw new Error('Expected seeded free profile event');
  }
  const checkedInEvent = seeded.events.find(
    (event) => event.id === checkedInEventId,
  );
  if (!checkedInEvent) {
    throw new Error('Expected seeded checked-in profile event');
  }
  const sourceEvent = await database.query.eventInstances.findFirst({
    where: (eventInstance) =>
      and(
        eq(eventInstance.id, profileEventId),
        eq(eventInstance.tenantId, seeded.tenant.id),
      ),
  });
  if (!sourceEvent) {
    throw new Error('Expected seeded profile source event');
  }
  const profileEventOption =
    await database.query.eventRegistrationOptions.findFirst({
      where: {
        eventId: profileEventId,
        id: profileEventOptionId,
        tenantId: seeded.tenant.id,
      },
    });
  if (!profileEventOption) {
    throw new Error('Expected seeded profile source registration option');
  }
  const checkedInEventOption =
    await database.query.eventRegistrationOptions.findFirst({
      where: {
        eventId: checkedInEventId,
        id: checkedInEventOptionId,
        tenantId: seeded.tenant.id,
      },
    });
  if (!checkedInEventOption) {
    throw new Error('Expected seeded checked-in source registration option');
  }

  await database.insert(schema.eventInstances).values([
    {
      creatorId: userId,
      description:
        'Profile docs event for pending checkout continuation coverage.',
      end: new Date(seedDate.getTime() + 3 * 60 * 60 * 1000),
      icon: sourceEvent.icon,
      id: pendingCheckoutEventId,
      location: sourceEvent.location,
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
      location: sourceEvent.location,
      start: new Date(seedDate.getTime() + 4 * 60 * 60 * 1000),
      status: 'APPROVED',
      templateId: sourceEvent.templateId,
      tenantId: seeded.tenant.id,
      title: waitlistTitle,
    },
  ]);
  await database.insert(schema.eventRegistrationOptions).values([
    {
      closeRegistrationTime: new Date(seedDate.getTime() + 60 * 60 * 1000),
      eventId: pendingCheckoutEventId,
      id: pendingCheckoutOptionId,
      isPaid: true,
      openRegistrationTime: new Date(seedDate.getTime() - 60 * 60 * 1000),
      organizingRegistration: false,
      price: 2500,
      registrationMode: 'fcfs',
      roleIds: [],
      spots: 20,
      title: 'Participant checkout',
    },
    {
      closeRegistrationTime: new Date(seedDate.getTime() + 60 * 60 * 1000),
      eventId: waitlistEventId,
      id: waitlistOptionId,
      isPaid: false,
      openRegistrationTime: new Date(seedDate.getTime() - 60 * 60 * 1000),
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      roleIds: [],
      spots: 1,
      title: 'Participant waitlist',
    },
  ]);
  await seedFreeRegistrationAddon({
    addonId: confirmedAddonId,
    database,
    eventId: profileEventId,
    registrationOptionId: profileEventOptionId,
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
      eventId: profileEventId,
      guestCount: 1,
      id: confirmedRegistrationId,
      registrationOptionId: profileEventOptionId,
      status: 'CONFIRMED',
      tenantId: seeded.tenant.id,
      userId,
    },
    {
      checkInTime: seedDate,
      eventId: checkedInEventId,
      id: checkedInRegistrationId,
      registrationOptionId: checkedInEventOptionId,
      status: 'CONFIRMED',
      tenantId: seeded.tenant.id,
      userId,
    },
    {
      eventId: pendingCheckoutEventId,
      id: pendingCheckoutRegistrationId,
      registrationOptionId: pendingCheckoutOptionId,
      status: 'PENDING',
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
      id: confirmedAddonPurchaseId,
      quantity: 2,
      registrationId: confirmedRegistrationId,
      unitPrice: 0,
    },
    {
      addonId: checkedInAddonId,
      id: checkedInAddonPurchaseId,
      quantity: 1,
      registrationId: checkedInRegistrationId,
      unitPrice: 0,
    },
  ]);
  await database.insert(schema.transactions).values({
    amount: 2500,
    comment: 'Profile docs pending checkout card',
    currency: 'EUR',
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
      eventTitle: checkedInEvent.title,
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
    },
    confirmed: {
      addOnPurchaseId: confirmedAddonPurchaseId,
      addOnTitle: confirmedAddonTitle,
      addonId: confirmedAddonId,
      eventId: profileEventId,
      eventTitle: profileEvent.title,
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
