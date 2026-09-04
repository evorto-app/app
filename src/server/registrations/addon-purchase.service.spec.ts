import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import { describe, expect, it, vi } from '@effect/vitest';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import { Effect, Layer } from 'effect';
import Stripe from 'stripe';

import { type eventAddons, type tenantStripeTaxRates } from '../../db/schema';
import { StripeClient } from '../stripe-client';
import { createRegistrationDatabaseTestLayer } from '../testing/registration-database';
import { createRejectingStripeClient } from '../testing/stripe-test-fixtures';
import {
  purchaseRegistrationAddon,
  registrationAddonPurchaseCapacity,
  resolveRegistrationAddonPurchaseAmounts,
  resolveRegistrationAddonPurchaseWindow,
} from './addon-purchase.service';

const createAddonPurchaseTaxFixture = ({
  includedQuantity = 0,
  isPaid = true,
  price = 100,
  stripeTaxRateId,
  taxRate,
}: Partial<Pick<typeof eventAddons.$inferSelect, 'isPaid' | 'price'>> &
  Pick<typeof eventAddons.$inferSelect, 'stripeTaxRateId'> & {
    includedQuantity?: number;
    taxRate?: Pick<
      typeof tenantStripeTaxRates.$inferSelect,
      'displayName' | 'inclusive' | 'percentage'
    >;
  }) => {
  const writes: string[] = [];
  const stripe = new Stripe('sk_test_addon_tax_boundary');
  const checkout = vi
    .spyOn(stripe.checkout.sessions, 'create')
    .mockRejectedValue(new Error('Unexpected Stripe Checkout creation'));
  const executeValues: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      if (statement.startsWith('select ')) {
        if (
          statement ===
          'select "communicationEmail", "email" from "users" where "users"."id" = $1 limit $2'
        ) {
          expect(parameters).toEqual(['user-1', 1]);
          return [['purchaser@example.com', 'purchaser@example.com']];
        }

        if (statement.includes(' from "event_registrations"')) {
          return [['event-1', 'option-1', 'CONFIRMED', 'user-1']];
        }
        if (
          statement.includes(' from "registration_transfers"') ||
          statement.includes(' from "event_registration_addon_purchase_orders"')
        ) {
          return [];
        }
        if (statement.includes(' from "event_registration_addon_purchases"')) {
          return includedQuantity > 0
            ? [
                [
                  'addon-1',
                  0,
                  '2026-09-15T12:00:00.000',
                  'event-1',
                  'purchase-1',
                  includedQuantity,
                  0,
                  includedQuantity,
                  0,
                  0,
                  'registration-1',
                  'option-1',
                  null,
                  null,
                  null,
                  'tenant-1',
                  0,
                  '2026-09-15T12:00:00.000',
                ],
              ]
            : [];
        }
        if (statement.includes(' from "tenants"')) {
          return [['EUR', 'tenant.example.com', 'acct_tenant']];
        }
        if (statement.includes(' from "event_addons"')) {
          return [
            [
              true,
              true,
              true,
              '2099-08-01T22:00:00.000',
              'APPROVED',
              'Event',
              isPaid,
              10,
              10,
              price,
              '2099-08-01T18:00:00.000',
              stripeTaxRateId,
              'Add-on',
              10,
            ],
          ];
        }
        if (statement.includes(' from "tenant_stripe_tax_rates"')) {
          expect(parameters).toEqual([
            'tenant-1',
            'acct_tenant',
            stripeTaxRateId,
            true,
            true,
          ]);
          expect(statement).toContain(' for update');
          return taxRate
            ? [[taxRate.displayName, taxRate.inclusive, taxRate.percentage]]
            : [];
        }
      }
      if (statement.startsWith('update "event_addons"')) {
        writes.push(statement);
        return [];
      }
      writes.push(statement);
      throw new Error(`Unexpected add-on tax fixture statement: ${statement}`);
    });
  const layer = Layer.mergeAll(
    createRegistrationDatabaseTestLayer({ executeValues }),
    Layer.succeed(StripeClient, stripe),
  );
  return { checkout, layer, writes };
};

const purchaseInput = {
  addonId: 'addon-1',
  operationKey: 'purchase-tax-check',
  quantity: 1,
  registrationId: 'registration-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
};

describe('persisted optional add-on tax configuration', () => {
  it.effect.each([
    { name: 'missing tax ID', stripeTaxRateId: null },
    { name: 'empty tax ID', stripeTaxRateId: '' },
    { name: 'missing tax row', stripeTaxRateId: 'txr_missing' },
    {
      name: 'null percentage',
      stripeTaxRateId: 'txr_null',
      taxRate: { displayName: 'Tax', inclusive: true, percentage: null },
    },
  ])(
    'rejects a paid add-on with $name before reserving stock',
    (configuration) =>
      Effect.gen(function* () {
        const fixture = createAddonPurchaseTaxFixture(configuration);
        const error = yield* purchaseRegistrationAddon(purchaseInput).pipe(
          Effect.provide(fixture.layer),
          Effect.flip,
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe(
          "Online payment cannot be started because this add-on's tax details are no longer available. No add-on purchase or payment was started. Contact the organizer.",
        );
        expect(fixture.writes).toEqual([]);
        expect(fixture.checkout).not.toHaveBeenCalled();
      }),
  );

  it.effect.each([
    {
      includedQuantity: 2,
      isPaid: false,
      name: 'a free add-on with included units and no tax ID',
      price: 0,
      stripeTaxRateId: null,
    },
    {
      name: 'a paid add-on with a zero-percent tax rate',
      stripeTaxRateId: 'txr_zero',
      taxRate: { displayName: 'Zero tax', inclusive: true, percentage: '0' },
    },
    {
      name: 'a paid add-on with a positive tax rate',
      stripeTaxRateId: 'txr_19',
      taxRate: { displayName: 'VAT', inclusive: true, percentage: '19' },
    },
  ])('allows $name through to the stock reservation', (configuration) =>
    Effect.gen(function* () {
      const fixture = createAddonPurchaseTaxFixture(configuration);
      const error = yield* purchaseRegistrationAddon(purchaseInput).pipe(
        Effect.provide(fixture.layer),
        Effect.flip,
      );

      expect(error).toBeInstanceOf(EventRegistrationConflictError);
      expect(error.message).toBe('There are not enough of this add-on left.');
      expect(fixture.writes).toHaveLength(1);
      expect(fixture.writes[0]).toContain('update "event_addons"');
      expect(fixture.checkout).not.toHaveBeenCalled();
    }),
  );
});

describe('registration add-on purchase policy', () => {
  const start = new Date('2026-08-01T18:00:00.000Z');
  const end = new Date('2026-08-01T22:00:00.000Z');

  it('uses an exclusive start boundary for before-event purchases', () => {
    expect(
      resolveRegistrationAddonPurchaseWindow({
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: false,
        end,
        now: new Date('2026-08-01T17:59:59.999Z'),
        start,
      }),
    ).toBe('before_event');
    expect(
      resolveRegistrationAddonPurchaseWindow({
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: true,
        end,
        now: start,
        start,
      }),
    ).toBe('during_event');
  });

  it('keeps the end boundary closed and respects each configured window', () => {
    expect(
      resolveRegistrationAddonPurchaseWindow({
        allowPurchaseBeforeEvent: false,
        allowPurchaseDuringEvent: true,
        end,
        now: new Date('2026-08-01T17:59:59.999Z'),
        start,
      }),
    ).toBeUndefined();
    expect(
      resolveRegistrationAddonPurchaseWindow({
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: true,
        end,
        now: end,
        start,
      }),
    ).toBeUndefined();
  });

  it('counts settled and pending optional units but not included units', () => {
    expect(
      registrationAddonPurchaseCapacity({
        allowMultiple: true,
        includedQuantity: 0,
        maxQuantityPerUser: 5,
        optionalPurchaseQuantity: 3,
        pendingOptionalQuantity: 1,
        purchasedOptionalQuantity: 1,
        requestedQuantity: 1,
        stock: 1,
      }),
    ).toBe('available');
    expect(
      registrationAddonPurchaseCapacity({
        allowMultiple: true,
        includedQuantity: 0,
        maxQuantityPerUser: 5,
        optionalPurchaseQuantity: 3,
        pendingOptionalQuantity: 1,
        purchasedOptionalQuantity: 1,
        requestedQuantity: 2,
        stock: 2,
      }),
    ).toBe('option_limit_exceeded');
  });

  it('enforces lifetime single-unit, per-user, and stock limits', () => {
    expect(
      registrationAddonPurchaseCapacity({
        allowMultiple: false,
        includedQuantity: 0,
        maxQuantityPerUser: 5,
        optionalPurchaseQuantity: 5,
        pendingOptionalQuantity: 0,
        purchasedOptionalQuantity: 1,
        requestedQuantity: 1,
        stock: 10,
      }),
    ).toBe('multiple_not_allowed');
    expect(
      registrationAddonPurchaseCapacity({
        allowMultiple: true,
        includedQuantity: 0,
        maxQuantityPerUser: 2,
        optionalPurchaseQuantity: 5,
        pendingOptionalQuantity: 0,
        purchasedOptionalQuantity: 2,
        requestedQuantity: 1,
        stock: 10,
      }),
    ).toBe('user_limit_exceeded');
    expect(
      registrationAddonPurchaseCapacity({
        allowMultiple: true,
        includedQuantity: 0,
        maxQuantityPerUser: 5,
        optionalPurchaseQuantity: 5,
        pendingOptionalQuantity: 0,
        purchasedOptionalQuantity: 0,
        requestedQuantity: 2,
        stock: 1,
      }),
    ).toBe('out_of_stock');
  });

  it('accepts the product cap and rejects one unit beyond it', () => {
    expect(
      registrationAddonPurchaseCapacity({
        allowMultiple: true,
        includedQuantity: 2,
        maxQuantityPerUser: 10,
        optionalPurchaseQuantity: 10,
        pendingOptionalQuantity: 0,
        purchasedOptionalQuantity: 0,
        requestedQuantity: 8,
        stock: 10,
      }),
    ).toBe('available');
    expect(
      registrationAddonPurchaseCapacity({
        allowMultiple: true,
        includedQuantity: 2,
        maxQuantityPerUser: 10,
        optionalPurchaseQuantity: 10,
        pendingOptionalQuantity: 0,
        purchasedOptionalQuantity: 0,
        requestedQuantity: 9,
        stock: 10,
      }),
    ).toBe('user_limit_exceeded');
  });

  it('derives exact no-tax and Stripe tax amounts before reserving stock', () => {
    expect(
      resolveRegistrationAddonPurchaseAmounts({
        quantity: 2,
        taxRateInclusive: null,
        taxRatePercentage: null,
        unitPrice: 100,
      }),
    ).toEqual({
      applicationFeeAmount: 7,
      baseAmount: 200,
      expectedGrossAmount: 200,
      taxAmount: 0,
    });
    expect(
      resolveRegistrationAddonPurchaseAmounts({
        quantity: 2,
        taxRateInclusive: false,
        taxRatePercentage: '19',
        unitPrice: 100,
      }),
    ).toEqual({
      applicationFeeAmount: 8,
      baseAmount: 200,
      expectedGrossAmount: 238,
      taxAmount: 38,
    });
    expect(
      resolveRegistrationAddonPurchaseAmounts({
        quantity: 2,
        taxRateInclusive: true,
        taxRatePercentage: '19',
        unitPrice: 100,
      }),
    ).toEqual({
      applicationFeeAmount: 7,
      baseAmount: 200,
      expectedGrossAmount: 200,
      taxAmount: 32,
    });
  });

  it('rejects unsafe quantities and incomplete tax snapshots', () => {
    expect(
      resolveRegistrationAddonPurchaseAmounts({
        quantity: 0,
        taxRateInclusive: null,
        taxRatePercentage: null,
        unitPrice: 100,
      }),
    ).toBeUndefined();
    expect(
      resolveRegistrationAddonPurchaseAmounts({
        quantity: 1,
        taxRateInclusive: null,
        taxRatePercentage: '19',
        unitPrice: 100,
      }),
    ).toBeUndefined();
  });

  it.effect(
    'aborts before add-on mutations when the required ticket owner is missing',
    () =>
      Effect.gen(function* () {
        const commands: string[] = [];
        const select = vi.fn<SqlConnection.Connection['executeValues']>(
          (statement, parameters) =>
            Effect.sync(() => {
              expect(commands).toEqual(['BEGIN']);
              if (
                statement ===
                'select "eventId", "registrationOptionId", "status", "userId" from "event_registrations" where (("event_registrations"."id" = $1) and ("event_registrations"."tenantId" = $2)) for update'
              ) {
                expect(parameters).toEqual(['registration-1', 'tenant-1']);
                return [['event-1', 'option-1', 'CONFIRMED', 'user-1']];
              }
              expect(statement).toBe(
                'select "communicationEmail", "email" from "users" where "users"."id" = $1 limit $2',
              );
              expect(parameters).toEqual(['user-1', 1]);
              return [];
            }),
        );
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: select,
          transactionControl: (command) =>
            Effect.sync(() => {
              commands.push(command);
            }),
        });

        const error = yield* purchaseRegistrationAddon({
          addonId: 'addon-1',
          operationKey: 'missing-owner',
          quantity: 1,
          registrationId: 'registration-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
        }).pipe(
          Effect.flip,
          Effect.provide(databaseLayer),
          Effect.provideService(StripeClient, createRejectingStripeClient()),
        );

        expect(error).toBeInstanceOf(EventRegistrationInternalError);
        expect(error.message).toBe(
          'The ticket owner could not be verified. No add-on purchase was started. Reopen the ticket and try again.',
        );
        expect(select).toHaveBeenCalledTimes(2);
        expect(
          select.mock.calls.every(([statement]) =>
            statement.startsWith('select '),
          ),
        ).toBe(true);
        expect(commands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
  );
});
