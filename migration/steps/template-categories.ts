import consola from 'consola';
import {
  count,
  eq,
  type InferInsertModel,
  type InferSelectModel,
} from 'drizzle-orm';

import * as oldSchema from '../../old/drizzle';
import { createId } from '../../src/db/create-id';
import type { ScriptDatabaseClient } from '../../src/db/database-client';
import * as schema from '../../src/db/schema';
import { resolveIcon } from '../config';
import { legacyTimestamp } from '../legacy-timestamp';
import { oldDatabase } from '../migrator-database';
import { maybeInsertIcons } from './icons';

const numberFormat = new Intl.NumberFormat();

export const migrateTemplateCategories = async (
  database: ScriptDatabaseClient,
  oldTenant: InferSelectModel<typeof oldSchema.tenant>,
  newTenant: InferSelectModel<typeof schema.tenants>,
) => {
  const oldCategories = await oldDatabase.query.eventTemplateCategory.findMany({
    where: { tenantId: oldTenant.id },
  });
  consola.info(`Migrating ${oldCategories.length} template categories`);
  await maybeInsertIcons(
    database,
    newTenant.id,
    ...oldCategories.map((category) => category.icon),
  );

  const categoryIdMap = new Map<string, string>();
  const categoryValues: InferInsertModel<
    typeof schema.eventTemplateCategories
  >[] = [];
  for (const category of oldCategories) {
    const id = createId();
    const resolvedIcon = await resolveIcon(
      database,
      category.icon,
      newTenant.id,
    );
    categoryValues.push({
      createdAt: legacyTimestamp(
        category.createdAt,
        `Legacy template category ${category.id} createdAt`,
      ),
      icon: resolvedIcon,
      id,
      tenantId: newTenant.id,
      title: category.name,
    });
    categoryIdMap.set(category.id, id);
  }
  if (categoryValues.length > 0) {
    await database
      .insert(schema.eventTemplateCategories)
      .values(categoryValues);
  }

  const newTemplateCategoryCountResult = await database
    .select({ count: count() })
    .from(schema.eventTemplateCategories)
    .where(eq(schema.eventTemplateCategories.tenantId, newTenant.id));
  const newTemplateCategoryCount = newTemplateCategoryCountResult[0].count;

  consola.success(
    `Migrated ${numberFormat.format(newTemplateCategoryCount)}/${numberFormat.format(oldCategories.length)} template categories`,
  );

  return categoryIdMap;
};
