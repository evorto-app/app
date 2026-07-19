import { describe, expect, it } from '@effect/vitest';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { eventRegistrationAddonFulfillmentEvents } from './event-registration-addon-fulfillment-events';

const checkSql = (name: string): string => {
  const constraint = getTableConfig(
    eventRegistrationAddonFulfillmentEvents,
  ).checks.find((check) => check.name === name);
  expect(constraint).toBeDefined();
  if (!constraint) {
    throw new Error(`Expected ${name} check`);
  }
  return new PgDialect()
    .sqlToQuery(constraint.value)
    .sql.replaceAll(/\s+/g, ' ');
};

describe('event registration add-on fulfillment event schema', () => {
  it('requires a non-user actor subject', () => {
    expect(
      checkSql('event_registration_addon_fulfillment_event_actor_shape'),
    ).toContain(
      '"event_registration_addon_fulfillment_events"."actor_subject" IS NOT NULL AND length(trim("event_registration_addon_fulfillment_events"."actor_subject")) BETWEEN 1 AND 100',
    );
  });

  it('requires a cancellation reason', () => {
    expect(
      checkSql('event_registration_addon_fulfillment_event_shape'),
    ).toContain(
      '"event_registration_addon_fulfillment_events"."reason" IS NOT NULL AND length(trim("event_registration_addon_fulfillment_events"."reason")) BETWEEN 1 AND 500',
    );
  });
});
