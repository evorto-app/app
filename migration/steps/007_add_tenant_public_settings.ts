import consola from 'consola';
import { sql } from 'drizzle-orm';

import { database } from '../database';

export const addTenantPublicSettings = async () => {
  consola.info('Adding tenant public settings columns');

  await database.execute(sql`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS favicon_url text,
    ADD COLUMN IF NOT EXISTS logo_url text,
    ADD COLUMN IF NOT EXISTS legal_notice_url text,
    ADD COLUMN IF NOT EXISTS privacy_policy_url text,
    ADD COLUMN IF NOT EXISTS terms_url text,
    ADD COLUMN IF NOT EXISTS seo_title text,
    ADD COLUMN IF NOT EXISTS seo_description text
  `);

  consola.success('Tenant public settings columns are available');
};
