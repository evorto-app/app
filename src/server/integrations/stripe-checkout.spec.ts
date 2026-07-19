import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { Effect } from 'effect';
import { DateTime } from 'luxon';
import Stripe from 'stripe';

import { StripeClient } from '../stripe-client';
import {
  buildCheckoutSessionExpiresAt,
  buildCheckoutSessionIdempotencyKey,
  createHostedCheckoutSession,
  expireHostedCheckoutSession,
  retrieveHostedCheckoutSession,
} from './stripe-checkout';

const createSessionMock = vi.fn();
const expireSessionMock = vi.fn();
const retrieveSessionMock = vi.fn();
const dummyStripeKey = 'test_stripe_key';

const createStripeClient = () => {
  const stripeClient = new Stripe(dummyStripeKey);
  vi.spyOn(stripeClient.checkout.sessions, 'create').mockImplementation(
    createSessionMock,
  );
  vi.spyOn(stripeClient.checkout.sessions, 'expire').mockImplementation(
    expireSessionMock,
  );
  vi.spyOn(stripeClient.checkout.sessions, 'retrieve').mockImplementation(
    retrieveSessionMock,
  );
  return stripeClient;
};

describe('stripe-checkout helpers', () => {
  afterEach(() => {
    createSessionMock.mockReset();
    expireSessionMock.mockReset();
    retrieveSessionMock.mockReset();
    vi.useRealTimers();
  });

  it('builds a stable checkout idempotency key', () => {
    expect(
      buildCheckoutSessionIdempotencyKey({
        registrationId: 'reg_123',
        transactionId: 'txn_456',
      }),
    ).toBe('registration:reg_123:transaction:txn_456');
  });

  it('derives checkout expiry from E2E_NOW_ISO when it is ahead of wall clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));

    const expected = Math.ceil(
      DateTime.fromISO('2026-01-15T18:00:00.000Z', { zone: 'utc' })
        .plus({ minutes: 30 })
        .toSeconds(),
    );
    expect(
      buildCheckoutSessionExpiresAt(30, {
        pinnedNowIso: '2026-01-15T18:00:00.000Z',
      }),
    ).toBe(expected);
  });

  it('falls back to wall clock when E2E_NOW_ISO is in the past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));

    const expected = Math.ceil(
      DateTime.fromISO('2026-03-01T12:00:00.000Z', { zone: 'utc' })
        .plus({ minutes: 35 })
        .toSeconds(),
    );
    expect(
      buildCheckoutSessionExpiresAt(30, {
        pinnedNowIso: '2026-02-01T12:00:00.000Z',
      }),
    ).toBe(expected);
  });

  it("keeps checkout expiry valid after Stripe's minimum-window request delay", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));

    const expiresAt = buildCheckoutSessionExpiresAt();

    vi.setSystemTime(new Date('2026-03-01T12:05:00.000Z'));
    expect(expiresAt - DateTime.now().setZone('utc').toSeconds()).toBe(30 * 60);
  });

  it("clamps checkout expiry safely below Stripe's 24-hour maximum", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));

    const expected = Math.ceil(
      DateTime.fromISO('2026-01-16T11:55:00.000Z', { zone: 'utc' }).toSeconds(),
    );
    const expiresAt = buildCheckoutSessionExpiresAt(30, {
      pinnedNowIso: '2026-01-17T18:00:00.000Z',
    });

    expect(expiresAt).toBe(expected);
    expect(
      expiresAt -
        DateTime.fromISO('2026-01-15T12:00:00.000Z', {
          zone: 'utc',
        }).toSeconds(),
    ).toBeLessThan(24 * 60 * 60);
  });

  it.effect(
    'forwards checkout payload and request options to Stripe client',
    () =>
      Effect.gen(function* () {
        createSessionMock.mockResolvedValueOnce({ id: 'cs_test_mock' });
        const stripeClient = createStripeClient();

        const session = yield* createHostedCheckoutSession(
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
        ).pipe(Effect.provideService(StripeClient, stripeClient));

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
      }),
  );

  it.effect('expires a hosted checkout in the connected account', () =>
    Effect.gen(function* () {
      expireSessionMock.mockResolvedValueOnce({
        id: 'cs_test_mock',
        status: 'expired',
      });
      const stripeClient = createStripeClient();

      const session = yield* expireHostedCheckoutSession(
        'cs_test_mock',
        'acct_test_123',
      ).pipe(Effect.provideService(StripeClient, stripeClient));

      expect(session).toEqual({ id: 'cs_test_mock', status: 'expired' });
      expect(expireSessionMock).toHaveBeenCalledWith(
        'cs_test_mock',
        undefined,
        { stripeAccount: 'acct_test_123' },
      );
    }),
  );

  it.effect('retrieves a hosted checkout in the connected account', () =>
    Effect.gen(function* () {
      retrieveSessionMock.mockResolvedValueOnce({
        id: 'cs_test_mock',
        status: 'open',
      });
      const stripeClient = createStripeClient();

      const session = yield* retrieveHostedCheckoutSession(
        'cs_test_mock',
        'acct_test_123',
      ).pipe(Effect.provideService(StripeClient, stripeClient));

      expect(session).toEqual({ id: 'cs_test_mock', status: 'open' });
      expect(retrieveSessionMock).toHaveBeenCalledWith(
        'cs_test_mock',
        undefined,
        { stripeAccount: 'acct_test_123' },
      );
    }),
  );

  it.effect(
    'surfaces Stripe client errors without requiring env configuration',
    () =>
      Effect.gen(function* () {
        const cause = new Error('stripe request failed');
        createSessionMock.mockRejectedValueOnce(cause);
        const stripeClient = createStripeClient();

        const error = yield* Effect.flip(
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
          ).pipe(Effect.provideService(StripeClient, stripeClient)),
        );
        expect(error.message).toBe('Stripe checkout session request failed');
        expect(error.cause).toBe(cause);
      }),
  );
});
