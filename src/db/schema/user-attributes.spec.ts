import { describe, expect, it } from '@effect/vitest';
import { getViewConfig, PgDialect } from 'drizzle-orm/pg-core';

import { userAttributes } from './user-attributes';

describe('user attributes view', () => {
  it('preserves organizer counts grouped and joined by tenant and user', () => {
    const view = getViewConfig(userAttributes);

    expect(view.name).toBe('user_attributes');
    expect(Object.keys(view.selectedFields)).toEqual([
      'id',
      'organizesSome',
      'tenantId',
      'userId',
    ]);
    expect(view.query).toBeDefined();
    if (!view.query) {
      throw new Error('Expected the generated user attributes view query');
    }
    expect(new PgDialect().sqlToQuery(view.query)).toEqual({
      params: [],
      sql: 'select "users_to_tenants"."id", "organizing_registration"."optionCount", "users_to_tenants"."tenantId", "users_to_tenants"."userId" from "users_to_tenants" left join (select count("event_registration_options"."id") as "optionCount", "event_registrations"."tenantId", "event_registrations"."userId" from "event_registration_options" inner join "event_registrations" on "event_registration_options"."id" = "event_registrations"."registrationOptionId" where "event_registration_options"."organizingRegistration" = true group by "event_registrations"."tenantId", "event_registrations"."userId") "organizing_registration" on (("organizing_registration"."tenantId" = "users_to_tenants"."tenantId") and ("organizing_registration"."userId" = "users_to_tenants"."userId"))',
    });
  });
});
