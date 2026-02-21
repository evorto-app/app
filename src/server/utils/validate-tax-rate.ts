import { Effect, Schema } from 'effect';

import type { DatabaseClient } from '../../db';

// Error codes for tax rate validation
export const TAX_RATE_ERROR_CODES = {
  ERR_FREE_CANNOT_HAVE_TAX_RATE: 'ERR_FREE_CANNOT_HAVE_TAX_RATE',
  ERR_INCOMPATIBLE_TAX_RATE: 'ERR_INCOMPATIBLE_TAX_RATE',
  ERR_PAID_REQUIRES_TAX_RATE: 'ERR_PAID_REQUIRES_TAX_RATE',
} as const;

export type TaxRateErrorCode =
  (typeof TAX_RATE_ERROR_CODES)[keyof typeof TAX_RATE_ERROR_CODES];

export interface TaxRateValidationError {
  error: {
    code: TaxRateErrorCode;
    message: string;
  };
  success: false;
}

export type TaxRateValidationResult =
  | TaxRateValidationError
  | TaxRateValidationSuccess;

// Validation result types
export interface TaxRateValidationSuccess {
  data: {
    isPaid: boolean;
    stripeTaxRateId: null | string;
  };
  success: true;
}

// Input schema for validation
export const TaxRateValidationInput = Schema.Struct({
  isPaid: Schema.Boolean,
  stripeTaxRateId: Schema.NullOr(Schema.String),
  tenantId: Schema.String,
});

export type TaxRateValidationInputType = Schema.Schema.Type<
  typeof TaxRateValidationInput
>;

const validationError = (
  code: TaxRateErrorCode,
  message: string,
): TaxRateValidationError => ({
  error: {
    code,
    message,
  },
  success: false,
});

const validationSuccess = (
  input: TaxRateValidationInputType,
): TaxRateValidationSuccess => ({
  data: {
    isPaid: input.isPaid,
    stripeTaxRateId: input.stripeTaxRateId,
  },
  success: true,
});

/**
 * Get all compatible (inclusive & active) tax rates for a tenant
 */
export function getCompatibleTaxRates(
  database: DatabaseClient,
  tenantId: string,
) {
  return database.query.tenantStripeTaxRates.findMany({
    orderBy: (table, { asc }) => [
      asc(table.displayName),
      asc(table.stripeTaxRateId),
    ],
    where: {
      active: true,
      inclusive: true,
      tenantId: tenantId,
    },
  });
}

/**
 * Check if tenant has any compatible tax rates available
 */
export const hasCompatibleTaxRates = (
  database: DatabaseClient,
  tenantId: string,
): Effect.Effect<boolean> =>
  Effect.map(getCompatibleTaxRates(database, tenantId), (rates) => rates.length > 0).pipe(
    Effect.orDie,
  );

/**
 * Validates tax rate assignment rules for registration options
 *
 * Rules:
 * - If isPaid=true → stripeTaxRateId REQUIRED and must reference compatible rate
 * - If isPaid=false → stripeTaxRateId MUST be null
 * - Compatible rate = inclusive=true AND active=true for tenant
 */
export const validateTaxRate = (
  database: DatabaseClient,
  input: TaxRateValidationInputType,
): Effect.Effect<TaxRateValidationResult> =>
  Effect.gen(function* () {
    // Rule: Free options cannot have tax rate
    if (!input.isPaid && input.stripeTaxRateId !== null) {
      return validationError(
        TAX_RATE_ERROR_CODES.ERR_FREE_CANNOT_HAVE_TAX_RATE,
        'Free registration options cannot have a tax rate assigned',
      );
    }

    // Rule: Paid options must have tax rate
    if (input.isPaid && !input.stripeTaxRateId) {
      return validationError(
        TAX_RATE_ERROR_CODES.ERR_PAID_REQUIRES_TAX_RATE,
        'Paid registration options must have a compatible tax rate assigned',
      );
    }

    // If paid option with tax rate, validate it's compatible
    if (input.isPaid && input.stripeTaxRateId) {
      const taxRate = yield* database.query.tenantStripeTaxRates.findFirst({
        where: {
          stripeTaxRateId: input.stripeTaxRateId,
          tenantId: input.tenantId,
        },
      });

      if (!taxRate) {
        return validationError(
          TAX_RATE_ERROR_CODES.ERR_INCOMPATIBLE_TAX_RATE,
          'Selected tax rate is not available for this tenant',
        );
      }

      // Check if rate is compatible (inclusive and active)
      if (!taxRate.inclusive || !taxRate.active) {
        return validationError(
          TAX_RATE_ERROR_CODES.ERR_INCOMPATIBLE_TAX_RATE,
          'Selected tax rate is not compatible (must be inclusive and active)',
        );
      }
    }

    // Validation passed
    return validationSuccess(input);
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed(
        validationError(
          TAX_RATE_ERROR_CODES.ERR_INCOMPATIBLE_TAX_RATE,
          'Failed to validate tax rate: ' +
            (error instanceof Error ? error.message : 'Unknown error'),
        ),
      ),
    ),
  );
