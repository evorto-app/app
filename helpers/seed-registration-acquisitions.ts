import {
  and,
  eq,
  gt,
  type InferInsertModel,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { alias } from 'drizzle-orm/pg-core';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import type { SupportedTenantCurrency } from '../src/types/custom/tenant';
import { getId } from './get-id';

type SeedDatabase = NodePgDatabase<typeof relations>;

/** A free CONFIRMED registration that needs its initial acquisition epoch. */
export interface FreeSeedRegistrationAcquisitionInput {
  acquiredAt: Date;
  currency: SupportedTenantCurrency;
  eventId: string;
  guestCount: number;
  ownerUserId: string;
  registrationId: string;
  tenantId: string;
}

export interface FreeSeedRegistrationAcquisitionRows {
  acquisition: InferInsertModel<typeof schema.registrationAcquisitions> & {
    id: string;
  };
  component: InferInsertModel<typeof schema.registrationAcquisitionComponents>;
}

/** Builds the initial acquisition and its zero-value registration component. */
export const buildFreeSeedRegistrationAcquisition = (
  input: FreeSeedRegistrationAcquisitionInput,
): FreeSeedRegistrationAcquisitionRows => {
  const acquisitionId = getId();
  const spotCount = input.guestCount + 1;
  return {
    acquisition: {
      acquiredAt: input.acquiredAt,
      eventId: input.eventId,
      id: acquisitionId,
      kind: 'initial',
      operationKey: `seed:${input.registrationId}`,
      ordinal: 0,
      ownerUserId: input.ownerUserId,
      registrationId: input.registrationId,
      spotCount,
      tenantId: input.tenantId,
    },
    component: {
      acquiredAt: input.acquiredAt,
      acquisitionId,
      allocationKey: 'registration',
      applicationFeeAmount: 0,
      baseAmount: 0,
      currency: input.currency,
      eventId: input.eventId,
      grossAmount: 0,
      kind: 'registration',
      netAmount: 0,
      quantity: spotCount,
      registrationId: input.registrationId,
      stripeFeeAmount: 0,
      taxAmount: 0,
      tenantId: input.tenantId,
    },
  };
};

/**
 * Inserts the initial acquisition history for seeded free registrations.
 *
 * Seeded registrations are free (paid ones go through the real Stripe flow,
 * see the comment at the top of add-registrations.ts), so there is no
 * transaction to attach and no payment rows are written.
 */
export const insertFreeSeedRegistrationAcquisitions = async (
  database: Pick<SeedDatabase, 'insert'>,
  inputs: readonly FreeSeedRegistrationAcquisitionInput[],
) => {
  if (inputs.length === 0) return;
  const rows = inputs.map((input) =>
    buildFreeSeedRegistrationAcquisition(input),
  );
  await database
    .insert(schema.registrationAcquisitions)
    .values(rows.map((row) => row.acquisition));
  await database
    .insert(schema.registrationAcquisitionComponents)
    .values(rows.map((row) => row.component));
};

/**
 * CONFIRMED registrations of a tenant whose current acquisition (highest
 * ordinal) is missing or owned by someone other than the registration's user.
 */
export const findConfirmedRegistrationsWithoutCurrentAcquisition = async (
  database: Pick<SeedDatabase, 'select'>,
  tenantId: string,
): Promise<
  {
    currentOwnerUserId: null | string;
    registrationId: string;
    userId: string;
  }[]
> => {
  const current = alias(
    schema.registrationAcquisitions,
    'current_registration_acquisition',
  );
  const newer = alias(
    schema.registrationAcquisitions,
    'newer_registration_acquisition',
  );
  return database
    .select({
      currentOwnerUserId: current.ownerUserId,
      registrationId: schema.eventRegistrations.id,
      userId: schema.eventRegistrations.userId,
    })
    .from(schema.eventRegistrations)
    .leftJoin(
      current,
      and(
        eq(current.tenantId, schema.eventRegistrations.tenantId),
        eq(current.registrationId, schema.eventRegistrations.id),
        notExists(
          database
            .select({ one: sql`1` })
            .from(newer)
            .where(
              and(
                eq(newer.tenantId, current.tenantId),
                eq(newer.registrationId, current.registrationId),
                gt(newer.ordinal, current.ordinal),
              ),
            ),
        ),
      ),
    )
    .where(
      and(
        eq(schema.eventRegistrations.tenantId, tenantId),
        eq(schema.eventRegistrations.status, 'CONFIRMED'),
        or(
          isNull(current.id),
          ne(current.ownerUserId, schema.eventRegistrations.userId),
        ),
      ),
    )
    .orderBy(schema.eventRegistrations.id);
};

/** Fails loudly when a seeded CONFIRMED registration cannot be cancelled. */
export const assertSeededRegistrationAcquisitions = async (
  database: Pick<SeedDatabase, 'select'>,
  tenantId: string,
) => {
  const missing = await findConfirmedRegistrationsWithoutCurrentAcquisition(
    database,
    tenantId,
  );
  if (missing.length === 0) return;
  const sample = missing
    .slice(0, 5)
    .map((row) => row.registrationId)
    .join(', ');
  throw new Error(
    `Seed left ${missing.length} CONFIRMED registration(s) of tenant ${tenantId} without a current acquisition owned by the registered user (first: ${sample})`,
  );
};
