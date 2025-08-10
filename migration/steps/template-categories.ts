import consola from 'consola';
import { count, eq, InferSelectModel, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

import * as oldSchema from '../../old/drizzle';
import { database } from '../../src/db';
import * as schema from '../../src/db/schema';
import { resolveIcon, transformAuthId } from '../config';
import { oldDatabase } from '../migrator-database';
import { maybeInsertIcons } from './icons';

const migrationStepSize = 1000;
const numberFormat = new Intl.NumberFormat();

export const migrateTemplateCategories = async (
  oldTenant: InferSelectModel<typeof oldSchema.tenant>,
  newTenant: InferSelectModel<typeof schema.tenants>,
) => {
  const oldCategories = await oldDatabase.query.eventTemplateCategory.findMany({
    where: { tenantId: oldTenant.id },
  });
  consola.info(`Migrating ${oldCategories.length} template categories`);
  await maybeInsertIcons(newTenant.id, ...oldCategories.map((c) => c.icon));
  
  const categoryValues = await Promise.all(
    oldCategories.map(async (category) => {
      try {
        const resolvedIcon = await resolveIcon(category.icon, newTenant.id);
        return {
          createdAt: new Date(category.createdAt),
          icon: resolvedIcon,
          tenantId: newTenant.id,
          title: category.name,
        };
      } catch (error) {
        consola.warn(`Failed to resolve icon "${category.icon}" for category "${category.name}": ${error}`);
        return null;
      }
    })
  );

  const newCategories = await database
    .insert(schema.eventTemplateCategories)
    .values(categoryValues.filter((c) => c !== null))
    .returning();

  const categoryIdMap = new Map<string, string>();
  let newCategoryIndex = 0;
  for (const [oldIndex, oldCategory] of oldCategories.entries()) {
    const categoryValue = categoryValues[oldIndex];
    if (categoryValue !== null) {
      categoryIdMap.set(oldCategory.id, newCategories[newCategoryIndex].id);
      newCategoryIndex++;
    }
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
