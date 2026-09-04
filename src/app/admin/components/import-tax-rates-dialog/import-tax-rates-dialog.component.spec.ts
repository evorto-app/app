import {
  RpcBadRequestError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import { describe, expect, it } from 'vitest';

import {
  stripeTaxRatesDashboardLink,
  taxRateCatalogErrorMessage,
  taxRateImportActionDisabled,
  taxRateImportErrorMessage,
} from './import-tax-rates-dialog.component';

describe('stripeTaxRatesDashboardLink', () => {
  it('opens the live Stripe tax-rates dashboard with production-facing copy', () => {
    expect(stripeTaxRatesDashboardLink).toEqual({
      href: 'https://dashboard.stripe.com/tax-rates',
      label: 'Open tax rate settings',
    });
    expect(stripeTaxRatesDashboardLink.href).not.toContain('/test/');
  });
});

describe('taxRateImportActionDisabled', () => {
  it('disables import when no tax rates are selected', () => {
    expect(
      taxRateImportActionDisabled({
        mutationPending: false,
        ratesReady: true,
        selectedCount: 0,
      }),
    ).toBe(true);
  });

  it('disables import while an import is already pending', () => {
    expect(
      taxRateImportActionDisabled({
        mutationPending: true,
        ratesReady: true,
        selectedCount: 1,
      }),
    ).toBe(true);
  });

  it('allows import only when selected tax rates are idle', () => {
    expect(
      taxRateImportActionDisabled({
        mutationPending: false,
        ratesReady: true,
        selectedCount: 1,
      }),
    ).toBe(false);
  });

  it('blocks import when the tax-rate list is unavailable', () => {
    expect(
      taxRateImportActionDisabled({
        mutationPending: false,
        ratesReady: false,
        selectedCount: 1,
      }),
    ).toBe(true);
  });
});

describe('tax-rate error copy', () => {
  it('shows the expected action from a safe list error', () => {
    expect(
      taxRateCatalogErrorMessage({
        _tag: 'RpcBadRequestError',
        message:
          'There are too many tax rates to load at once. Archive tax rates you no longer use, then try again.',
      }),
    ).toContain('Archive tax rates you no longer use');
  });

  it('shows the expected action from a safe import error', () => {
    expect(
      taxRateImportErrorMessage(
        new RpcBadRequestError({
          message:
            'A selected tax rate is no longer available. No tax rates were added. Select the tax rates again, then choose Add selected.',
        }),
      ),
    ).toContain('Select the tax rates again');
  });
});

describe('unconfirmed tax-rate import feedback', () => {
  it.each([
    { error: new Error('Response connection closed'), name: 'a lost response' },
    {
      error: new RpcInternalServerError({
        message: 'Private persistence failure details',
      }),
      name: 'an internal failure',
    },
  ])('keeps the persisted outcome uncertain for $name', ({ error }) => {
    const message = taxRateImportErrorMessage(error);
    expect(message).toBe(
      'The import outcome could not be confirmed. Reload the page to check the current tax rates before trying again.',
    );
    expect(message).not.toContain('Nothing changed');
    expect(message).not.toContain(error.message);
  });
});
