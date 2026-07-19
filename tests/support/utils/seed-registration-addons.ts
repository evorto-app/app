import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from '../../../src/db/schema';
import { relations } from '../../../src/db/relations';
import { getId } from '../../../helpers/get-id';

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
