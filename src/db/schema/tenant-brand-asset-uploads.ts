import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { modelOfTenant } from './model';

export const tenantBrandAssetKind = pgEnum('tenant_brand_asset_kind', [
  'logo',
  'favicon',
]);
export const tenantBrandAssetStatus = pgEnum('tenant_brand_asset_status', [
  'uploading',
  'ready',
  'attached',
  'cleaning',
]);

/** Unknown PUT outcomes remain owned until a later cleanup observes known settlement. */
export const tenantBrandAssetUploads = pgTable(
  'tenant_brand_asset_uploads',
  {
    ...modelOfTenant,
    assetUrl: text().notNull().unique(),
    cleanupClaimToken: text(),
    expiresAt: timestamp().notNull(),
    kind: tenantBrandAssetKind().notNull(),
    nextCleanupAt: timestamp(),
    putSucceededAt: timestamp(),
    status: tenantBrandAssetStatus().notNull().default('uploading'),
    storageKey: text().notNull().unique(),
  },
  (table) => [
    index('tenant_brand_asset_cleanup_due_idx')
      .on(table.nextCleanupAt, table.id)
      .where(sql`${table.nextCleanupAt} is not null`),
    index('tenant_brand_asset_tenant_idx').on(table.tenantId),
    check(
      'tenant_brand_asset_settlement',
      sql`${table.status} not in ('ready', 'attached') or ${table.putSucceededAt} is not null`,
    ),
    check(
      'tenant_brand_asset_cleanup_schedule',
      sql`(${table.status} = 'attached') = (${table.nextCleanupAt} is null)`,
    ),
    check(
      'tenant_brand_asset_cleanup_claim',
      sql`${table.cleanupClaimToken} is null or ${table.status} = 'cleaning'`,
    ),
  ],
);
