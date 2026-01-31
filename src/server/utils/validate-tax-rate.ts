import { Schema } from 'effect';

import { database } from '../../db';
import * as schema from '../../db/schema';

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

/**
 * Get all compatible (inclusive & active) tax rates for a tenant
 */
export async function getCompatibleTaxRates(tenantId: string) {
  return database.query.tenantStripeTaxRates.findMany({
    orderBy: (table: typeof schema.tenantStripeTaxRates, { asc }: any) => [
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
export async function hasCompatibleTaxRates(
  tenantId: string,
): Promise<boolean> {
  const rates = await getCompatibleTaxRates(tenantId);
  return rates.length > 0;
}

/**
 * Validates tax rate assignment rules for registration options
 *
 * Rules:
 * - If isPaid=true → stripeTaxRateId REQUIRED and must reference compatible rate
 * - If isPaid=false → stripeTaxRateId MUST be null
 * - Compatible rate = inclusive=true AND active=true for tenant
 */
export async function validateTaxRate(
  input: TaxRateValidationInputType,
): Promise<TaxRateValidationResult> {
  try {
    // Rule: Free options cannot have tax rate
    if (!input.isPaid && input.stripeTaxRateId !== null) {
      return {
        error: {
          code: TAX_RATE_ERROR_CODES.ERR_FREE_CANNOT_HAVE_TAX_RATE,
          message: 'Free registration options cannot have a tax rate assigned',
        },
        success: false,
      };
    }

    // Rule: Paid options must have tax rate
    if (input.isPaid && !input.stripeTaxRateId) {
      return {
        error: {
          code: TAX_RATE_ERROR_CODES.ERR_PAID_REQUIRES_TAX_RATE,
          message:
            'Paid registration options must have a compatible tax rate assigned',
        },
        success: false,
      };
    }

    // If paid option with tax rate, validate it's compatible
    if (input.isPaid && input.stripeTaxRateId) {
      const taxRate = await database.query.tenantStripeTaxRates.findFirst({
        where: {
          stripeTaxRateId: input.stripeTaxRateId,
          tenantId: input.tenantId,
        },
      });

      if (!taxRate) {
        return {
          error: {
            code: TAX_RATE_ERROR_CODES.ERR_INCOMPATIBLE_TAX_RATE,
            message: 'Selected tax rate is not available for this tenant',
          },
          success: false,
        };
      }

      // Check if rate is compatible (inclusive and active)
      if (!taxRate.inclusive || !taxRate.active) {
        return {
          error: {
            code: TAX_RATE_ERROR_CODES.ERR_INCOMPATIBLE_TAX_RATE,
            message:
              'Selected tax rate is not compatible (must be inclusive and active)',
          },
          success: false,
        };
      }
    }

    // Validation passed
    return {
      data: {
        isPaid: input.isPaid,
        stripeTaxRateId: input.stripeTaxRateId,
      },
      success: true,
    };
  } catch (error) {
    return {
      error: {
        code: TAX_RATE_ERROR_CODES.ERR_INCOMPATIBLE_TAX_RATE,
        message:
          'Failed to validate tax rate: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
      },
      success: false,
    };
  }
}
