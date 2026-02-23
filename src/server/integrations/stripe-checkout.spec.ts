import { DateTime } from 'luxon';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetStripeClientLoaderForTests,
  __setStripeClientLoaderForTests,
  buildCheckoutSessionExpiresAt,
  buildCheckoutSessionIdempotencyKey,
  createHostedCheckoutSession,
} from './stripe-checkout';

const createSessionMock = vi.fn();

describe('stripe-checkout helpers', () => {
  afterEach(() => {
    createSessionMock.mockReset();
    __resetStripeClientLoaderForTests();
    vi.unstubAllEnvs();
  });

  it('builds a stable checkout idempotency key', () => {
    expect(
      buildCheckoutSessionIdempotencyKey({
        registrationId: 'reg_123',
        transactionId: 'txn_456',
      }),
    ).toBe('registration:reg_123:transaction:txn_456');
  });

  it('derives checkout expiry from E2E_NOW_ISO when present', () => {
    vi.stubEnv('E2E_NOW_ISO', '2026-02-01T12:00:00.000Z');

    const expected = Math.ceil(
      DateTime.fromISO('2026-02-01T12:00:00.000Z', { zone: 'utc' })
        .plus({ minutes: 30 })
        .toSeconds(),
    );
    expect(buildCheckoutSessionExpiresAt(30)).toBe(expected);
  });

  it('forwards checkout payload and request options to Stripe client', async () => {
    createSessionMock.mockResolvedValueOnce({ id: 'cs_test_mock' });
    __setStripeClientLoaderForTests(async () => ({
      checkout: {
        sessions: {
          create: createSessionMock,
        },
      },
    }));

    const session = await createHostedCheckoutSession(
      {
        cancel_url: 'http://localhost:4200/events/event-1?registrationStatus=cancel',
        mode: 'payment',
        success_url:
          'http://localhost:4200/events/event-1?registrationStatus=success',
      },
      {
        idempotencyKey: 'registration:reg_123:transaction:txn_456',
        stripeAccount: 'acct_test_123',
      },
    );

    expect(session).toEqual({ id: 'cs_test_mock' });
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
      }),
      {
        idempotencyKey: 'registration:reg_123:transaction:txn_456',
        stripeAccount: 'acct_test_123',
      },
    );
  });

  it('surfaces Stripe client errors without requiring env configuration', async () => {
    createSessionMock.mockRejectedValueOnce(new Error('stripe request failed'));
    __setStripeClientLoaderForTests(async () => ({
      checkout: {
        sessions: {
          create: createSessionMock,
        },
      },
    }));

    await expect(
      createHostedCheckoutSession(
        {
          cancel_url:
            'http://localhost:4200/events/event-1?registrationStatus=cancel',
          mode: 'payment',
          success_url:
            'http://localhost:4200/events/event-1?registrationStatus=success',
        },
        {
          idempotencyKey: 'registration:reg_123:transaction:txn_456',
          stripeAccount: 'acct_test_123',
        },
      ),
    ).rejects.toThrow('stripe request failed');
  });
});
