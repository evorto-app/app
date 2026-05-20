import consola from 'consola';
import { sql } from 'drizzle-orm';

import { database } from '../database';

export const addTenantLegalTextFields = async () => {
  consola.info('Adding tenant legal text fields');

  await database.execute(sql`
    ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS legal_notice_text text,
    ADD COLUMN IF NOT EXISTS privacy_policy_text text,
    ADD COLUMN IF NOT EXISTS terms_text text
  `);

  consola.success('Tenant legal text fields are available');
};
