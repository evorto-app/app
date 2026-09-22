import { describe, expect, it } from '@effect/vitest';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { tenantBrandAssetUploads } from './tenant-brand-asset-uploads';
import { tenants } from './tenants';

describe('organization image upload schema', () => {
  it('preserves ownership across organization deletion and indexes bounded due cleanup', () => {
    const config = getTableConfig(tenantBrandAssetUploads);
    const tenantKey = config.foreignKeys.find(
      (key) => key.reference().foreignTable === tenants,
    );
    expect(tenantKey?.onDelete).toBe('no action');
    expect(
      config.columns.find((column) => column.name === 'storageKey')?.isUnique,
    ).toBe(true);
    expect(
      config.columns.find((column) => column.name === 'assetUrl')?.isUnique,
    ).toBe(true);
    const dueIndex = config.indexes.find(
      (index) => index.config.name === 'tenant_brand_asset_cleanup_due_idx',
    );
    expect(
      dueIndex?.config.columns.map((column) =>
        'name' in column ? column.name : null,
      ),
    ).toEqual(['nextCleanupAt', 'id']);
    expect(dueIndex?.config.where).toBeDefined();
    expect(
      config.checks.map((check) => new PgDialect().sqlToQuery(check.value).sql),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("not in ('ready', 'attached') or"),
        expect.stringContaining("= 'attached') ="),
        expect.stringContaining('is null or'),
      ]),
    );
  });
});
