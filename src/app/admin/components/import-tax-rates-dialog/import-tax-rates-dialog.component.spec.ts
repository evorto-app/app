import { describe, expect, it } from 'vitest';

import {
  stripeTaxRatesDashboardLink,
  taxRateImportActionDisabled,
} from './import-tax-rates-dialog.component';

describe('stripeTaxRatesDashboardLink', () => {
  it('opens the live Stripe tax-rates dashboard with production-facing copy', () => {
    expect(stripeTaxRatesDashboardLink).toEqual({
      href: 'https://dashboard.stripe.com/tax-rates',
      label: 'Open Stripe tax rates',
    });
    expect(stripeTaxRatesDashboardLink.href).not.toContain('/test/');
  });
});

describe('taxRateImportActionDisabled', () => {
  it('disables import when no tax rates are selected', () => {
    expect(
      taxRateImportActionDisabled({
        mutationPending: false,
        selectedCount: 0,
      }),
    ).toBe(true);
  });

  it('disables import while an import is already pending', () => {
    expect(
      taxRateImportActionDisabled({
        mutationPending: true,
        selectedCount: 1,
      }),
    ).toBe(true);
  });

  it('allows import only when selected tax rates are idle', () => {
    expect(
      taxRateImportActionDisabled({
        mutationPending: false,
        selectedCount: 1,
      }),
    ).toBe(false);
  });
});
