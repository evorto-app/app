import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from '../../../src/db/schema';
import { relations } from '../../../src/db/relations';
import { getId } from '../../../helpers/get-id';

import { deleteRegistrationAcquisitionLedger } from './registration-acquisition-cleanup';
import type { futureServerEventWindow } from './server-test-clock';

type TestDatabase = NodePgDatabase<typeof relations>;

// Seeds a free add-on directly for browser flows that need deterministic
// add-on purchases without depending on a full organizer authoring journey.
export const seedFreeRegistrationAddon = async ({
  addonId,
  database,
  eventId,
  registrationOptionId,
  title = 'Snack voucher',
}: {
  addonId: string;
  database: TestDatabase;
  eventId: string;
  registrationOptionId: string;
  title?: string;
}) => {
  await database.insert(schema.eventAddons).values({
    allowMultiple: true,
    allowPurchaseBeforeEvent: false,
    allowPurchaseDuringEvent: false,
    allowPurchaseDuringRegistration: true,
    description: 'Collect a snack voucher at the welcome desk.',
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
    eventId,
    includedQuantity: 0,
    optionalPurchaseQuantity: 3,
    registrationOptionId,
  });
};

export const seedRequiredRegistrationQuestion = async ({
  database,
  description = 'Tell organizers anything they need to know before the event.',
  eventId,
  registrationOptionId,
  title = 'Anything organizers should know?',
}: {
  database: TestDatabase;
  description?: string;
  eventId: string;
  registrationOptionId: string;
  title?: string;
}) => {
  const questionId = `q-${getId().slice(0, 18)}`;

  await database
    .delete(schema.eventRegistrationQuestions)
    .where(
      and(
        eq(schema.eventRegistrationQuestions.eventId, eventId),
        eq(
          schema.eventRegistrationQuestions.registrationOptionId,
          registrationOptionId,
        ),
      ),
    );

  await database.insert(schema.eventRegistrationQuestions).values({
    description,
    eventId,
    id: questionId,
    registrationOptionId,
    required: true,
    sortOrder: 0,
    title,
  });

  return { questionId, title };
};

// Own a distinct event instead of temporarily deleting seeded registrations.
// Cleanup is registered before setup but acquires ownership only after commit.
export const seedFreeAddonRegistrationEvent = async ({
  database,
  registerDatabaseCleanup,
  sourceEventId,
  sourceOptionId,
  tenantId,
  window,
}: {
  database: TestDatabase;
  registerDatabaseCleanup: (
    cleanup: (database: TestDatabase) => Promise<void>,
  ) => void;
  sourceEventId: string;
  sourceOptionId: string;
  tenantId: string;
  window: ReturnType<typeof futureServerEventWindow>;
}) => {
  const sourceEvent = await database.query.eventInstances.findFirst({
    where: { id: sourceEventId, tenantId },
  });
  const sourceOption = await database.query.eventRegistrationOptions.findFirst({
    where: { eventId: sourceEventId, id: sourceOptionId },
  });
  if (!sourceEvent || !sourceOption || sourceOption.isPaid) {
    throw new Error(
      'Expected a tenant-owned free registration event and option',
    );
  }
  const eventId = getId();
  const optionId = getId();
  let ownsEvent = false;

  registerDatabaseCleanup(async (cleanupDatabase) => {
    if (!ownsEvent) return;
    await cleanupDatabase.transaction(async (transaction) => {
      const registrations = await transaction
        .select({ id: schema.eventRegistrations.id })
        .from(schema.eventRegistrations)
        .where(
          and(
            eq(schema.eventRegistrations.eventId, eventId),
            eq(schema.eventRegistrations.tenantId, tenantId),
          ),
        );
      const registrationIds = registrations.map(
        (registration) => registration.id,
      );
      await deleteRegistrationAcquisitionLedger({
        database: transaction,
        registrationIds,
        tenantId,
      });
      if (registrationIds.length > 0) {
        await transaction
          .delete(schema.eventRegistrations)
          .where(
            and(
              inArray(schema.eventRegistrations.id, registrationIds),
              eq(schema.eventRegistrations.eventId, eventId),
              eq(schema.eventRegistrations.tenantId, tenantId),
            ),
          );
      }
      await transaction
        .delete(schema.eventRegistrationQuestions)
        .where(eq(schema.eventRegistrationQuestions.eventId, eventId));
      await transaction
        .delete(schema.addonToEventRegistrationOptions)
        .where(eq(schema.addonToEventRegistrationOptions.eventId, eventId));
      await transaction
        .delete(schema.eventAddons)
        .where(eq(schema.eventAddons.eventId, eventId));
      await transaction
        .delete(schema.eventRegistrationOptions)
        .where(
          and(
            eq(schema.eventRegistrationOptions.id, optionId),
            eq(schema.eventRegistrationOptions.eventId, eventId),
          ),
        );
      await transaction
        .delete(schema.eventInstances)
        .where(
          and(
            eq(schema.eventInstances.id, eventId),
            eq(schema.eventInstances.tenantId, tenantId),
          ),
        );
    });
    ownsEvent = false;
  });

  await database.transaction(async (transaction) => {
    await transaction.insert(schema.eventInstances).values({
      ...sourceEvent,
      end: window.end,
      id: eventId,
      start: window.start,
    });
    await transaction.insert(schema.eventRegistrationOptions).values({
      ...sourceOption,
      checkedInSpots: 0,
      closeRegistrationTime: window.closeRegistrationTime,
      confirmedSpots: 0,
      eventId,
      id: optionId,
      openRegistrationTime: window.openRegistrationTime,
      reservedSpots: 0,
      spots: 20,
      waitlistSpots: 0,
    });
  });
  ownsEvent = true;
  return { eventId, optionId };
};
