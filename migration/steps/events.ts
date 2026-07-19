import consola from 'consola';
import {
  and,
  count,
  eq,
  exists,
  type InferInsertModel,
  type InferSelectModel,
} from 'drizzle-orm';
import { marked } from 'marked';

import * as oldSchema from '../../old/drizzle';
import { createId } from '../../src/db/create-id';
import type { ScriptDatabaseClient } from '../../src/db/database-client';
import * as schema from '../../src/db/schema';
import { mapUserId, resolveIcon } from '../config';
import { legacyEventLocation } from '../legacy-event-location';
import { legacyEventReviewStatus } from '../legacy-event-publication';
import { legacyRegistrationPricing } from '../legacy-event-prices';
import { legacyParticipantRegistrationMode } from '../legacy-registration-mode';
import {
  assertLegacyDeregistrationSupported,
  legacyRegistrationPolicy,
} from '../legacy-registration-policy';
import { legacySignupRoleIds } from '../legacy-signup-roles';
import { legacyTimestamp, legacyTimestampDateTime } from '../legacy-timestamp';
import { oldDatabase } from '../migrator-database';
import { maybeInsertIcons } from './icons';

const migrationStepSize = 100;
const numberFormat = new Intl.NumberFormat();

type LegacyEvent = InferSelectModel<typeof oldSchema.tumiEvent> & {
  readonly registrations: InferSelectModel<
    typeof oldSchema.eventRegistration
  >[];
};

type EventInsert = InferInsertModel<typeof schema.eventInstances>;
type EventOptionInsert = InferInsertModel<
  typeof schema.eventRegistrationOptions
>;
type EventDiscountInsert = InferInsertModel<
  typeof schema.eventRegistrationOptionDiscounts
>;

interface PreparedEvent {
  readonly discounts: EventDiscountInsert[];
  readonly eventWithoutIcon: Omit<EventInsert, 'icon'>;
  readonly oldEvent: LegacyEvent;
  readonly options: EventOptionInsert[];
}

const requireLegacySignupLists = (event: LegacyEvent) => {
  if (event.participantSignup === null || event.organizerSignup === null) {
    throw new Error(
      `Legacy event ${event.id} has a null signup allow-list; migration is blocked.`,
    );
  }
  return {
    organizerStatuses: event.organizerSignup,
    participantStatuses: event.participantSignup,
  };
};

const prepareEvent = async (
  database: ScriptDatabaseClient,
  oldTenant: InferSelectModel<typeof oldSchema.tenant>,
  newTenant: InferSelectModel<typeof schema.tenants>,
  templateIdMap: ReadonlyMap<string, string>,
  roleMap: ReadonlyMap<string, string>,
  oldEvent: LegacyEvent,
): Promise<PreparedEvent> => {
  const context = `Legacy event ${oldEvent.id}`;
  assertLegacyDeregistrationSupported(oldEvent.disableDeregistration, context);
  const templateId = templateIdMap.get(oldEvent.eventTemplateId);
  if (!templateId || templateId === 'remove') {
    throw new Error(`${context} has no migrated target template.`);
  }
  const creatorId = await mapUserId(database, oldEvent.creatorId);
  if (!creatorId) {
    throw new Error(
      `${context} has no mapped target creator for ${oldEvent.creatorId}.`,
    );
  }

  const { organizerStatuses, participantStatuses } =
    requireLegacySignupLists(oldEvent);
  const participantRoleIds = legacySignupRoleIds(
    participantStatuses,
    roleMap,
    context,
  );
  const organizerRoleIds = legacySignupRoleIds(
    organizerStatuses,
    roleMap,
    context,
  );
  const participantRegistrationMode = legacyParticipantRegistrationMode({
    deferredPayment: oldEvent.deferredPayment,
    registrationMode: oldEvent.registrationMode,
  });

  const createdAt = legacyTimestamp(oldEvent.createdAt, `${context} createdAt`);
  const start = legacyTimestampDateTime(oldEvent.start, `${context} start`);
  const end = legacyTimestampDateTime(oldEvent.end, `${context} end`);
  if (end.toMillis() <= start.toMillis()) {
    throw new Error(`${context} does not end after it starts.`);
  }
  const closeRegistrationTime = start.plus({ hours: 1 }).toJSDate();
  const eventId = createId();
  const options: EventOptionInsert[] = [];
  const discounts: EventDiscountInsert[] = [];

  if (participantRoleIds.length > 0) {
    const pricing = legacyRegistrationPricing(
      oldEvent.registrationMode,
      oldEvent.prices,
      participantStatuses,
    );
    const policy = legacyRegistrationPolicy({
      context,
      eventSettings: oldEvent.deRegistrationSettings,
      registrationMode: oldEvent.registrationMode,
      registrationType: 'participants',
      tenantSettings: oldTenant.settings,
    });
    const optionId = createId();
    const openRegistrationTime = legacyTimestamp(
      oldEvent.registrationStart,
      `${context} participant registration start`,
    );
    if (openRegistrationTime > closeRegistrationTime) {
      throw new Error(
        `${context} participant registration opens after it closes; migration is blocked.`,
      );
    }
    options.push({
      ...policy,
      checkedInSpots: oldEvent.registrations.filter(
        (registration) =>
          registration.type === 'PARTICIPANT' && registration.checkInTime,
      ).length,
      closeRegistrationTime,
      confirmedSpots: oldEvent.registrations.filter(
        (registration) =>
          registration.type === 'PARTICIPANT' &&
          registration.status === 'SUCCESSFUL',
      ).length,
      createdAt,
      eventId,
      id: optionId,
      isPaid: pricing.isPaid,
      openRegistrationTime,
      organizingRegistration: false,
      price: pricing.basePriceInCents,
      registeredDescription: marked.parse(oldEvent.participantText, {
        async: false,
      }),
      registrationMode: participantRegistrationMode,
      reservedSpots: oldEvent.registrations.filter(
        (registration) =>
          registration.type === 'PARTICIPANT' &&
          registration.status === 'PENDING',
      ).length,
      roleIds: participantRoleIds,
      spots: oldEvent.participantLimit,
      title: 'Participants',
      updatedAt: createdAt,
      waitlistSpots: 0,
    });
    if (pricing.esnCardDiscountedPriceInCents !== null) {
      discounts.push({
        discountedPrice: pricing.esnCardDiscountedPriceInCents,
        discountType: 'esnCard',
        registrationOptionId: optionId,
      });
    }
  }

  if (organizerRoleIds.length > 0) {
    const policy = legacyRegistrationPolicy({
      context,
      eventSettings: oldEvent.deRegistrationSettings,
      registrationMode: oldEvent.registrationMode,
      registrationType: 'organizers',
      tenantSettings: oldTenant.settings,
    });
    const openRegistrationTime = legacyTimestamp(
      oldEvent.organizerRegistrationStart,
      `${context} organizer registration start`,
    );
    if (openRegistrationTime > closeRegistrationTime) {
      throw new Error(
        `${context} organizer registration opens after it closes; migration is blocked.`,
      );
    }
    options.push({
      ...policy,
      checkedInSpots: oldEvent.registrations.filter(
        (registration) =>
          registration.type === 'ORGANIZER' && registration.checkInTime,
      ).length,
      closeRegistrationTime,
      confirmedSpots: oldEvent.registrations.filter(
        (registration) =>
          registration.type === 'ORGANIZER' &&
          registration.status === 'SUCCESSFUL',
      ).length,
      createdAt,
      description: marked.parse(oldEvent.organizerText, { async: false }),
      eventId,
      id: createId(),
      isPaid: false,
      openRegistrationTime,
      organizingRegistration: true,
      price: 0,
      registrationMode: 'fcfs',
      reservedSpots: 0,
      roleIds: organizerRoleIds,
      spots: oldEvent.organizerLimit,
      title: 'Organizers',
      updatedAt: createdAt,
      waitlistSpots: 0,
    });
  }

  return {
    discounts,
    eventWithoutIcon: {
      createdAt,
      creatorId,
      description: marked.parse(oldEvent.description, { async: false }),
      end: end.toJSDate(),
      id: eventId,
      location: legacyEventLocation({
        coordinates: oldEvent.coordinates,
        googlePlaceId: oldEvent.googlePlaceId,
        googlePlaceUrl: oldEvent.googlePlaceUrl,
        isVirtual: oldEvent.isVirtual,
        name: oldEvent.location,
        onlineMeetingUrl: oldEvent.onlineMeetingUrl,
      }),
      simpleModeEnabled:
        options.length === 2 &&
        options.some(({ organizingRegistration }) => organizingRegistration) &&
        options.some(({ organizingRegistration }) => !organizingRegistration),
      start: start.toJSDate(),
      status: legacyEventReviewStatus(oldEvent.publicationState),
      templateId,
      tenantId: newTenant.id,
      title: oldEvent.title,
      unlisted: false,
      updatedAt: createdAt,
    },
    oldEvent,
    options,
  };
};

export const migrateEvents = async (
  database: ScriptDatabaseClient,
  oldTenant: InferSelectModel<typeof oldSchema.tenant>,
  newTenant: InferSelectModel<typeof schema.tenants>,
  templateIdMap: Map<string, string>,
  roleMap: Map<string, string>,
) => {
  const oldEventCountResult = await oldDatabase
    .select({ count: count() })
    .from(oldSchema.tumiEvent)
    .where(
      exists(
        oldDatabase
          .select()
          .from(oldSchema.eventTemplate)
          .where(
            and(
              eq(
                oldSchema.tumiEvent.eventTemplateId,
                oldSchema.eventTemplate.id,
              ),
              eq(oldSchema.eventTemplate.tenantId, oldTenant.id),
            ),
          ),
      ),
    );
  const oldEventCount = oldEventCountResult[0]?.count ?? 0;
  consola.info(`Migrating ${numberFormat.format(oldEventCount)} events`);

  for (let index = 0; index < oldEventCount; index += migrationStepSize) {
    consola.info(
      `Migrating events ${numberFormat.format(index + 1)} to ${numberFormat.format(index + migrationStepSize)}`,
    );
    const eventIdSubquery = oldDatabase
      .select({ id: oldSchema.tumiEvent.id })
      .from(oldSchema.tumiEvent)
      .where(
        exists(
          oldDatabase
            .select()
            .from(oldSchema.eventTemplate)
            .where(
              and(
                eq(
                  oldSchema.tumiEvent.eventTemplateId,
                  oldSchema.eventTemplate.id,
                ),
                eq(oldSchema.eventTemplate.tenantId, oldTenant.id),
              ),
            ),
        ),
      )
      .orderBy(oldSchema.tumiEvent.id)
      .limit(migrationStepSize)
      .offset(index)
      .as('eventIdSubquery');
    const joinedOldEvents = await oldDatabase
      .select()
      .from(oldSchema.tumiEvent)
      .innerJoin(
        eventIdSubquery,
        eq(oldSchema.tumiEvent.id, eventIdSubquery.id),
      )
      .leftJoin(
        oldSchema.eventRegistration,
        eq(oldSchema.tumiEvent.id, oldSchema.eventRegistration.eventId),
      )
      .orderBy(oldSchema.tumiEvent.id);

    const groupedEvents = new Map<string, LegacyEvent>();
    for (const row of joinedOldEvents) {
      const event = row.TumiEvent;
      const registration = row.EventRegistration;
      if (!groupedEvents.has(event.id)) {
        groupedEvents.set(event.id, { ...event, registrations: [] });
      }
      if (registration)
        groupedEvents.get(event.id)?.registrations.push(registration);
    }
    const oldEvents = [...groupedEvents.values()];
    const preparedEvents: PreparedEvent[] = [];
    for (const oldEvent of oldEvents) {
      preparedEvents.push(
        await prepareEvent(
          database,
          oldTenant,
          newTenant,
          templateIdMap,
          roleMap,
          oldEvent,
        ),
      );
    }
    if (preparedEvents.length === 0) continue;

    await maybeInsertIcons(
      database,
      newTenant.id,
      ...oldEvents.map((event) => event.icon),
    );
    const eventValues: EventInsert[] = [];
    for (const prepared of preparedEvents) {
      eventValues.push({
        ...prepared.eventWithoutIcon,
        icon: await resolveIcon(database, prepared.oldEvent.icon, newTenant.id),
      });
    }
    const registrationOptions = preparedEvents.flatMap(
      ({ options }) => options,
    );
    const discounts = preparedEvents.flatMap(({ discounts: values }) => values);
    await database.transaction(async (transaction) => {
      await transaction.insert(schema.eventInstances).values(eventValues);
      if (registrationOptions.length > 0) {
        await transaction
          .insert(schema.eventRegistrationOptions)
          .values(registrationOptions);
      }
      if (discounts.length > 0) {
        await transaction
          .insert(schema.eventRegistrationOptionDiscounts)
          .values(discounts);
      }
    });
  }

  const newEventCountResult = await database
    .select({ count: count() })
    .from(schema.eventInstances)
    .where(eq(schema.eventInstances.tenantId, newTenant.id));
  const newEventCount = newEventCountResult[0]?.count ?? 0;
  consola.info(
    `Migrated ${numberFormat.format(newEventCount)}/${numberFormat.format(oldEventCount)} events`,
  );
};
