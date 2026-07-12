import { describe, expect, it } from 'vitest';

import {
  resetAddOnPayment,
  resetRegistrationPayment,
} from './payment-configuration';

describe('payment configuration reset', () => {
  it('clears only registration payment fields', () => {
    expect(
      resetRegistrationPayment(
        {
          esnCardDiscountedPrice: 750,
          isPaid: true,
          price: 1000,
          roleIds: ['role-1'],
          stripeTaxRateId: 'txr_1',
          title: 'Participant',
        },
        null,
        null,
      ),
    ).toEqual({
      esnCardDiscountedPrice: null,
      isPaid: false,
      price: 0,
      roleIds: ['role-1'],
      stripeTaxRateId: null,
      title: 'Participant',
    });
  });

  it('clears only add-on payment fields and preserves an already-free value', () => {
    const free = {
      isPaid: false,
      price: 0,
      stripeTaxRateId: '',
      title: 'Dinner',
    };

    expect(resetAddOnPayment(free, '')).toBe(free);
    expect(
      resetAddOnPayment(
        { ...free, isPaid: true, price: 500, stripeTaxRateId: 'txr_2' },
        '',
      ),
    ).toEqual(free);
  });
});
