import consola from 'consola';
import {
  count,
  eq,
  type InferInsertModel,
  type InferSelectModel,
} from 'drizzle-orm';
import { marked } from 'marked';

import * as oldSchema from '../../old/drizzle';
import { createId } from '../../src/db/create-id';
import type { ScriptDatabaseClient } from '../../src/db/database-client';
import * as schema from '../../src/db/schema';
import { resolveIcon } from '../config';
import { legacyEventLocation } from '../legacy-event-location';
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

const numberFormat = new Intl.NumberFormat();
const POSTGRES_INTEGER_MAX = 2_147_483_647;

type TemplateInsert = InferInsertModel<typeof schema.eventTemplates>;
type TemplateOptionInsert = InferInsertModel<
  typeof schema.templateRegistrationOptions
>;
type TemplateDiscountInsert = InferInsertModel<
  typeof schema.templateRegistrationOptionDiscounts
>;

interface PreparedTemplate {
  readonly discounts: TemplateDiscountInsert[];
  readonly oldIcon: string;
  readonly oldTemplateId: string;
  readonly options: TemplateOptionInsert[];
  readonly targetTemplateId: string;
  readonly templateWithoutIcon: Omit<TemplateInsert, 'icon'>;
}

const exactOffsetHours = (
  eventStart: string,
  registrationStart: string,
  context: string,
): number => {
  const eventStartMillis = legacyTimestampDateTime(
    eventStart,
    `${context} event start`,
  ).toMillis();
  const registrationStartMillis = legacyTimestampDateTime(
    registrationStart,
    `${context} registration start`,
  ).toMillis();
  const offset = (eventStartMillis - registrationStartMillis) / 3_600_000;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > POSTGRES_INTEGER_MAX
  ) {
    throw new Error(
      `${context} has a registration offset that is not an exact whole hour; migration is blocked.`,
    );
  }
  return offset;
};

export const migrateTemplates = async (
  database: ScriptDatabaseClient,
  oldTenant: InferSelectModel<typeof oldSchema.tenant>,
  newTenant: InferSelectModel<typeof schema.tenants>,
  categoryIdMap: Map<string, string>,
  roleMap: Map<string, string>,
) => {
  const oldTemplates = await oldDatabase.query.eventTemplate.findMany({
    where: { tenantId: oldTenant.id },
    with: {
      eventTemplateCategory: {
        columns: { name: true },
      },
      tumiEvents: {
        limit: 1,
        orderBy: { start: 'desc', id: 'desc' },
      },
    },
  });
  consola.info(`Migrating ${oldTemplates.length} templates`);

  const preparedTemplates: PreparedTemplate[] = [];
  for (const template of oldTemplates) {
    const context = `Legacy template ${template.id}`;
    const categoryId = categoryIdMap.get(template.categoryId ?? 'none');
    if (!categoryId || categoryId === 'remove') {
      throw new Error(`${context} has no migrated target category.`);
    }
    const templateId = createId();
    const createdAt = legacyTimestamp(
      template.createdAt,
      `${context} createdAt`,
    );
    const options: TemplateOptionInsert[] = [];
    const discounts: TemplateDiscountInsert[] = [];
    const representativeEvent = template.tumiEvents[0];

    if (representativeEvent) {
      if (
        representativeEvent.participantSignup === null ||
        representativeEvent.organizerSignup === null
      ) {
        throw new Error(
          `${context} representative event ${representativeEvent.id} has a null signup allow-list; migration is blocked.`,
        );
      }
      const eventContext = `${context} representative event ${representativeEvent.id}`;
      assertLegacyDeregistrationSupported(
        representativeEvent.disableDeregistration,
        eventContext,
      );
      const participantRoleIds = legacySignupRoleIds(
        representativeEvent.participantSignup,
        roleMap,
        eventContext,
      );
      const organizerRoleIds = legacySignupRoleIds(
        representativeEvent.organizerSignup,
        roleMap,
        eventContext,
      );
      const participantRegistrationMode = legacyParticipantRegistrationMode({
        deferredPayment: representativeEvent.deferredPayment,
        registrationMode: representativeEvent.registrationMode,
      });

      if (participantRoleIds.length > 0) {
        const pricing = legacyRegistrationPricing(
          representativeEvent.registrationMode,
          representativeEvent.prices,
          representativeEvent.participantSignup,
        );
        const optionId = createId();
        options.push({
          ...legacyRegistrationPolicy({
            context: eventContext,
            eventSettings: representativeEvent.deRegistrationSettings,
            registrationMode: representativeEvent.registrationMode,
            registrationType: 'participants',
            tenantSettings: oldTenant.settings,
          }),
          // Legacy had no explicit close time; closing at start is the safest
          // target-template default and never broadens registration access.
          closeRegistrationOffset: 0,
          createdAt,
          id: optionId,
          isPaid: pricing.isPaid,
          openRegistrationOffset: exactOffsetHours(
            representativeEvent.start,
            representativeEvent.registrationStart,
            `${eventContext} participant`,
          ),
          organizingRegistration: false,
          price: pricing.basePriceInCents,
          registeredDescription: marked.parse(template.participantText, {
            async: false,
          }),
          registrationMode: participantRegistrationMode,
          roleIds: participantRoleIds,
          spots: representativeEvent.participantLimit,
          templateId,
          title: 'Participants',
          untouchedSinceMigration: true,
          updatedAt: createdAt,
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
        options.push({
          ...legacyRegistrationPolicy({
            context: eventContext,
            eventSettings: representativeEvent.deRegistrationSettings,
            registrationMode: representativeEvent.registrationMode,
            registrationType: 'organizers',
            tenantSettings: oldTenant.settings,
          }),
          closeRegistrationOffset: 0,
          createdAt,
          description: marked.parse(template.organizerText, { async: false }),
          id: createId(),
          isPaid: false,
          openRegistrationOffset: exactOffsetHours(
            representativeEvent.start,
            representativeEvent.organizerRegistrationStart,
            `${eventContext} organizer`,
          ),
          organizingRegistration: true,
          price: 0,
          registrationMode: 'fcfs',
          roleIds: organizerRoleIds,
          spots: representativeEvent.organizerLimit,
          templateId,
          title: 'Organizers',
          untouchedSinceMigration: true,
          updatedAt: createdAt,
        });
      }
    }

    preparedTemplates.push({
      discounts,
      oldIcon: template.icon,
      oldTemplateId: template.id,
      options,
      targetTemplateId: templateId,
      templateWithoutIcon: {
        categoryId,
        createdAt,
        description: marked.parse(template.description, { async: false }),
        id: templateId,
        location: legacyEventLocation({
          coordinates: template.coordinates,
          googlePlaceId: template.googlePlaceId,
          googlePlaceUrl: template.googlePlaceUrl,
          isVirtual: template.isVirtual,
          name: template.location,
          onlineMeetingUrl: template.onlineMeetingUrl,
        }),
        planningTips: marked.parse(template.comment, { async: false }),
        simpleModeEnabled:
          options.length === 2 &&
          options.some(
            ({ organizingRegistration }) => organizingRegistration,
          ) &&
          options.some(({ organizingRegistration }) => !organizingRegistration),
        tenantId: newTenant.id,
        title: template.title,
        untouchedSinceMigration: true,
        updatedAt: createdAt,
      },
    });
  }

  const templateIdMap = new Map(
    preparedTemplates.map(({ oldTemplateId, targetTemplateId }) => [
      oldTemplateId,
      targetTemplateId,
    ]),
  );
  if (preparedTemplates.length > 0) {
    await maybeInsertIcons(
      database,
      newTenant.id,
      ...preparedTemplates.map(({ oldIcon }) => oldIcon),
    );
    const templateValues: TemplateInsert[] = [];
    for (const prepared of preparedTemplates) {
      templateValues.push({
        ...prepared.templateWithoutIcon,
        icon: await resolveIcon(database, prepared.oldIcon, newTenant.id),
      });
    }
    const optionValues = preparedTemplates.flatMap(({ options }) => options);
    const discountValues = preparedTemplates.flatMap(
      ({ discounts }) => discounts,
    );
    await database.transaction(async (transaction) => {
      await transaction.insert(schema.eventTemplates).values(templateValues);
      if (optionValues.length > 0) {
        await transaction
          .insert(schema.templateRegistrationOptions)
          .values(optionValues);
      }
      if (discountValues.length > 0) {
        await transaction
          .insert(schema.templateRegistrationOptionDiscounts)
          .values(discountValues);
      }
    });
  }

  const newTemplateCountResult = await database
    .select({ count: count() })
    .from(schema.eventTemplates)
    .where(eq(schema.eventTemplates.tenantId, newTenant.id));
  const newTemplateCount = newTemplateCountResult[0]?.count ?? 0;
  consola.info(
    `Migrated ${numberFormat.format(newTemplateCount)}/${numberFormat.format(oldTemplates.length)} templates`,
  );
  return templateIdMap;
};
