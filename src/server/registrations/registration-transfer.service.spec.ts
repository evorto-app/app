import { describe, expect, it, vi } from '@effect/vitest';
import { Cause, Effect, Exit, Layer, Schema } from 'effect';
import Stripe from 'stripe';

import { Database } from '../../db';
import {
  RegistrationTransferInternalError,
  RegistrationTransferNotFoundError,
} from '../../shared/rpc-contracts/app-rpcs/registration-transfers.errors';
import { createDefaultTenantDiscountProviders } from '../../shared/tenant-config';
import { StripeClient } from '../stripe-client';
import { createDatabaseTestLayer } from '../testing/database-test-layer';
import {
  registrationTransferGuestCheckoutLine,
  RegistrationTransferService,
  resumeRegistrationTransferCheckout,
} from './registration-transfer.service';

describe('RegistrationTransferService.getClaim tenant settings', () => {
  const createClaimDatabase = (
    tenantRecord: undefined | { discountProviders: null | object },
  ) => {
    const executeValues = vi.fn(
      (statement: string, parameters: readonly unknown[]) =>
        Effect.sync(() => {
          expect(statement.startsWith('select ')).toBe(true);
          if (statement.includes('from "registration_transfers"')) {
            expect(parameters).toContain('tenant-1');
            // Match the public claim query's selected column order.
            return [
              [
                null,
                '2099-09-18T12:00:00.000',
                'event-1',
                '2099-09-18T10:00:00.000',
                'Transfer event',
                '2099-09-17T10:00:00.000',
                null,
                'option-1',
                true,
                1000,
                'Admission',
                null,
                null,
                null,
                null,
                null,
                0,
                null,
                'registration-1',
                1,
                'open',
                'transfer-1',
              ],
            ];
          }
          if (statement.includes('from "tenants"')) {
            expect(parameters).toContain('tenant-1');
            return tenantRecord ? [[tenantRecord.discountProviders]] : [];
          }
          const emptyReadTables = [
            'event_registration_questions',
            'registration_transfer_bundle_addon_purchases',
            'registration_transfer_refund_plan_items',
            'user_discount_cards',
            'event_registration_option_discounts',
          ];
          if (
            emptyReadTables.some((table) =>
              statement.includes(`from "${table}"`),
            )
          ) {
            return [];
          }
          throw new Error(`Unexpected claim query: ${statement}`);
        }),
    );
    return {
      executeValues,
      layer: createDatabaseTestLayer(executeValues),
    };
  };

  const getClaim = Effect.gen(function* () {
    const service = yield* RegistrationTransferService;
    return yield* service.getClaim({
      credential: 'claim-token',
      tenant: {
        cancellationDeadlineHoursBeforeStart: 24,
        currency: 'EUR',
        domain: 'tenant.example.com',
        emailSenderEmail: null,
        emailSenderName: null,
        id: 'tenant-1',
        maxActiveRegistrationsPerUser: 10,
        name: 'Tenant',
        refundFeesOnCancellation: false,
        stripeAccountId: null,
        transferDeadlineHoursBeforeStart: 24,
      },
      user: {
        communicationEmail: 'recipient@example.com',
        email: 'recipient@example.com',
        id: 'recipient-1',
        roleIds: [],
      },
    });
  }).pipe(Effect.provide(RegistrationTransferService.Default));

  it.effect('returns not found when the pricing tenant no longer exists', () =>
    Effect.gen(function* () {
      const database = createClaimDatabase(undefined);
      const error = yield* getClaim.pipe(
        Effect.provide(database.layer),
        Effect.flip,
      );
      expect(error).toBeInstanceOf(RegistrationTransferNotFoundError);
      expect(error.message).toBe('Registration transfer not found');
      expect(
        database.executeValues.mock.calls.filter(([statement]) =>
          statement.includes('from "tenants"'),
        ),
      ).toHaveLength(1);
    }),
  );

  for (const discountProviders of [
    null,
    {},
    { esnCard: { config: {}, status: 'invalid' } },
  ]) {
    it.effect(
      `preserves invalid persisted tenant settings as a schema defect: ${JSON.stringify(discountProviders)}`,
      () =>
        Effect.gen(function* () {
          const database = createClaimDatabase({ discountProviders });
          const exit = yield* getClaim.pipe(
            Effect.provide(database.layer),
            Effect.exit,
          );
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isSuccess(exit)) {
            throw new Error('Expected invalid persisted settings to fail');
          }
          expect(Cause.hasDies(exit.cause)).toBe(true);
          const defect = exit.cause.reasons.find((reason) =>
            Cause.isDieReason(reason),
          );
          expect(defect).toBeDefined();
          if (!defect) throw new Error('Expected a schema defect');
          expect(Schema.isSchemaError(defect.defect)).toBe(true);
          expect(
            database.executeValues.mock.calls.filter(([statement]) =>
              statement.includes('from "tenants"'),
            ),
          ).toHaveLength(1);
        }),
    );
  }

  it.effect(
    'returns current pricing for complete persisted tenant settings',
    () =>
      Effect.gen(function* () {
        const database = createClaimDatabase({
          discountProviders: createDefaultTenantDiscountProviders(),
        });
        const claim = yield* getClaim.pipe(Effect.provide(database.layer));
        expect(claim).toMatchObject({
          recipientBundlePrice: 1000,
          registrationOption: { basePrice: 1000, currentPrice: 1000 },
          status: 'open',
          transferId: 'transfer-1',
        });
      }),
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
