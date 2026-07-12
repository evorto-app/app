import type { DatabaseClient } from '@db/index';

import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { and, eq, gt, or } from 'drizzle-orm';
import { Effect } from 'effect';

import {
  eventAddons,
  eventInstances,
  eventRegistrationOptions,
  eventTemplates,
  templateEventAddons,
  templateRegistrationOptions,
} from '../../db/schema';
import { lockTenantStripeAccount } from './pending-stripe-obligations';

interface PaidConfigurationItem {
  readonly isPaid: boolean;
  readonly price: number;
}

export const eventConfigurationHasPaidItems = ({
  addOns,
  registrationOptions,
}: {
  readonly addOns: readonly PaidConfigurationItem[];
  readonly registrationOptions: readonly PaidConfigurationItem[];
}): boolean =>
  [...registrationOptions, ...addOns].some(
    (item) => item.isPaid || item.price > 0,
  );

export const stripeRequiredForPaidEventConfigurationError = () =>
  new RpcBadRequestError({
    message:
      'Connect Stripe before configuring paid registration options or add-ons',
    reason: 'stripeRequiredForPaidEventConfiguration',
  });

export const stripeAccountRemovalBlockedByPaidConfigurationErrorDetails = {
  message: 'Stripe account cannot change while paid event configuration exists',
  reason:
    'Make every event and template registration option and add-on free before changing the connected Stripe account.',
} as const;

export const paidEventConfigurationPredicates = (tenantId: string) => ({
  eventAddon: and(
    eq(eventInstances.tenantId, tenantId),
    or(eq(eventAddons.isPaid, true), gt(eventAddons.price, 0)),
  ),
  eventRegistrationOption: and(
    eq(eventInstances.tenantId, tenantId),
    or(
      eq(eventRegistrationOptions.isPaid, true),
      gt(eventRegistrationOptions.price, 0),
    ),
  ),
  templateAddon: and(
    eq(eventTemplates.tenantId, tenantId),
    or(eq(templateEventAddons.isPaid, true), gt(templateEventAddons.price, 0)),
  ),
  templateRegistrationOption: and(
    eq(eventTemplates.tenantId, tenantId),
    or(
      eq(templateRegistrationOptions.isPaid, true),
      gt(templateRegistrationOptions.price, 0),
    ),
  ),
});

export const ensureStripeForPaidEventConfiguration = Effect.fn(
  'ensureStripeForPaidEventConfiguration',
)(function* (
  database: Pick<DatabaseClient, 'select'>,
  tenantId: string,
  configuration: {
    readonly addOns: readonly PaidConfigurationItem[];
    readonly registrationOptions: readonly PaidConfigurationItem[];
  },
) {
  if (!eventConfigurationHasPaidItems(configuration)) return;

  const stripeAccountId = yield* lockTenantStripeAccount(
    database,
    tenantId,
  ).pipe(Effect.orDie);
  if (!stripeAccountId) {
    return yield* Effect.fail(stripeRequiredForPaidEventConfigurationError());
  }
});

const eventHasPaidConfiguration = Effect.fn('eventHasPaidConfiguration')(
  function* (database: Pick<DatabaseClient, 'select'>, eventId: string) {
    const paidRegistrationOptions = yield* database
      .select({ id: eventRegistrationOptions.id })
      .from(eventRegistrationOptions)
      .where(
        and(
          eq(eventRegistrationOptions.eventId, eventId),
          or(
            eq(eventRegistrationOptions.isPaid, true),
            gt(eventRegistrationOptions.price, 0),
          ),
        ),
      )
      .limit(1)
      .pipe(Effect.orDie);
    if (paidRegistrationOptions.length > 0) return true;

    const paidAddOns = yield* database
      .select({ id: eventAddons.id })
      .from(eventAddons)
      .where(
        and(
          eq(eventAddons.eventId, eventId),
          or(eq(eventAddons.isPaid, true), gt(eventAddons.price, 0)),
        ),
      )
      .limit(1)
      .pipe(Effect.orDie);

    return paidAddOns.length > 0;
  },
);

export const ensureStripeForStoredEventConfiguration = Effect.fn(
  'ensureStripeForStoredEventConfiguration',
)(function* (
  database: Pick<DatabaseClient, 'select'>,
  tenantId: string,
  eventId: string,
) {
  const stripeAccountId = yield* lockTenantStripeAccount(
    database,
    tenantId,
  ).pipe(Effect.orDie);
  if (stripeAccountId) return;

  const scopedEvent = yield* database
    .select({ id: eventInstances.id })
    .from(eventInstances)
    .where(
      and(
        eq(eventInstances.id, eventId),
        eq(eventInstances.tenantId, tenantId),
      ),
    )
    .for('update')
    .pipe(Effect.orDie);
  const lockedEvent = scopedEvent[0];
  if (!lockedEvent) return;

  if (yield* eventHasPaidConfiguration(database, lockedEvent.id)) {
    return yield* Effect.fail(stripeRequiredForPaidEventConfigurationError());
  }
});

/**
 * A tenant may disconnect Stripe only after every event and template price is
 * free. Call this after locking the tenant row so paid configuration writes
 * and account removal share the same serialization boundary.
 */
export const tenantHasPaidEventConfiguration = Effect.fn(
  'tenantHasPaidEventConfiguration',
)(function* (database: Pick<DatabaseClient, 'select'>, tenantId: string) {
  const predicates = paidEventConfigurationPredicates(tenantId);
  const eventRegistrationOption = yield* database
    .select({ id: eventRegistrationOptions.id })
    .from(eventRegistrationOptions)
    .innerJoin(
      eventInstances,
      eq(eventInstances.id, eventRegistrationOptions.eventId),
    )
    .where(predicates.eventRegistrationOption)
    .limit(1)
    .pipe(Effect.orDie);
  if (eventRegistrationOption.length > 0) return true;

  const eventAddon = yield* database
    .select({ id: eventAddons.id })
    .from(eventAddons)
    .innerJoin(eventInstances, eq(eventInstances.id, eventAddons.eventId))
    .where(predicates.eventAddon)
    .limit(1)
    .pipe(Effect.orDie);
  if (eventAddon.length > 0) return true;

  const templateRegistrationOption = yield* database
    .select({ id: templateRegistrationOptions.id })
    .from(templateRegistrationOptions)
    .innerJoin(
      eventTemplates,
      eq(eventTemplates.id, templateRegistrationOptions.templateId),
    )
    .where(predicates.templateRegistrationOption)
    .limit(1)
    .pipe(Effect.orDie);
  if (templateRegistrationOption.length > 0) return true;

  const templateAddon = yield* database
    .select({ id: templateEventAddons.id })
    .from(templateEventAddons)
    .innerJoin(
      eventTemplates,
      eq(eventTemplates.id, templateEventAddons.templateId),
    )
    .where(predicates.templateAddon)
    .limit(1)
    .pipe(Effect.orDie);

  return templateAddon.length > 0;
});
