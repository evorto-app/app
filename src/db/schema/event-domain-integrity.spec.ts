import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  eventInstances,
  eventReviewLifecycleCheckName,
  eventTemplateTenantForeignKeyName,
  eventTimeOrderCheckName,
} from './event-instances';
import {
  eventRegistrationOptionCapacityCheckName,
  eventRegistrationOptionPriceCheckName,
  eventRegistrationOptions,
  eventRegistrationOptionsEventIndexName,
  eventRegistrationOptionTimeOrderCheckName,
} from './event-registration-options';
import {
  eventTemplateCategoryTenantForeignKeyName,
  eventTemplates,
} from './event-templates';

const dialect = new PgDialect();

const checkSql = (
  table: Parameters<typeof getTableConfig>[0],
  name: string,
): string => {
  const constraint = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name,
  );
  if (!constraint) {
    throw new Error(`Missing check constraint: ${name}`);
  }
  return dialect.sqlToQuery(constraint.value).sql;
};

describe('event domain persistence', () => {
  it('binds templates and events to one tenant owner tuple', () => {
    expect(
      getTableConfig(eventTemplates).foreignKeys.map((foreignKey) =>
        foreignKey.getName(),
      ),
    ).toContain(eventTemplateCategoryTenantForeignKeyName);
    expect(
      getTableConfig(eventInstances).foreignKeys.map((foreignKey) =>
        foreignKey.getName(),
      ),
    ).toContain(eventTemplateTenantForeignKeyName);
  });

  it('requires ordered event times and explicit review lifecycle state', () => {
    expect(checkSql(eventInstances, eventTimeOrderCheckName)).toContain(
      '"event_instances"."start" < "event_instances"."end"',
    );
    const reviewSql = checkSql(eventInstances, eventReviewLifecycleCheckName);
    expect(reviewSql).toContain(`"event_instances"."status" = 'APPROVED'`);
    expect(reviewSql).toContain('"event_instances"."reviewedAt" IS NOT NULL');
    expect(reviewSql).toContain(
      `"event_instances"."status" = 'PENDING_REVIEW'`,
    );
  });

  it('bounds option counters, price state, and registration windows', () => {
    const capacitySql = checkSql(
      eventRegistrationOptions,
      eventRegistrationOptionCapacityCheckName,
    );
    expect(capacitySql).toContain(
      '"event_registration_options"."confirmedSpots" + "event_registration_options"."reservedSpots" <= "event_registration_options"."spots"',
    );
    expect(capacitySql).toContain(
      '"event_registration_options"."checkedInSpots" <= "event_registration_options"."confirmedSpots"',
    );
    expect(
      checkSql(eventRegistrationOptions, eventRegistrationOptionPriceCheckName),
    ).toContain(
      'NOT "event_registration_options"."isPaid" AND "event_registration_options"."price" = 0',
    );
    expect(
      checkSql(
        eventRegistrationOptions,
        eventRegistrationOptionTimeOrderCheckName,
      ),
    ).toContain(
      '"event_registration_options"."openRegistrationTime" <= "event_registration_options"."closeRegistrationTime"',
    );
  });

  it('indexes event option discovery by event', () => {
    const eventIndex = getTableConfig(eventRegistrationOptions).indexes.find(
      (candidate) =>
        candidate.config.name === eventRegistrationOptionsEventIndexName,
    );

    expect(eventIndex?.config.columns.map((column) => column.name)).toEqual([
      'eventId',
    ]);
  });
});
