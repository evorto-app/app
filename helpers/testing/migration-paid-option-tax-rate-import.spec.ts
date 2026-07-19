import { describe, expect, it, vi } from 'vitest';

import {
  type PaidOptionTaxReference,
  planLegacyPaidOptionTaxRateImport,
  type ProviderTaxRate,
} from '../../migration/steps/002_import_legacy_paid_option_tax_rates';

const providerTaxRate = (
  id: string,
  overrides: Partial<ProviderTaxRate> = {},
): ProviderTaxRate => ({
  active: true,
  country: 'DE',
  displayName: 'VAT',
  id,
  inclusive: true,
  percentage: 7,
  state: null,
  ...overrides,
});

const legacy = {
  stripeConnectAccountId: 'acct_legacy',
  stripeReducedTaxRate: 'txr_reduced',
  stripeRegularTaxRate: 'txr_regular',
};

const target = {
  id: 'tenant-1',
  stripeAccountId: 'acct_legacy',
};

const paidOptions: PaidOptionTaxReference[] = [
  { id: 'event-option-1', kind: 'event', stripeTaxRateId: null },
  { id: 'template-option-1', kind: 'template', stripeTaxRateId: null },
];

describe('legacy paid-option Stripe tax-rate import', () => {
  it('imports exact provider metadata under the legacy Connect account', async () => {
    const retrieveTaxRate = vi.fn(
      async (stripeAccountId: string, stripeTaxRateId: string) =>
        providerTaxRate(stripeTaxRateId, {
          displayName:
            stripeTaxRateId === 'txr_reduced' ? 'Reduced VAT' : 'Regular VAT',
          percentage: stripeTaxRateId === 'txr_reduced' ? 7 : 19,
        }),
    );

    const plan = await planLegacyPaidOptionTaxRateImport({
      legacy,
      paidOptions,
      retrieveTaxRate,
      target,
    });

    expect(retrieveTaxRate.mock.calls).toEqual([
      ['acct_legacy', 'txr_reduced'],
      ['acct_legacy', 'txr_regular'],
    ]);
    expect(plan).toEqual({
      paidOptionTaxRateId: 'txr_reduced',
      taxRates: [
        {
          active: true,
          country: 'DE',
          displayName: 'Reduced VAT',
          inclusive: true,
          percentage: '7',
          state: null,
          stripeAccountId: 'acct_legacy',
          stripeTaxRateId: 'txr_reduced',
          tenantId: 'tenant-1',
        },
        {
          active: true,
          country: 'DE',
          displayName: 'Regular VAT',
          inclusive: true,
          percentage: '19',
          state: null,
          stripeAccountId: 'acct_legacy',
          stripeTaxRateId: 'txr_regular',
          tenantId: 'tenant-1',
        },
      ],
    });
  });

  it('blocks paid options when the legacy reduced tax reference is missing', async () => {
    const retrieveTaxRate = vi.fn(async () => providerTaxRate('unused'));

    await expect(
      planLegacyPaidOptionTaxRateImport({
        legacy: { ...legacy, stripeReducedTaxRate: null },
        paidOptions,
        retrieveTaxRate,
        target,
      }),
    ).rejects.toThrow('without a legacy reduced Stripe tax-rate reference');
    expect(retrieveTaxRate).not.toHaveBeenCalled();
  });

  it('blocks mismatched account provenance and existing option references', async () => {
    const retrieveTaxRate = vi.fn(async () => providerTaxRate('unused'));

    await expect(
      planLegacyPaidOptionTaxRateImport({
        legacy,
        paidOptions,
        retrieveTaxRate,
        target: { ...target, stripeAccountId: 'acct_other' },
      }),
    ).rejects.toThrow('Legacy and target Stripe accounts differ');
    await expect(
      planLegacyPaidOptionTaxRateImport({
        legacy,
        paidOptions: [
          {
            id: 'event-option-1',
            kind: 'event',
            stripeTaxRateId: 'txr_other',
          },
        ],
        retrieveTaxRate,
        target,
      }),
    ).rejects.toThrow('already references a different Stripe tax rate');
    expect(retrieveTaxRate).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', { active: false }],
    ['exclusive', { inclusive: false }],
  ])('blocks an %s paid-option provider rate', async (_label, overrides) => {
    await expect(
      planLegacyPaidOptionTaxRateImport({
        legacy,
        paidOptions,
        retrieveTaxRate: async (_stripeAccountId, stripeTaxRateId) =>
          providerTaxRate(stripeTaxRateId, overrides),
        target,
      }),
    ).rejects.toThrow('must be active and inclusive in Stripe');
  });

  it('propagates provider lookup failures without fabricating a fallback', async () => {
    await expect(
      planLegacyPaidOptionTaxRateImport({
        legacy,
        paidOptions,
        retrieveTaxRate: async () => {
          throw new Error('Stripe lookup unavailable');
        },
        target,
      }),
    ).rejects.toThrow('Stripe lookup unavailable');
  });

  it('does nothing when the tenant has no paid options or configured rates', async () => {
    const retrieveTaxRate = vi.fn(async () => providerTaxRate('unused'));

    await expect(
      planLegacyPaidOptionTaxRateImport({
        legacy: {
          stripeConnectAccountId: null,
          stripeReducedTaxRate: null,
          stripeRegularTaxRate: null,
        },
        paidOptions: [],
        retrieveTaxRate,
        target: { ...target, stripeAccountId: null },
      }),
    ).resolves.toEqual({ paidOptionTaxRateId: null, taxRates: [] });
    expect(retrieveTaxRate).not.toHaveBeenCalled();
  });
});
