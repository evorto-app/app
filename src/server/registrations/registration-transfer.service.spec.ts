import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import { describe, expect, it, vi } from '@effect/vitest';
import { getTableName } from 'drizzle-orm';
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Result,
  Schema,
} from 'effect';
import Stripe from 'stripe';

import { transactions } from '../../db/schema';
import { MAX_EVENT_ADDON_TYPES } from '../../shared/registration-quantity-limits';
import {
  RegistrationTransferConflictError,
  RegistrationTransferInternalError,
  RegistrationTransferNotFoundError,
} from '../../shared/rpc-contracts/app-rpcs/registration-transfers.errors';
import { createDefaultTenantDiscountProviders } from '../../shared/tenant-config';
import { StripeClient } from '../stripe-client';
import { createDatabaseTestLayer } from '../testing/database-test-layer';
import { createRegistrationDatabaseTestLayer } from '../testing/registration-database';
import { hashRegistrationTransferClaimCode } from './registration-transfer-claim-code';
import { RegistrationTransferPricingError } from './registration-transfer-pricing';
import { RegistrationTransferStateError } from './registration-transfer-state';
import {
  registrationTransferDeadlineFailure,
  registrationTransferGuestCheckoutLine,
  registrationTransferPricingFailure,
  RegistrationTransferService,
  resumeRegistrationTransferCheckout,
} from './registration-transfer.service';

const checkoutSessionResponse = ({
  id,
  status = 'open',
  url = null,
}: {
  id: string;
  status?: Stripe.Checkout.Session['status'];
  url?: Stripe.Checkout.Session['url'];
}): Stripe.Response<Stripe.Checkout.Session> => ({
  adaptive_pricing: null,
  after_expiration: null,
  allow_promotion_codes: null,
  amount_subtotal: null,
  amount_total: null,
  automatic_tax: {
    enabled: false,
    liability: null,
    provider: null,
    status: null,
  },
  billing_address_collection: null,
  cancel_url: null,
  client_reference_id: null,
  client_secret: null,
  collected_information: null,
  consent: null,
  consent_collection: null,
  created: 1_900_000_000,
  currency: 'eur',
  currency_conversion: null,
  custom_fields: [],
  custom_text: {
    after_submit: null,
    shipping_address: null,
    submit: null,
    terms_of_service_acceptance: null,
  },
  customer: null,
  customer_account: null,
  customer_creation: null,
  customer_details: null,
  customer_email: null,
  discounts: null,
  expires_at: 1_900_000_000,
  id,
  integration_identifier: null,
  invoice: null,
  invoice_creation: null,
  lastResponse: {
    headers: {},
    requestId: `req_${id}`,
    statusCode: 200,
  },
  livemode: false,
  locale: null,
  managed_payments: null,
  metadata: null,
  mode: 'payment',
  object: 'checkout.session',
  origin_context: null,
  payment_intent: null,
  payment_link: null,
  payment_method_collection: null,
  payment_method_configuration_details: null,
  payment_method_options: null,
  payment_method_types: ['card'],
  payment_status: 'unpaid',
  permissions: null,
  recovered_from: null,
  saved_payment_method_options: null,
  setup_intent: null,
  shipping_address_collection: null,
  shipping_cost: null,
  shipping_options: [],
  status,
  submit_type: null,
  subscription: null,
  success_url: null,
  total_details: null,
  ui_mode: 'hosted_page',
  url,
  wallet_options: null,
});

class UnusedTransferStripeHttpClient extends Stripe.HttpClient {
  override getClientName() {
    return 'evorto-transfer-test';
  }
  override makeRequest(): Promise<never> {
    return Promise.reject(
      new Error('Unexpected transfer test provider request'),
    );
  }
}

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

describe('RegistrationTransferService.getClaim tenant settings', () => {
  const createClaimDatabase = (
    tenantRecord: undefined | { discountProviders: null | object },
    bundleTypeCount = 0,
  ) => {
    const executeValues = vi.fn(
      (statement: string, parameters: readonly unknown[]) =>
        Effect.sync(() => {
          expect(statement.startsWith('select ')).toBe(true);
          if (statement.includes('from "registration_transfers"')) {
            expect(parameters).toEqual([
              'tenant-1',
              hashRegistrationTransferClaimCode(
                'ABCD-1234-ABCD-1234-ABCD-1234-ABCD-1234',
              ),
              1,
            ]);
            expect(statement).toContain('"claim_code_hash"');
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
          if (
            statement.includes(
              'from "registration_transfer_bundle_addon_purchases"',
            )
          ) {
            return Array.from({ length: bundleTypeCount }, (_, index) => [
              0,
              0,
              'Included add-on',
              `addon-${index + 1}`,
              1,
              0,
              1,
              null,
              0,
              `Add-on ${index + 1}`,
            ]);
          }
          const emptyReadTables = [
            'event_registration_questions',
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
      claimCode: ' abcd-1234-abcd-1234-abcd-1234-abcd-1234 ',
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

  it.effect.each([MAX_EVENT_ADDON_TYPES, MAX_EVENT_ADDON_TYPES + 1])(
    'bounds the stored claim view at %i add-on types without truncating valid bundles',
    (count) =>
      Effect.gen(function* () {
        const database = createClaimDatabase(
          {
            discountProviders: createDefaultTenantDiscountProviders(),
          },
          count,
        );
        const result = yield* getClaim.pipe(
          Effect.provide(database.layer),
          Effect.result,
        );
        if (count > MAX_EVENT_ADDON_TYPES) {
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isSuccess(result))
            throw new Error('Oversized bundle was exposed');
          expect(result.failure).toBeInstanceOf(
            RegistrationTransferConflictError,
          );
          expect(result.failure.message).toContain(
            'too many different add-ons',
          );
        } else {
          expect(Result.isSuccess(result)).toBe(true);
          if (Result.isFailure(result)) throw result.failure;
          expect(result.success.bundle.addOns.map(({ id }) => id)).toEqual(
            Array.from({ length: count }, (_, index) => `addon-${index + 1}`),
          );
        }
        expect(
          database.executeValues.mock.calls.every(([statement]) =>
            statement.startsWith('select '),
          ),
        ).toBe(true);
      }),
  );

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
        const transactionCommands: string[] = [];
        const statements: string[] = [];
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: (statement, parameters) =>
            Effect.sync(() => {
              statements.push(statement);
              expect(transactionCommands).toEqual(['BEGIN']);
              if (
                statement.startsWith(`update "${getTableName(transactions)}"`)
              ) {
                expect(parameters).toEqual([
                  expect.any(String),
                  0,
                  null,
                  null,
                  null,
                  expect.any(String),
                  'cs_unbound',
                  'https://checkout.stripe.com/c/pay/cs_unbound',
                  'transaction-1',
                  'registration-1',
                  'pending',
                  'tenant-1',
                  'registration',
                ]);
                expect(statement).toContain(
                  `"${transactions.stripeCheckoutSessionId.name}" is null`,
                );
                expect(statement).toContain('returning "id"');
                return [];
              }
              if (
                statement.startsWith('select ') &&
                statement.includes(` from "${getTableName(transactions)}"`)
              ) {
                expect(parameters).toEqual([
                  'transaction-1',
                  'registration-1',
                  'pending',
                  'tenant-1',
                  1,
                ]);
                expect(statement).toContain(
                  `"${transactions.stripeCheckoutSessionId.name}", "${transactions.stripeCheckoutUrl.name}"`,
                );
                return [];
              }
              throw new Error(`Unexpected transfer fixture SQL: ${statement}`);
            }),
          transactionControl: (command) =>
            Effect.sync(() => {
              transactionCommands.push(command);
            }),
        });
        const stripe = new Stripe('sk_test_transfer_cleanup', {
          httpClient: new UnusedTransferStripeHttpClient(),
          maxNetworkRetries: 0,
        });
        vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue(
          checkoutSessionResponse({
            id: 'cs_unbound',
            url: 'https://checkout.stripe.com/c/pay/cs_unbound',
          }),
        );
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
            Layer.mergeAll(databaseLayer, Layer.succeed(StripeClient, stripe)),
          ),
          Effect.flip,
        );

        expect(expire).toHaveBeenCalledWith('cs_unbound', undefined, {
          stripeAccount: 'acct_tenant',
        });
        expect(statements).toHaveLength(2);
        expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
        expect(error).not.toHaveProperty('cause');
        expect(error).toBeInstanceOf(RegistrationTransferInternalError);
        expect(error).toMatchObject({
          message: expect.stringContaining(
            'unbound Checkout session could not be expired',
          ),
        });
      }),
  );
});

type TransferService = Effect.Success<typeof RegistrationTransferService.make>;

const transferInput: Parameters<TransferService['claim']>[0] = {
  answers: [],
  claimCode: '0123-4567-89AB-CDEF-0123-4567-89AB-CDEF',
  tenant: {
    cancellationDeadlineHoursBeforeStart: 24,
    currency: 'EUR',
    domain: 'tenant.example.com',
    emailSenderEmail: 'organizer@example.com',
    emailSenderName: 'Organizer',
    id: 'tenant-1',
    maxActiveRegistrationsPerUser: 0,
    name: 'Tenant',
    refundFeesOnCancellation: false,
    stripeAccountId: 'acct_tenant',
    transferDeadlineHoursBeforeStart: 24,
  },
  user: {
    communicationEmail: undefined,
    email: 'recipient@example.com',
    id: 'recipient-1',
    roleIds: [],
  },
};
const eventStart = '2099-08-01 18:00:00';
const eventEnd = '2099-08-01 22:00:00';
const transferExpiry = '2099-07-31 18:00:00';

const checkoutFixture = () => {
  const stripe = new Stripe('sk_test_transfer_persisted_boundaries', {
    httpClient: new UnusedTransferStripeHttpClient(),
    maxNetworkRetries: 0,
  });
  const providerCause = new Error('Stopped at the synthetic Checkout boundary');
  const checkout = vi
    .spyOn(stripe.checkout.sessions, 'create')
    .mockRejectedValue(providerCause);
  return { checkout, providerCause, stripe };
};

describe('private transfer code recovery', () => {
  for (const operation of ['getClaim', 'claim'] as const) {
    it.effect(
      `${operation} explains an unavailable code without starting payment`,
      () =>
        Effect.gen(function* () {
          const { checkout, stripe } = checkoutFixture();
          const statements: string[] = [];
          const layer = Layer.mergeAll(
            Layer.succeed(StripeClient, stripe),
            createRegistrationDatabaseTestLayer({
              executeValues: (statement, parameters) =>
                Effect.sync(() => {
                  statements.push(statement);
                  expect(statement).toContain('from "registration_transfers"');
                  expect(statement.startsWith('select ')).toBe(true);
                  expect(parameters).toEqual([
                    transferInput.tenant.id,
                    hashRegistrationTransferClaimCode(transferInput.claimCode),
                    1,
                  ]);
                  return [];
                }),
            }),
          );
          const service = yield* RegistrationTransferService.make;
          const attempt =
            operation === 'getClaim'
              ? service.getClaim(transferInput).pipe(Effect.asVoid)
              : service.claim(transferInput).pipe(Effect.asVoid);
          const error = yield* attempt.pipe(Effect.provide(layer), Effect.flip);
          expect(error).toBeInstanceOf(RegistrationTransferNotFoundError);
          expect(error.message).toBe(
            'This transfer code is invalid or no longer available. This request did not start a payment. Ask the sender for the current code.',
          );
          expect(error.message).not.toContain(transferInput.claimCode);
          expect(statements).toHaveLength(1);
          expect(checkout).not.toHaveBeenCalled();
        }),
    );
  }

  it.effect(
    'explains an expired code after recording expiry without starting payment',
    () =>
      Effect.gen(function* () {
        const { checkout, stripe } = checkoutFixture();
        const writes: string[] = [];
        const layer = Layer.mergeAll(
          Layer.succeed(StripeClient, stripe),
          createRegistrationDatabaseTestLayer({
            executeValues: (statement, parameters) =>
              Effect.sync(() => {
                if (
                  statement.startsWith('select ') &&
                  statement.includes('from "registration_transfers"')
                ) {
                  expect(parameters).toEqual([
                    transferInput.tenant.id,
                    hashRegistrationTransferClaimCode(transferInput.claimCode),
                    1,
                  ]);
                  return [
                    [
                      eventEnd,
                      'event-1',
                      eventStart,
                      'APPROVED',
                      'Event',
                      '1960-01-01 00:00:00',
                      'event-1',
                      'option-1',
                      0,
                      [],
                      null,
                      null,
                      null,
                      'registration-1',
                      1,
                      'CONFIRMED',
                      'source-1',
                      'open',
                      'transfer-1',
                    ],
                  ];
                }
                if (statement.startsWith('update "registration_transfers"')) {
                  writes.push(statement);
                  expect(parameters).toContain(transferInput.tenant.id);
                  expect(parameters).toContain('transfer-1');
                  return [['transfer-1']];
                }
                if (
                  statement.startsWith(
                    'insert into "registration_transfer_events"',
                  )
                ) {
                  writes.push(statement);
                  expect(parameters).toContain('expired');
                  return [];
                }
                throw new Error(
                  `Unexpected expired-code statement: ${statement}`,
                );
              }),
          }),
        );
        const service = yield* RegistrationTransferService.make;
        const error = yield* service
          .claim(transferInput)
          .pipe(Effect.provide(layer), Effect.flip);
        expect(error).toBeInstanceOf(RegistrationTransferConflictError);
        expect(error.message).toBe(
          'This transfer code has expired. No payment or refund was started. Ask the sender for a new code.',
        );
        expect(error.message).not.toContain(transferInput.claimCode);
        expect(writes).toHaveLength(2);
        expect(checkout).not.toHaveBeenCalled();
      }),
  );
});

describe('persisted transfer claim questions', () => {
  it.effect.each([25, 26])(
    'validates %i stored questions without truncation',
    (count) =>
      Effect.gen(function* () {
        const questions = Array.from({ length: count }, (_, index) => ({
          description: '',
          id: `question-${index}`,
          required: true,
          title: `Question ${index}`,
        }));
        const statements: string[] = [];
        const executeValues: SqlConnection.Connection['executeValues'] = (
          statement,
          parameters,
        ) =>
          Effect.sync(() => {
            statements.push(statement);
            if (
              statement.startsWith('select ') &&
              statement.includes(' from "registration_transfers"')
            ) {
              expect(parameters).toEqual([
                'tenant-1',
                '7237d20f656f12c2e8bf7e9240be0e4d1d50cddbe7dd9b7696ffc4b835d4d1f0',
                1,
              ]);
              expect(parameters).not.toContain(transferInput.claimCode);
              return [
                [
                  null,
                  eventEnd,
                  'event-1',
                  eventStart,
                  'Event',
                  transferExpiry,
                  '',
                  'option-1',
                  false,
                  0,
                  'Option',
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
            if (
              statement.startsWith('select ') &&
              statement.includes(' from "event_registration_questions"')
            ) {
              return questions.map((question) => [
                question.description,
                question.id,
                question.required,
                question.title,
              ]);
            }
            if (
              statement.startsWith('select ') &&
              (statement.includes(
                ' from "registration_transfer_bundle_addon_purchases"',
              ) ||
                statement.includes(
                  ' from "registration_transfer_refund_plan_items"',
                ))
            ) {
              return [];
            }
            throw new Error(
              `Unexpected claim question fixture statement: ${statement}`,
            );
          });
        const service = yield* RegistrationTransferService.make;
        const result = yield* service
          .getClaim(transferInput)
          .pipe(
            Effect.result,
            Effect.provide(
              createRegistrationDatabaseTestLayer({ executeValues }),
            ),
          );
        if (count === 25) {
          expect(Result.isSuccess(result)).toBe(true);
          if (Result.isFailure(result)) throw result.failure;
          expect(result.success.registrationOption.questions).toEqual(
            questions,
          );
          expect(result.success.status).toBe('open');
        } else {
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isSuccess(result))
            throw new Error('Over-limit questions exposed a claim');
          expect(result.failure).toBeInstanceOf(
            RegistrationTransferConflictError,
          );
          expect(result.failure.message).toContain(
            'too many sign-up questions',
          );
        }
        expect(
          statements.every((statement) => statement.startsWith('select ')),
        ).toBe(true);
      }),
  );
});

const createTransferTaxFixture = ({
  addonCount = 1,
  addonPrice = 0,
  addonTaxId = null,
  includedQuantity = 0,
  optionIsPaid = false,
  optionTaxId = null,
  percentage = '0',
  purchasedQuantity = 0,
  taxRowExists = true,
}: {
  addonCount?: number;
  addonPrice?: number;
  addonTaxId?: null | string;
  includedQuantity?: number;
  optionIsPaid?: boolean;
  optionTaxId?: null | string;
  percentage?: null | string;
  purchasedQuantity?: number;
  taxRowExists?: boolean;
}) => {
  const writes: string[] = [];
  const expansionReads: string[] = [];
  const pricedAddonIds: string[] = [];
  const questionLocks: string[] = [];
  const { checkout, stripe } = checkoutFixture();
  const quantity = includedQuantity + purchasedQuantity;
  const optionPrice = optionIsPaid ? 1000 : 0;
  const bundleRows =
    quantity > 0
      ? Array.from({ length: addonCount }, (_, index) => [
          `addon-${index + 1}`,
          0,
          `purchase-${index + 1}`,
          includedQuantity,
          purchasedQuantity,
          quantity,
          0,
          0,
          null,
          null,
          null,
          addonPrice,
        ])
      : [];
  const executeValues: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      if (!statement.startsWith('select ')) {
        writes.push(statement);
        throw new Error(`Unexpected transfer tax fixture write: ${statement}`);
      }
      if (
        [
          'event_registration_addon_purchases',
          'event_registration_addon_purchase_lots',
          'registration_transfer_bundle_addon_purchase_lots',
          'event_addons',
          'user_discount_cards',
          'event_registration_option_discounts',
        ].some((table) => statement.includes(` from "${table}"`))
      ) {
        expansionReads.push(statement);
      }
      if (
        statement ===
        'select "id" from "tenants" where "tenants"."id" = $1 for key share'
      ) {
        expect(questionLocks).toEqual([]);
        expect(parameters).toEqual(['tenant-1']);
        questionLocks.push('tenant');
        return [['tenant-1']];
      }
      if (
        statement ===
        'select "id" from "event_instances" where (("event_instances"."id" = $1) and ("event_instances"."tenantId" = $2)) for share'
      ) {
        expect(questionLocks).toEqual(['tenant']);
        expect(parameters).toEqual(['event-1', 'tenant-1']);
        questionLocks.push('event');
        return [['event-1']];
      }
      if (
        statement ===
        'select "id", "required" from "event_registration_questions" where (("event_registration_questions"."eventId" = $1) and ("event_registration_questions"."registrationOptionId" = $2)) order by "event_registration_questions"."id" for share'
      ) {
        expect(questionLocks).toEqual(['tenant', 'event']);
        expect(parameters).toEqual(['event-1', 'option-1']);
        questionLocks.push('questions');
        return [];
      }
      if (statement.includes(' from "registration_transfers"')) {
        if (!statement.includes(' for update')) {
          expect(parameters).toEqual([
            'tenant-1',
            '7237d20f656f12c2e8bf7e9240be0e4d1d50cddbe7dd9b7696ffc4b835d4d1f0',
            1,
          ]);
          expect(parameters).not.toContain(transferInput.claimCode);
        }
        return statement.includes(' for update')
          ? [[transferExpiry, 'registration-1', 'source-1', 'open']]
          : [
              [
                eventEnd,
                'event-1',
                eventStart,
                'APPROVED',
                'Event',
                transferExpiry,
                'event-1',
                'option-1',
                optionPrice,
                [],
                optionTaxId,
                null,
                null,
                'registration-1',
                1,
                'CONFIRMED',
                'source-1',
                'open',
                'transfer-1',
              ],
            ];
      }
      if (statement.includes(' from "event_registrations"')) {
        return statement.includes(' for update')
          ? [[0, 'CONFIRMED', 'source-1']]
          : [['CONFIRMED']];
      }
      if (statement.includes(' from "registration_acquisitions"'))
        return [['event-1', 'acquisition-1', 1, 'source-1']];
      if (
        statement.includes(
          ' from "registration_transfer_bundle_addon_purchases"',
        ) ||
        statement.includes(' from "event_registration_addon_purchases"')
      )
        return bundleRows;
      if (
        statement.includes(
          ' from "registration_transfer_bundle_addon_purchase_lots"',
        ) ||
        statement.includes(' from "event_registration_addon_purchase_lots"')
      )
        return [];
      if (statement.includes(' from "tenants"')) {
        return statement.includes(' for update')
          ? [['acct_tenant']]
          : [
              [
                'EUR',
                { esnCard: { config: {}, status: 'disabled' } },
                'tenant.example.com',
                'organizer@example.com',
                'Organizer',
                'tenant-1',
                0,
                'Tenant',
                24,
              ],
            ];
      }
      if (statement.includes(' from "users_to_tenants"'))
        return [['membership-1']];
      if (statement.includes(' from "users"'))
        return [[null, 'recipient@example.com']];
      if (
        statement.includes(' from "roles_to_tenant_users"') ||
        statement.includes(' from "event_registration_questions"') ||
        statement.includes(' from "user_discount_cards"') ||
        statement.includes(' from "event_registration_option_discounts"')
      )
        return [];
      if (statement.includes(' from "event_registration_options"'))
        return [
          [
            eventStart,
            'APPROVED',
            'Event',
            'event-1',
            optionIsPaid,
            optionPrice,
            [],
            optionTaxId,
            null,
          ],
        ];
      if (statement.includes(' from "event_addons"')) {
        pricedAddonIds.push(
          ...parameters.filter(
            (value): value is string =>
              typeof value === 'string' && value.startsWith('addon-'),
          ),
        );
        return Array.from({ length: addonCount }, (_, index) => [
          `addon-${index + 1}`,
          addonPrice,
          addonTaxId,
          'Add-on',
        ]);
      }
      if (statement.includes(' from "tenant_stripe_tax_rates"')) {
        expect(statement).toContain(' for update');
        return taxRowExists
          ? [
              ...new Set([optionTaxId, addonTaxId].filter((id) => id !== null)),
            ].map((id) => ['Tax', true, percentage, id])
          : [];
      }
      throw new Error(
        `Unexpected transfer tax fixture statement: ${statement}`,
      );
    });
  return {
    checkout,
    expansionReads,
    layer: Layer.mergeAll(
      createRegistrationDatabaseTestLayer({ executeValues }),
      ConfigProvider.layer(
        ConfigProvider.fromEnv({ env: { NODE_ENV: 'production' } }),
      ),
      Layer.succeed(StripeClient, stripe),
    ),
    pricedAddonIds,
    writes,
  };
};

describe('persisted transfer bundle type bounds', () => {
  it.effect.each([MAX_EVENT_ADDON_TYPES, MAX_EVENT_ADDON_TYPES + 1])(
    'checks %i stored add-on types before fulfillment and recipient price expansion',
    (count) =>
      Effect.gen(function* () {
        const fixture = createTransferTaxFixture({
          addonCount: count,
          includedQuantity: 1,
        });
        const service = yield* RegistrationTransferService.make;
        const error = yield* service
          .claim(transferInput)
          .pipe(Effect.provide(fixture.layer), Effect.flip);
        expect(error).toBeInstanceOf(RegistrationTransferConflictError);
        if (count > MAX_EVENT_ADDON_TYPES) {
          expect(error.message).toContain('too many different add-ons');
          expect(fixture.expansionReads).toEqual([]);
          expect(fixture.pricedAddonIds).toEqual([]);
        } else {
          expect(error.message).toBe(
            'You already have a ticket for this event. This transfer was not accepted, and no payment or refund was started.',
          );
          expect(fixture.pricedAddonIds).toEqual(
            Array.from({ length: count }, (_, index) => `addon-${index + 1}`),
          );
        }
        expect(fixture.writes).toEqual([]);
        expect(fixture.checkout).not.toHaveBeenCalled();
      }),
  );
});

describe('persisted transfer tax configuration', () => {
  it.effect.each([
    { name: 'paid option with no tax ID', optionIsPaid: true },
    {
      name: 'paid option with an empty tax ID',
      optionIsPaid: true,
      optionTaxId: '',
    },
    {
      addonPrice: 500,
      name: 'purchased positive-price add-on with no tax ID',
      purchasedQuantity: 1,
    },
    {
      addonPrice: 500,
      addonTaxId: '',
      name: 'purchased positive-price add-on with an empty tax ID',
      purchasedQuantity: 1,
    },
    {
      name: 'option tax ID with no row',
      optionIsPaid: true,
      optionTaxId: 'txr_missing',
      taxRowExists: false,
    },
    {
      name: 'option tax ID with null percentage',
      optionIsPaid: true,
      optionTaxId: 'txr_null',
      percentage: null,
    },
    {
      addonPrice: 500,
      addonTaxId: 'txr_missing',
      name: 'add-on tax ID with no row',
      purchasedQuantity: 1,
      taxRowExists: false,
    },
    {
      addonPrice: 500,
      addonTaxId: 'txr_null',
      name: 'add-on tax ID with null percentage',
      percentage: null,
      purchasedQuantity: 1,
    },
  ])('rejects $name before any write or Checkout', (configuration) =>
    Effect.gen(function* () {
      const fixture = createTransferTaxFixture(configuration);
      const service = yield* RegistrationTransferService.make;
      const error = yield* service
        .claim(transferInput)
        .pipe(Effect.provide(fixture.layer), Effect.flip);
      expect(error).toBeInstanceOf(RegistrationTransferConflictError);
      expect(error.message).toBe(
        'The price or tax for this ticket changed while you were accepting it. No payment or refund was started. Review the latest total and try again.',
      );
      expect(fixture.writes).toEqual([]);
      expect(fixture.checkout).not.toHaveBeenCalled();
    }),
  );

  it.effect.each([
    { name: 'free option without a tax ID' },
    {
      addonPrice: 500,
      includedQuantity: 2,
      name: 'included positive-price add-on without a tax ID',
    },
    {
      name: 'zero-price purchased add-on without a tax ID',
      purchasedQuantity: 2,
    },
    {
      name: 'paid option with zero-percent tax',
      optionIsPaid: true,
      optionTaxId: 'txr_zero',
    },
    {
      addonPrice: 500,
      addonTaxId: 'txr_zero',
      name: 'purchased positive-price add-on with zero-percent tax',
      purchasedQuantity: 1,
    },
  ])(
    'preserves $name through to the recipient-registration check',
    (configuration) =>
      Effect.gen(function* () {
        const fixture = createTransferTaxFixture(configuration);
        const service = yield* RegistrationTransferService.make;
        const error = yield* service
          .claim(transferInput)
          .pipe(Effect.provide(fixture.layer), Effect.flip);
        expect(error).toBeInstanceOf(RegistrationTransferConflictError);
        expect(error.message).toBe(
          'You already have a ticket for this event. This transfer was not accepted, and no payment or refund was started.',
        );
        expect(fixture.writes).toEqual([]);
        expect(fixture.checkout).not.toHaveBeenCalled();
      }),
  );
});

const persistedCheckoutSnapshot = (lineCount: number) => ({
  customerEmail: 'recipient@example.com',
  eventTitle: 'Event',
  eventUrl: 'https://tenant.example.com/events/event-1',
  expiresAt: 4_089_000_000,
  lineItems: Array.from({ length: lineCount }, (_, index) => ({
    name: `Line ${index}`,
    quantity: 1,
    unitAmount: 1000,
  })),
  notificationEmail: 'recipient@example.com',
});

const createPersistedCheckoutFixture = (snapshot: unknown) => {
  const writes: string[] = [];
  const { checkout, providerCause, stripe } = checkoutFixture();
  const executeValues: SqlConnection.Connection['executeValues'] = (
    statement,
  ) =>
    Effect.sync(() => {
      if (
        statement.startsWith('select ') &&
        statement.includes(' from "registration_transfers"')
      ) {
        return [
          [
            35,
            'EUR',
            'registration-1',
            snapshot,
            'acct_tenant',
            null,
            null,
            'transaction-1',
          ],
        ];
      }
      writes.push(statement);
      if (statement.startsWith('update "transactions"'))
        return [['transaction-1']];
      if (statement.startsWith('insert into "registration_transfer_events"'))
        return [];
      throw new Error(
        `Unexpected persisted checkout fixture statement: ${statement}`,
      );
    });
  return {
    checkout,
    layer: Layer.mergeAll(
      createRegistrationDatabaseTestLayer({ executeValues }),
      Layer.succeed(StripeClient, stripe),
    ),
    providerCause,
    writes,
  };
};

describe('persisted transfer Checkout resume', () => {
  it.effect.each([
    { name: '101 lines', snapshot: persistedCheckoutSnapshot(101) },
    {
      name: 'malformed line items',
      snapshot: { ...persistedCheckoutSnapshot(1), lineItems: 'invalid' },
    },
    {
      name: 'malformed line amount',
      snapshot: {
        ...persistedCheckoutSnapshot(1),
        lineItems: [{ name: 'Line', quantity: 1, unitAmount: '1000' }],
      },
    },
    {
      name: 'missing customer email',
      snapshot: { ...persistedCheckoutSnapshot(1), customerEmail: undefined },
    },
  ])('rejects $name before provider calls or writes', ({ snapshot }) =>
    Effect.gen(function* () {
      const fixture = createPersistedCheckoutFixture(snapshot);
      const service = yield* RegistrationTransferService.make;
      const error = yield* service
        .retryCheckout({ ...transferInput, transferId: 'transfer-1' })
        .pipe(Effect.flip, Effect.provide(fixture.layer));
      expect(error).toBeInstanceOf(RegistrationTransferInternalError);
      expect(error).not.toHaveProperty('cause');
      expect(error.message).toBe(
        'The saved payment details for this transfer are invalid. No payment was started. Contact Evorto support.',
      );
      expect(fixture.checkout).not.toHaveBeenCalled();
      expect(fixture.writes).toEqual([]);
    }),
  );

  it.effect(
    'sends exactly 100 stored lines to Checkout without truncation',
    () =>
      Effect.gen(function* () {
        const snapshot = persistedCheckoutSnapshot(100);
        const fixture = createPersistedCheckoutFixture(snapshot);
        const service = yield* RegistrationTransferService.make;
        const result = yield* service
          .retryCheckout({ ...transferInput, transferId: 'transfer-1' })
          .pipe(Effect.provide(fixture.layer), Effect.flip);
        expect(result).toBeInstanceOf(RegistrationTransferInternalError);
        expect(result).not.toHaveProperty('cause');
        expect(result.message).toBe(
          'Transfer payment setup is still pending. Retry without creating another transfer.',
        );
        expect(fixture.checkout).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            customer_email: snapshot.customerEmail,
            line_items: snapshot.lineItems.map((line) => ({
              price_data: {
                currency: 'EUR',
                product_data: { name: line.name },
                unit_amount: line.unitAmount,
              },
              quantity: line.quantity,
            })),
          }),
          expect.objectContaining({ stripeAccount: 'acct_tenant' }),
        );
        expect(fixture.writes).toEqual([]);
      }),
  );
});
