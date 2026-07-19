import { describe, expect, it } from 'vitest';

import { legacyRegistrationPricing } from '../../migration/legacy-event-prices';

const defaultOption = {
  allowedStatusList: ['NONE', 'TRIAL', 'FULL'],
  amount: '7.50',
  defaultPrice: true,
  esnCardRequired: false,
};

describe('legacy event price mapping', () => {
  it('preserves decimal-string base and ESNcard prices', () => {
    expect(
      legacyRegistrationPricing(
        'STRIPE',
        {
          options: [
            defaultOption,
            {
              allowedStatusList: ['NONE', 'TRIAL', 'FULL'],
              amount: '5',
              defaultPrice: false,
              esnCardRequired: true,
            },
          ],
        },
        ['NONE', 'TRIAL', 'FULL'],
      ),
    ).toEqual({
      basePriceInCents: 750,
      esnCardDiscountedPriceInCents: 500,
      isPaid: true,
    });
  });

  it('canonicalizes non-Stripe registration to free', () => {
    expect(
      legacyRegistrationPricing(
        'ONLINE',
        {
          options: [{ ...defaultOption, amount: '99' }],
        },
        ['NONE'],
      ),
    ).toEqual({
      basePriceInCents: 0,
      esnCardDiscountedPriceInCents: null,
      isPaid: false,
    });
  });

  it('blocks external registration without a target link representation', () => {
    expect(() => legacyRegistrationPricing('EXTERNAL', null, ['NONE'])).toThrow(
      'external registration has no target representation',
    );
  });

  it.each([
    [null, 'no valid price options'],
    [{ options: [] }, 'exactly one default price'],
    [{ options: [defaultOption, defaultOption] }, 'exactly one default price'],
    [
      { options: [{ ...defaultOption, amount: '-1' }] },
      'positive default or nonnegative alternative amount',
    ],
    [
      { options: [{ ...defaultOption, amount: '1.234' }] },
      'at most two decimal places',
    ],
    [
      { options: [{ ...defaultOption, amount: '30000000' }] },
      'at most two decimal places',
    ],
  ])('blocks malformed paid pricing %o', (prices, message) => {
    expect(() => legacyRegistrationPricing('STRIPE', prices, ['NONE'])).toThrow(
      message,
    );
  });

  it('blocks membership-only and ambiguous ESNcard alternatives', () => {
    expect(() =>
      legacyRegistrationPricing(
        'STRIPE',
        {
          options: [
            defaultOption,
            {
              ...defaultOption,
              amount: 6,
              defaultPrice: false,
            },
          ],
        },
        ['NONE'],
      ),
    ).toThrow('membership-only pricing');
    expect(() =>
      legacyRegistrationPricing(
        'STRIPE',
        {
          options: [
            defaultOption,
            {
              ...defaultOption,
              amount: 6,
              defaultPrice: false,
              esnCardRequired: true,
            },
            {
              ...defaultOption,
              amount: 5,
              defaultPrice: false,
              esnCardRequired: true,
            },
          ],
        },
        ['NONE'],
      ),
    ).toThrow('Multiple legacy ESNcard prices');
  });

  it.each([
    [0.29, 29],
    [19.99, 1_999],
  ])(
    'rounds an ordinary numeric price %s without floating-point loss',
    (amount, cents) => {
      expect(
        legacyRegistrationPricing(
          'STRIPE',
          { options: [{ ...defaultOption, amount }] },
          ['NONE'],
        ).basePriceInCents,
      ).toBe(cents);
    },
  );

  it('blocks an ESNcard discount that widens legacy status eligibility', () => {
    expect(() =>
      legacyRegistrationPricing(
        'STRIPE',
        {
          options: [
            defaultOption,
            {
              ...defaultOption,
              allowedStatusList: ['FULL'],
              amount: 5,
              defaultPrice: false,
              esnCardRequired: true,
            },
          ],
        },
        ['TRIAL', 'FULL'],
      ),
    ).toThrow('restricted to a subset');
  });

  it('blocks a default price that covers only some eligible statuses', () => {
    expect(() =>
      legacyRegistrationPricing(
        'STRIPE',
        {
          options: [
            {
              ...defaultOption,
              allowedStatusList: ['FULL'],
            },
          ],
        },
        ['TRIAL', 'FULL'],
      ),
    ).toThrow('Legacy default pricing is restricted to a subset');
  });

  it('preserves a free ESNcard alternative on a paid base price', () => {
    expect(
      legacyRegistrationPricing(
        'STRIPE',
        {
          options: [
            defaultOption,
            {
              ...defaultOption,
              amount: '0',
              defaultPrice: false,
              esnCardRequired: true,
            },
          ],
        },
        ['NONE'],
      ).esnCardDiscountedPriceInCents,
    ).toBe(0);
  });
});
