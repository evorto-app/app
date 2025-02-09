import consola from 'consola';
import { count, eq, InferSelectModel, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

import * as oldSchema from '../../old/drizzle';
import { database } from '../../src/db';
import * as schema from '../../src/db/schema';
import { transformAuthId } from '../config';
import { oldDatabase } from '../migrator-database';
import { maybeInsertIcons } from './icons';

const migrationStepSize = 1000;
const numberFormat = new Intl.NumberFormat();

export const migrateTemplateCategories = async (
  oldTenant: InferSelectModel<typeof oldSchema.tenant>,
  newTenant: InferSelectModel<typeof schema.tenants>,
) => {
  const oldCategories = await oldDatabase.query.eventTemplateCategory.findMany({
    where: eq(oldSchema.eventTemplateCategory.tenantId, oldTenant.id),
  });
  consola.info(`Migrating ${oldCategories.length} template categories`);
  await maybeInsertIcons(newTenant.id, ...oldCategories.map((c) => c.icon));
  const newCategories = await database
    .insert(schema.eventTemplateCategories)
    .values(
      oldCategories.map((category) => ({
        createdAt: new Date(category.createdAt),
        icon: category.icon,
        tenantId: newTenant.id,
        title: category.name,
      })),
    )
    .returning();

  const categoryIdMap = new Map<string, string>();
  for (const [index, oldCategory] of oldCategories.entries()) {
    categoryIdMap.set(oldCategory.id, newCategories[index].id);
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
