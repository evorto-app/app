import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@effect/vitest';
import { DrizzleQueryError, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { createNodePgPoolConfig } from '../pg-connection-config';
import { relations } from '../relations';
import {
  eventDiscountOptionOwnerForeignKeyName,
  eventDiscountOptionTypeUniqueConstraintName,
  eventDiscountPriceNonnegativeCheckName,
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventTemplateCategories,
  eventTemplates,
  templateDiscountOptionOwnerForeignKeyName,
  templateDiscountOptionTypeUniqueConstraintName,
  templateDiscountPriceNonnegativeCheckName,
  templateRegistrationOptionDiscounts,
  templateRegistrationOptions,
  tenants,
  users,
} from './index';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

interface DiscountIntegrityFixture {
  categoryIds: readonly [string, string];
  eventIds: readonly [string, string, string];
  eventOptionIds: readonly [string, string, string];
  templateIds: readonly [string, string, string];
  templateOptionIds: readonly [string, string, string];
  tenantIds: readonly [string, string];
  userIds: readonly [string, string];
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeFixture = (): DiscountIntegrityFixture => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6);
  const pair = (prefix: string): readonly [string, string] => [
    `${prefix}-a-${suffix}`,
    `${prefix}-b-${suffix}`,
  ];
  const triple = (prefix: string): readonly [string, string, string] => [
    `${prefix}-a-${suffix}`,
    `${prefix}-b-${suffix}`,
    `${prefix}-c-${suffix}`,
  ];

  return {
    categoryIds: pair('cat'),
    eventIds: triple('event'),
    eventOptionIds: triple('eoption'),
    templateIds: triple('template'),
    templateOptionIds: triple('toption'),
    tenantIds: pair('tenant'),
    userIds: pair('user'),
  };
};

const seedFixture = async (
  database: TestDatabase,
  fixture: DiscountIntegrityFixture,
) => {
  const now = Date.now();
  const tenantIndexByOwner = [0, 0, 1] as const;

  await database.insert(tenants).values(
    fixture.tenantIds.map((tenantId, index) => ({
      domain: `${tenantId}.discount-integrity.example`,
      id: tenantId,
      name: `Discount integrity tenant ${index + 1}`,
    })),
  );
  await database.insert(users).values(
    fixture.userIds.map((userId, index) => ({
      auth0Id: `discount-integrity|${userId}`,
      communicationEmail: `${userId}@example.com`,
      email: `${userId}@example.com`,
      firstName: `Discount ${index + 1}`,
      id: userId,
      lastName: 'Integrity',
    })),
  );
  await database.insert(eventTemplateCategories).values(
    fixture.categoryIds.map((categoryId, index) => ({
      icon: { iconColor: 0, iconName: 'circle' },
      id: categoryId,
      tenantId: fixture.tenantIds[index],
      title: `Discount category ${index + 1}`,
    })),
  );
  await database.insert(eventTemplates).values(
    fixture.templateIds.map((templateId, index) => {
      const tenantIndex = tenantIndexByOwner[index];
      return {
        categoryId: fixture.categoryIds[tenantIndex],
        description: 'Discount integrity fixture',
        icon: { iconColor: 0, iconName: 'circle' },
        id: templateId,
        listingAudience: 'both',
        tenantId: fixture.tenantIds[tenantIndex],
        title: `Discount template ${index + 1}`,
      };
    }),
  );
  await database.insert(templateRegistrationOptions).values(
    fixture.templateOptionIds.map((optionId, index) => ({
      closeRegistrationOffset: 0,
      id: optionId,
      isPaid: true,
      openRegistrationOffset: 0,
      organizingRegistration: false,
      price: 1000,
      registrationMode: 'fcfs' as const,
      spots: 10,
      templateId: fixture.templateIds[index],
      title: `Template option ${index + 1}`,
    })),
  );
  await database.insert(eventInstances).values(
    fixture.eventIds.map((eventId, index) => {
      const tenantIndex = tenantIndexByOwner[index];
      return {
        creatorId: fixture.userIds[tenantIndex],
        description: 'Discount integrity fixture',
        end: new Date(now + 2 * 24 * 60 * 60 * 1000),
        icon: { iconColor: 0, iconName: 'circle' },
        id: eventId,
        listingAudience: 'both',
        start: new Date(now + 24 * 60 * 60 * 1000),
        templateId: fixture.templateIds[index],
        tenantId: fixture.tenantIds[tenantIndex],
        title: `Discount event ${index + 1}`,
      };
    }),
  );
  await database.insert(eventRegistrationOptions).values(
    fixture.eventOptionIds.map((optionId, index) => ({
      closeRegistrationTime: new Date(now + 12 * 60 * 60 * 1000),
      eventId: fixture.eventIds[index],
      id: optionId,
      isPaid: true,
      openRegistrationTime: new Date(now - 60 * 60 * 1000),
      organizingRegistration: false,
      price: 1000,
      registrationMode: 'fcfs' as const,
      spots: 10,
      title: `Event option ${index + 1}`,
    })),
  );
};

const cleanDiscounts = async (
  database: TestDatabase,
  fixture: DiscountIntegrityFixture,
) => {
  await database
    .delete(eventRegistrationOptionDiscounts)
    .where(inArray(eventRegistrationOptionDiscounts.eventId, fixture.eventIds));
  await database
    .delete(templateRegistrationOptionDiscounts)
    .where(
      inArray(
        templateRegistrationOptionDiscounts.templateId,
        fixture.templateIds,
      ),
    );
};

const cleanFixture = async (
  database: TestDatabase,
  fixture: DiscountIntegrityFixture,
) => {
  await cleanDiscounts(database, fixture);
  await database
    .delete(eventRegistrationOptions)
    .where(inArray(eventRegistrationOptions.id, fixture.eventOptionIds));
  await database
    .delete(eventInstances)
    .where(inArray(eventInstances.id, fixture.eventIds));
  await database
    .delete(templateRegistrationOptions)
    .where(inArray(templateRegistrationOptions.id, fixture.templateOptionIds));
  await database
    .delete(eventTemplates)
    .where(inArray(eventTemplates.id, fixture.templateIds));
  await database
    .delete(eventTemplateCategories)
    .where(inArray(eventTemplateCategories.id, fixture.categoryIds));
  await database.delete(users).where(inArray(users.id, fixture.userIds));
  await database.delete(tenants).where(inArray(tenants.id, fixture.tenantIds));
};

const expectConstraintViolation = async (
  operation: PromiseLike<unknown>,
  code: '23503' | '23505' | '23514',
  constraint: string,
) => {
  try {
    await operation;
    throw new Error(`Expected constraint ${constraint} to reject`);
  } catch (error) {
    expect(error).toBeInstanceOf(DrizzleQueryError);
    if (!(error instanceof DrizzleQueryError)) {
      throw error;
    }

    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause).toHaveProperty('code', code);
    expect(error.cause).toHaveProperty('constraint', constraint);
  }
};

describe('registration option discount integrity in PostgreSQL', () => {
  let database: TestDatabase;
  const fixture = makeFixture();
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
    await seedFixture(database, fixture);
  });

  beforeEach(async () => {
    await cleanDiscounts(database, fixture);
  });

  afterAll(async () => {
    await cleanFixture(database, fixture);
    await pool.end();
  });

  it('accepts discounts whose option and owner belong together in each tenant', async () => {
    await expect(
      database.insert(templateRegistrationOptionDiscounts).values([
        {
          discountedPrice: 500,
          discountType: 'esnCard',
          registrationOptionId: fixture.templateOptionIds[0],
          templateId: fixture.templateIds[0],
        },
        {
          discountedPrice: 600,
          discountType: 'esnCard',
          registrationOptionId: fixture.templateOptionIds[2],
          templateId: fixture.templateIds[2],
        },
      ]),
    ).resolves.toBeDefined();
    await expect(
      database.insert(eventRegistrationOptionDiscounts).values([
        {
          discountedPrice: 500,
          discountType: 'esnCard',
          eventId: fixture.eventIds[0],
          registrationOptionId: fixture.eventOptionIds[0],
        },
        {
          discountedPrice: 600,
          discountType: 'esnCard',
          eventId: fixture.eventIds[2],
          registrationOptionId: fixture.eventOptionIds[2],
        },
      ]),
    ).resolves.toBeDefined();
  });

  it('rejects same-tenant and cross-tenant template owner mismatches', async () => {
    await expectConstraintViolation(
      database.insert(templateRegistrationOptionDiscounts).values({
        discountedPrice: 500,
        discountType: 'esnCard',
        registrationOptionId: fixture.templateOptionIds[0],
        templateId: fixture.templateIds[1],
      }),
      '23503',
      templateDiscountOptionOwnerForeignKeyName,
    );
    await expectConstraintViolation(
      database.insert(templateRegistrationOptionDiscounts).values({
        discountedPrice: 500,
        discountType: 'esnCard',
        registrationOptionId: fixture.templateOptionIds[0],
        templateId: fixture.templateIds[2],
      }),
      '23503',
      templateDiscountOptionOwnerForeignKeyName,
    );
  });

  it('rejects same-tenant and cross-tenant event owner mismatches', async () => {
    await expectConstraintViolation(
      database.insert(eventRegistrationOptionDiscounts).values({
        discountedPrice: 500,
        discountType: 'esnCard',
        eventId: fixture.eventIds[1],
        registrationOptionId: fixture.eventOptionIds[0],
      }),
      '23503',
      eventDiscountOptionOwnerForeignKeyName,
    );
    await expectConstraintViolation(
      database.insert(eventRegistrationOptionDiscounts).values({
        discountedPrice: 500,
        discountType: 'esnCard',
        eventId: fixture.eventIds[2],
        registrationOptionId: fixture.eventOptionIds[0],
      }),
      '23503',
      eventDiscountOptionOwnerForeignKeyName,
    );
  });

  it('rejects duplicate discount types for an option', async () => {
    const templateDiscount = {
      discountedPrice: 500,
      discountType: 'esnCard',
      registrationOptionId: fixture.templateOptionIds[0],
      templateId: fixture.templateIds[0],
    } as const;
    const eventDiscount = {
      discountedPrice: 500,
      discountType: 'esnCard',
      eventId: fixture.eventIds[0],
      registrationOptionId: fixture.eventOptionIds[0],
    } as const;

    await database
      .insert(templateRegistrationOptionDiscounts)
      .values(templateDiscount);
    await expectConstraintViolation(
      database
        .insert(templateRegistrationOptionDiscounts)
        .values(templateDiscount),
      '23505',
      templateDiscountOptionTypeUniqueConstraintName,
    );
    await database
      .insert(eventRegistrationOptionDiscounts)
      .values(eventDiscount);
    await expectConstraintViolation(
      database.insert(eventRegistrationOptionDiscounts).values(eventDiscount),
      '23505',
      eventDiscountOptionTypeUniqueConstraintName,
    );
  });

  it('rejects negative discounted prices', async () => {
    await expectConstraintViolation(
      database.insert(templateRegistrationOptionDiscounts).values({
        discountedPrice: -1,
        discountType: 'esnCard',
        registrationOptionId: fixture.templateOptionIds[0],
        templateId: fixture.templateIds[0],
      }),
      '23514',
      templateDiscountPriceNonnegativeCheckName,
    );
    await expectConstraintViolation(
      database.insert(eventRegistrationOptionDiscounts).values({
        discountedPrice: -1,
        discountType: 'esnCard',
        eventId: fixture.eventIds[0],
        registrationOptionId: fixture.eventOptionIds[0],
      }),
      '23514',
      eventDiscountPriceNonnegativeCheckName,
    );
  });
});
