import consola from 'consola';
import {
  and,
  count,
  eq,
  exists,
  InferInsertModel,
  InferSelectModel,
  sql,
} from 'drizzle-orm';
import { DateTime } from 'luxon';
import { marked } from 'marked';

import * as oldSchema from '../../old/drizzle';
import { publicationState } from '../../old/drizzle';
import { database } from '../../src/db';
import * as schema from '../../src/db/schema';
import { mapUserId, resolveIcon, transformAuthId } from '../config';
import { oldDatabase } from '../migrator-database';
import { maybeInsertIcons } from './icons';

const migrationStepSize = 100;
const numberFormat = new Intl.NumberFormat();

export const migrateEvents = async (
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
  const oldEventCount = oldEventCountResult[0].count;

  consola.info(`Migrating ${numberFormat.format(oldEventCount)} events`);

  for (let index = 0; index < oldEventCount; index += migrationStepSize) {
    consola.info(
      `Migrating events ${numberFormat.format(
        index + 1,
      )} to ${numberFormat.format(index + migrationStepSize)}`,
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
      .orderBy(oldSchema.tumiEvent.id)
      .leftJoin(
        oldSchema.eventRegistration,
        eq(oldSchema.tumiEvent.id, oldSchema.eventRegistration.eventId),
      );

    const groupedEvents = new Map<
      string,
      InferSelectModel<typeof oldSchema.tumiEvent> & {
        registrations: InferSelectModel<typeof oldSchema.eventRegistration>[];
      }
    >();
    for (const row of joinedOldEvents) {
      // Every row now looks like { TumiEvent, EventRegistration }
      const event = row.TumiEvent;
      const registration = row.EventRegistration;
      if (!groupedEvents.has(event.id)) {
        groupedEvents.set(event.id, { ...event, registrations: [] });
      }
      if (registration) {
        groupedEvents.get(event.id)?.registrations?.push(registration);
      }
    }
    const oldEvents = [...groupedEvents.values()];

    if (oldEvents.length != migrationStepSize) {
      consola.info(
        `Migrating ${oldEvents.length} events from ${joinedOldEvents.length} rows`,
      );
    }

    await maybeInsertIcons(
      newTenant.id,
      ...oldEvents.map((event) => event.icon),
    );

    // Filter valid events with a proper template mapping
    const validEvents = oldEvents.filter((event) => {
      const mapped = templateIdMap.get(event.eventTemplateId);
      return mapped && mapped !== 'remove';
    });

    // Insert event instances and return inserted rows for mapping
    const eventInstancesToInsert = [];
    for (const event of validEvents) {
      const mappedCreatorId = await mapUserId(event.creatorId);
      const resolvedIcon = await resolveIcon(event.icon, newTenant.id);
      if (!mappedCreatorId) {
        consola.warn(
          `Skipping event "${event.title}" - creator ID ${event.creatorId} not found in user mapping`,
        );
        continue;
      }

      const statusMap = {
        APPROVAL: { status: 'PENDING_REVIEW', visibility: 'HIDDEN' },
        DRAFT: { status: 'DRAFT', visibility: 'HIDDEN' },
        ORGANIZERS: { status: 'APPROVED', visibility: 'HIDDEN' },
        PUBLIC: { status: 'APPROVED', visibility: 'PUBLIC' },
      };
      eventInstancesToInsert.push({
        createdAt: DateTime.fromSQL(event.createdAt).toJSDate(),
        creatorId: mappedCreatorId,
        description: marked.parse(event.description, { async: false }),
        end: DateTime.fromSQL(event.end).toJSDate(),
        icon: resolvedIcon,
        location: event.coordinates
          ? ({
              coordinates: event.coordinates as {
                lat: number;
                lng: number;
              },
              name: event.location,
              placeId: event.googlePlaceId!,
              type: 'google',
            } as const)
          : null,
        start: DateTime.fromSQL(event.start).toJSDate(),
        ...statusMap[event.publicationState],
        templateId: templateIdMap.get(event.eventTemplateId) as string,
        tenantId: newTenant.id,
        title: event.title,
        untouchedSinceMigration: true,
      });
    }

    const newEvents = await database
      .insert(schema.eventInstances)
      .values(eventInstancesToInsert)
      .returning();

    // Build event registration options for each valid event
    const registrationOptions: InferInsertModel<
      typeof schema.eventRegistrationOptions
    >[] = [];
    for (const [index_, oldEvent] of validEvents.entries()) {
      const newEvent = newEvents[index_];
      const regStart = DateTime.fromSQL(oldEvent.registrationStart);
      const eventStart = DateTime.fromSQL(oldEvent.start);

      const participantRoleIds = [];
      const organizerRoleIds = [];

      participantRoleIds.push(
        ...(oldEvent.participantSignup
          ?.map((role) => roleMap.get(role) ?? 'remove')
          ?.filter((roleId) => roleId !== 'remove') ?? []),
      );
      organizerRoleIds.push(
        ...(oldEvent.organizerSignup
          ?.map((role) => roleMap.get(role) ?? 'remove')
          ?.filter((roleId) => roleId !== 'remove') ?? []),
      );

      let price = 0;
      if (
        typeof oldEvent.prices?.options === 'object' &&
        Array.isArray(oldEvent.prices.options)
      ) {
        const option = oldEvent.prices.options.find(
          (opt: {
            allowedStatusList: string[];
            amount: number;
            esnCardRequired: boolean;
          }) => !opt.esnCardRequired && opt.allowedStatusList.includes('NONE'),
        );
        if (option) {
          price = Math.round(option.amount * 100);
        }
      }

      // Participant option
      registrationOptions.push(
        {
          checkedInSpots: oldEvent.registrations.filter(
            (registration) => registration.checkInTime,
          ).length,
          closeRegistrationTime: eventStart.plus({ hours: 1 }).toJSDate(),
          confirmedSpots: oldEvent.registrations.filter(
            (registration) =>
              registration.type === 'PARTICIPANT' &&
              registration.status === 'SUCCESSFUL',
          ).length,
          createdAt: new Date(oldEvent.createdAt),
          eventId: newEvent.id,
          isPaid: oldEvent.registrationMode === 'STRIPE',
          openRegistrationTime: regStart.toJSDate(),
          organizingRegistration: false,
          price: price,
          registeredDescription: marked.parse(oldEvent.participantText, {
            async: false,
          }),
          registrationMode: 'fcfs',
          reservedSpots: oldEvent.registrations.filter(
            (registration) =>
              registration.type === 'PARTICIPANT' &&
              registration.status === 'PENDING',
          ).length,
          roleIds: participantRoleIds,
          spots: oldEvent.participantLimit,
          title: 'Participants',
          updatedAt: new Date(),
          waitlistSpots: 0,
        },
        {
          checkedInSpots: oldEvent.registrations.filter(
            (registration) =>
              registration.type === 'ORGANIZER' &&
              registration.status === 'SUCCESSFUL',
          ).length,
          closeRegistrationTime: eventStart.plus({ hours: 1 }).toJSDate(),
          confirmedSpots: oldEvent.registrations.filter(
            (registration) =>
              registration.type === 'ORGANIZER' &&
              registration.status === 'SUCCESSFUL',
          ).length,
          createdAt: new Date(oldEvent.createdAt),
          description: marked.parse(oldEvent.organizerText, { async: false }),
          eventId: newEvent.id,
          isPaid: false,
          openRegistrationTime: regStart.toJSDate(),
          organizingRegistration: true,
          price: 0,
          registeredDescription: undefined,
          registrationMode: 'fcfs',
          reservedSpots: 0,
          roleIds: organizerRoleIds,
          spots: oldEvent.organizerLimit ?? 1,
          title: 'Organizers',
          updatedAt: new Date(),
          waitlistSpots: 0,
        },
      );
    }

    if (registrationOptions.length > 0) {
      await database
        .insert(schema.eventRegistrationOptions)
        .values(registrationOptions);
    }
  }

  const newEventCountResult = await database
    .select({ count: count() })
    .from(schema.eventInstances)
    .where(eq(schema.eventInstances.tenantId, newTenant.id));
  const newEventCount = newEventCountResult[0].count;

  consola.info(
    `Migrated ${numberFormat.format(newEventCount)}/${numberFormat.format(oldEventCount)} events`,
  );
};
