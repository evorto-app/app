import type { DatabaseClient } from '@db/index';

import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { and, eq, exists, inArray, isNotNull } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import {
  eventAddons,
  eventInstances,
  eventRegistrationOptions,
  eventTemplates,
  templateEventAddons,
  templateRegistrationOptions,
  tenants,
  tenantStripeTaxRates,
} from '../../db/schema';

const providerLoadFailureDetails = {
  message: 'Stripe tax rates could not be loaded from the replacement account',
  reason:
    'Verify the replacement Stripe account ID and connection, then retry. No account or tax-rate changes were applied.',
} as const;

const providerResponseFailureDetails = {
  message: 'Stripe returned invalid tax-rate data for the replacement account',
  reason:
    'Review the active inclusive tax rates in the replacement Stripe account, then retry. No account or tax-rate changes were applied.',
} as const;

const rotationMatchFailure = (
  message: string,
  reason: string,
): RpcBadRequestError =>
  new RpcBadRequestError({
    message,
    reason: `${reason} No account or tax-rate changes were applied.`,
  });

const StripeTaxRateProviderRate = Schema.Struct({
  active: Schema.Boolean,
  country: Schema.NullOr(Schema.String),
  display_name: Schema.String,
  id: Schema.NonEmptyString,
  inclusive: Schema.Boolean,
  percentage: Schema.Number,
  state: Schema.NullOr(Schema.String),
});

const StripeTaxRateProviderPage = Schema.Struct({
  data: Schema.Array(StripeTaxRateProviderRate),
  has_more: Schema.Boolean,
});

export interface StripeTaxRateAccountRotationLockedState {
  readonly bindings: readonly StripeTaxRateAccountRotationBinding[];
  readonly sourceMetadata: readonly StripeTaxRateAccountRotationSourceMetadata[];
}

export interface StripeTaxRateAccountRotationPlan {
  readonly bindings: readonly StripeTaxRateAccountRotationBindingPlan[];
  readonly targetRates: readonly StripeTaxRateAccountRotationTargetRate[];
  readonly targetStripeAccountId: string;
  readonly tenantId: string;
}

export interface StripeTaxRateAccountRotationStripeClient {
  readonly taxRates: {
    readonly list: (
      parameters: StripeTaxRateListParameters,
      options: StripeTaxRateListRequestOptions,
    ) => PromiseLike<unknown>;
  };
}

export interface StripeTaxRateAccountRotationTargetRate {
  readonly country: null | string;
  readonly displayName: string;
  readonly percentage: string;
  readonly state: null | string;
  readonly stripeTaxRateId: string;
}

interface StripeTaxRateAccountRotationBinding {
  readonly id: string;
  readonly kind: StripeTaxRateAccountRotationBindingKind;
  readonly parentId: string;
  readonly sourceStripeTaxRateId: string;
}

type StripeTaxRateAccountRotationBindingKind =
  | 'eventAddon'
  | 'eventRegistrationOption'
  | 'templateAddon'
  | 'templateRegistrationOption';

interface StripeTaxRateAccountRotationBindingPlan extends StripeTaxRateAccountRotationBinding {
  readonly targetStripeTaxRateId: string;
}

interface StripeTaxRateAccountRotationSourceMetadata {
  readonly country: null | string;
  readonly displayName: null | string;
  readonly inclusive: boolean;
  readonly percentage: null | string;
  readonly state: null | string;
  readonly stripeAccountId: string;
  readonly stripeTaxRateId: string;
}

interface StripeTaxRateListParameters {
  readonly active: true;
  readonly inclusive: true;
  readonly limit: 100;
  readonly starting_after?: string;
}

interface StripeTaxRateListRequestOptions {
  readonly stripeAccount: string;
}

const normalizeText = (value: null | string): null | string => {
  if (value === null) return null;

  const normalized = value
    .normalize('NFKC')
    .trim()
    .replaceAll(/\s+/gu, ' ')
    .toLocaleLowerCase('en-US');
  return normalized.length === 0 ? null : normalized;
};

const normalizePercentage = (value: number | string): null | string => {
  const normalizedValue = typeof value === 'number' ? value : value.trim();
  if (normalizedValue === '') return null;

  const numberValue =
    typeof normalizedValue === 'number'
      ? normalizedValue
      : Number(normalizedValue);
  return Number.isFinite(numberValue) && numberValue >= 0 && numberValue <= 100
    ? String(numberValue)
    : null;
};

const taxRateMetadataMatches = (
  source: StripeTaxRateAccountRotationSourceMetadata,
  target: StripeTaxRateAccountRotationTargetRate,
): boolean =>
  normalizePercentage(source.percentage ?? '') ===
    normalizePercentage(target.percentage) &&
  normalizeText(source.displayName) === normalizeText(target.displayName) &&
  normalizeText(source.country) === normalizeText(target.country) &&
  normalizeText(source.state) === normalizeText(target.state);

export const fetchStripeTaxRateAccountRotationTargetRates = Effect.fn(
  'fetchStripeTaxRateAccountRotationTargetRates',
)(function* (
  stripe: StripeTaxRateAccountRotationStripeClient,
  targetStripeAccountId: string,
) {
  const rates: StripeTaxRateAccountRotationTargetRate[] = [];
  const seenIds = new Set<string>();
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const response = yield* Effect.tryPromise({
      catch: () => new RpcBadRequestError(providerLoadFailureDetails),
      try: () =>
        Promise.resolve(
          stripe.taxRates.list(
            {
              active: true,
              inclusive: true,
              limit: 100,
              ...(startingAfter !== undefined && {
                starting_after: startingAfter,
              }),
            },
            { stripeAccount: targetStripeAccountId },
          ),
        ),
    });
    const page = yield* Schema.decodeUnknownEffect(StripeTaxRateProviderPage)(
      response,
    ).pipe(
      Effect.mapError(
        () => new RpcBadRequestError(providerResponseFailureDetails),
      ),
    );

    for (const rate of page.data) {
      const percentage = normalizePercentage(rate.percentage);
      if (
        !rate.active ||
        !rate.inclusive ||
        normalizeText(rate.display_name) === null ||
        percentage === null ||
        seenIds.has(rate.id)
      ) {
        return yield* new RpcBadRequestError(providerResponseFailureDetails);
      }

      seenIds.add(rate.id);
      rates.push({
        country: rate.country,
        displayName: rate.display_name,
        percentage,
        state: rate.state,
        stripeTaxRateId: rate.id,
      });
    }

    hasMore = page.has_more;
    if (hasMore) {
      const lastRate = page.data.at(-1);
      if (!lastRate) {
        return yield* new RpcBadRequestError(providerResponseFailureDetails);
      }
      startingAfter = lastRate.id;
    }
  }

  return rates;
});

export const buildStripeTaxRateAccountRotationPlan = Effect.fn(
  'buildStripeTaxRateAccountRotationPlan',
)(function* (input: {
  readonly lockedState: StripeTaxRateAccountRotationLockedState;
  readonly sourceStripeAccountId: string;
  readonly targetRates: readonly StripeTaxRateAccountRotationTargetRate[];
  readonly targetStripeAccountId: string;
  readonly tenantId: string;
}) {
  const sourceIds = [
    ...new Set(
      input.lockedState.bindings.map(
        (binding) => binding.sourceStripeTaxRateId,
      ),
    ),
  ];
  const targetIdBySourceId = new Map<string, string>();
  const matchedTargetIds = new Set<string>();

  for (const sourceStripeTaxRateId of sourceIds) {
    const sourceRows = input.lockedState.sourceMetadata.filter(
      (metadata) =>
        metadata.stripeTaxRateId === sourceStripeTaxRateId &&
        metadata.stripeAccountId === input.sourceStripeAccountId,
    );
    if (sourceRows.length !== 1) {
      return yield* rotationMatchFailure(
        'A tax rate assigned to event configuration has no unique source-account metadata',
        `Repair or re-import source tax rate ${sourceStripeTaxRateId} before changing the Stripe account.`,
      );
    }
    const source = sourceRows[0];
    if (
      !source ||
      !source.inclusive ||
      source.percentage === null ||
      normalizePercentage(source.percentage) === null
    ) {
      return yield* rotationMatchFailure(
        'A tax rate assigned to event configuration has invalid source metadata',
        `Repair or re-import source tax rate ${sourceStripeTaxRateId} before changing the Stripe account.`,
      );
    }

    const targetMatches = input.targetRates.filter((target) =>
      taxRateMetadataMatches(source, target),
    );
    if (targetMatches.length === 0) {
      return yield* rotationMatchFailure(
        'The replacement Stripe account is missing a matching active inclusive tax rate',
        `Create a rate matching source tax rate ${sourceStripeTaxRateId} by percentage, display name, country, and state, then retry.`,
      );
    }
    if (targetMatches.length > 1) {
      return yield* rotationMatchFailure(
        'The replacement Stripe account has multiple matching active inclusive tax rates',
        `Archive duplicate rates matching source tax rate ${sourceStripeTaxRateId}, then retry.`,
      );
    }
    const target = targetMatches[0];
    if (!target) {
      return yield* Effect.die(
        new Error('A unique Stripe tax-rate match disappeared'),
      );
    }

    targetIdBySourceId.set(sourceStripeTaxRateId, target.stripeTaxRateId);
    matchedTargetIds.add(target.stripeTaxRateId);
  }

  const targetIdFor = (sourceStripeTaxRateId: string): string => {
    const targetStripeTaxRateId = targetIdBySourceId.get(sourceStripeTaxRateId);
    if (!targetStripeTaxRateId) {
      throw new Error(
        `Missing planned target for source tax rate ${sourceStripeTaxRateId}`,
      );
    }
    return targetStripeTaxRateId;
  };

  return {
    bindings: input.lockedState.bindings.map((binding) => ({
      ...binding,
      targetStripeTaxRateId: targetIdFor(binding.sourceStripeTaxRateId),
    })),
    targetRates: input.targetRates.filter((rate) =>
      matchedTargetIds.has(rate.stripeTaxRateId),
    ),
    targetStripeAccountId: input.targetStripeAccountId,
    tenantId: input.tenantId,
  } satisfies StripeTaxRateAccountRotationPlan;
});

const requireBoundTaxRateIds = Effect.fn('requireBoundTaxRateIds')(function* <
  Row extends { readonly sourceStripeTaxRateId: null | string },
>(rows: readonly Row[]) {
  const bindings: (Row & { readonly sourceStripeTaxRateId: string })[] = [];
  for (const row of rows) {
    if (!row.sourceStripeTaxRateId) {
      return yield* rotationMatchFailure(
        'Tax-rate configuration changed while the Stripe account was rotating',
        'Reload the tenant and retry the account change.',
      );
    }
    bindings.push({
      ...row,
      sourceStripeTaxRateId: row.sourceStripeTaxRateId,
    });
  }
  return bindings;
});

/**
 * Call only after the caller has locked the tenant row. Every mutable binding
 * is locked without filtering event status or dates, so approved historical
 * events are included in the same account-rotation transaction.
 */
export const planStripeTaxRateAccountRotation = Effect.fn(
  'planStripeTaxRateAccountRotation',
)(function* (
  database: Pick<DatabaseClient, 'select'>,
  input: {
    readonly sourceStripeAccountId: string;
    readonly targetRates: readonly StripeTaxRateAccountRotationTargetRate[];
    readonly targetStripeAccountId: string;
    readonly tenantId: string;
  },
) {
  const eventRegistrationOptionRows = yield* database
    .select({
      id: eventRegistrationOptions.id,
      parentId: eventRegistrationOptions.eventId,
      sourceStripeTaxRateId: eventRegistrationOptions.stripeTaxRateId,
    })
    .from(eventRegistrationOptions)
    .innerJoin(
      eventInstances,
      eq(eventInstances.id, eventRegistrationOptions.eventId),
    )
    .where(
      and(
        eq(eventInstances.tenantId, input.tenantId),
        isNotNull(eventRegistrationOptions.stripeTaxRateId),
      ),
    )
    .for('update', { of: eventRegistrationOptions })
    .pipe(Effect.orDie);
  const eventRegistrationOptionBindings = yield* requireBoundTaxRateIds(
    eventRegistrationOptionRows.map((binding) => ({
      ...binding,
      kind: 'eventRegistrationOption' as const,
    })),
  );

  const eventAddonRows = yield* database
    .select({
      id: eventAddons.id,
      parentId: eventAddons.eventId,
      sourceStripeTaxRateId: eventAddons.stripeTaxRateId,
    })
    .from(eventAddons)
    .innerJoin(eventInstances, eq(eventInstances.id, eventAddons.eventId))
    .where(
      and(
        eq(eventInstances.tenantId, input.tenantId),
        isNotNull(eventAddons.stripeTaxRateId),
      ),
    )
    .for('update', { of: eventAddons })
    .pipe(Effect.orDie);
  const eventAddonBindings = yield* requireBoundTaxRateIds(
    eventAddonRows.map((binding) => ({
      ...binding,
      kind: 'eventAddon' as const,
    })),
  );

  const templateRegistrationOptionRows = yield* database
    .select({
      id: templateRegistrationOptions.id,
      parentId: templateRegistrationOptions.templateId,
      sourceStripeTaxRateId: templateRegistrationOptions.stripeTaxRateId,
    })
    .from(templateRegistrationOptions)
    .innerJoin(
      eventTemplates,
      eq(eventTemplates.id, templateRegistrationOptions.templateId),
    )
    .where(
      and(
        eq(eventTemplates.tenantId, input.tenantId),
        isNotNull(templateRegistrationOptions.stripeTaxRateId),
      ),
    )
    .for('update', { of: templateRegistrationOptions })
    .pipe(Effect.orDie);
  const templateRegistrationOptionBindings = yield* requireBoundTaxRateIds(
    templateRegistrationOptionRows.map((binding) => ({
      ...binding,
      kind: 'templateRegistrationOption' as const,
    })),
  );

  const templateAddonRows = yield* database
    .select({
      id: templateEventAddons.id,
      parentId: templateEventAddons.templateId,
      sourceStripeTaxRateId: templateEventAddons.stripeTaxRateId,
    })
    .from(templateEventAddons)
    .innerJoin(
      eventTemplates,
      eq(eventTemplates.id, templateEventAddons.templateId),
    )
    .where(
      and(
        eq(eventTemplates.tenantId, input.tenantId),
        isNotNull(templateEventAddons.stripeTaxRateId),
      ),
    )
    .for('update', { of: templateEventAddons })
    .pipe(Effect.orDie);
  const templateAddonBindings = yield* requireBoundTaxRateIds(
    templateAddonRows.map((binding) => ({
      ...binding,
      kind: 'templateAddon' as const,
    })),
  );

  const bindings = [
    ...eventRegistrationOptionBindings,
    ...eventAddonBindings,
    ...templateRegistrationOptionBindings,
    ...templateAddonBindings,
  ];

  const distinctSourceIds = [
    ...new Set(bindings.map((binding) => binding.sourceStripeTaxRateId)),
  ];
  const sourceMetadata =
    distinctSourceIds.length === 0
      ? []
      : yield* database
          .select({
            country: tenantStripeTaxRates.country,
            displayName: tenantStripeTaxRates.displayName,
            inclusive: tenantStripeTaxRates.inclusive,
            percentage: tenantStripeTaxRates.percentage,
            state: tenantStripeTaxRates.state,
            stripeAccountId: tenantStripeTaxRates.stripeAccountId,
            stripeTaxRateId: tenantStripeTaxRates.stripeTaxRateId,
          })
          .from(tenantStripeTaxRates)
          .where(
            and(
              eq(tenantStripeTaxRates.tenantId, input.tenantId),
              eq(
                tenantStripeTaxRates.stripeAccountId,
                input.sourceStripeAccountId,
              ),
              inArray(tenantStripeTaxRates.stripeTaxRateId, distinctSourceIds),
            ),
          )
          .for('update', { of: tenantStripeTaxRates })
          .pipe(Effect.orDie);

  return yield* buildStripeTaxRateAccountRotationPlan({
    lockedState: {
      bindings,
      sourceMetadata,
    },
    sourceStripeAccountId: input.sourceStripeAccountId,
    targetRates: input.targetRates,
    targetStripeAccountId: input.targetStripeAccountId,
    tenantId: input.tenantId,
  });
});

export interface StripeTaxRateAccountRotationApplyOperations {
  readonly currentStripeAccountId: (
    tenantId: string,
  ) => Effect.Effect<null | string>;
  readonly remapBinding: (
    tenantId: string,
    binding: StripeTaxRateAccountRotationBindingPlan,
  ) => Effect.Effect<boolean>;
  readonly upsertTargetRate: (
    tenantId: string,
    stripeAccountId: string,
    rate: StripeTaxRateAccountRotationTargetRate,
  ) => Effect.Effect<void>;
}

const ensureRemapped = (
  remapped: boolean,
): Effect.Effect<void, RpcBadRequestError> =>
  remapped
    ? Effect.void
    : Effect.fail(
        rotationMatchFailure(
          'Tax-rate configuration changed while the Stripe account was rotating',
          'Reload the tenant and retry the account change.',
        ),
      );

export const executeStripeTaxRateAccountRotationPlan = Effect.fn(
  'executeStripeTaxRateAccountRotationPlan',
)(function* (
  operations: StripeTaxRateAccountRotationApplyOperations,
  plan: StripeTaxRateAccountRotationPlan,
) {
  const currentStripeAccountId = yield* operations.currentStripeAccountId(
    plan.tenantId,
  );
  if (currentStripeAccountId !== plan.targetStripeAccountId) {
    return yield* rotationMatchFailure(
      'The tenant Stripe account did not reach the planned replacement account',
      'Keep the account switch and tax-rate remap in one transaction, then retry.',
    );
  }

  yield* Effect.forEach(
    plan.targetRates,
    (rate) =>
      operations.upsertTargetRate(
        plan.tenantId,
        plan.targetStripeAccountId,
        rate,
      ),
    { concurrency: 1, discard: true },
  );
  yield* Effect.forEach(
    plan.bindings,
    (binding) =>
      operations
        .remapBinding(plan.tenantId, binding)
        .pipe(Effect.flatMap((remapped) => ensureRemapped(remapped))),
    { concurrency: 1, discard: true },
  );
});

const makeStripeTaxRateAccountRotationApplyOperations = (
  database: Pick<DatabaseClient, 'insert' | 'select' | 'update'>,
): StripeTaxRateAccountRotationApplyOperations => ({
  currentStripeAccountId: (tenantId) =>
    database
      .select({ stripeAccountId: tenants.stripeAccountId })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows[0]?.stripeAccountId ?? null),
      ),
  remapBinding: (tenantId, binding) => {
    switch (binding.kind) {
      case 'eventAddon': {
        return database
          .update(eventAddons)
          .set({ stripeTaxRateId: binding.targetStripeTaxRateId })
          .where(
            and(
              eq(eventAddons.id, binding.id),
              eq(eventAddons.eventId, binding.parentId),
              eq(eventAddons.stripeTaxRateId, binding.sourceStripeTaxRateId),
              exists(
                database
                  .select({ id: eventInstances.id })
                  .from(eventInstances)
                  .where(
                    and(
                      eq(eventInstances.id, eventAddons.eventId),
                      eq(eventInstances.tenantId, tenantId),
                    ),
                  ),
              ),
            ),
          )
          .returning({ id: eventAddons.id })
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows.length === 1),
          );
      }
      case 'eventRegistrationOption': {
        return database
          .update(eventRegistrationOptions)
          .set({ stripeTaxRateId: binding.targetStripeTaxRateId })
          .where(
            and(
              eq(eventRegistrationOptions.id, binding.id),
              eq(eventRegistrationOptions.eventId, binding.parentId),
              eq(
                eventRegistrationOptions.stripeTaxRateId,
                binding.sourceStripeTaxRateId,
              ),
              exists(
                database
                  .select({ id: eventInstances.id })
                  .from(eventInstances)
                  .where(
                    and(
                      eq(eventInstances.id, eventRegistrationOptions.eventId),
                      eq(eventInstances.tenantId, tenantId),
                    ),
                  ),
              ),
            ),
          )
          .returning({ id: eventRegistrationOptions.id })
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows.length === 1),
          );
      }
      case 'templateAddon': {
        return database
          .update(templateEventAddons)
          .set({ stripeTaxRateId: binding.targetStripeTaxRateId })
          .where(
            and(
              eq(templateEventAddons.id, binding.id),
              eq(templateEventAddons.templateId, binding.parentId),
              eq(
                templateEventAddons.stripeTaxRateId,
                binding.sourceStripeTaxRateId,
              ),
              exists(
                database
                  .select({ id: eventTemplates.id })
                  .from(eventTemplates)
                  .where(
                    and(
                      eq(eventTemplates.id, templateEventAddons.templateId),
                      eq(eventTemplates.tenantId, tenantId),
                    ),
                  ),
              ),
            ),
          )
          .returning({ id: templateEventAddons.id })
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows.length === 1),
          );
      }
      case 'templateRegistrationOption': {
        return database
          .update(templateRegistrationOptions)
          .set({ stripeTaxRateId: binding.targetStripeTaxRateId })
          .where(
            and(
              eq(templateRegistrationOptions.id, binding.id),
              eq(templateRegistrationOptions.templateId, binding.parentId),
              eq(
                templateRegistrationOptions.stripeTaxRateId,
                binding.sourceStripeTaxRateId,
              ),
              exists(
                database
                  .select({ id: eventTemplates.id })
                  .from(eventTemplates)
                  .where(
                    and(
                      eq(
                        eventTemplates.id,
                        templateRegistrationOptions.templateId,
                      ),
                      eq(eventTemplates.tenantId, tenantId),
                    ),
                  ),
              ),
            ),
          )
          .returning({ id: templateRegistrationOptions.id })
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows.length === 1),
          );
      }
    }
  },
  upsertTargetRate: (tenantId, stripeAccountId, rate) => {
    const values = {
      active: true,
      country: rate.country,
      displayName: rate.displayName,
      inclusive: true,
      percentage: rate.percentage,
      state: rate.state,
      stripeAccountId,
      stripeTaxRateId: rate.stripeTaxRateId,
      tenantId,
    };
    return database
      .insert(tenantStripeTaxRates)
      .values(values)
      .onConflictDoUpdate({
        set: values,
        target: [
          tenantStripeTaxRates.tenantId,
          tenantStripeTaxRates.stripeTaxRateId,
        ],
      })
      .pipe(Effect.orDie, Effect.asVoid);
  },
});

/**
 * Apply inside the same transaction, after deleting source-account metadata
 * and switching the tenant to the target account. This preserves one atomic
 * account-and-binding rotation while target metadata and bindings are remapped.
 */
export const applyStripeTaxRateAccountRotation = Effect.fn(
  'applyStripeTaxRateAccountRotation',
)(function* (
  database: Pick<DatabaseClient, 'insert' | 'select' | 'update'>,
  plan: StripeTaxRateAccountRotationPlan,
) {
  return yield* executeStripeTaxRateAccountRotationPlan(
    makeStripeTaxRateAccountRotationApplyOperations(database),
    plan,
  );
});
