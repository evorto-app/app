import { Database } from '@db/index';
import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

import { createRegistrationDatabaseTestLayer } from '../testing/registration-database';
import {
  getCompatibleTaxRates,
  hasCompatibleTaxRates,
  TAX_RATE_ERROR_CODES,
  validateTaxRate,
} from './validate-tax-rate';

const createDatabase = (
  taxRate?:
    | undefined
    | {
        active: boolean;
        inclusive: boolean;
        percentage?: null | string;
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

describe('compatible tax-rate selectors', () => {
  for (const percentage of ['0', '19', null]) {
    it.layer(
      createRegistrationDatabaseTestLayer({
        executeValues: (statement, parameters) =>
          Effect.sync(() => {
            if (statement.includes('from "tenants"')) {
              expect(statement).toContain('"d0"."id" = $1');
              expect(parameters).toEqual(['tenant-1', 1]);
              return [['acct_current']];
            }
            expect(statement).toContain('from "tenant_stripe_tax_rates"');
            expect(
              statement
                .split(' where ', 2)[1]
                ?.split(' order by ', 1)[0]
                ?.replaceAll(/[()]/gu, ''),
            ).toBe(
              '"d0"."active" = $1 and "d0"."inclusive" = $2 and "d0"."percentage" is not null and "d0"."stripeAccountId" = $3 and "d0"."tenantId" = $4',
            );
            expect(statement).toContain(
              'order by "d0"."displayName" asc, "d0"."stripeTaxRateId" asc',
            );
            expect(parameters).toEqual([
              true,
              true,
              'acct_current',
              'tenant-1',
            ]);
            return percentage === null
              ? []
              : [
                  [
                    '2026-09-16T00:00:00.000Z',
                    'tax-rate-1',
                    '2026-09-16T00:00:00.000Z',
                    'tenant-1',
                    true,
                    'NL',
                    'VAT',
                    true,
                    percentage,
                    null,
                    'acct_current',
                    'txr_vat',
                  ],
                ];
          }),
      }),
    )(`percentage ${percentage}`, (it) => {
      it.effect('returns only selectable percentage rates', () =>
        Effect.gen(function* () {
          const database = yield* Database;
          const rates = yield* getCompatibleTaxRates(database, 'tenant-1');

          expect(rates.map((rate) => rate.percentage)).toEqual(
            percentage === null ? [] : [percentage],
          );
          expect(yield* hasCompatibleTaxRates(database, 'tenant-1')).toBe(
            percentage !== null,
          );
        }),
      );
    });
  }
});

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

  it.effect.each(['0', '19'])(
    'accepts paid options with a tenant-owned active inclusive %s percent tax rate',
    (percentage) =>
      Effect.gen(function* () {
        const database = createDatabase({
          active: true,
          inclusive: true,
          percentage,
        });
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

  it.effect('rejects a tax rate without a percentage', () =>
    Effect.gen(function* () {
      const result = yield* validateTaxRate(
        createDatabase({
          active: true,
          inclusive: true,
          percentage: null,
        }) as never,
        {
          isPaid: true,
          stripeTaxRateId: 'txr_fixed_amount',
          tenantId: 'tenant-1',
        },
      );

      expect(result).toEqual({
        error: {
          code: TAX_RATE_ERROR_CODES.ERR_TAX_RATE_PERCENTAGE_REQUIRED,
          message: 'Selected tax rate must have a percentage',
        },
        success: false,
      });
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
