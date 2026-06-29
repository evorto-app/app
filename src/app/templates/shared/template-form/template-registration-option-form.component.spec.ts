import { describe, expect, it } from 'vitest';

import { templateTaxRateOptionsMessage } from './template-registration-option-form.component';

describe('templateTaxRateOptionsMessage', () => {
  it('explains loading, empty, and failed tax-rate select states', () => {
    expect(
      templateTaxRateOptionsMessage({
        isPending: true,
        isSuccess: false,
        rateCount: 0,
      }),
    ).toBe('Loading tax rates ...');

    expect(
      templateTaxRateOptionsMessage({
        isPending: false,
        isSuccess: true,
        rateCount: 0,
      }),
    ).toBe('No active inclusive tax rates available');

    expect(
      templateTaxRateOptionsMessage({
        isPending: false,
        isSuccess: false,
        rateCount: 0,
      }),
    ).toBe('Failed to load tax rates');
  });

  it('stays quiet when compatible tax rates are available', () => {
    expect(
      templateTaxRateOptionsMessage({
        isPending: false,
        isSuccess: true,
        rateCount: 1,
      }),
    ).toBeNull();
  });
});
