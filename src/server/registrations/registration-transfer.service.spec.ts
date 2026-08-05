import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { readFileSync } from 'node:fs';
import Stripe from 'stripe';

import { Database } from '../../db';
import {
  RegistrationTransferConflictError,
  RegistrationTransferInternalError,
} from '../../shared/rpc-contracts/app-rpcs/registration-transfers.errors';
import { StripeClient } from '../stripe-client';
import { RegistrationTransferPricingError } from './registration-transfer-pricing';
import { RegistrationTransferStateError } from './registration-transfer-state';
import {
  registrationTransferDeadlineFailure,
  registrationTransferGuestCheckoutLine,
  registrationTransferPricingFailure,
  resumeRegistrationTransferCheckout,
} from './registration-transfer.service';

const registrationTransferServiceSource = readFileSync(
  new URL('registration-transfer.service.ts', import.meta.url),
  'utf8',
);
const registrationTransferHandlerSource = readFileSync(
  new URL(
    '../effect/rpc/handlers/registration-transfers.handlers.ts',
    import.meta.url,
  ),
  'utf8',
);

const directExpectedOutcomeBodies = [
  ...registrationTransferServiceSource.matchAll(
    /new RegistrationTransfer(?:Conflict|NotFound)Error\(\{([\s\S]*?)\}\)/gu,
  ),
].map((match) => match[1] ?? '');

describe('ticket transfer expected outcome language', () => {
  it('keeps every direct expected outcome in plain product wording', () => {
    const directExpectedOutcomeCount = [
      ...registrationTransferServiceSource.matchAll(
        /new RegistrationTransfer(?:Conflict|NotFound)Error/gu,
      ),
    ].length;
    expect(directExpectedOutcomeBodies).toHaveLength(
      directExpectedOutcomeCount,
    );

    const literalMessages = directExpectedOutcomeBodies.flatMap((body) =>
      [...body.matchAll(/(['"])(.*?)\1/gsu)].map((match) => match[2] ?? ''),
    );
    expect(literalMessages.length).toBeGreaterThan(35);
    for (const message of literalMessages) {
      expect(message).not.toMatch(
        /\b(?:bundle|checkout|claim|IDs?|operation|protocol|registration|source|state|stripe|supported|tenant)\b/iu,
      );
    }
  });

  it('keeps distinct next actions and explicit unchanged outcomes', () => {
    expect(registrationTransferServiceSource).toContain(
      'A previous refund for this ticket is still unfinished. No ticket transfer or new refund was started. Wait for the refund to finish, then try again.',
    );
    expect(registrationTransferServiceSource).toContain(
      'This sign-up choice is not available to you. The ticket transfer was not accepted, and no payment or refund was started.',
    );
    expect(registrationTransferServiceSource).toContain(
      "Payment is already complete, so this ticket transfer cannot be cancelled here. No refund was started. Reopen the ticket and review the transfer's current outcome.",
    );
    expect(registrationTransferServiceSource).toContain(
      'The payment link expired. No payment was taken or refund started, and the original ticket and add-ons remain with the sender.',
    );
    expect(registrationTransferServiceSource).toContain(
      "refundOutcome: refundClaimIds.length > 0 ? 'pending' : 'notStarted'",
    );
    expect(registrationTransferServiceSource).toContain(
      'comment: `Ticket transfer payment for ${lockedOption.eventTitle}`',
    );
    expect(registrationTransferServiceSource).not.toContain(
      'comment: `Registration transfer payment for ${lockedOption.eventTitle}`',
    );
  });

  it('asks signed-out people to sign in without account jargon', () => {
    expect(registrationTransferHandlerSource).toContain(
      'Sign in to open or manage a ticket transfer. No ticket, payment, or refund was changed.',
    );
    expect(registrationTransferHandlerSource).not.toContain(
      'Authenticated participant account required',
    );
  });
});

describe('registration transfer invariant failures', () => {
  it('keeps an elapsed deadline as an expected conflict', () => {
    const failure = registrationTransferDeadlineFailure(
      new RegistrationTransferStateError({
        message:
          'This ticket can no longer be transferred because the deadline has passed.',
        reason: 'deadlinePassed',
      }),
    );

    expect(failure).toBeInstanceOf(RegistrationTransferConflictError);
    expect(failure.message).toBe(
      'The ticket transfer deadline has passed. No ticket transfer was started.',
    );
  });

  it('treats an invalid saved deadline as an internal defect without exposing details', () => {
    const failure = registrationTransferDeadlineFailure(
      new RegistrationTransferStateError({
        message: 'Transfer deadline must be a non-negative integer',
        reason: 'invalidDeadlinePolicy',
      }),
    );

    expect(failure).toBeInstanceOf(RegistrationTransferInternalError);
    expect(failure.message).toBe(
      'The transfer deadline settings are invalid. No transfer was started. Ask an organizer to review them.',
    );
    expect(failure.message).not.toContain('non-negative integer');
  });

  it.each([
    {
      expected:
        'The saved price for this transfer is invalid. No payment was started. Ask an organizer for help.',
      reason: 'invalidAmount' as const,
    },
    {
      expected:
        'The total price for this transfer is too high. No payment was started. Ask an organizer for help.',
      reason: 'amountTooLarge' as const,
    },
  ])(
    'maps $reason pricing to a plain internal failure',
    ({ expected, reason }) => {
      const failure = registrationTransferPricingFailure(
        new RegistrationTransferPricingError({
          message: 'sensitive saved pricing details',
          reason,
        }),
      );

      expect(failure).toBeInstanceOf(RegistrationTransferInternalError);
      expect(failure.message).toBe(expected);
      expect(failure.message).not.toContain('sensitive saved pricing details');
    },
  );
});

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
      name: 'Guest ticket for Paid event',
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
          message: expect.stringContaining(
            'unbound Checkout session could not be expired',
          ),
        });
        expect(error).not.toHaveProperty('cause');
      }),
  );
});
