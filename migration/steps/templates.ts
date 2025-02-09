import consola from 'consola';
import {
  count,
  eq,
  InferInsertModel,
  InferSelectModel,
  sql,
} from 'drizzle-orm';
import { DateTime } from 'luxon';
import { marked } from 'marked';

import * as oldSchema from '../../old/drizzle';
import { database } from '../../src/db';
import * as schema from '../../src/db/schema';
import { transformAuthId } from '../config';
import { oldDatabase } from '../migrator-database';
import { maybeInsertIcons } from './icons';

const migrationStepSize = 1000;
const numberFormat = new Intl.NumberFormat();

export const migrateTemplates = async (
  oldTenant: InferSelectModel<typeof oldSchema.tenant>,
  newTenant: InferSelectModel<typeof schema.tenants>,
  categoryIdMap: Map<string, string>,
  roleMap: Map<string, string>,
) => {
  const oldTemplates = await oldDatabase.query.eventTemplate.findMany({
    where: eq(oldSchema.eventTemplate.tenantId, oldTenant.id),
    with: {
      eventTemplateCategory: {
        columns: {
          name: true,
        },
      },
      tumiEvents: {
        limit: 1,
      },
    },
  });
  consola.info(`Migrating ${oldTemplates.length} templates`);

  await maybeInsertIcons(newTenant.id, ...oldTemplates.map((t) => t.icon));

  const newTemplates = await database
    .insert(schema.eventTemplates)
    .values(
      oldTemplates
        .map((template) => ({
          categoryId:
            categoryIdMap.get(template.categoryId ?? 'none') ?? 'remove',
          createdAt: new Date(template.createdAt),
          description: marked.parse(template.description, { async: false }),
          icon: template.icon,
          planningTips: marked.parse(template.comment, { async: false }),
          tenantId: newTenant.id,
          title: template.title,
          untouchedSinceMigration: true,
        }))
        .filter((t) => t.categoryId !== 'remove'),
    )
    .returning();

  const templateIdMap = new Map<string, string>();
  for (const [index, oldTemplate] of oldTemplates.entries()) {
    templateIdMap.set(oldTemplate.id, newTemplates[index].id);
  }

  await database.insert(schema.templateRegistrationOptions).values(
    oldTemplates
      .flatMap((template) => {
        const eventInstance = template.tumiEvents[0];

        let participantOffset = 168;
        let organizerOffset = 168;
        const participantRoleIds = [];
        const organizerRoleIds = [];
        if (eventInstance) {
          participantOffset = Math.round(
            DateTime.fromISO(eventInstance.start).diff(
              DateTime.fromISO(eventInstance.registrationStart),
              ['hours'],
            ).hours,
          );
          organizerOffset = Math.round(
            DateTime.fromISO(eventInstance.start).diff(
              DateTime.fromISO(eventInstance.registrationStart),
              ['hours'],
            ).hours,
          );
          participantRoleIds.push(
            ...(eventInstance.participantSignup
              ?.map((role) => roleMap.get(role) ?? 'remove')
              ?.filter((roleId) => roleId !== 'remove') ?? []),
          );
          organizerRoleIds.push(
            ...(eventInstance.organizerSignup
              ?.map((role) => roleMap.get(role) ?? 'remove')
              ?.filter((roleId) => roleId !== 'remove') ?? []),
          );
        }
        let price = 0;
        if (
          typeof eventInstance?.prices?.options === 'object' &&
          Array.isArray(eventInstance.prices.options)
        ) {
          price =
            (eventInstance.prices.options.find(
              (price) =>
                !price.esnCardRequired &&
                price.allowedStatusList.includes('NONE'),
            )?.amount ?? 0) * 100;
        }
        return [
          {
            closeRegistrationOffset: 4,
            isPaid: eventInstance?.registrationMode === 'STRIPE',
            openRegistrationOffset: participantOffset,
            organizingRegistration: false,
            price,
            registeredDescription: marked.parse(template.participantText, {
              async: false,
            }),
            roleIds: participantRoleIds,
            spots: eventInstance?.participantLimit ?? 20,
            templateId: templateIdMap.get(template.id) ?? 'remove',
            title: 'Participants',
          },
          {
            closeRegistrationOffset: 1,
            description: marked.parse(template.organizerText, { async: false }),
            isPaid: false,
            openRegistrationOffset: organizerOffset,
            organizingRegistration: true,
            price: 0,
            roleIds: organizerRoleIds,
            spots: eventInstance?.organizerLimit ?? 1,
            templateId: templateIdMap.get(template.id) ?? 'remove',
            title: 'Organizers',
          },
        ];
      })
      .filter((t) => t.templateId !== 'remove'),
  );

  const newTemplateCountResult = await database
    .select({ count: count() })
    .from(schema.eventTemplates)
    .where(eq(schema.eventTemplates.tenantId, newTenant.id));
  const newTemplateCount = newTemplateCountResult[0].count;

  consola.info(
    `Migrated ${numberFormat.format(newTemplateCount)}/${numberFormat.format(oldTemplates.length)} templates`,
  );

  return templateIdMap;
};
