import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

import { TAX_RATE_ERROR_CODES, validateTaxRate } from './validate-tax-rate';

const createDatabase = (
  taxRate?:
    | undefined
    | {
        active: boolean;
        inclusive: boolean;
      },
  stripeAccountId: null | string = 'acct_current',
) => {
  const findFirst = vi.fn(() => Effect.succeed(taxRate));
  return {
    findFirst,
    query: {
      tenants: {
        findFirst: () => Effect.succeed({ stripeAccountId }),
      },
      tenantStripeTaxRates: {
        findFirst,
      },
    },
  } as const;
};

describe('validateTaxRate', () => {
  it('keeps compatible tax-rate lookup on a named Effect boundary', () => {
    const source = readFileSync(
      new URL('validate-tax-rate.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      "getCompatibleTaxRates = Effect.fn('getCompatibleTaxRates')",
    );
  });

  it.effect(
    'accepts paid options with a tenant-owned active inclusive tax rate',
    () =>
      Effect.gen(function* () {
        const database = createDatabase({ active: true, inclusive: true });
        const result = yield* validateTaxRate(database as never, {
          isPaid: true,
          stripeTaxRateId: 'txr_active_inclusive',
          tenantId: 'tenant-1',
        });

        expect(result).toEqual({
          data: {
            isPaid: true,
            stripeTaxRateId: 'txr_active_inclusive',
          },
          success: true,
        });
        expect(database.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              stripeAccountId: 'acct_current',
              stripeTaxRateId: 'txr_active_inclusive',
              tenantId: 'tenant-1',
            },
          }),
        );
      }),
  );

  it.effect('rejects paid options without a tax rate', () =>
    Effect.gen(function* () {
      const result = yield* validateTaxRate(createDatabase() as never, {
        isPaid: true,
        stripeTaxRateId: null,
        tenantId: 'tenant-1',
      });

      expect(result).toEqual({
        error: {
          code: TAX_RATE_ERROR_CODES.ERR_PAID_REQUIRES_TAX_RATE,
          message:
            'Paid registration options must have a compatible tax rate assigned',
        },
        success: false,
      });
    }),
  );

  it.effect('rejects free options with stale tax rates', () =>
    Effect.gen(function* () {
      const result = yield* validateTaxRate(createDatabase() as never, {
        isPaid: false,
        stripeTaxRateId: 'txr_stale',
        tenantId: 'tenant-1',
      });

      expect(result).toEqual({
        error: {
          code: TAX_RATE_ERROR_CODES.ERR_FREE_CANNOT_HAVE_TAX_RATE,
          message: 'Free registration options cannot have a tax rate assigned',
        },
        success: false,
      });
    }),
  );

  it.effect('rejects tax rates that are not available for the tenant', () =>
    Effect.gen(function* () {
      const result = yield* validateTaxRate(createDatabase() as never, {
        isPaid: true,
        stripeTaxRateId: 'txr_other_tenant',
        tenantId: 'tenant-1',
      });

      expect(result).toEqual({
        error: {
          code: TAX_RATE_ERROR_CODES.ERR_INCOMPATIBLE_TAX_RATE,
          message: 'Selected tax rate is not available for this tenant',
        },
        success: false,
      });
    }),
  );

  it.effect('rejects inactive or exclusive tax rates', () =>
    Effect.gen(function* () {
      for (const taxRate of [
        { active: false, inclusive: true },
        { active: true, inclusive: false },
      ]) {
        const result = yield* validateTaxRate(
          createDatabase(taxRate) as never,
          {
            isPaid: true,
            stripeTaxRateId: 'txr_incompatible',
            tenantId: 'tenant-1',
          },
        );

        expect(result).toEqual({
          error: {
            code: TAX_RATE_ERROR_CODES.ERR_INCOMPATIBLE_TAX_RATE,
            message:
              'Selected tax rate is not compatible (must be inclusive and active)',
          },
          success: false,
        });
      }
    }),
  );

  it.effect('rejects legacy unscoped rows instead of inferring ownership', () =>
    Effect.gen(function* () {
      const database = createDatabase({ active: true, inclusive: true }, null);
      const result = yield* validateTaxRate(database as never, {
        isPaid: true,
        stripeTaxRateId: 'txr_legacy',
        tenantId: 'tenant-1',
      });

      expect(result).toMatchObject({
        error: { code: TAX_RATE_ERROR_CODES.ERR_INCOMPATIBLE_TAX_RATE },
        success: false,
      });
      expect(database.findFirst).not.toHaveBeenCalled();
    }),
  );
});
