import type { DatabaseClient } from '@db/index';

import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { and, eq, gt, isNotNull, or } from 'drizzle-orm';
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
}): boolean => [...registrationOptions, ...addOns].some((item) => item.isPaid);

export const stripeRequiredForPaidEventConfigurationError = () =>
  new RpcBadRequestError({
    message:
      'Paid sign-ups are not available for this organization yet. Contact Evorto support before adding prices, then try again.',
    reason: 'paymentSetupRequired',
  });

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

/** Checks whether the organization already has stored paid configuration. */
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

/** Checks whether the organization already has stored tax-rate assignments. */
export const tenantHasStripeTaxRateConfiguration = Effect.fn(
  'tenantHasStripeTaxRateConfiguration',
)(function* (database: Pick<DatabaseClient, 'select'>, tenantId: string) {
  const eventRegistrationOption = yield* database
    .select({ stripeTaxRateId: eventRegistrationOptions.stripeTaxRateId })
    .from(eventRegistrationOptions)
    .innerJoin(
      eventInstances,
      eq(eventInstances.id, eventRegistrationOptions.eventId),
    )
    .where(
      and(
        eq(eventInstances.tenantId, tenantId),
        isNotNull(eventRegistrationOptions.stripeTaxRateId),
      ),
    )
    .limit(1)
    .pipe(Effect.orDie);
  if (eventRegistrationOption.length > 0) return true;

  const eventAddon = yield* database
    .select({ stripeTaxRateId: eventAddons.stripeTaxRateId })
    .from(eventAddons)
    .innerJoin(eventInstances, eq(eventInstances.id, eventAddons.eventId))
    .where(
      and(
        eq(eventInstances.tenantId, tenantId),
        isNotNull(eventAddons.stripeTaxRateId),
      ),
    )
    .limit(1)
    .pipe(Effect.orDie);
  if (eventAddon.length > 0) return true;

  const templateRegistrationOption = yield* database
    .select({
      stripeTaxRateId: templateRegistrationOptions.stripeTaxRateId,
    })
    .from(templateRegistrationOptions)
    .innerJoin(
      eventTemplates,
      eq(eventTemplates.id, templateRegistrationOptions.templateId),
    )
    .where(
      and(
        eq(eventTemplates.tenantId, tenantId),
        isNotNull(templateRegistrationOptions.stripeTaxRateId),
      ),
    )
    .limit(1)
    .pipe(Effect.orDie);
  if (templateRegistrationOption.length > 0) return true;

  const templateAddon = yield* database
    .select({ stripeTaxRateId: templateEventAddons.stripeTaxRateId })
    .from(templateEventAddons)
    .innerJoin(
      eventTemplates,
      eq(eventTemplates.id, templateEventAddons.templateId),
    )
    .where(
      and(
        eq(eventTemplates.tenantId, tenantId),
        isNotNull(templateEventAddons.stripeTaxRateId),
      ),
    )
    .limit(1)
    .pipe(Effect.orDie);

  return templateAddon.length > 0;
});
