import consola from 'consola';
import { and, eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';

import type { ScriptDatabaseClient } from '../../src/db/database-client';
import * as schema from '../../src/db/schema';

export interface LegacyPaidOptionTaxReferences {
  readonly stripeConnectAccountId: null | string;
  readonly stripeReducedTaxRate: null | string;
  readonly stripeRegularTaxRate: null | string;
}

export interface LegacyPaidOptionTaxTarget {
  readonly id: string;
  readonly stripeAccountId: null | string;
}

export interface PaidOptionTaxReference {
  readonly id: string;
  readonly kind: 'event' | 'template';
  readonly stripeTaxRateId: null | string;
}

export interface ProviderTaxRate {
  readonly active: boolean;
  readonly country: null | string;
  readonly displayName: null | string;
  readonly id: string;
  readonly inclusive: boolean;
  readonly percentage: null | number;
  readonly state: null | string;
}

export interface LegacyPaidOptionTaxRateImportPlan {
  readonly paidOptionTaxRateId: null | string;
  readonly taxRates: readonly Omit<
    typeof schema.tenantStripeTaxRates.$inferInsert,
    'id'
  >[];
}

const normalizeProviderIdentifier = (
  value: null | string,
  field: string,
): null | string => {
  if (value === null) return null;

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Legacy ${field} is blank; migration is blocked.`);
  }
  return normalized;
};

export const planLegacyPaidOptionTaxRateImport = async ({
  legacy,
  paidOptions,
  retrieveTaxRate,
  target,
}: {
  readonly legacy: LegacyPaidOptionTaxReferences;
  readonly paidOptions: readonly PaidOptionTaxReference[];
  readonly retrieveTaxRate: (
    stripeAccountId: string,
    stripeTaxRateId: string,
  ) => Promise<ProviderTaxRate>;
  readonly target: LegacyPaidOptionTaxTarget;
}): Promise<LegacyPaidOptionTaxRateImportPlan> => {
  const legacyStripeAccountId = normalizeProviderIdentifier(
    legacy.stripeConnectAccountId,
    'stripeConnectAccountId',
  );
  const targetStripeAccountId = normalizeProviderIdentifier(
    target.stripeAccountId,
    'target stripeAccountId',
  );
  if (legacyStripeAccountId !== targetStripeAccountId) {
    throw new Error(
      `Legacy and target Stripe accounts differ for tenant ${target.id}; migration is blocked.`,
    );
  }

  const reducedTaxRateId = normalizeProviderIdentifier(
    legacy.stripeReducedTaxRate,
    'stripeReducedTaxRate',
  );
  const regularTaxRateId = normalizeProviderIdentifier(
    legacy.stripeRegularTaxRate,
    'stripeRegularTaxRate',
  );

  if (paidOptions.length > 0 && reducedTaxRateId === null) {
    throw new Error(
      `Tenant ${target.id} has migrated paid options without a legacy reduced Stripe tax-rate reference; migration is blocked.`,
    );
  }

  const conflictingPaidOption = paidOptions.find(
    ({ stripeTaxRateId }) =>
      stripeTaxRateId !== null && stripeTaxRateId !== reducedTaxRateId,
  );
  if (conflictingPaidOption) {
    throw new Error(
      `Paid ${conflictingPaidOption.kind} option ${conflictingPaidOption.id} already references a different Stripe tax rate; migration is blocked.`,
    );
  }

  const configuredTaxRateIds = [reducedTaxRateId, regularTaxRateId].filter(
    (stripeTaxRateId): stripeTaxRateId is string => stripeTaxRateId !== null,
  );
  const distinctTaxRateIds = [...new Set(configuredTaxRateIds)];
  if (distinctTaxRateIds.length > 0 && legacyStripeAccountId === null) {
    throw new Error(
      `Tenant ${target.id} has legacy Stripe tax-rate references without a Connect account; migration is blocked.`,
    );
  }
  if (legacyStripeAccountId === null) {
    return { paidOptionTaxRateId: null, taxRates: [] };
  }

  const providerTaxRates = await Promise.all(
    distinctTaxRateIds.map(async (stripeTaxRateId) => {
      const taxRate = await retrieveTaxRate(
        legacyStripeAccountId,
        stripeTaxRateId,
      );
      if (taxRate.id !== stripeTaxRateId) {
        throw new Error(
          `Stripe returned tax rate ${taxRate.id} for requested reference ${stripeTaxRateId}; migration is blocked.`,
        );
      }
      return taxRate;
    }),
  );

  if (reducedTaxRateId !== null && paidOptions.length > 0) {
    const paidOptionTaxRate = providerTaxRates.find(
      ({ id }) => id === reducedTaxRateId,
    );
    if (!paidOptionTaxRate?.active || !paidOptionTaxRate.inclusive) {
      throw new Error(
        `Legacy paid-option tax rate ${reducedTaxRateId} must be active and inclusive in Stripe; migration is blocked.`,
      );
    }
  }

  return {
    paidOptionTaxRateId: paidOptions.length > 0 ? reducedTaxRateId : null,
    taxRates: providerTaxRates.map((taxRate) => ({
      active: taxRate.active,
      country: taxRate.country,
      displayName: taxRate.displayName,
      inclusive: taxRate.inclusive,
      percentage:
        taxRate.percentage === null ? null : String(taxRate.percentage),
      state: taxRate.state,
      stripeAccountId: legacyStripeAccountId,
      stripeTaxRateId: taxRate.id,
      tenantId: target.id,
    })),
  };
};

const listPaidOptionTaxReferences = async (
  database: ScriptDatabaseClient,
  tenantId: string,
): Promise<PaidOptionTaxReference[]> => {
  const eventOptions = await database
    .select({
      id: schema.eventRegistrationOptions.id,
      stripeTaxRateId: schema.eventRegistrationOptions.stripeTaxRateId,
    })
    .from(schema.eventRegistrationOptions)
    .innerJoin(
      schema.eventInstances,
      eq(schema.eventRegistrationOptions.eventId, schema.eventInstances.id),
    )
    .where(
      and(
        eq(schema.eventInstances.tenantId, tenantId),
        eq(schema.eventRegistrationOptions.isPaid, true),
      ),
    );
  const templateOptions = await database
    .select({
      id: schema.templateRegistrationOptions.id,
      stripeTaxRateId: schema.templateRegistrationOptions.stripeTaxRateId,
    })
    .from(schema.templateRegistrationOptions)
    .innerJoin(
      schema.eventTemplates,
      eq(
        schema.templateRegistrationOptions.templateId,
        schema.eventTemplates.id,
      ),
    )
    .where(
      and(
        eq(schema.eventTemplates.tenantId, tenantId),
        eq(schema.templateRegistrationOptions.isPaid, true),
      ),
    );

  const paidOptions: PaidOptionTaxReference[] = [];
  for (const option of eventOptions) {
    paidOptions.push({ ...option, kind: 'event' });
  }
  for (const option of templateOptions) {
    paidOptions.push({ ...option, kind: 'template' });
  }
  return paidOptions;
};

export const importLegacyPaidOptionTaxRates = async (
  database: ScriptDatabaseClient,
  stripe: Stripe,
  legacy: LegacyPaidOptionTaxReferences,
  target: LegacyPaidOptionTaxTarget,
) => {
  const paidOptions = await listPaidOptionTaxReferences(database, target.id);
  const plan = await planLegacyPaidOptionTaxRateImport({
    legacy,
    paidOptions,
    retrieveTaxRate: async (stripeAccountId, stripeTaxRateId) => {
      const taxRate = await stripe.taxRates.retrieve(
        stripeTaxRateId,
        undefined,
        { stripeAccount: stripeAccountId },
      );
      return {
        active: taxRate.active,
        country: taxRate.country ?? null,
        displayName: taxRate.display_name ?? null,
        id: taxRate.id,
        inclusive: taxRate.inclusive,
        percentage: taxRate.percentage ?? null,
        state: taxRate.state ?? null,
      };
    },
    target,
  });

  if (plan.taxRates.length === 0 && plan.paidOptionTaxRateId === null) {
    consola.info(
      `No legacy Stripe tax rates to import for tenant ${target.id}`,
    );
    return;
  }

  await database.transaction(async (transaction) => {
    for (const taxRate of plan.taxRates) {
      await transaction
        .insert(schema.tenantStripeTaxRates)
        .values(taxRate)
        .onConflictDoUpdate({
          set: {
            active: taxRate.active,
            country: taxRate.country,
            displayName: taxRate.displayName,
            inclusive: taxRate.inclusive,
            percentage: taxRate.percentage,
            state: taxRate.state,
            stripeAccountId: taxRate.stripeAccountId,
          },
          target: [
            schema.tenantStripeTaxRates.tenantId,
            schema.tenantStripeTaxRates.stripeTaxRateId,
          ],
        });
    }

    if (plan.paidOptionTaxRateId === null) return;

    const eventOptionIds: string[] = [];
    const templateOptionIds: string[] = [];
    for (const option of paidOptions) {
      if (option.kind === 'event') eventOptionIds.push(option.id);
      else templateOptionIds.push(option.id);
    }

    if (eventOptionIds.length > 0) {
      await transaction
        .update(schema.eventRegistrationOptions)
        .set({ stripeTaxRateId: plan.paidOptionTaxRateId })
        .where(inArray(schema.eventRegistrationOptions.id, eventOptionIds));
    }
    if (templateOptionIds.length > 0) {
      await transaction
        .update(schema.templateRegistrationOptions)
        .set({ stripeTaxRateId: plan.paidOptionTaxRateId })
        .where(
          inArray(schema.templateRegistrationOptions.id, templateOptionIds),
        );
    }
  });

  consola.success(
    `Imported ${plan.taxRates.length} provider-verified Stripe tax rates for tenant ${target.id}`,
  );
};
