import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import Stripe from 'stripe';

import { Database } from '../../db';
import { RegistrationTransferInternalError } from '../../shared/rpc-contracts/app-rpcs/registration-transfers.errors';
import { StripeClient } from '../stripe-client';
import {
  registrationTransferGuestCheckoutLine,
  resumeRegistrationTransferCheckout,
} from './registration-transfer.service';

describe('registrationTransferGuestCheckoutLine', () => {
  it('omits a zero-value guest line when a paid add-on still requires Checkout', () => {
    const addOnLine = {
      addonId: 'addon-1',
      allocationKey: 'transfer-addon:purchase-1',
      kind: 'addon' as const,
      name: 'Paid add-on',
      quantity: 1,
      unitAmount: 500,
    };
    const guestLine = registrationTransferGuestCheckoutLine({
      eventTitle: 'Free event',
      guestCount: 2,
      guestUnitPrice: 0,
      stripeTaxRateId: null,
    });
    const lineItems = guestLine ? [addOnLine, guestLine] : [addOnLine];

    expect(lineItems).toEqual([
      expect.objectContaining({
        addonId: 'addon-1',
        quantity: 1,
        unitAmount: 500,
      }),
    ]);
    expect(lineItems.every(({ unitAmount }) => unitAmount > 0)).toBe(true);
  });

  it('retains a positive guest line and its tax rate', () => {
    expect(
      registrationTransferGuestCheckoutLine({
        eventTitle: 'Paid event',
        guestCount: 2,
        guestUnitPrice: 1000,
        stripeTaxRateId: 'txr_guest',
      }),
    ).toEqual({
      name: 'Guest registration fee for Paid event',
      quantity: 2,
      taxRateId: 'txr_guest',
      unitAmount: 1000,
    });
  });
});

describe('resumeRegistrationTransferCheckout', () => {
  it.effect(
    'preserves a failed unbound Checkout expiry as an internal error',
    () =>
      Effect.gen(function* () {
        const transaction = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => Effect.succeed([]),
              }),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => ({
                returning: () => Effect.succeed([]),
              }),
            }),
          }),
        };
        const database = {
          transaction: (
            run: (
              currentTransaction: typeof transaction,
            ) => Effect.Effect<unknown>,
          ) => run(transaction),
        };
        const stripe = new Stripe('sk_test_transfer_cleanup');
        vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({
          id: 'cs_unbound',
          url: 'https://checkout.stripe.test/cs_unbound',
        } as Stripe.Checkout.Session);
        const expiryCause = new Error('Stripe expiry unavailable');
        const expire = vi
          .spyOn(stripe.checkout.sessions, 'expire')
          .mockRejectedValue(expiryCause);

        const error = yield* resumeRegistrationTransferCheckout({
          paymentClaim: {
            appFee: 35,
            currency: 'EUR',
            id: 'transaction-1',
            request: {
              customerEmail: 'recipient@example.com',
              eventTitle: 'Event',
              eventUrl: 'https://tenant.example.com/events/event-1',
              expiresAt: 1_900_000_000,
              lineItems: [
                {
                  name: 'Registration fee',
                  quantity: 1,
                  unitAmount: 1000,
                },
              ],
              notificationEmail: 'recipient@example.com',
            },
            stripeAccountId: 'acct_tenant',
          },
          registrationId: 'registration-1',
          tenantId: 'tenant-1',
          transferId: 'transfer-1',
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Database, database as never),
              Layer.succeed(StripeClient, stripe),
            ),
          ),
          Effect.flip,
        );

        expect(expire).toHaveBeenCalledWith('cs_unbound', undefined, {
          stripeAccount: 'acct_tenant',
        });
        expect(error).toBeInstanceOf(RegistrationTransferInternalError);
        expect(error).toMatchObject({
          cause: {
            _tag: 'StripeCheckoutError',
            cause: expiryCause,
          },
          message: expect.stringContaining(
            'unbound Checkout session could not be expired',
          ),
        });
      }),
  );
});
