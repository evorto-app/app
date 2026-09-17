import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import { describe, expect, it, vi } from '@effect/vitest';
import { getTableName } from 'drizzle-orm';
import {
  Cause,
  ConfigProvider,
  Context,
  Effect,
  Exit,
  Layer,
  Schema,
} from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcGroup, RpcMessage } from 'effect/unstable/rpc';
import { SqlError, UniqueViolation } from 'effect/unstable/sql/SqlError';
import Stripe from 'stripe';

import type { Tenant } from '../../../../../types/custom/tenant';
import type { User } from '../../../../../types/custom/user';

import { Database } from '../../../../../db';
import {
  activeEventRegistrationUniqueIndexName,
  addonToEventRegistrationOptions,
  emailOutbox,
  eventAddons,
  eventInstances,
  eventRegistrationAddonFulfillmentAllocations,
  eventRegistrationAddonFulfillmentEvents,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchaseOrders,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  registrationAcquisitionComponents,
  registrationAcquisitionPayments,
  registrationAcquisitionRefundAllocations,
  registrationAcquisitions,
  RegistrationCheckoutSnapshotSchema,
  registrationTransferRefundPlanItems,
  registrationTransfers,
  rolesToTenantUsers,
  tenants,
  tenantStripeTaxRates,
  transactions,
  users,
  usersToTenants,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  AppRpcs,
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { TRANSACTIONAL_EMAIL_SENDER } from '../../../../integrations/email-delivery';
import { RegistrationAcquisitionWriteError } from '../../../../registrations/registration-acquisition-write';
import { RegistrationTransferMutationConflict } from '../../../../registrations/registration-transfer-mutation-guard';
import { StripeClient } from '../../../../stripe-client';
import { createRegistrationDatabaseTestLayer } from '../../../../testing/registration-database';
import { RpcAccess } from '../shared/rpc-access.service';
import { EventRegistrationService } from './event-registration.service';
import {
  cancelRegistrationForTenant,
  eventRegistrationHandlers,
  hasReachedRegistrationCancellationDeadline,
  mapRegistrationAcquisitionGuardError,
  mapRegistrationMutationInternalError,
  mapRegistrationTransferGuardError,
  registrationAddonPurchaseAvailability,
  registrationCancellationAvailability,
  registrationCancellationStripeRefundTerms,
  registrationTransferBlockedReason,
  resolveCancellationDeadlineHoursBeforeStart,
  resolveRefundFeesOnCancellation,
  withoutRegistrationInternalErrorCause,
} from './events-registration.handlers';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
} from './events.errors';

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

class UnusedStripeHttpClient extends Stripe.HttpClient {
  override getClientName() {
    return 'evorto-registration-handler-test';
  }

  override makeRequest() {
    return Promise.reject(new Error('Unexpected unmocked Stripe test request'));
  }
}

const createStripeClientDouble = ({
  createCheckoutSession = vi.fn(() =>
    Promise.reject(new Error('Unexpected Stripe Checkout create request')),
  ),
  expireCheckoutSession = vi.fn((sessionId: string) =>
    Promise.resolve(
      checkoutSessionResponse({ id: sessionId, status: 'expired' }),
    ),
  ),
  retrieveCheckoutSession = vi.fn((sessionId: string) =>
    Promise.resolve(checkoutSessionResponse({ id: sessionId })),
  ),
}: {
  createCheckoutSession?: Stripe['checkout']['sessions']['create'];
  expireCheckoutSession?: Stripe['checkout']['sessions']['expire'];
  retrieveCheckoutSession?: Stripe['checkout']['sessions']['retrieve'];
} = {}): Stripe => {
  const stripe = new Stripe('sk_test_handlers', {
    httpClient: new UnusedStripeHttpClient(),
    maxNetworkRetries: 0,
  });
  vi.spyOn(stripe.checkout.sessions, 'create').mockImplementation(
    createCheckoutSession,
  );
  vi.spyOn(stripe.checkout.sessions, 'expire').mockImplementation(
    expireCheckoutSession,
  );
  vi.spyOn(stripe.checkout.sessions, 'retrieve').mockImplementation(
    retrieveCheckoutSession,
  );
  vi.spyOn(stripe.refunds, 'create').mockRejectedValue(
    new Error('Unexpected Stripe refund create request'),
  );
  return stripe;
};

const requestContextRpcs = AppRpcs.middleware(RpcRequestContextMiddleware);

const handlerOptions = <
  Tag extends RpcGroup.Rpcs<typeof requestContextRpcs>['_tag'],
>(
  tag: Tag,
  headers = Headers.empty,
) => {
  const rpc = [...requestContextRpcs.requests.values()].find(
    (
      request,
    ): request is Extract<
      RpcGroup.Rpcs<typeof requestContextRpcs>,
      { readonly _tag: Tag }
    > => request._tag === tag,
  );
  if (!rpc) throw new Error(`Missing test RPC ${tag}`);
  return {
    client: new Rpc.ServerClient(1),
    headers,
    requestId: RpcMessage.RequestId(1),
    rpc,
  };
};

const registrationConfigProviderLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: {
      BASE_URL: 'https://deployment.example',
      NODE_ENV: 'production',
    },
  }),
);

const tenant: Tenant = {
  cancellationDeadlineHoursBeforeStart: 0,
  currency: 'EUR' as const,
  defaultLocation: undefined,
  discountProviders: {
    esnCard: {
      config: {},
      status: 'disabled' as const,
    },
  },
  domain: 'tenant.example.com',
  emailSenderEmail: 'board@tenant.example.com',
  emailSenderName: 'Tenant Board',
  id: 'tenant-1',
  maxActiveRegistrationsPerUser: 0,
  name: 'Tenant',
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['NL'],
  },
  refundFeesOnCancellation: true,
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Amsterdam',
  transferDeadlineHoursBeforeStart: 0,
};

const createUser = ({
  id = 'scanner-1',
  permissions = [],
}: {
  id?: string;
  permissions?: readonly Permission[];
} = {}): User => ({
  attributes: [],
  auth0Id: `auth0|${id}`,
  communicationEmail: `${id}.contact@example.com`,
  email: `${id}@example.com`,
  firstName: 'Scan',
  homeTenantId: tenant.id,
  homeTenantName: tenant.name,
  iban: undefined,
  id,
  lastName: 'User',
  paypalEmail: undefined,
  permissions,
  roleIds: [],
});

interface HandlerContextOptions {
  nowIso?: string;
  stripe?: Stripe;
  tenant?: Tenant;
  user?: ReturnType<typeof createUser>;
}

const createSqlContextLayer = <E>({
  databaseLayer,
  nowIso,
  stripe = createStripeClientDouble(),
  tenant: currentTenant = tenant,
  user = createUser(),
}: HandlerContextOptions & { databaseLayer: Layer.Layer<Database, E> }) => {
  const requestContext = {
    authData: {},
    authenticated: true,
    permissions: user.permissions,
    tenant: currentTenant,
    user,
    userAssigned: true,
  } satisfies RpcRequestContextShape;

  return Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, requestContext),
    databaseLayer,
    Layer.succeed(StripeClient, stripe),
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: {
          BASE_URL: 'https://app.example',
          NODE_ENV: 'production',
          ...(nowIso && { E2E_NOW_ISO: nowIso }),
        },
      }),
    ),
  );
};

type CheckInRegistrationRead = Pick<
  typeof eventRegistrations.$inferSelect,
  | 'checkedInGuestCount'
  | 'checkInTime'
  | 'eventId'
  | 'guestCount'
  | 'id'
  | 'registrationOptionId'
  | 'status'
  | 'userId'
> & {
  readonly event: Pick<typeof eventInstances.$inferSelect, 'start'>;
};

const createCurrentCheckInDatabase = ({
  activeTransferId,
  guestCheckInCount = 0,
  mode = 'blocked',
  organizer = false,
  registration,
}: {
  readonly activeTransferId?: string;
  readonly guestCheckInCount?: number;
  readonly mode?: 'blocked' | 'checkIn' | 'lockedTransfer';
  readonly organizer?: boolean;
  readonly registration?: CheckInRegistrationRead;
}) => {
  const queries: CancellationSqlStatement[] = [];
  const updateCalls: string[] = [];
  const transactionCommands: CancellationTransactionCommand[] = [];
  let transactionOpen = false;
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        queries.push({ parameters, statement });
        if (!registration)
          throw new Error(
            'Check-in fixture must reject before reading registration state',
          );
        const registrationTable = getTableName(eventRegistrations);
        if (
          statement.startsWith('select ') &&
          !statement.includes(' for update')
        ) {
          if (statement.includes(` from "${registrationTable}"`)) {
            if (statement.includes('"organizingRegistration"')) {
              expect(organizer).toBe(true);
              expect(parameters).toEqual([
                1,
                registration.eventId,
                'CONFIRMED',
                tenant.id,
                'scanner-1',
              ]);
              return [
                ['organizer-registration-1', { organizingRegistration: true }],
              ];
            }
            expect(statement).toContain('"checked_in_guest_count"');
            expect(statement).toContain('"guest_count"');
            expect(
              statement.endsWith(
                ` where (("d0"."${eventRegistrations.id.name}" = $2) and ("d0"."${eventRegistrations.tenantId.name}" = $3)) limit $4`,
              ),
            ).toBe(true);
            expect(parameters).toEqual([1, registration.id, tenant.id, 1]);
            return [
              [
                registration.checkedInGuestCount,
                cancellationTimestamp(registration.checkInTime),
                registration.eventId,
                registration.guestCount,
                registration.id,
                registration.registrationOptionId,
                registration.status,
                registration.userId,
                { start: cancellationTimestamp(registration.event.start) },
              ],
            ];
          }
          if (
            statement.includes(` from "${getTableName(registrationTransfers)}"`)
          ) {
            expect(parameters).toEqual([
              registration.id,
              'open',
              'checkout_pending',
              'refund_pending',
              'refund_failed',
              registration.id,
              'checkout_pending',
              tenant.id,
              1,
            ]);
            expect(
              statement.endsWith(
                ` where (((((("d0"."${registrationTransfers.sourceRegistrationId.name}" = $1) and ("d0"."${registrationTransfers.status.name}" in ($2, $3, $4, $5)))) or ((("d0"."${registrationTransfers.recipientRegistrationId.name}" = $6) and ("d0"."${registrationTransfers.status.name}" = $7))))) and ("d0"."${registrationTransfers.tenantId.name}" = $8)) limit $9`,
              ),
            ).toBe(true);
            return activeTransferId ? [[activeTransferId]] : [];
          }
        }
        expect(transactionOpen).toBe(true);
        if (
          statement.startsWith(
            `select "${eventRegistrations.status.name}" from "${registrationTable}"`,
          )
        ) {
          expect(parameters).toEqual([registration.id, tenant.id]);
          expect(statement).toContain('for update');
          return [[registration.status]];
        }
        if (
          statement.startsWith(
            `select "${registrationTransfers.id.name}", "${registrationTransfers.status.name}" from "${getTableName(registrationTransfers)}"`,
          )
        ) {
          expect(parameters).toEqual([
            tenant.id,
            registration.id,
            'open',
            'checkout_pending',
          ]);
          expect(statement).toContain('for update');
          expect(statement).toContain(
            `"${registrationTransfers.sourceRegistrationId.name}" = $2`,
          );
          return mode === 'lockedTransfer' ? [['transfer-race', 'open']] : [];
        }
        expect(mode).toBe('checkIn');
        if (statement.startsWith(`update "${registrationTable}"`)) {
          expect(registration.checkInTime).toBeNull();
          const checkInTime = parameters[2];
          if (
            typeof checkInTime !== 'string' ||
            !Number.isFinite(Date.parse(checkInTime))
          )
            throw new Error('Check-in must bind an actual timestamp');
          expect(parameters).toEqual([
            expect.any(String),
            guestCheckInCount,
            checkInTime,
            registration.id,
            tenant.id,
            'CONFIRMED',
          ]);
          expect(statement).toContain(`"checked_in_guest_count" + $2`);
          expect(statement).toContain(
            `"${registrationTable}"."${eventRegistrations.checkInTime.name}" is null`,
          );
          expect(statement).toContain(
            'returning "checked_in_guest_count", "checkInTime"::text, "id"',
          );
          updateCalls.push('registration');
          return [
            [
              registration.checkedInGuestCount + guestCheckInCount,
              checkInTime.replace('Z', ''),
              registration.id,
            ],
          ];
        }
        if (
          statement.startsWith(
            `update "${getTableName(eventRegistrationOptions)}"`,
          )
        ) {
          expect(parameters).toEqual([
            guestCheckInCount + 1,
            expect.any(String),
            registration.registrationOptionId,
            registration.eventId,
          ]);
          expect(statement).toContain(
            `"${eventRegistrationOptions.checkedInSpots.name}" + $1`,
          );
          expect(statement).toContain(
            `"${eventRegistrationOptions.id.name}" = $3`,
          );
          expect(statement).toContain(
            `"${eventRegistrationOptions.eventId.name}" = $4`,
          );
          expect(updateCalls).toEqual(['registration']);
          updateCalls.push('option');
          return [[registration.registrationOptionId]];
        }
        throw new Error(`Unexpected current check-in SQL: ${statement}`);
      }),
    transactionControl: (command) =>
      Effect.sync(() => {
        expect(mode).not.toBe('blocked');
        transactionCommands.push(command);
        transactionOpen = command === 'BEGIN';
      }),
  });
  return { databaseLayer, queries, transactionCommands, updateCalls };
};

type ScannedRegistrationRead = Pick<
  typeof eventRegistrations.$inferSelect,
  | 'appliedDiscountedPrice'
  | 'appliedDiscountType'
  | 'checkedInGuestCount'
  | 'checkInTime'
  | 'eventId'
  | 'guestCount'
  | 'status'
  | 'userId'
> & {
  readonly event: Pick<typeof eventInstances.$inferSelect, 'start' | 'title'>;
  readonly registrationOption: Pick<
    typeof eventRegistrationOptions.$inferSelect,
    'price' | 'title'
  >;
  readonly transactions: readonly Pick<
    typeof transactions.$inferSelect,
    'amount'
  >[];
  readonly user: Pick<typeof users.$inferSelect, 'firstName' | 'lastName'>;
};

const createScanReadDatabaseLayer = ({
  registration,
}: {
  readonly registration: ScannedRegistrationRead;
}) =>
  createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        expect(statement).toContain(
          ` from "${getTableName(eventRegistrations)}"`,
        );
        expect(statement).not.toContain(' for update');
        if (statement.includes('"checked_in_guest_count"')) {
          expect(parameters).toEqual([
            1,
            1,
            'registration',
            1,
            'registration-1',
            'tenant-1',
            1,
          ]);
          return [
            [
              registration.appliedDiscountedPrice,
              registration.appliedDiscountType,
              registration.checkedInGuestCount,
              registration.checkInTime?.toISOString().replace('Z', '') ?? null,
              registration.eventId,
              registration.guestCount,
              registration.status,
              registration.userId,
              {
                ...registration.event,
                start: registration.event.start.toISOString().replace('Z', ''),
              },
              { ...registration.registrationOption },
              registration.transactions.map((transaction) => ({
                ...transaction,
              })),
              { ...registration.user },
            ],
          ];
        }
        if (statement.includes('"organizingRegistration"')) {
          expect(parameters).toEqual([
            1,
            'event-1',
            'CONFIRMED',
            'tenant-1',
            'scanner-1',
          ]);
          return [];
        }
        throw new Error(
          'Unexpected current registration scan fixture SQL statement',
        );
      }),
  });

const scannedRegistration: ScannedRegistrationRead = {
  appliedDiscountedPrice: null,
  appliedDiscountType: null,
  checkedInGuestCount: 0,
  checkInTime: null,
  event: {
    start: new Date(Date.now() + 30 * 60 * 1000),
    title: 'City tour',
  },
  eventId: 'event-1',
  guestCount: 0,
  registrationOption: {
    price: 0,
    title: 'Participant',
  },
  status: 'CONFIRMED',
  transactions: [],
  user: {
    firstName: 'Alice',
    lastName: 'Doe',
  },
  userId: 'attendee-1',
};

const nonConfirmedRegistrationStatuses = [
  'CANCELLED',
  'PENDING',
  'WAITLIST',
] as const;

interface AcquisitionSourceTransaction {
  readonly amount?: number;
  readonly appFee?: null | number;
  readonly currency?: string;
  readonly eventId?: string;
  readonly eventRegistrationId?: string;
  readonly id?: string;
  readonly method?: string;
  readonly status?: string;
  readonly stripeAccountId?: null | string;
  readonly stripeChargeId?: null | string;
  readonly stripeCheckoutCancellationRequestedAt?: Date | null;
  readonly stripeCheckoutSessionId?: null | string;
  readonly stripeFee?: null | number;
  readonly stripeNetAmount?: null | number;
  readonly stripePaymentIntentId?: null | string;
  readonly targetUserId?: null | string;
  readonly type?: string;
}

const createAcquisitionRows = ({
  addonLots = [],
  eventId,
  guestCount,
  registrationId,
  transactions: sourceTransactions,
  userId,
}: {
  readonly addonLots?: readonly Record<string, unknown>[];
  readonly eventId: string;
  readonly guestCount: number;
  readonly registrationId: string;
  readonly transactions: readonly AcquisitionSourceTransaction[];
  readonly userId: string;
}) => {
  const acquisitionId = `acquisition-${registrationId}`;
  const successfulSources = sourceTransactions.filter(
    (
      transaction,
    ): transaction is AcquisitionSourceTransaction & { readonly id: string } =>
      typeof transaction.id === 'string' &&
      transaction.status === 'successful' &&
      (transaction.amount ?? 0) > 0 &&
      (transaction.type === 'registration' || transaction.type === 'addon'),
  );
  const payments = successfulSources.map((transaction, index) => ({
    acquisitionId,
    attachedAt: new Date('2026-07-10T12:00:00.000Z'),
    eventId,
    id: `acquisition-payment-${index + 1}`,
    registrationId,
    tenantId: tenant.id,
    transactionId: transaction.id,
  }));
  const paymentByTransactionId = new Map(
    payments.map((payment) => [payment.transactionId, payment]),
  );
  const addonComponents = addonLots.map((lot, index) => {
    const sourceTransactionId =
      typeof lot['sourceTransactionId'] === 'string'
        ? lot['sourceTransactionId']
        : undefined;
    const payment = sourceTransactionId
      ? paymentByTransactionId.get(sourceTransactionId)
      : undefined;
    const grossAmount =
      typeof lot['grossAmount'] === 'number' && payment
        ? lot['grossAmount']
        : 0;
    const applicationFeeAmount =
      typeof lot['applicationFeeAmount'] === 'number' && payment
        ? lot['applicationFeeAmount']
        : 0;
    const stripeFeeAmount =
      typeof lot['stripeFeeAmount'] === 'number' && payment
        ? lot['stripeFeeAmount']
        : 0;
    const netAmount = grossAmount - applicationFeeAmount - stripeFeeAmount;
    const lotId =
      typeof lot['id'] === 'string' ? lot['id'] : `purchase-lot-${index + 1}`;
    const purchaseId =
      typeof lot['purchaseId'] === 'string'
        ? lot['purchaseId']
        : `purchase-${index + 1}`;
    return {
      acquiredAt: new Date('2026-07-10T12:00:00.000Z'),
      acquisitionId,
      acquisitionPaymentId: payment?.id ?? null,
      allocationKey: `addon-lot:${lotId}`,
      applicationFeeAmount,
      baseAmount:
        typeof lot['baseAmount'] === 'number' && payment
          ? lot['baseAmount']
          : 0,
      currency: 'EUR' as const,
      eventId,
      grossAmount,
      id: `acquisition-component-addon-${index + 1}`,
      kind: 'addon_lot' as const,
      netAmount,
      purchaseId,
      purchaseLotId: lotId,
      quantity: typeof lot['quantity'] === 'number' ? lot['quantity'] : 1,
      registrationId,
      stripeFeeAmount,
      taxAmount:
        typeof lot['taxAmount'] === 'number' && payment ? lot['taxAmount'] : 0,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
      tenantId: tenant.id,
    };
  });
  const registrationSource = successfulSources.find(
    ({ type }) => type === 'registration',
  );
  const registrationPayment = registrationSource
    ? paymentByTransactionId.get(registrationSource.id)
    : undefined;
  const addonAmountsForRegistrationPayment = {
    applicationFee: 0,
    gross: 0,
    net: 0,
    stripeFee: 0,
  };
  for (const component of addonComponents) {
    if (component.acquisitionPaymentId !== registrationPayment?.id) continue;
    addonAmountsForRegistrationPayment.applicationFee +=
      component.applicationFeeAmount;
    addonAmountsForRegistrationPayment.gross += component.grossAmount;
    addonAmountsForRegistrationPayment.net += component.netAmount;
    addonAmountsForRegistrationPayment.stripeFee += component.stripeFeeAmount;
  }
  const registrationGross = Math.max(
    0,
    (registrationSource?.amount ?? 0) -
      addonAmountsForRegistrationPayment.gross,
  );
  const registrationApplicationFee = Math.max(
    0,
    (registrationSource?.appFee ?? 0) -
      addonAmountsForRegistrationPayment.applicationFee,
  );
  const registrationStripeFee = Math.max(
    0,
    (registrationSource?.stripeFee ?? 0) -
      addonAmountsForRegistrationPayment.stripeFee,
  );
  const registrationNet =
    registrationGross - registrationApplicationFee - registrationStripeFee;
  const components = [
    {
      acquiredAt: new Date('2026-07-10T12:00:00.000Z'),
      acquisitionId,
      acquisitionPaymentId:
        registrationGross > 0 ? (registrationPayment?.id ?? null) : null,
      allocationKey: 'registration',
      applicationFeeAmount: registrationApplicationFee,
      baseAmount: registrationGross,
      currency: 'EUR' as const,
      eventId,
      grossAmount: registrationGross,
      id: 'acquisition-component-registration',
      kind: 'registration' as const,
      netAmount: registrationNet,
      purchaseId: null,
      purchaseLotId: null,
      quantity: guestCount + 1,
      registrationId,
      stripeFeeAmount: registrationStripeFee,
      taxAmount: 0,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
      tenantId: tenant.id,
    },
    ...addonComponents,
  ];
  return {
    acquisition: {
      acquiredAt: new Date('2026-07-10T12:00:00.000Z'),
      eventId,
      id: acquisitionId,
      kind: 'initial' as const,
      operationKey: `initial-registration:${registrationId}`,
      ordinal: 0,
      ownerUserId: userId,
      previousAcquisitionId: null,
      registrationId,
      spotCount: guestCount + 1,
      tenantId: tenant.id,
      transferId: null,
    },
    components,
    payments,
  };
};

const createTransferDatabase = Effect.fn(function* ({
  activeTargetRegistrations = [],
  afterRegistrationLock,
  bundleAddonPurchases = [],
  concurrentTargetRegistration = null,
  discountProviders = tenant.discountProviders,
  existingTargetRegistration = null,
  lockedActiveTransfers = [],
  lockedEventStart,
  lockedEventStatus = 'APPROVED',
  lockedOptionRoleIds,
  lockedOptionTransferDeadlineHoursBeforeStart = null,
  lockedTargetMembership = true,
  lockedTargetRoleIds,
  lockedTenantTransferDeadlineHoursBeforeStart = 0,
  organizerRegistrations = [
    {
      id: 'organizer-registration-1',
      registrationOption: {
        organizingRegistration: true,
      },
    },
  ],
  participantCommit = false,
  recipientDiscountCards = [],
  registration = {
    appliedDiscountedPrice: null,
    appliedDiscountType: null,
    checkInTime: null,
    event: {
      start: new Date(Date.now() + 24 * 60 * 60 * 1000),
      title: 'City tour',
    },
    eventId: 'event-1',
    guestCount: 0,
    id: 'registration-1',
    registrationOptionId: 'option-1',
    status: 'CONFIRMED',
    transactions: [],
    user: {
      communicationEmail: 'attendee.contact@example.com',
      email: 'attendee@example.com',
      firstName: 'Attendee',
      lastName: 'Owner',
    },
    userId: 'attendee-1',
  },
  registrationOptionDiscounts = [],
  registrationOptionIsPaid,
  registrationOptionPrice = 0,
  registrationOptionRoleIds = ['participant-role-1'],
  registrationQuestionIds = [],
  sourceRefunds = [],
  targetLookupEmail = 'target@example.com',
  targetTenantUser = {
    id: 'target-tenant-user-1',
    roles: [{ id: 'participant-role-1' }],
  },
  targetUser = {
    communicationEmail: 'target.contact@example.com',
    email: 'target@example.com',
    firstName: 'Target',
    id: 'target-user-1',
    lastName: 'Recipient',
  },
  updateError,
}: {
  activeTargetRegistrations?: readonly { id: string }[];
  afterRegistrationLock?: () => void;
  bundleAddonPurchases?: readonly {
    price: number;
    purchasedQuantity: number;
    redeemedQuantity?: number;
  }[];
  concurrentTargetRegistration?: null | { id: string };
  discountProviders?: Tenant['discountProviders'];
  existingTargetRegistration?: null | { id: string };
  lockedActiveTransfers?: readonly {
    id: string;
    recipientRegistrationId: null | string;
    sourceRegistrationId: string;
    status: 'checkout_pending' | 'open' | 'refund_failed' | 'refund_pending';
  }[];
  lockedEventStart?: Date;
  lockedEventStatus?: typeof eventInstances.$inferSelect.status;
  lockedOptionRoleIds?: readonly string[];
  lockedOptionTransferDeadlineHoursBeforeStart?: null | number;
  lockedTargetMembership?: boolean;
  lockedTargetRoleIds?: readonly string[];
  lockedTenantTransferDeadlineHoursBeforeStart?: number;
  organizerRegistrations?: readonly {
    id: string;
    registrationOption: {
      organizingRegistration: boolean;
    };
  }[];
  participantCommit?: boolean;
  recipientDiscountCards?: readonly {
    type: 'esnCard';
    validFrom: Date | null;
    validTo: Date | null;
  }[];
  registration?: null | {
    appliedDiscountedPrice: null | number;
    appliedDiscountType: 'esnCard' | null;
    checkedInGuestCount?: number;
    checkInTime: Date | null;
    event: null | { start: Date; title?: string };
    eventId: string;
    guestCount?: number;
    id: string;
    registrationOptionId: string;
    status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
    transactions: readonly {
      amount: number;
      id?: string;
      status: 'cancelled' | 'pending' | 'successful';
      type: 'addon' | 'other' | 'refund' | 'registration';
    }[];
    user?: {
      communicationEmail: string;
      email: string;
      firstName?: string;
      lastName?: string;
    };
    userId: string;
  };
  registrationOptionDiscounts?: readonly {
    discountedPrice: number;
    discountType: 'esnCard';
  }[];
  registrationOptionIsPaid?: boolean;
  registrationOptionPrice?: number;
  registrationOptionRoleIds?: string[];
  registrationQuestionIds?: readonly string[];
  sourceRefunds?: readonly {
    amount: number;
    currency?: string;
    eventId?: null | string;
    eventRegistrationId?: null | string;
    manuallyCreated?: boolean | null;
    method: 'cash' | 'stripe';
    sourceTransactionId: null | string;
    status: 'cancelled' | 'pending' | 'successful';
    stripeAccountId?: null | string;
    stripeRefundId?: null | string;
    stripeRefundStatus: 'failed' | 'pending' | 'succeeded';
    targetUserId?: null | string;
  }[];
  targetLookupEmail?: string;
  targetTenantUser?: null | { id: string; roles: readonly { id: string }[] };
  targetUser?: null | {
    communicationEmail?: string;
    email?: string;
    firstName?: string;
    id: string;
    lastName?: string;
  };
  updateError?: SqlError;
} = {}) {
  const insertedEmails: Pick<
    typeof emailOutbox.$inferInsert,
    'html' | 'idempotencyKey' | 'kind' | 'toEmail'
  >[] = [];
  const lockOrder: string[] = [];
  const normalizedRegistrationOptionIsPaid =
    registrationOptionIsPaid ?? registrationOptionPrice > 0;
  const updateSets: Pick<
    typeof eventRegistrations.$inferInsert,
    | 'appliedDiscountedPrice'
    | 'appliedDiscountType'
    | 'basePriceAtRegistration'
    | 'discountAmount'
    | 'userId'
  >[] = [];
  const normalizedSourceTransactions = (registration?.transactions ?? []).map(
    (transaction, index) => {
      const id = transaction.id ?? `source-transaction-${index + 1}`;
      return {
        amount: transaction.amount,
        appFee: 0,
        currency: tenant.currency,
        eventId: registration?.eventId ?? 'event-1',
        eventRegistrationId: registration?.id ?? 'registration-1',
        id,
        method: 'stripe' as const,
        status: transaction.status,
        stripeAccountId: 'acct_historical',
        stripeChargeId: `ch_${id}`,
        stripeFee: 0,
        stripeNetAmount: transaction.amount,
        stripePaymentIntentId: null,
        targetUserId: registration?.userId ?? 'attendee-1',
        tenantId: tenant.id,
        type: transaction.type,
      };
    },
  );
  const normalizedSourceRefunds = sourceRefunds.map((refund, index) => {
    const source = normalizedSourceTransactions.find(
      ({ id }) => id === refund.sourceTransactionId,
    );
    return {
      currency: source?.currency ?? tenant.currency,
      eventId: source?.eventId ?? registration?.eventId ?? 'event-1',
      eventRegistrationId:
        source?.eventRegistrationId ?? registration?.id ?? 'registration-1',
      manuallyCreated: false,
      stripeAccountId: source?.stripeAccountId ?? 'acct_historical',
      stripeRefundId: `re_source_${index + 1}`,
      targetUserId:
        source?.targetUserId ?? registration?.userId ?? 'attendee-1',
      ...refund,
    };
  });
  const addonSourceTransactions = normalizedSourceTransactions.filter(
    (transaction) =>
      transaction.status === 'successful' &&
      transaction.amount > 0 &&
      transaction.type === 'addon',
  );
  const normalizedBundleAddonPurchases = [
    ...bundleAddonPurchases,
    ...addonSourceTransactions
      .slice(bundleAddonPurchases.length)
      .map((transaction) => ({
        price: transaction.amount,
        purchasedQuantity: 1,
        redeemedQuantity: 0,
      })),
  ].map((purchase, index) => ({
    addonId: `addon-${index + 1}`,
    cancelledQuantity: 0,
    description: null,
    includedQuantity: 0,
    price: purchase.price,
    purchasedQuantity: purchase.purchasedQuantity,
    purchaseId: `purchase-${index + 1}`,
    quantity: purchase.purchasedQuantity,
    redeemedQuantity: purchase.redeemedQuantity ?? 0,
    stripeTaxRateId: null,
    title: `Add-on ${index + 1}`,
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  }));
  const normalizedBundleLots = normalizedBundleAddonPurchases.map(
    (purchase, index) => {
      const source = addonSourceTransactions[index];
      return {
        applicationFeeAmount: source?.appFee ?? 0,
        baseAmount: source?.amount ?? 0,
        cancelledQuantity: 0,
        currency: tenant.currency,
        grossAmount: source?.amount ?? 0,
        id: `purchase-lot-${index + 1}`,
        netAmount: source?.stripeNetAmount ?? 0,
        paymentAllocationFinalizedAt: null,
        purchaseId: purchase.purchaseId,
        quantity: purchase.purchasedQuantity,
        redeemedQuantity: purchase.redeemedQuantity,
        refundAllocatedApplicationFeeAmount: 0,
        refundAllocatedGrossAmount: 0,
        refundAllocatedNetAmount: 0,
        refundAllocatedQuantity: 0,
        sourceTransactionId: source?.id,
        stripeFeeAmount: source?.stripeFee ?? 0,
        taxAmount: 0,
        taxRateDisplayName: null,
        taxRateInclusive: null,
        taxRatePercentage: null,
        unitPrice: purchase.price,
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      };
    },
  );
  const acquisitionRows = createAcquisitionRows({
    addonLots: normalizedBundleLots,
    eventId: registration?.eventId ?? 'event-1',
    guestCount: registration?.guestCount ?? 0,
    registrationId: registration?.id ?? 'registration-1',
    transactions: normalizedSourceTransactions,
    userId: registration?.userId ?? 'attendee-1',
  });
  const registrationId = registration?.id ?? 'registration-1';
  const eventId = registration?.eventId ?? 'event-1';
  const normalizedEventTitle = registration?.event?.title ?? 'City tour';
  const optionId = registration?.registrationOptionId ?? 'option-1';
  const sourceUserId = registration?.userId ?? 'attendee-1';
  const targetUserId = targetUser?.id ?? 'target-user-1';
  const driverTimestamp = (value: Date | null | undefined) =>
    value?.toISOString().replace('Z', '') ?? null;
  let transactionOpen = false;

  const readTransferRows: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      if (
        statement.includes(' from "event_registrations"') &&
        statement.includes('"organizingRegistration"')
      ) {
        expect(statement).not.toContain(' for update');
        expect(parameters).toEqual([
          1,
          eventId,
          'CONFIRMED',
          tenant.id,
          'scanner-1',
        ]);
        return organizerRegistrations.map((row) => [
          row.id,
          row.registrationOption ? { ...row.registrationOption } : null,
        ]);
      }
      if (
        statement.includes(' from "event_registrations"') &&
        statement.includes('"communicationEmail"')
      ) {
        expect(statement).not.toContain(' for update');
        expect(parameters).toEqual(
          participantCommit
            ? [1, 1, registrationId, 'CANCELLED', tenant.id, sourceUserId, 1]
            : [1, 1, eventId, registrationId, 'CANCELLED', tenant.id, 1],
        );
        if (!registration) return [];
        return [
          [
            registration.eventId,
            registration.guestCount ?? 0,
            registration.id,
            registration.registrationOptionId,
            registration.status,
            registration.userId,
            registration.event
              ? {
                  start: driverTimestamp(registration.event.start),
                  title: normalizedEventTitle,
                }
              : null,
            registration.user
              ? {
                  ...registration.user,
                  firstName: registration.user.firstName ?? 'Attendee',
                  lastName: registration.user.lastName ?? 'Owner',
                }
              : {
                  communicationEmail: 'attendee.contact@example.com',
                  email: 'attendee@example.com',
                  firstName: 'Attendee',
                  lastName: 'Owner',
                },
          ],
        ];
      }
      if (
        statement.includes(' from "registration_transfers"') &&
        !statement.includes(' for update')
      ) {
        expect(parameters).toEqual([
          registrationId,
          'open',
          'checkout_pending',
          'refund_pending',
          'refund_failed',
          registrationId,
          'checkout_pending',
          tenant.id,
          1,
        ]);
        expect(statement).toContain('"recipient_registration_id"');
        expect(statement).toContain('"source_registration_id"');
        return [];
      }
      if (
        statement.includes(' from "users_to_tenants"') &&
        statement.includes('"roles"')
      ) {
        expect(parameters).toEqual([tenant.id, targetUserId, 1]);
        return targetTenantUser
          ? [
              [
                targetTenantUser.id,
                targetTenantUser.roles.map((role) => ({ ...role })),
              ],
            ]
          : [];
      }
      if (statement.includes(' from "users"') && statement.includes('lower(')) {
        expect(statement).toContain('lower("users"."email")');
        expect(parameters).toEqual([targetLookupEmail, 1]);
        return targetUser ? [[targetUser.id]] : [];
      }
      if (
        statement.includes(' from "users"') &&
        statement.includes('"communicationEmail"')
      ) {
        expect(parameters).toEqual([targetUserId, 1]);
        return targetUser
          ? [
              [
                targetUser.communicationEmail ?? 'target.contact@example.com',
                targetUser.email ?? 'target@example.com',
                targetUser.firstName ?? 'Target',
                targetUser.id,
                targetUser.lastName ?? 'Recipient',
              ],
            ]
          : [];
      }
      if (
        statement.includes(' from "event_registration_options"') &&
        !statement.includes(' for update')
      ) {
        expect(parameters).toEqual([eventId, optionId, 1]);
        expect(statement).toContain('"roleIds"');
        return [[registrationOptionRoleIds]];
      }
      if (
        statement.includes(' from "event_registrations"') &&
        !statement.includes(' for update') &&
        !statement.includes(' inner join ')
      ) {
        expect(parameters).toEqual(
          transactionOpen
            ? [eventId, 'CANCELLED', tenant.id, targetUserId]
            : [eventId, 'CANCELLED', tenant.id, targetUserId, 1],
        );
        return transactionOpen
          ? concurrentTargetRegistration
            ? [[concurrentTargetRegistration.id]]
            : []
          : existingTargetRegistration
            ? [[existingTargetRegistration.id]]
            : [];
      }
      if (
        statement.startsWith('select ') &&
        statement.includes(' from "event_registrations"') &&
        statement.includes(' for update')
      ) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([registrationId, tenant.id]);
        expect(statement).toContain('"checked_in_guest_count"');
        lockOrder.push('registration');
        afterRegistrationLock?.();
        return registration
          ? [
              [
                registration.checkedInGuestCount ?? 0,
                driverTimestamp(registration.checkInTime),
                registration.eventId,
                registration.guestCount ?? 0,
                registration.registrationOptionId,
                registration.status,
                registration.userId,
              ],
            ]
          : [];
      }
      if (
        statement.includes(' from "users_to_tenants"') &&
        statement.includes(' for update')
      ) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([
          tenant.id,
          ...[sourceUserId, targetUserId].toSorted(),
        ]);
        expect(statement).toContain(
          ' order by "users_to_tenants"."userId" for update',
        );
        lockOrder.push('memberships');
        return [
          ['source-tenant-user-1', sourceUserId],
          ...(targetTenantUser && lockedTargetMembership
            ? [[targetTenantUser.id, targetUserId]]
            : []),
        ];
      }
      if (statement.includes(' from "roles_to_tenant_users"')) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([tenant.id, targetTenantUser?.id]);
        expect(statement).toContain(' order by ');
        expect(statement).toContain(' for update');
        lockOrder.push('roles');
        return (
          lockedTargetRoleIds ??
          targetTenantUser?.roles.map(({ id }) => id) ??
          []
        ).map((id) => [id]);
      }
      if (
        statement.includes(' from "registration_transfers"') &&
        statement.includes(' for update')
      ) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([
          tenant.id,
          registrationId,
          'open',
          'checkout_pending',
        ]);
        expect(statement).toContain('"source_registration_id"');
        return lockedActiveTransfers.map(({ id, status }) => [id, status]);
      }
      if (statement.includes(' from "registration_acquisitions"')) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual(
          statement.includes(' limit ')
            ? [tenant.id, registrationId, 1]
            : [tenant.id, registrationId],
        );
        expect(statement).toContain(
          ' order by "registration_acquisitions"."ordinal" desc',
        );
        expect(statement).toContain(' for update');
        const row = acquisitionRows.acquisition;
        return [
          [
            driverTimestamp(row.acquiredAt),
            row.eventId,
            row.id,
            row.kind,
            row.operationKey,
            row.ordinal,
            row.ownerUserId,
            row.previousAcquisitionId,
            row.registrationId,
            row.spotCount,
            row.tenantId,
            row.transferId,
          ],
        ];
      }
      if (statement.includes(' from "registration_acquisition_payments"')) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([acquisitionRows.acquisition.id]);
        expect(statement).toContain(
          ' order by "registration_acquisition_payments"."id" for update',
        );
        return acquisitionRows.payments.map((row) => [
          row.acquisitionId,
          driverTimestamp(row.attachedAt),
          row.eventId,
          row.id,
          row.registrationId,
          row.tenantId,
          row.transactionId,
        ]);
      }
      if (statement.includes(' from "registration_acquisition_components"')) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([acquisitionRows.acquisition.id]);
        expect(statement).toContain(
          ' order by "registration_acquisition_components"."id" for update',
        );
        return acquisitionRows.components.map((row) => [
          driverTimestamp(row.acquiredAt),
          row.acquisitionId,
          row.acquisitionPaymentId,
          row.allocationKey,
          row.applicationFeeAmount,
          row.baseAmount,
          row.currency,
          row.eventId,
          row.grossAmount,
          row.id,
          row.kind,
          row.netAmount,
          row.purchaseId,
          row.purchaseLotId,
          row.quantity,
          row.registrationId,
          row.stripeFeeAmount,
          row.taxAmount,
          row.taxRateDisplayName,
          row.taxRateInclusive,
          row.taxRatePercentage,
          row.tenantId,
        ]);
      }
      if (
        statement.includes(' from "event_registration_addon_purchase_orders"')
      ) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([
          registrationId,
          'pending_payment',
          tenant.id,
          1,
        ]);
        return [];
      }
      if (
        statement.includes(' from "transactions"') &&
        statement.includes('"manuallyCreated"')
      ) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([
          tenant.id,
          'refund',
          ...acquisitionRows.payments.map(({ transactionId }) => transactionId),
        ]);
        expect(statement).toContain(' order by "transactions"."id" for update');
        return normalizedSourceRefunds.map((row) => [
          row.amount,
          row.currency,
          row.eventId,
          row.eventRegistrationId,
          row.manuallyCreated,
          row.method,
          row.sourceTransactionId,
          row.status,
          row.stripeAccountId,
          row.stripeRefundId,
          row.stripeRefundStatus,
          row.targetUserId,
        ]);
      }
      if (statement.includes(' from "transactions"')) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([
          registrationId,
          tenant.id,
          ...acquisitionRows.payments.map(({ transactionId }) => transactionId),
        ]);
        expect(statement).toContain(' order by "transactions"."id" for update');
        return normalizedSourceTransactions
          .filter((row) =>
            acquisitionRows.payments.some(
              ({ transactionId }) => transactionId === row.id,
            ),
          )
          .map((row) => [
            row.amount,
            row.appFee,
            row.currency,
            row.eventId,
            row.eventRegistrationId,
            row.id,
            row.method,
            row.status,
            row.stripeAccountId,
            row.stripeChargeId,
            row.stripeFee,
            row.stripeNetAmount,
            row.stripePaymentIntentId,
            row.targetUserId,
            row.type,
          ]);
      }
      if (
        statement.includes(' from "event_registration_options"') &&
        statement.includes(' for update')
      ) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([optionId, eventId, tenant.id]);
        expect(statement).toContain(' inner join "event_instances"');
        expect(statement).toContain(' inner join "tenants"');
        lockOrder.push('terms');
        return [
          [
            discountProviders,
            driverTimestamp(
              lockedEventStart ??
                registration?.event?.start ??
                new Date(Date.now() + 24 * 60 * 60 * 1000),
            ),
            lockedEventStatus,
            normalizedRegistrationOptionIsPaid,
            registrationOptionPrice,
            lockedOptionRoleIds ?? registrationOptionRoleIds,
            null,
            'Participant ticket',
            lockedOptionTransferDeadlineHoursBeforeStart,
            null,
            lockedTenantTransferDeadlineHoursBeforeStart,
          ],
        ];
      }
      if (statement.includes(' from "event_registration_questions"')) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([eventId, optionId]);
        expect(statement).toContain(' for update');
        return registrationQuestionIds.map((id) => [id]);
      }
      if (statement.includes(' from "event_registration_addon_purchases"')) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([registrationId, tenant.id]);
        expect(statement).toContain(' inner join "event_addons"');
        expect(statement).toContain(
          ' order by "event_registration_addon_purchases"."id" for update',
        );
        return normalizedBundleAddonPurchases.map((row) => [
          row.addonId,
          row.cancelledQuantity,
          row.description,
          row.includedQuantity,
          row.price,
          row.purchasedQuantity,
          row.purchaseId,
          row.quantity,
          row.redeemedQuantity,
          row.stripeTaxRateId,
          row.title,
          driverTimestamp(row.updatedAt),
        ]);
      }
      if (
        statement.includes(' from "event_registration_addon_purchase_lots"')
      ) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([
          ...normalizedBundleAddonPurchases.map(({ purchaseId }) => purchaseId),
          tenant.id,
        ]);
        expect(statement).toContain(
          ' order by "event_registration_addon_purchase_lots"."id" for update',
        );
        return normalizedBundleLots.map((row) => [
          row.applicationFeeAmount,
          row.baseAmount,
          row.cancelledQuantity,
          row.currency,
          row.grossAmount,
          row.id,
          row.netAmount,
          driverTimestamp(row.paymentAllocationFinalizedAt),
          row.purchaseId,
          row.quantity,
          row.redeemedQuantity,
          row.refundAllocatedApplicationFeeAmount,
          row.refundAllocatedGrossAmount,
          row.refundAllocatedNetAmount,
          row.refundAllocatedQuantity,
          row.sourceTransactionId ?? null,
          row.stripeFeeAmount,
          row.taxAmount,
          row.taxRateDisplayName,
          row.taxRateInclusive,
          row.taxRatePercentage,
          row.unitPrice,
          driverTimestamp(row.updatedAt),
        ]);
      }
      if (statement.includes(' from "user_discount_cards"')) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual(['verified', tenant.id, targetUserId]);
        expect(statement).toContain(' for update');
        return recipientDiscountCards.map((row) => [
          row.type,
          driverTimestamp(row.validFrom),
          driverTimestamp(row.validTo),
        ]);
      }
      if (statement.includes(' from "event_registration_option_discounts"')) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([optionId]);
        expect(statement).toContain(' for update');
        return registrationOptionDiscounts.map((row) => [
          row.discountedPrice,
          row.discountType,
        ]);
      }
      if (
        statement.includes(' from "event_registrations"') &&
        statement.includes(' inner join "event_instances"')
      ) {
        expect(transactionOpen).toBe(true);
        expect(parameters).toEqual([
          tenant.id,
          targetUserId,
          registrationId,
          'CANCELLED',
          expect.any(Date),
          1,
        ]);
        return activeTargetRegistrations.map(({ id }) => [id]);
      }
      throw new Error(`Unexpected direct-transfer fixture SQL: ${statement}`);
    });
  let transferredAcquisitionId: string | undefined;
  let transferredAcquiredAt: string | undefined;
  let transferOwnerUpdated = false;
  let transferComponentsWritten = false;
  const organizerTransferUpdateSql =
    'update "event_registrations" set "applied_discounted_price" = $1, "applied_discount_type" = $2, "base_price_at_registration" = $3, "updatedAt" = $4, "discount_amount" = $5, "tax_rate_id" = $6, "userId" = $7 where (("event_registrations"."id" = $8) and ("event_registrations"."tenantId" = $9) and ("event_registrations"."status" = $10) and (not ("event_registrations"."userId" = $11)) and (not exists (select "id" from "event_registrations" "target_registrations" where (("target_registrations"."tenantId" = $12) and ("target_registrations"."eventId" = $13) and ("target_registrations"."userId" = $14) and (not ("target_registrations"."status" = $15)))))) returning "id"';
  const participantTransferUpdateSql =
    'update "event_registrations" set "applied_discounted_price" = $1, "applied_discount_type" = $2, "base_price_at_registration" = $3, "updatedAt" = $4, "discount_amount" = $5, "tax_rate_id" = $6, "userId" = $7 where (("event_registrations"."id" = $8) and ("event_registrations"."tenantId" = $9) and ("event_registrations"."status" = $10) and (not ("event_registrations"."userId" = $11)) and (not exists (select "id" from "event_registrations" "target_registrations" where (("target_registrations"."tenantId" = $12) and ("target_registrations"."eventId" = $13) and ("target_registrations"."userId" = $14) and (not ("target_registrations"."status" = $15))))) and ("event_registrations"."userId" = $16)) returning "id"';
  const transferAcquisitionInsertSql =
    'insert into "registration_acquisitions" ("acquired_at", "event_id", "id", "kind", "operation_key", "ordinal", "owner_user_id", "previous_acquisition_id", "registration_id", "spot_count", "tenant_id", "transfer_id") values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, default)';
  const transferEmailInsertSql =
    'insert into "email_outbox" ("createdAt", "id", "updatedAt", "tenantId", "attempts", "claim_lease_expires_at", "claim_lease_id", "delivery_unknown_at", "exhausted_at", "from_email", "from_name", "html", "idempotency_key", "kind", "last_attempt_at", "last_error", "max_attempts", "next_attempt_at", "provider", "provider_message_id", "reply_to_email", "reply_to_name", "sent_at", "status", "subject", "suppressed_at", "text", "to_email") values (default, $1, default, $2, default, default, default, default, default, $3, $4, $5, $6, $7, default, default, default, default, default, default, $8, $9, default, default, $10, default, $11, $12) on conflict ("idempotency_key") do nothing';
  const transferComponentInsertPrefix =
    'insert into "registration_acquisition_components" ("acquired_at", "acquisition_id", "acquisition_payment_id", "allocation_key", "application_fee_amount", "base_amount", "currency", "event_id", "gross_amount", "id", "kind", "net_amount", "purchase_id", "purchase_lot_id", "quantity", "registration_id", "stripe_fee_amount", "tax_amount", "tax_rate_name", "tax_rate_inclusive", "tax_rate_percentage", "tenant_id") values ';

  const executeTransferWrite: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.gen(function* () {
      expect(transactionOpen).toBe(true);
      if (
        statement.startsWith(`update "${getTableName(eventRegistrations)}"`)
      ) {
        expect(statement).toBe(
          participantCommit
            ? participantTransferUpdateSql
            : organizerTransferUpdateSql,
        );
        expect(transferOwnerUpdated).toBe(false);
        const appliedDiscountedPrice = Schema.decodeUnknownSync(
          Schema.NullOr(Schema.Number),
        )(parameters[0]);
        const appliedDiscountType = Schema.decodeUnknownSync(
          Schema.NullOr(Schema.Literal('esnCard')),
        )(parameters[1]);
        const basePriceAtRegistration = Schema.decodeUnknownSync(Schema.Number)(
          parameters[2],
        );
        const updatedAt = Schema.decodeUnknownSync(Schema.String)(
          parameters[3],
        );
        const discountAmount = Schema.decodeUnknownSync(
          Schema.NullOr(Schema.Number),
        )(parameters[4]);
        const userId = Schema.decodeUnknownSync(Schema.String)(parameters[6]);
        expect(new Date(updatedAt).toISOString()).toBe(updatedAt);
        const expectedBasePrice = normalizedRegistrationOptionIsPaid
          ? registrationOptionPrice
          : 0;
        expect(parameters).toEqual([
          expectedBasePrice > 0 ? 0 : null,
          expectedBasePrice > 0 ? 'esnCard' : null,
          expectedBasePrice,
          updatedAt,
          // Persist zero when the recipient has no discount.
          expectedBasePrice,
          null,
          targetUserId,
          registrationId,
          tenant.id,
          'CONFIRMED',
          targetUserId,
          tenant.id,
          eventId,
          targetUserId,
          'CANCELLED',
          ...(participantCommit ? [sourceUserId] : []),
        ]);
        updateSets.push({
          appliedDiscountedPrice,
          appliedDiscountType,
          basePriceAtRegistration,
          discountAmount,
          userId,
        });
        if (updateError) return yield* Effect.fail(updateError);
        transferOwnerUpdated = true;
        return [[registrationId]];
      }

      if (
        statement.startsWith(
          `insert into "${getTableName(registrationAcquisitions)}"`,
        )
      ) {
        expect(statement).toBe(transferAcquisitionInsertSql);
        expect(transferOwnerUpdated).toBe(true);
        expect(transferredAcquisitionId).toBeUndefined();
        const acquiredAt = Schema.decodeUnknownSync(Schema.String)(
          parameters[0],
        );
        const id = Schema.decodeUnknownSync(Schema.NonEmptyString)(
          parameters[2],
        );
        expect(new Date(acquiredAt).toISOString()).toBe(acquiredAt);
        expect(id.length).toBeLessThanOrEqual(20);
        expect(id).not.toBe(acquisitionRows.acquisition.id);
        expect(parameters).toEqual([
          acquiredAt,
          eventId,
          id,
          'direct_transfer',
          `direct-registration-transfer:${acquisitionRows.acquisition.id}`,
          acquisitionRows.acquisition.ordinal + 1,
          targetUserId,
          acquisitionRows.acquisition.id,
          registrationId,
          (registration?.guestCount ?? 0) + 1,
          tenant.id,
        ]);
        transferredAcquisitionId = id;
        transferredAcquiredAt = acquiredAt;
        return [];
      }

      if (
        statement.startsWith(
          `insert into "${getTableName(registrationAcquisitionComponents)}"`,
        )
      ) {
        if (!transferredAcquisitionId || !transferredAcquiredAt)
          throw new Error(
            'Transfer components require the inserted acquisition',
          );
        expect(transferOwnerUpdated).toBe(true);
        expect(transferComponentsWritten).toBe(false);
        type TransferFreeComponent = Pick<
          typeof registrationAcquisitionComponents.$inferSelect,
          'allocationKey' | 'kind' | 'purchaseId' | 'purchaseLotId' | 'quantity'
        >;
        const components = [
          {
            allocationKey: 'registration',
            kind: 'registration',
            purchaseId: null,
            purchaseLotId: null,
            quantity: (registration?.guestCount ?? 0) + 1,
          },
          ...normalizedBundleLots.map(
            (lot) =>
              ({
                allocationKey: `addon-lot:${lot.id}`,
                kind: 'addon_lot',
                purchaseId: lot.purchaseId,
                purchaseLotId: lot.id,
                quantity: lot.quantity,
              }) satisfies TransferFreeComponent,
          ),
        ] satisfies readonly TransferFreeComponent[];
        let offset = 0;
        const componentIds = new Set<string>();
        const valueSql: string[] = [];
        for (const component of components) {
          const width = component.kind === 'registration' ? 19 : 21;
          const values = parameters.slice(offset, offset + width);
          const id = Schema.decodeUnknownSync(Schema.NonEmptyString)(values[8]);
          expect(id.length).toBeLessThanOrEqual(20);
          expect(componentIds.has(id)).toBe(false);
          componentIds.add(id);
          expect(values).toEqual([
            transferredAcquiredAt,
            transferredAcquisitionId,
            component.allocationKey,
            0,
            0,
            tenant.currency,
            eventId,
            0,
            id,
            component.kind,
            0,
            ...(component.kind === 'addon_lot'
              ? [component.purchaseId, component.purchaseLotId]
              : []),
            component.quantity,
            registrationId,
            0,
            0,
            null,
            null,
            null,
            tenant.id,
          ]);
          // Exactly the two free component row shapes emitted by the writer:
          // payment ID is DEFAULT; registration rows also omit both purchase IDs.
          const p = (index: number) => `$${offset + index}`;
          valueSql.push(
            component.kind === 'registration'
              ? `(${p(1)}, ${p(2)}, default, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, default, default, ${p(12)}, ${p(13)}, ${p(14)}, ${p(15)}, ${p(16)}, ${p(17)}, ${p(18)}, ${p(19)})`
              : `(${p(1)}, ${p(2)}, default, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ${p(12)}, ${p(13)}, ${p(14)}, ${p(15)}, ${p(16)}, ${p(17)}, ${p(18)}, ${p(19)}, ${p(20)}, ${p(21)})`,
          );
          offset += width;
        }
        expect(parameters).toHaveLength(offset);
        expect(statement).toBe(
          transferComponentInsertPrefix + valueSql.join(', '),
        );
        transferComponentsWritten = true;
        return [];
      }

      if (statement.startsWith(`insert into "${getTableName(emailOutbox)}"`)) {
        expect(statement).toBe(transferEmailInsertSql);
        expect(transferOwnerUpdated).toBe(true);
        expect(transferComponentsWritten).toBe(true);
        const id = Schema.decodeUnknownSync(Schema.NonEmptyString)(
          parameters[0],
        );
        const html = Schema.decodeUnknownSync(Schema.NonEmptyString)(
          parameters[4],
        );
        const idempotencyKey = Schema.decodeUnknownSync(Schema.NonEmptyString)(
          parameters[5],
        );
        const kind = Schema.decodeUnknownSync(
          Schema.Literal('registrationTransferred'),
        )(parameters[6]);
        const text = Schema.decodeUnknownSync(Schema.NonEmptyString)(
          parameters[10],
        );
        const toEmail = Schema.decodeUnknownSync(Schema.NonEmptyString)(
          parameters[11],
        );
        const previousOwnerEmail = registration?.user
          ? registration.user.communicationEmail.trim() ||
            registration.user.email.trim()
          : 'attendee.contact@example.com';
        const newOwnerEmail =
          targetUser?.communicationEmail?.trim() ||
          targetUser?.email?.trim() ||
          'target.contact@example.com';
        const previousOwner = insertedEmails.length === 0;
        expect(insertedEmails.length).toBeLessThan(2);
        expect(id.length).toBeLessThanOrEqual(20);
        expect(parameters).toEqual([
          id,
          tenant.id,
          TRANSACTIONAL_EMAIL_SENDER.email,
          TRANSACTIONAL_EMAIL_SENDER.name,
          html,
          `registration-transferred/${tenant.id}/${registrationId}/direct-registration-transfer:${acquisitionRows.acquisition.id}/${previousOwner ? 'previousOwner' : 'newOwner'}/${previousOwner ? sourceUserId : targetUserId}`,
          'registrationTransferred',
          tenant.emailSenderEmail?.trim() || null,
          tenant.emailSenderEmail?.trim()
            ? tenant.emailSenderName?.trim() || tenant.name
            : null,
          `${previousOwner ? 'Registration transferred' : 'Registration transferred to you'}: ${normalizedEventTitle}`,
          text,
          previousOwner ? previousOwnerEmail : newOwnerEmail,
        ]);
        expect(html).toContain(`https://${tenant.domain}/events/${eventId}`);
        expect(text).toContain(normalizedEventTitle);
        insertedEmails.push({ html, idempotencyKey, kind, toEmail });
        return [];
      }
      throw new Error(
        `Unexpected direct-transfer fixture write SQL: ${statement}`,
      );
    });
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      statement.startsWith('select ')
        ? readTransferRows(statement, parameters)
        : executeTransferWrite(statement, parameters),
    transactionControl: (command) =>
      Effect.sync(() => {
        if (command === 'BEGIN') {
          expect(transactionOpen).toBe(false);
          transactionOpen = true;
        } else {
          expect(transactionOpen).toBe(true);
          transactionOpen = false;
        }
      }),
  });
  const databaseContext = yield* Layer.build(databaseLayer);
  return {
    database: Context.get(databaseContext, Database),
    insertedEmails,
    lockOrder,
    mutateFirstAddonFulfillment: () => {
      const purchase = normalizedBundleAddonPurchases[0];
      const lot = normalizedBundleLots[0];
      if (purchase) purchase.redeemedQuantity += 1;
      if (lot) lot.redeemedQuantity += 1;
    },
    sourceTransactions: normalizedSourceTransactions,
    updateSets,
  };
});

type TransferPreviewInput = Parameters<
  (typeof eventRegistrationHandlers)['events.previewEventRegistrationTransfer']
>[0];

// The rejection cases using this token exit before the reviewed-bundle comparison.
const unusedTransferPreviewVersion = 'unused-before-preview-comparison';

const previewEventRegistrationTransfer = Effect.fn(
  'previewEventRegistrationTransfer',
)(function* ({
  eventId = 'event-1',
  registrationId = 'registration-1',
  targetUserId = 'target-user-1',
}: Partial<TransferPreviewInput> = {}) {
  const preview = yield* eventRegistrationHandlers[
    'events.previewEventRegistrationTransfer'
  ](
    { eventId, registrationId, targetUserId },
    handlerOptions('events.previewEventRegistrationTransfer'),
  );
  return preview;
});

const previewAndTransferEventRegistration = Effect.fn(
  'previewAndTransferEventRegistration',
)(function* ({
  eventId = 'event-1',
  registrationId = 'registration-1',
  targetUserId = 'target-user-1',
}: Partial<TransferPreviewInput> = {}) {
  const preview = yield* previewEventRegistrationTransfer({
    eventId,
    registrationId,
    targetUserId,
  });
  yield* eventRegistrationHandlers['events.transferEventRegistration'](
    {
      eventId,
      previewVersion: preview.previewVersion,
      registrationId,
      targetUserId,
    },
    handlerOptions('events.transferEventRegistration'),
  );
  return preview;
});

type TransferTargetRead =
  | 'activeUsers'
  | 'memberRoles'
  | 'optionRoles'
  | 'organizerAuthorization'
  | 'searchTenantMembers'
  | 'sourceRegistration';

type TransferTargetSource = Pick<
  typeof eventRegistrations.$inferSelect,
  | 'appliedDiscountedPrice'
  | 'appliedDiscountType'
  | 'checkInTime'
  | 'eventId'
  | 'id'
  | 'registrationOptionId'
  | 'status'
  | 'userId'
> & {
  event: Pick<typeof eventInstances.$inferSelect, 'start'>;
  transactions: Pick<
    typeof transactions.$inferSelect,
    'amount' | 'status' | 'type'
  >[];
};

type TransferTargetTenantUser = Pick<
  typeof users.$inferSelect,
  'communicationEmail' | 'email' | 'firstName' | 'lastName'
> &
  Pick<typeof usersToTenants.$inferSelect, 'id' | 'userId'>;

const createTransferTargetsDatabase = ({
  hasCheckedInHistory = false,
  hasPaidSource = false,
  hasSourceDiscount = false,
  registrationOptionRoleIds = ['participant-role-1'],
}: {
  hasCheckedInHistory?: boolean;
  hasPaidSource?: boolean;
  hasSourceDiscount?: boolean;
  registrationOptionRoleIds?: string[];
} = {}) =>
  Effect.gen(function* () {
    const now = new Date();
    const source: TransferTargetSource = {
      appliedDiscountedPrice: hasSourceDiscount ? 0 : null,
      appliedDiscountType: hasSourceDiscount ? 'esnCard' : null,
      checkInTime: hasCheckedInHistory ? now : null,
      event: { start: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
      eventId: 'event-1',
      id: 'registration-1',
      registrationOptionId: 'option-1',
      status: 'CONFIRMED',
      transactions: hasPaidSource
        ? [{ amount: 1200, status: 'successful', type: 'registration' }]
        : [],
      userId: 'attendee-1',
    };
    const option: Pick<
      typeof eventRegistrationOptions.$inferSelect,
      'roleIds'
    > = {
      roleIds: [...registrationOptionRoleIds],
    };
    const organizer: Pick<typeof eventRegistrations.$inferSelect, 'id'> & {
      registrationOption: Pick<
        typeof eventRegistrationOptions.$inferSelect,
        'organizingRegistration'
      >;
    } = {
      id: 'organizer-registration-1',
      registrationOption: { organizingRegistration: true },
    };
    const activeRegistrations: Pick<
      typeof eventRegistrations.$inferSelect,
      'userId'
    >[] = [
      { userId: source.userId },
      { userId: 'scanner-1' },
      { userId: 'already-registered-user' },
    ];
    // searchableInfo includes communicationEmail. These unselected addresses
    // make all four rows honest matches for the original search "alex" while
    // preserving every displayed email/name and filtering assertion.
    const tenantUserRows: TransferTargetTenantUser[] = [
      {
        communicationEmail: 'alex.current@example.com',
        email: 'current@example.com',
        firstName: 'Current',
        id: 'tenant-user-current',
        lastName: 'Owner',
        userId: 'attendee-1',
      },
      {
        communicationEmail: 'alex@example.com',
        email: 'alex@example.com',
        firstName: 'Alex',
        id: 'tenant-user-eligible',
        lastName: 'Able',
        userId: 'target-user-1',
      },
      {
        communicationEmail: 'alex.registered@example.com',
        email: 'registered@example.com',
        firstName: 'Already',
        id: 'tenant-user-active',
        lastName: 'Registered',
        userId: 'already-registered-user',
      },
      {
        communicationEmail: 'alex.other@example.com',
        email: 'other@example.com',
        firstName: 'Other',
        id: 'tenant-user-ineligible',
        lastName: 'Role',
        userId: 'other-user-1',
      },
    ];
    const memberRoles: Pick<
      typeof rolesToTenantUsers.$inferSelect,
      'roleId' | 'userTenantId'
    >[] = [
      { roleId: 'participant-role-1', userTenantId: 'tenant-user-current' },
      { roleId: 'participant-role-1', userTenantId: 'tenant-user-eligible' },
      { roleId: 'participant-role-1', userTenantId: 'tenant-user-active' },
      { roleId: 'other-role-1', userTenantId: 'tenant-user-ineligible' },
    ];
    const expectedReads: readonly TransferTargetRead[] = [
      'sourceRegistration',
      'organizerAuthorization',
      'optionRoles',
      'activeUsers',
      'searchTenantMembers',
      'memberRoles',
    ];
    const reads: TransferTargetRead[] = [];
    const registrationTable = getTableName(eventRegistrations);
    const optionTable = getTableName(eventRegistrationOptions);
    const eventTable = getTableName(eventInstances);
    const userTable = getTableName(users);
    const tenantUserTable = getTableName(usersToTenants);
    const roleTable = getTableName(rolesToTenantUsers);
    const executeValues: SqlConnection.Connection['executeValues'] = (
      statement,
      parameters,
    ) =>
      Effect.sync(() => {
        const read = expectedReads[reads.length];
        if (!read)
          throw new Error(`Unexpected extra transfer target SQL: ${statement}`);
        reads.push(read);
        switch (read) {
          case 'activeUsers': {
            expect(statement).toBe(
              `select "d0"."userId" as "userId" from "${registrationTable}" as "d0" where (("d0"."eventId" = $1) and (not ("d0"."status" = $2)) and ("d0"."tenantId" = $3))`,
            );
            expect(parameters).toEqual(['event-1', 'CANCELLED', 'tenant-1']);
            return activeRegistrations.map((registration) => [
              registration.userId,
            ]);
          }
          case 'memberRoles': {
            expect(statement).toBe(
              `select "roleId", "userTenantId" from "${roleTable}" where "${roleTable}"."userTenantId" in ($1, $2, $3, $4)`,
            );
            expect(parameters).toEqual(
              tenantUserRows.map((member) => member.id),
            );
            return memberRoles.map((membership) => [
              membership.roleId,
              membership.userTenantId,
            ]);
          }
          case 'optionRoles': {
            expect(statement).toBe(
              `select "d0"."roleIds" as "roleIds" from "${optionTable}" as "d0" where (("d0"."eventId" = $1) and ("d0"."id" = $2)) limit $3`,
            );
            expect(parameters).toEqual(['event-1', 'option-1', 1]);
            return [[[...option.roleIds]]];
          }
          case 'organizerAuthorization': {
            expect(statement).toBe(
              `select "d0"."id" as "id", "registrationOption"."r" as "registrationOption" from "${registrationTable}" as "d0" left join lateral(select row_to_json("t".*) "r" from (select "d1"."organizingRegistration" as "organizingRegistration" from "${optionTable}" as "d1" where "d0"."registrationOptionId" = "d1"."id" limit $1) as "t") as "registrationOption" on true where (("d0"."eventId" = $2) and ("d0"."status" = $3) and ("d0"."tenantId" = $4) and ("d0"."userId" = $5))`,
            );
            expect(parameters).toEqual([
              1,
              'event-1',
              'CONFIRMED',
              'tenant-1',
              'scanner-1',
            ]);
            return [[organizer.id, { ...organizer.registrationOption }]];
          }
          case 'searchTenantMembers': {
            expect(statement).toBe(
              `select "${userTable}"."email", "${userTable}"."firstName", "${tenantUserTable}"."id", "${userTable}"."lastName", "${tenantUserTable}"."userId" from "${tenantUserTable}" inner join "${userTable}" on "${tenantUserTable}"."userId" = "${userTable}"."id" where (("${tenantUserTable}"."tenantId" = $1) and ("${userTable}"."searchableInfo" ilike $2)) limit $3`,
            );
            expect(parameters).toEqual(['tenant-1', '%alex%', 100]);
            for (const member of tenantUserRows) {
              expect(member.communicationEmail).toContain('alex');
            }
            return tenantUserRows.map((member) => [
              member.email,
              member.firstName,
              member.id,
              member.lastName,
              member.userId,
            ]);
          }
          case 'sourceRegistration': {
            expect(statement).toBe(
              `select "d0"."eventId" as "eventId", "d0"."id" as "id", "d0"."registrationOptionId" as "registrationOptionId", "d0"."status" as "status", "d0"."userId" as "userId", "event"."r" as "event" from "${registrationTable}" as "d0" left join lateral(select row_to_json("t".*) "r" from (select "d1"."start"::text as "start" from "${eventTable}" as "d1" where "d0"."eventId" = "d1"."id" limit $1) as "t") as "event" on true where (("d0"."eventId" = $2) and ("d0"."id" = $3) and (not ("d0"."status" = $4)) and ("d0"."tenantId" = $5)) limit $6`,
            );
            expect(parameters).toEqual([
              1,
              'event-1',
              'registration-1',
              'CANCELLED',
              'tenant-1',
              1,
            ]);
            // Lookup does not select the source's check-in/payment/discount facts.
            // Preserve that actual projection rather than returning phantom columns.
            return [
              [
                source.eventId,
                source.id,
                source.registrationOptionId,
                source.status,
                source.userId,
                {
                  start: source.event.start.toISOString().replace('Z', ''),
                },
              ],
            ];
          }
        }
      });
    const databaseContext = yield* Layer.build(
      createRegistrationDatabaseTestLayer({
        executeValues,
        transactionControl: () =>
          Effect.die(
            new Error('Unexpected transfer target lookup transaction'),
          ),
      }),
    );
    return {
      database: Context.get(databaseContext, Database),
      expectComplete: () => expect(reads).toEqual(expectedReads),
      reads,
    };
  });
describe('registration mutation guard error mapping', () => {
  it.effect('maps only known guard domain failures to conflicts', () =>
    Effect.gen(function* () {
      const transferConflict = yield* mapRegistrationTransferGuardError(
        new RegistrationTransferMutationConflict({
          message: 'Active transfer',
          registrationId: 'registration-1',
          status: 'open',
          transferId: 'transfer-1',
        }),
      ).pipe(Effect.flip);
      expect(transferConflict).toBeInstanceOf(EventRegistrationConflictError);
      expect(transferConflict.message).toContain('active transfer');

      const acquisitionConflict = yield* mapRegistrationAcquisitionGuardError(
        new RegistrationAcquisitionWriteError({
          message: 'Current acquisition owner does not match',
        }),
        'Registration acquisition ownership is inconsistent.',
      ).pipe(Effect.flip);
      expect(acquisitionConflict).toBeInstanceOf(
        EventRegistrationConflictError,
      );
      expect(acquisitionConflict.message).toBe(
        'Registration acquisition ownership is inconsistent.',
      );
    }),
  );

  it.effect('preserves unexpected guard failures as defects', () =>
    Effect.gen(function* () {
      const unexpected = new Error('database unavailable');
      const effects = [
        mapRegistrationTransferGuardError(unexpected),
        mapRegistrationAcquisitionGuardError(
          unexpected,
          'Registration acquisition ownership is inconsistent.',
        ),
      ];

      for (const effect of effects) {
        const exit = yield* effect.pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toBe(unexpected);
        }
      }
    }),
  );
});

type CurrentOwnerStatusAddonOption = Pick<
  typeof addonToEventRegistrationOptions.$inferSelect,
  'optionalPurchaseQuantity' | 'registrationOptionId'
> &
  Pick<
    typeof eventAddons.$inferSelect,
    | 'allowMultiple'
    | 'allowPurchaseBeforeEvent'
    | 'allowPurchaseDuringEvent'
    | 'description'
    | 'isPaid'
    | 'maxQuantityPerUser'
    | 'stripeTaxRateId'
    | 'title'
  > & {
    readonly addOnId: typeof eventAddons.$inferSelect.id;
    readonly nextPurchaseTaxRateDisplayName: typeof tenantStripeTaxRates.$inferSelect.displayName;
    readonly nextPurchaseTaxRateInclusive:
      null | typeof tenantStripeTaxRates.$inferSelect.inclusive;
    readonly nextPurchaseTaxRatePercentage: typeof tenantStripeTaxRates.$inferSelect.percentage;
    readonly nextPurchaseUnitPrice: typeof eventAddons.$inferSelect.price;
    readonly stockAvailableQuantity: typeof eventAddons.$inferSelect.totalAvailableQuantity;
  };

type CurrentOwnerStatusDatabaseStep =
  | {
      readonly includeOtherTransfer: boolean;
      readonly operation: 'readTransferRefunds';
      readonly rows: readonly CurrentOwnerStatusRefund[];
    }
  | {
      readonly operation: 'readConfiguredAddons';
      readonly rows: readonly CurrentOwnerStatusAddonOption[];
    }
  | {
      readonly operation: 'readOptionTitles';
      readonly rows: readonly Pick<
        typeof eventRegistrationOptions.$inferSelect,
        'id' | 'title'
      >[];
    }
  | {
      readonly operation: 'readOwnerRegistrations';
      readonly rows: readonly CurrentOwnerStatusRegistration[];
    }
  | {
      readonly operation: 'readVisibleTransfers';
      readonly registrationOwned: boolean;
      readonly rows: readonly CurrentOwnerStatusTransfer[];
    }
  | {
      readonly operation: 'recheckOwnership';
      readonly rows: readonly Pick<
        typeof eventRegistrations.$inferSelect,
        'id'
      >[];
    };

type CurrentOwnerStatusPurchase = Pick<
  typeof eventRegistrationAddonPurchases.$inferSelect,
  | 'addonId'
  | 'cancelledQuantity'
  | 'includedQuantity'
  | 'purchasedQuantity'
  | 'quantity'
  | 'redeemedQuantity'
  | 'unitPrice'
> & {
  readonly addOn: Pick<typeof eventAddons.$inferSelect, 'title'>;
};

type CurrentOwnerStatusPurchaseOrder = Pick<
  typeof eventRegistrationAddonPurchaseOrders.$inferSelect,
  'addonId' | 'expiresAt' | 'operationKey' | 'quantity'
> & {
  readonly transaction: null | Pick<
    typeof transactions.$inferSelect,
    'stripeCheckoutUrl'
  >;
};

type CurrentOwnerStatusRefund = Pick<
  typeof registrationTransferRefundPlanItems.$inferSelect,
  'currency' | 'refundAmountDue' | 'transferId'
> & {
  readonly refund: null | Pick<
    typeof transactions.$inferSelect,
    | 'manuallyCreated'
    | 'method'
    | 'status'
    | 'stripeRefundAttempts'
    | 'stripeRefundClaimLeaseExpiresAt'
    | 'stripeRefundClaimLeaseId'
    | 'stripeRefundMaxAttempts'
    | 'stripeRefundNextAttemptAt'
    | 'stripeRefundStatus'
  >;
};

type CurrentOwnerStatusRegistration = Pick<
  typeof eventRegistrations.$inferSelect,
  | 'appliedDiscountedPrice'
  | 'appliedDiscountType'
  | 'basePriceAtRegistration'
  | 'checkInTime'
  | 'discountAmount'
  | 'guestCount'
  | 'id'
  | 'registrationOptionId'
  | 'status'
> & {
  readonly addonPurchaseOrders: readonly CurrentOwnerStatusPurchaseOrder[];
  readonly addonPurchases: readonly CurrentOwnerStatusPurchase[];
  readonly event: Pick<
    typeof eventInstances.$inferSelect,
    'end' | 'start' | 'status'
  >;
  readonly registrationOption: Pick<
    typeof eventRegistrationOptions.$inferSelect,
    | 'cancellationDeadlineHoursBeforeStart'
    | 'organizingRegistration'
    | 'price'
    | 'registeredDescription'
    | 'title'
    | 'transferDeadlineHoursBeforeStart'
  >;
  readonly transactions: readonly Pick<
    typeof transactions.$inferSelect,
    'amount' | 'method' | 'status' | 'stripeCheckoutUrl' | 'type'
  >[];
};

type CurrentOwnerStatusTransfer = Pick<
  typeof registrationTransfers.$inferSelect,
  | 'expiresAt'
  | 'ownershipTransferredAt'
  | 'registrationOptionId'
  | 'sourceRegistrationId'
  | 'sourceUserId'
  | 'status'
> & {
  readonly transferId: typeof registrationTransfers.$inferSelect.id;
};

const currentOwnerStatusTimestamp = (value: Date | null) =>
  value?.toISOString().replace('Z', '') ?? null;

const currentOwnerStatusRegistrationValues = (
  row: CurrentOwnerStatusRegistration,
) => [
  row.appliedDiscountedPrice,
  row.appliedDiscountType,
  row.basePriceAtRegistration,
  currentOwnerStatusTimestamp(row.checkInTime),
  row.discountAmount,
  row.guestCount,
  row.id,
  row.registrationOptionId,
  row.status,
  row.addonPurchaseOrders.map((order) => ({
    ...order,
    expiresAt: currentOwnerStatusTimestamp(order.expiresAt),
    transaction: order.transaction ? { ...order.transaction } : null,
  })),
  row.addonPurchases.map((purchase) => ({
    ...purchase,
    addOn: { ...purchase.addOn },
  })),
  {
    ...row.event,
    end: currentOwnerStatusTimestamp(row.event.end),
    start: currentOwnerStatusTimestamp(row.event.start),
  },
  { ...row.registrationOption },
  row.transactions.map((transaction) => ({ ...transaction })),
];

const currentOwnerStatusRegistration: CurrentOwnerStatusRegistration = {
  addonPurchaseOrders: [],
  addonPurchases: [],
  appliedDiscountedPrice: null,
  appliedDiscountType: null,
  basePriceAtRegistration: null,
  checkInTime: null,
  discountAmount: null,
  event: {
    end: new Date('2026-09-19T12:00:00.000Z'),
    start: new Date('2026-09-19T09:00:00.000Z'),
    status: 'APPROVED',
  },
  guestCount: 0,
  id: 'registration-1',
  registrationOption: {
    cancellationDeadlineHoursBeforeStart: null,
    organizingRegistration: false,
    price: 1200,
    registeredDescription: null,
    title: 'Participant',
    transferDeadlineHoursBeforeStart: 0,
  },
  registrationOptionId: 'option-1',
  status: 'CONFIRMED',
  transactions: [
    {
      amount: 1200,
      method: 'stripe',
      status: 'successful',
      stripeCheckoutUrl: null,
      type: 'registration',
    },
  ],
};

const currentOwnerStatusStatements = {
  readConfiguredAddons:
    'select "event_addons"."id", "event_addons"."allowMultiple", "event_addons"."allowPurchaseBeforeEvent", "event_addons"."allowPurchaseDuringEvent", "event_addons"."description", "event_addons"."isPaid", "event_addons"."maxQuantityPerUser", "tenant_stripe_tax_rates"."displayName", "tenant_stripe_tax_rates"."inclusive", "tenant_stripe_tax_rates"."percentage", "event_addons"."price", "addon_to_event_registration_options"."optional_purchase_quantity", "addon_to_event_registration_options"."registrationOptionId", "event_addons"."totalAvailableQuantity", "event_addons"."stripeTaxRateId", "event_addons"."title" from "addon_to_event_registration_options" inner join "event_addons" on (("event_addons"."id" = "addon_to_event_registration_options"."addonId") and ("event_addons"."eventId" = "addon_to_event_registration_options"."eventId")) inner join "event_instances" on (("event_instances"."id" = "addon_to_event_registration_options"."eventId") and ("event_instances"."tenantId" = $1)) left join "tenant_stripe_tax_rates" on (("tenant_stripe_tax_rates"."tenantId" = $2) and ("tenant_stripe_tax_rates"."stripeAccountId" = $3) and ("tenant_stripe_tax_rates"."stripeTaxRateId" = "event_addons"."stripeTaxRateId") and ("tenant_stripe_tax_rates"."active" = $4)) where (("addon_to_event_registration_options"."eventId" = $5) and ("addon_to_event_registration_options"."registrationOptionId" in ($6))) order by "addon_to_event_registration_options"."registrationOptionId", "event_addons"."id"',
  readOptionTitles:
    'select "id", "title" from "event_registration_options" where (("event_registration_options"."eventId" = $1) and ("event_registration_options"."id" in ($2)))',
  recheckOwnership:
    'select "d0"."id" as "id" from "event_registrations" as "d0" where (("d0"."eventId" = $1) and ("d0"."id" in ($2)) and (not ("d0"."status" = $3)) and ("d0"."tenantId" = $4) and ("d0"."userId" = $5))',
  visibleTransfersPrefix:
    'select "expires_at"::text, "ownership_transferred_at"::text, "registration_option_id", "source_registration_id", "source_user_id", "status", "id" from "registration_transfers" where (("registration_transfers"."event_id" = $1) and ("registration_transfers"."tenantId" = $2) and ("registration_transfers"."status" in ($3, $4, $5, $6, $7)) and ',
};

const createCurrentOwnerStatusDatabaseFixture = (
  steps: readonly CurrentOwnerStatusDatabaseStep[],
) => {
  const completed: CurrentOwnerStatusDatabaseStep['operation'][] = [];
  const executeValues: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      const step = steps[completed.length];
      if (!step) {
        throw new Error(`Unexpected owner status fixture SQL: ${statement}`);
      }
      switch (step.operation) {
        case 'readConfiguredAddons': {
          expect(statement).toBe(
            currentOwnerStatusStatements.readConfiguredAddons,
          );
          expect(parameters).toEqual([
            'tenant-1',
            'tenant-1',
            '',
            true,
            'event-1',
            'option-1',
          ]);
          completed.push(step.operation);
          return step.rows.map((row) => [
            row.addOnId,
            row.allowMultiple,
            row.allowPurchaseBeforeEvent,
            row.allowPurchaseDuringEvent,
            row.description,
            row.isPaid,
            row.maxQuantityPerUser,
            row.nextPurchaseTaxRateDisplayName,
            row.nextPurchaseTaxRateInclusive,
            row.nextPurchaseTaxRatePercentage,
            row.nextPurchaseUnitPrice,
            row.optionalPurchaseQuantity,
            row.registrationOptionId,
            row.stockAvailableQuantity,
            row.stripeTaxRateId,
            row.title,
          ]);
        }
        case 'readOptionTitles': {
          expect(statement).toBe(currentOwnerStatusStatements.readOptionTitles);
          expect(parameters).toEqual(['event-1', 'option-1']);
          completed.push(step.operation);
          return step.rows.map((row) => [row.id, row.title]);
        }
        case 'readOwnerRegistrations': {
          expect(
            statement.startsWith(
              'select "d0"."applied_discounted_price" as "appliedDiscountedPrice", "d0"."applied_discount_type" as "appliedDiscountType", "d0"."base_price_at_registration" as "basePriceAtRegistration", "d0"."checkInTime"::text as "checkInTime", "d0"."discount_amount" as "discountAmount", "d0"."guest_count" as "guestCount", "d0"."id" as "id", "d0"."registrationOptionId" as "registrationOptionId", "d0"."status" as "status", "addonPurchaseOrders"."r" as "addonPurchaseOrders", "addonPurchases"."r" as "addonPurchases", "event"."r" as "event", "registrationOption"."r" as "registrationOption", "transactions"."r" as "transactions" from "event_registrations" as "d0" ',
            ),
          ).toBe(true);
          expect(statement).toContain(
            'where (((("d2"."method" = $1) and ("d2"."status" = $2) and ("d2"."tenantId" = $3) and ("d2"."type" = $4))) and ("d1"."transaction_id" = "d2"."id")) limit $5',
          );
          expect(statement).toContain(
            'where (((("d1"."requested_by_user_id" = $6) and ("d1"."status" = $7) and ("d1"."tenant_id" = $8))) and ("d0"."id" = "d1"."registration_id"))',
          );
          expect(statement).toContain(
            'select "d1"."cancellation_deadline_hours_before_start" as "cancellationDeadlineHoursBeforeStart", "d1"."organizingRegistration" as "organizingRegistration", "d1"."price" as "price", "d1"."registeredDescription" as "registeredDescription", "d1"."title" as "title", "d1"."transfer_deadline_hours_before_start" as "transferDeadlineHoursBeforeStart" from "event_registration_options" as "d1"',
          );
          expect(statement).toContain(
            'select "d1"."amount" as "amount", "d1"."method" as "method", "d1"."status" as "status", "d1"."stripeCheckoutUrl" as "stripeCheckoutUrl", "d1"."type" as "type" from "transactions" as "d1"',
          );
          expect(
            statement.endsWith(
              ' where (("d0"."eventId" = $12) and (not ("d0"."status" = $13)) and ("d0"."tenantId" = $14) and ("d0"."userId" = $15))',
            ),
          ).toBe(true);
          expect(parameters).toEqual([
            'stripe',
            'pending',
            'tenant-1',
            'addon',
            1,
            'scanner-1',
            'pending_payment',
            'tenant-1',
            1,
            1,
            1,
            'event-1',
            'CANCELLED',
            'tenant-1',
            'scanner-1',
          ]);
          completed.push(step.operation);
          return step.rows.map((row) =>
            currentOwnerStatusRegistrationValues(row),
          );
        }
        case 'readTransferRefunds': {
          const transferFilter = step.includeOtherTransfer ? '$2, $3' : '$2';
          const tenantParameter = step.includeOtherTransfer ? '$4' : '$3';
          const amountParameter = step.includeOtherTransfer ? '$5' : '$4';
          expect(statement).toBe(
            'select "registration_transfer_refund_plan_items"."currency", "transactions"."manuallyCreated", "transactions"."method", "transactions"."status", "transactions"."stripe_refund_attempts", "transactions"."stripe_refund_claim_lease_expires_at"::text, "transactions"."stripe_refund_claim_lease_id", "transactions"."stripe_refund_max_attempts", "transactions"."stripe_refund_next_attempt_at"::text, "transactions"."stripe_refund_status", "registration_transfer_refund_plan_items"."refund_amount_due", "registration_transfer_refund_plan_items"."transfer_id" from "registration_transfer_refund_plan_items" left join "transactions" on (("transactions"."id" = "registration_transfer_refund_plan_items"."refund_transaction_id") and ("transactions"."tenantId" = "registration_transfer_refund_plan_items"."tenant_id") and ("transactions"."type" = $1)) where (("registration_transfer_refund_plan_items"."transfer_id" in (' +
              transferFilter +
              ')) and ("registration_transfer_refund_plan_items"."tenant_id" = ' +
              tenantParameter +
              ') and ("registration_transfer_refund_plan_items"."refund_amount_due" > ' +
              amountParameter +
              '))',
          );
          expect(parameters).toEqual([
            'refund',
            'transfer-1',
            ...(step.includeOtherTransfer ? ['transfer-other'] : []),
            'tenant-1',
            0,
          ]);
          completed.push(step.operation);
          return step.rows.map((row) => [
            row.currency,
            row.refund?.manuallyCreated ?? null,
            row.refund?.method ?? null,
            row.refund?.status ?? null,
            row.refund?.stripeRefundAttempts ?? null,
            currentOwnerStatusTimestamp(
              row.refund?.stripeRefundClaimLeaseExpiresAt ?? null,
            ),
            row.refund?.stripeRefundClaimLeaseId ?? null,
            row.refund?.stripeRefundMaxAttempts ?? null,
            currentOwnerStatusTimestamp(
              row.refund?.stripeRefundNextAttemptAt ?? null,
            ),
            row.refund?.stripeRefundStatus ?? null,
            row.refundAmountDue,
            row.transferId,
          ]);
        }
        case 'readVisibleTransfers': {
          expect(statement).toBe(
            currentOwnerStatusStatements.visibleTransfersPrefix +
              (step.registrationOwned
                ? '((("registration_transfers"."source_user_id" = $8) or ("registration_transfers"."source_registration_id" in ($9)))))'
                : '("registration_transfers"."source_user_id" = $8))'),
          );
          expect(parameters).toEqual([
            'event-1',
            'tenant-1',
            'open',
            'checkout_pending',
            'refund_pending',
            'refund_failed',
            'completed',
            'scanner-1',
            ...(step.registrationOwned ? ['registration-1'] : []),
          ]);
          completed.push(step.operation);
          return step.rows.map((row) => [
            currentOwnerStatusTimestamp(row.expiresAt),
            currentOwnerStatusTimestamp(row.ownershipTransferredAt),
            row.registrationOptionId,
            row.sourceRegistrationId,
            row.sourceUserId,
            row.status,
            row.transferId,
          ]);
        }
        case 'recheckOwnership': {
          expect(statement).toBe(currentOwnerStatusStatements.recheckOwnership);
          expect(parameters).toEqual([
            'event-1',
            'registration-1',
            'CANCELLED',
            'tenant-1',
            'scanner-1',
          ]);
          completed.push(step.operation);
          return step.rows.map((row) => [row.id]);
        }
      }
    });
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues,
    transactionControl: () =>
      Effect.die(new Error('Unexpected owner status fixture transaction')),
  });
  return {
    databaseLayer,
    expectComplete: () => {
      expect(completed).toEqual(steps.map((step) => step.operation));
    },
    registrationReadCount: () =>
      completed.filter(
        (operation) =>
          operation === 'readOwnerRegistrations' ||
          operation === 'recheckOwnership',
      ).length,
  };
};

describe('event registration owner add-on status', () => {
  const now = new Date('2026-09-18T09:00:00.000Z');
  const eventStart = new Date('2026-09-19T09:00:00.000Z');
  const eventEnd = new Date('2026-09-19T12:00:00.000Z');
  const availableAddonInput = {
    activeTransfer: false,
    allowMultiple: true,
    allowPurchaseBeforeEvent: true,
    allowPurchaseDuringEvent: false,
    eventEnd,
    eventStart,
    eventStatus: 'APPROVED',
    maxQuantityPerUser: 3,
    now,
    optionalPurchaseQuantity: 2,
    paymentConfigured: true,
    pendingOptionalQuantity: 0,
    pendingOrder: false,
    purchasedOptionalQuantity: 0,
    registrationStatus: 'CONFIRMED',
    stockAvailableQuantity: 4,
    taxConfigured: true,
  } as const;

  it('keeps a free add-on available when no Stripe payment configuration is needed', () => {
    expect(registrationAddonPurchaseAvailability(availableAddonInput)).toEqual({
      currentPurchaseWindow: 'beforeEvent',
      maxPurchasableQuantity: 2,
      purchaseAvailable: true,
      purchaseBlockedReason: 'none',
      purchaseStatus: 'available',
    });
  });

  it('blocks every add-on while any add-on checkout is pending', () => {
    expect(
      registrationAddonPurchaseAvailability({
        ...availableAddonInput,
        pendingOrder: true,
      }),
    ).toEqual({
      currentPurchaseWindow: 'beforeEvent',
      maxPurchasableQuantity: 0,
      purchaseAvailable: false,
      purchaseBlockedReason: 'paymentPending',
      purchaseStatus: 'paymentPending',
    });
  });

  it('allows paid and fulfilled bundles while blocking pending add-on payments', () => {
    const transferableInput = {
      activeTransfer: false,
      eventStart,
      eventStatus: 'APPROVED',
      hasPendingAddonOrder: false,
      now,
      registrationStatus: 'CONFIRMED',
      transferDeadlineHoursBeforeStart: 0,
    } as const;

    expect(registrationTransferBlockedReason(transferableInput)).toBe('none');
    expect(
      registrationTransferBlockedReason({
        ...transferableInput,
        hasPendingAddonOrder: true,
      }),
    ).toBe('addonPaymentPending');
    expect(
      registrationTransferBlockedReason({
        ...transferableInput,
        activeTransfer: true,
      }),
    ).toBe('activeTransfer');
  });

  it('removes internal causes before an add-on purchase error crosses RPC', () => {
    const sanitized = withoutRegistrationInternalErrorCause(
      new EventRegistrationInternalError({
        cause: new Error('duplicate key violates secret_constraint_name'),
        message: 'Add-on purchase reservation failed',
      }),
    );

    expect(sanitized.message).toBe('Add-on purchase reservation failed');
    expect(sanitized).not.toHaveProperty('cause');
  });

  it.effect(
    'removes internal causes before a registration mutation error crosses RPC',
    () =>
      Effect.gen(function* () {
        const sanitized = yield* mapRegistrationMutationInternalError(
          new EventRegistrationInternalError({
            cause: new Error('duplicate key violates secret_constraint_name'),
            message: 'Registration payment setup failed',
          }),
        ).pipe(Effect.flip);

        expect(sanitized.message).toBe('Registration payment setup failed');
        expect(sanitized).not.toHaveProperty('cause');
      }),
  );

  it.effect(
    'returns every configured add-on and owner-scoped pending checkout recovery data',
    () =>
      Effect.gen(function* () {
        const pendingCheckoutExpiresAt = new Date('2026-09-18T09:30:00.000Z');
        const includedPurchase: CurrentOwnerStatusPurchase = {
          addOn: { title: 'Included lunch' },
          addonId: 'addon-included',
          cancelledQuantity: 0,
          includedQuantity: 2,
          purchasedQuantity: 1,
          quantity: 3,
          redeemedQuantity: 0,
          unitPrice: 0,
        };
        const baseRegistration: CurrentOwnerStatusRegistration = {
          addonPurchaseOrders: [],
          addonPurchases: [includedPurchase],
          appliedDiscountedPrice: null,
          appliedDiscountType: null,
          basePriceAtRegistration: null,
          checkInTime: null,
          discountAmount: null,
          event: {
            end: eventEnd,
            start: eventStart,
            status: 'APPROVED',
          },
          guestCount: 0,
          id: 'registration-1',
          registrationOption: {
            cancellationDeadlineHoursBeforeStart: null,
            organizingRegistration: false,
            price: 1200,
            registeredDescription: null,
            title: 'Participant',
            transferDeadlineHoursBeforeStart: 0,
          },
          registrationOptionId: 'option-1',
          status: 'CONFIRMED',
          transactions: [
            {
              amount: 1200,
              method: 'stripe',
              status: 'successful',
              stripeCheckoutUrl: null,
              type: 'registration',
            },
          ],
        };
        const registrationAddOnOptions: readonly CurrentOwnerStatusAddonOption[] =
          [
            {
              addOnId: 'addon-included',
              allowMultiple: true,
              allowPurchaseBeforeEvent: true,
              allowPurchaseDuringEvent: false,
              description: 'Included with the registration',
              isPaid: false,
              maxQuantityPerUser: 3,
              nextPurchaseTaxRateDisplayName: null,
              nextPurchaseTaxRateInclusive: null,
              nextPurchaseTaxRatePercentage: null,
              nextPurchaseUnitPrice: 0,
              optionalPurchaseQuantity: 0,
              registrationOptionId: 'option-1',
              stockAvailableQuantity: 5,
              stripeTaxRateId: null,
              title: 'Included lunch',
            },
            {
              addOnId: 'addon-free',
              allowMultiple: true,
              allowPurchaseBeforeEvent: true,
              allowPurchaseDuringEvent: false,
              description: null,
              isPaid: false,
              maxQuantityPerUser: 3,
              nextPurchaseTaxRateDisplayName: null,
              nextPurchaseTaxRateInclusive: null,
              nextPurchaseTaxRatePercentage: null,
              nextPurchaseUnitPrice: 0,
              optionalPurchaseQuantity: 2,
              registrationOptionId: 'option-1',
              stockAvailableQuantity: 4,
              stripeTaxRateId: null,
              title: 'Free city map',
            },
            {
              addOnId: 'addon-paid',
              allowMultiple: true,
              allowPurchaseBeforeEvent: true,
              allowPurchaseDuringEvent: true,
              description: 'A paid upgrade',
              isPaid: true,
              maxQuantityPerUser: 3,
              nextPurchaseTaxRateDisplayName: 'VAT',
              nextPurchaseTaxRateInclusive: false,
              nextPurchaseTaxRatePercentage: '21',
              nextPurchaseUnitPrice: 499,
              optionalPurchaseQuantity: 3,
              registrationOptionId: 'option-1',
              stockAvailableQuantity: 3,
              stripeTaxRateId: 'txr_21',
              title: 'Paid upgrade',
            },
          ];
        const statusReadSteps = (
          row: CurrentOwnerStatusRegistration,
        ): readonly CurrentOwnerStatusDatabaseStep[] => [
          { operation: 'readOwnerRegistrations', rows: [row] },
          { operation: 'readConfiguredAddons', rows: registrationAddOnOptions },
          {
            operation: 'readVisibleTransfers',
            registrationOwned: true,
            rows: [],
          },
        ];
        const fixture = createCurrentOwnerStatusDatabaseFixture([
          ...statusReadSteps(baseRegistration),
          ...statusReadSteps({
            ...baseRegistration,
            addonPurchaseOrders: [
              {
                addonId: 'addon-paid',
                expiresAt: pendingCheckoutExpiresAt,
                operationKey: 'operation-paid-1',
                quantity: 2,
                transaction: {
                  stripeCheckoutUrl:
                    'https://checkout.stripe.com/c/pay/cs_test_addon',
                },
              },
            ],
          }),
          ...statusReadSteps({
            ...baseRegistration,
            addonPurchases: [
              {
                ...includedPurchase,
                cancelledQuantity: 1,
                redeemedQuantity: 1,
              },
            ],
          }),
        ]);
        const getRegistrationStatus = () =>
          eventRegistrationHandlers['events.getRegistrationStatus'](
            { eventId: 'event-1' },
            handlerOptions('events.getRegistrationStatus'),
          ).pipe(
            Effect.provide(
              createSqlContextLayer({
                databaseLayer: fixture.databaseLayer,
                nowIso: now.toISOString(),
              }),
            ),
          );

        const availableResult = yield* getRegistrationStatus();
        const availableRegistration = availableResult.registrations[0];
        expect(availableRegistration).toBeDefined();
        expect(availableResult.outgoingTransfers).toEqual([]);
        expect(fixture.registrationReadCount()).toBe(1);
        expect(
          availableRegistration?.registrationAddOns.map(
            ({ addOnId }) => addOnId,
          ),
        ).toEqual(['addon-included', 'addon-free', 'addon-paid']);
        expect(availableRegistration?.registrationAddOns[0]).toEqual(
          expect.objectContaining({
            cancelledQuantity: 0,
            includedQuantity: 2,
            remainingQuantity: 3,
            settledPurchasedQuantity: 1,
            totalQuantity: 3,
          }),
        );
        expect(availableRegistration?.registrationAddOns[1]).toEqual(
          expect.objectContaining({
            maxPurchasableQuantity: 2,
            purchaseAvailable: true,
            purchaseBlockedReason: 'none',
            purchaseStatus: 'available',
          }),
        );
        expect(availableRegistration?.registrationAddOns[2]).toEqual(
          expect.objectContaining({
            nextPurchaseUnitGrossAmount: 604,
            nextPurchaseUnitTaxAmount: 105,
            purchaseBlockedReason: 'paymentUnavailable',
          }),
        );
        expect(availableRegistration).toEqual(
          expect.objectContaining({
            cancellationAvailable: true,
            cancellationBlockedReason: 'none',
            organizingRegistration: false,
            transferAvailable: true,
            transferBlockedReason: 'none',
          }),
        );

        const pendingResult = yield* getRegistrationStatus();
        const pendingRegistration = pendingResult.registrations[0];
        expect(
          pendingRegistration?.registrationAddOns.every(
            (addOn) =>
              addOn.purchaseStatus === 'paymentPending' &&
              addOn.maxPurchasableQuantity === 0,
          ),
        ).toBe(true);
        expect(pendingRegistration?.registrationAddOns[1]).toEqual(
          expect.objectContaining({
            pendingCheckoutExpiresAt: null,
            pendingCheckoutUrl: null,
            pendingOperationKey: null,
            pendingQuantity: 0,
          }),
        );
        expect(pendingRegistration?.registrationAddOns[2]).toEqual(
          expect.objectContaining({
            pendingCheckoutExpiresAt: pendingCheckoutExpiresAt.toISOString(),
            pendingCheckoutUrl:
              'https://checkout.stripe.com/c/pay/cs_test_addon',
            pendingOperationKey: 'operation-paid-1',
            pendingQuantity: 2,
          }),
        );
        expect(pendingRegistration?.registrationAddOns[2]).not.toHaveProperty(
          'stripeTaxRateId',
        );
        expect(pendingRegistration).toEqual(
          expect.objectContaining({
            transferAvailable: false,
            transferBlockedReason: 'addonPaymentPending',
          }),
        );

        const fulfillmentResult = yield* getRegistrationStatus();
        expect(fulfillmentResult.registrations[0]).toEqual(
          expect.objectContaining({
            transferAvailable: true,
            transferBlockedReason: 'none',
          }),
        );
        expect(
          fulfillmentResult.registrations[0]?.registrationAddOns[0],
        ).toEqual(
          expect.objectContaining({
            cancelledQuantity: 1,
            redeemedQuantity: 1,
            remainingQuantity: 1,
          }),
        );
        expect(fixture.registrationReadCount()).toBe(3);
        fixture.expectComplete();
      }),
  );

  it.effect(
    'keeps the paid transfer refund visible to the previous owner after ticket ownership moves',
    () =>
      Effect.gen(function* () {
        const transferredAt = new Date('2026-09-18T08:00:00.000Z');
        const cases: readonly {
          expectedRefundStatus: 'completed' | 'needsAttention' | 'processing';
          refundTransactionStatus: NonNullable<
            CurrentOwnerStatusRefund['refund']
          >['status'];
          stripeRefundStatus: NonNullable<
            CurrentOwnerStatusRefund['refund']
          >['stripeRefundStatus'];
          transferStatus: CurrentOwnerStatusTransfer['status'];
        }[] = [
          {
            expectedRefundStatus: 'processing',
            refundTransactionStatus: 'pending',
            stripeRefundStatus: 'pending',
            transferStatus: 'refund_pending',
          },
          {
            expectedRefundStatus: 'needsAttention',
            refundTransactionStatus: 'pending',
            stripeRefundStatus: 'pending',
            transferStatus: 'refund_failed',
          },
          {
            expectedRefundStatus: 'completed',
            refundTransactionStatus: 'successful',
            stripeRefundStatus: 'succeeded',
            transferStatus: 'completed',
          },
        ];

        for (const lifecycleCase of cases) {
          const fixture = createCurrentOwnerStatusDatabaseFixture([
            { operation: 'readOwnerRegistrations', rows: [] },
            {
              operation: 'readVisibleTransfers',
              registrationOwned: false,
              rows: [
                {
                  expiresAt: new Date('2026-09-18T07:00:00.000Z'),
                  ownershipTransferredAt: transferredAt,
                  registrationOptionId: 'option-1',
                  sourceRegistrationId: 'registration-1',
                  sourceUserId: 'scanner-1',
                  status: lifecycleCase.transferStatus,
                  transferId: 'transfer-1',
                },
                // Deliberately inject an invalid response row to preserve the
                // defensive owner-filter assertion. The verified SQL predicate
                // excludes this row; it is not a possible PostgreSQL result.
                {
                  expiresAt: new Date('2026-09-18T07:00:00.000Z'),
                  ownershipTransferredAt: transferredAt,
                  registrationOptionId: 'option-other',
                  sourceRegistrationId: 'registration-other',
                  sourceUserId: 'other-user',
                  status: lifecycleCase.transferStatus,
                  transferId: 'transfer-other',
                },
              ],
            },
            {
              includeOtherTransfer: true,
              operation: 'readTransferRefunds',
              rows: [
                {
                  currency: 'EUR',
                  refund: {
                    manuallyCreated: false,
                    method: 'stripe',
                    status: lifecycleCase.refundTransactionStatus,
                    stripeRefundAttempts: 1,
                    stripeRefundClaimLeaseExpiresAt: null,
                    stripeRefundClaimLeaseId: null,
                    stripeRefundMaxAttempts: 8,
                    stripeRefundNextAttemptAt:
                      lifecycleCase.refundTransactionStatus === 'pending'
                        ? new Date('2026-09-18T08:10:00.000Z')
                        : null,
                    stripeRefundStatus: lifecycleCase.stripeRefundStatus,
                  },
                  refundAmountDue: 1200,
                  transferId: 'transfer-1',
                },
              ],
            },
            {
              operation: 'readOptionTitles',
              rows: [{ id: 'option-1', title: 'Participant ticket' }],
            },
          ]);
          const result = yield* eventRegistrationHandlers[
            'events.getRegistrationStatus'
          ](
            { eventId: 'event-1' },
            handlerOptions('events.getRegistrationStatus'),
          ).pipe(
            Effect.provide(
              createSqlContextLayer({ databaseLayer: fixture.databaseLayer }),
            ),
          );

          expect(result).toEqual({
            isRegistered: false,
            outgoingTransfers: [
              {
                currency: 'EUR',
                refundAmount: 1200,
                refundStatus: lifecycleCase.expectedRefundStatus,
                registrationOptionTitle: 'Participant ticket',
                transferId: 'transfer-1',
                transferredAt: transferredAt.toISOString(),
              },
            ],
            registrations: [],
          });
          expect(fixture.registrationReadCount()).toBe(1);
          fixture.expectComplete();
        }
      }),
  );

  it.effect(
    'drops a stale owned registration when the later transfer query observes the ownership move',
    () =>
      Effect.gen(function* () {
        const transferredAt = new Date('2026-09-18T08:00:00.000Z');
        const fixture = createCurrentOwnerStatusDatabaseFixture([
          {
            operation: 'readOwnerRegistrations',
            rows: [currentOwnerStatusRegistration],
          },
          { operation: 'readConfiguredAddons', rows: [] },
          {
            operation: 'readVisibleTransfers',
            registrationOwned: true,
            rows: [
              {
                expiresAt: new Date('2026-09-18T07:00:00.000Z'),
                ownershipTransferredAt: transferredAt,
                registrationOptionId: 'option-1',
                sourceRegistrationId: 'registration-1',
                sourceUserId: 'scanner-1',
                status: 'completed',
                transferId: 'transfer-1',
              },
            ],
          },
          { operation: 'recheckOwnership', rows: [] },
          {
            includeOtherTransfer: false,
            operation: 'readTransferRefunds',
            rows: [],
          },
          {
            operation: 'readOptionTitles',
            rows: [{ id: 'option-1', title: 'Participant ticket' }],
          },
        ]);

        const result = yield* eventRegistrationHandlers[
          'events.getRegistrationStatus'
        ](
          { eventId: 'event-1' },
          handlerOptions('events.getRegistrationStatus'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({ databaseLayer: fixture.databaseLayer }),
          ),
        );

        expect(result).toEqual({
          isRegistered: false,
          outgoingTransfers: [
            {
              currency: 'EUR',
              refundAmount: 0,
              refundStatus: 'notRequired',
              registrationOptionTitle: 'Participant ticket',
              transferId: 'transfer-1',
              transferredAt: transferredAt.toISOString(),
            },
          ],
          registrations: [],
        });
        expect(fixture.registrationReadCount()).toBe(2);
        fixture.expectComplete();
      }),
  );
});

type TrustedUrlPaymentClaim = Pick<
  typeof transactions.$inferSelect,
  | 'appFee'
  | 'currency'
  | 'id'
  | 'stripeAccountId'
  | 'stripeCheckoutRequest'
  | 'stripeCheckoutSessionId'
  | 'stripeCheckoutUrl'
>;

const createTrustedUrlDatabaseFixture = () => {
  let claim: TrustedUrlPaymentClaim | undefined;
  let registrationId: string | undefined;
  let transactionOpen = false;
  let bindingCount = 0;
  const commands: ('BEGIN' | 'COMMIT' | 'ROLLBACK')[] = [];
  const requireClaim = () => {
    if (!claim) throw new Error('Trusted URL fixture payment claim is missing');
    return claim;
  };
  const requireRegistrationId = () => {
    if (!registrationId)
      throw new Error('Trusted URL fixture registration is missing');
    return registrationId;
  };
  const claimValues = (row: TrustedUrlPaymentClaim) => [
    row.appFee,
    row.currency,
    row.id,
    row.stripeAccountId,
    row.stripeCheckoutRequest,
    row.stripeCheckoutSessionId,
    row.stripeCheckoutUrl,
  ];
  const claimTuple = () => {
    const row = requireClaim();
    return [
      row.id,
      requireRegistrationId(),
      'stripe',
      'pending',
      'tenant-1',
      'registration',
    ];
  };
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        if (
          statement ===
          'select "id" from "tenants" where "tenants"."id" = $1 for key share'
        ) {
          expect(transactionOpen).toBe(true);
          expect(parameters).toEqual(['tenant-1']);
          return [['tenant-1']];
        }
        if (
          statement ===
          'select "id" from "event_instances" where (("event_instances"."id" = $1) and ("event_instances"."tenantId" = $2)) for share'
        ) {
          expect(transactionOpen).toBe(true);
          expect(parameters).toEqual(['event-1', 'tenant-1']);
          return [['event-1']];
        }
        if (
          statement ===
          'select "id", "required" from "event_registration_questions" where (("event_registration_questions"."eventId" = $1) and ("event_registration_questions"."registrationOptionId" = $2)) order by "event_registration_questions"."id" for share'
        ) {
          expect(transactionOpen).toBe(true);
          expect(parameters).toEqual(['event-1', 'option-1']);
          return [];
        }
        if (
          statement.startsWith(
            `insert into "${getTableName(eventRegistrations)}"`,
          )
        ) {
          expect(transactionOpen).toBe(true);
          expect(registrationId).toBeUndefined();
          expect(statement).toContain('returning "id"');
          const id = Schema.decodeUnknownSync(Schema.String)(parameters[3]);
          expect(parameters).toEqual([
            null,
            null,
            1000,
            id,
            'tenant-1',
            0,
            'event-1',
            0,
            'option-1',
            'PENDING',
            'txr_123',
            'VAT',
            true,
            '19',
            'attendee-1',
          ]);
          registrationId = id;
          return [[id]];
        }
        if (
          statement.startsWith(`insert into "${getTableName(transactions)}"`)
        ) {
          expect(transactionOpen).toBe(true);
          expect(registrationId).toBeDefined();
          expect(claim).toBeUndefined();
          const id = Schema.decodeUnknownSync(Schema.String)(parameters[0]);
          const request = Schema.decodeUnknownSync(
            Schema.fromJsonString(RegistrationCheckoutSnapshotSchema),
          )(parameters[12]);
          expect(parameters).toEqual([
            id,
            'tenant-1',
            1000,
            35,
            'Registration for event Trusted URL event event-1',
            'EUR',
            'event-1',
            requireRegistrationId(),
            'attendee-1',
            'stripe',
            'pending',
            'acct_123',
            JSON.stringify(request),
            'attendee-1',
            'registration',
          ]);
          expect(request.eventUrl).toBe(
            'https://tenant.example.com/events/event-1',
          );
          expect(request.customerEmail).toBe('attendee-1@example.com');
          claim = {
            appFee: 35,
            currency: 'EUR',
            id,
            stripeAccountId: 'acct_123',
            stripeCheckoutRequest: request,
            stripeCheckoutSessionId: null,
            stripeCheckoutUrl: null,
          };
          return [claimValues(claim)];
        }
        if (
          statement.startsWith(
            `update "${getTableName(eventRegistrationOptions)}"`,
          )
        ) {
          expect(transactionOpen).toBe(true);
          expect(statement).toContain(
            `"${eventRegistrationOptions.reservedSpots.name}" +`,
          );
          expect(parameters).toEqual([
            1,
            expect.any(String),
            'option-1',
            'event-1',
            1,
          ]);
          return [['option-1']];
        }
        if (statement.startsWith(`update "${getTableName(transactions)}"`)) {
          expect(transactionOpen).toBe(true);
          const current = requireClaim();
          expect(parameters).toEqual([
            expect.any(String),
            0,
            null,
            null,
            null,
            expect.any(String),
            'cs_test_123',
            'https://checkout.stripe.test/cs_test_123',
            ...claimTuple(),
          ]);
          expect(statement).toContain(
            `"${transactions.stripeCheckoutCancellationRequestedAt.name}" is null`,
          );
          expect(statement).toContain(
            `"${transactions.stripeCheckoutSessionId.name}" is null`,
          );
          expect(current.stripeCheckoutSessionId).toBeNull();
          expect(current.stripeCheckoutUrl).toBeNull();
          claim = {
            ...current,
            stripeCheckoutSessionId: 'cs_test_123',
            stripeCheckoutUrl: 'https://checkout.stripe.test/cs_test_123',
          };
          bindingCount += 1;
          return [[current.id]];
        }
        if (!statement.startsWith('select '))
          throw new Error(`Unexpected trusted URL fixture SQL: ${statement}`);
        if (
          statement.includes(
            ` from "${getTableName(eventRegistrationOptions)}"`,
          )
        ) {
          if (!statement.includes(' for update')) {
            expect(parameters).toEqual([1, 'event-1', 'option-1', 1]);
            if (transactionOpen) {
              expect(statement).toContain(
                'select "d0"."closeRegistrationTime"::text as "closeRegistrationTime", "d0"."id" as "id", "d0"."isPaid" as "isPaid"',
              );
              expect(statement).not.toContain('"questions"');
              return [
                [
                  '2099-01-02T00:00:00.000',
                  'option-1',
                  true,
                  '2000-01-01T00:00:00.000',
                  false,
                  1000,
                  'fcfs',
                  [],
                  'txr_123',
                  {
                    start: '2099-01-01T12:00:00.000',
                    status: 'APPROVED',
                    tenantId: 'tenant-1',
                  },
                ],
              ];
            }
            return [
              [
                '2099-01-02T00:00:00.000',
                0,
                'event-1',
                'option-1',
                true,
                '2000-01-01T00:00:00.000',
                false,
                1000,
                'fcfs',
                0,
                [],
                10,
                'txr_123',
                {
                  start: '2099-01-01T12:00:00.000',
                  status: 'APPROVED',
                  tenantId: 'tenant-1',
                  title: 'Trusted URL event',
                },
                [],
              ],
            ];
          }
          expect(transactionOpen).toBe(true);
          expect(parameters).toEqual(['option-1', 'event-1']);
          return [['txr_123']];
        }
        if (statement.includes(` from "${getTableName(eventRegistrations)}"`)) {
          if (statement.includes(' for update')) {
            expect(transactionOpen).toBe(true);
            expect(registrationId).toBeDefined();
            expect(statement).toMatch(/^select "status" from /);
            expect(parameters).toEqual([
              requireRegistrationId(),
              'event-1',
              'tenant-1',
            ]);
            return [['PENDING']];
          }
          expect(registrationId).toBeUndefined();
          expect(parameters).toEqual([
            'event-1',
            'CANCELLED',
            'tenant-1',
            'attendee-1',
            ...(transactionOpen ? [] : [1]),
          ]);
          return [];
        }
        if (statement.includes(` from "${getTableName(transactions)}"`)) {
          expect(transactionOpen).toBe(true);
          expect(statement).toContain(' for update');
          expect(statement).toContain(
            `select "${transactions.stripeCheckoutCancellationRequestedAt.name}"::text, "${transactions.stripeCheckoutSessionId.name}"`,
          );
          expect(parameters).toEqual(claimTuple());
          const current = requireClaim();
          return [[null, current.stripeCheckoutSessionId]];
        }
        if (statement.includes(` from "${getTableName(eventAddons)}"`)) {
          if (transactionOpen) {
            expect(parameters).toEqual(['event-1', 'option-1']);
            expect(statement).toContain('"event_addons"."isPaid"');
            expect(statement).not.toContain('"totalAvailableQuantity"');
            return [];
          }
          expect(parameters).toEqual([
            'tenant-1',
            'acct_123',
            true,
            true,
            'event-1',
            'option-1',
          ]);
          return [];
        }
        if (statement.includes(' from "user_discount_cards"')) {
          if (transactionOpen) {
            expect(parameters).toEqual(['tenant-1', 'attendee-1']);
            expect(statement).toContain(
              'order by "user_discount_cards"."id" for share',
            );
            expect(statement).not.toContain('"status" =');
          } else {
            expect(parameters).toEqual(['verified', 'tenant-1', 'attendee-1']);
          }
          return [];
        }
        if (statement.includes(' from "event_registration_option_discounts"')) {
          expect(transactionOpen).toBe(true);
          expect(parameters).toEqual(['option-1']);
          return [];
        }
        if (
          statement.includes(' from "tenants"') &&
          statement.includes('"discountProviders"')
        ) {
          expect(transactionOpen).toBe(true);
          expect(parameters).toEqual(['tenant-1', 1]);
          return [[{ esnCard: { config: {}, status: 'disabled' } }]];
        }
        if (
          statement.includes(` from "${getTableName(tenantStripeTaxRates)}"`)
        ) {
          if (statement.includes(' for update')) {
            expect(transactionOpen).toBe(true);
            expect(parameters).toEqual([
              'tenant-1',
              'acct_123',
              true,
              true,
              'txr_123',
            ]);
            return [['VAT', true, '19', 'txr_123']];
          }
          expect(parameters).toEqual([
            true,
            true,
            'acct_123',
            'txr_123',
            'tenant-1',
            1,
          ]);
          return [['VAT', true, '19']];
        }
        expect(transactionOpen).toBe(true);
        expect(statement).toContain(' for update');
        if (statement.includes(` from "${getTableName(usersToTenants)}"`)) {
          expect(parameters).toEqual(['tenant-1', 'attendee-1']);
          return [['membership-1']];
        }
        if (statement.includes(` from "${getTableName(tenants)}"`)) {
          expect(parameters).toEqual(['tenant-1']);
          return [['acct_123']];
        }
        throw new Error(`Unexpected trusted URL fixture SQL: ${statement}`);
      }),
    transactionControl: (command) =>
      Effect.sync(() => {
        if (command === 'BEGIN') {
          expect(transactionOpen).toBe(false);
          transactionOpen = true;
        } else {
          expect(transactionOpen).toBe(true);
          transactionOpen = false;
        }
        commands.push(command);
      }),
  });
  return {
    databaseLayer,
    expectComplete: () => {
      expect(commands).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
      expect(bindingCount).toBe(1);
      expect(transactionOpen).toBe(false);
    },
  };
};

describe('event registration trusted URLs', () => {
  it.effect(
    'ignores forged request origins when creating Stripe checkout return URLs',
    () =>
      Effect.gen(function* () {
        const createCheckoutSession = vi.fn(() =>
          Promise.resolve(
            checkoutSessionResponse({
              id: 'cs_test_123',
              url: 'https://checkout.stripe.test/cs_test_123',
            }),
          ),
        );
        const stripe = createStripeClientDouble({ createCheckoutSession });
        const fixture = createTrustedUrlDatabaseFixture();
        const attackerOptions = {
          headers: Headers.fromInput({
            host: 'attacker.example',
            origin: 'https://attacker.example',
            'x-forwarded-host': 'attacker.example',
            'x-forwarded-proto': 'https',
          }),
        };

        yield* eventRegistrationHandlers['events.registerForEvent'](
          {
            eventId: 'event-1',
            guestCount: 0,
            registrationOptionId: 'option-1',
          },
          handlerOptions('events.registerForEvent', attackerOptions.headers),
        ).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: fixture.databaseLayer,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
              user: createUser({ id: 'attendee-1' }),
            }),
          ),
          Effect.provide(registrationConfigProviderLayer),
        );

        fixture.expectComplete();
        expect(createCheckoutSession).toHaveBeenCalledOnce();
        expect(createCheckoutSession).toHaveBeenCalledWith(
          expect.objectContaining({
            cancel_url:
              'https://tenant.example.com/events/event-1?registrationStatus=cancel',
            success_url:
              'https://tenant.example.com/events/event-1?registrationStatus=success',
          }),
          expect.objectContaining({
            stripeAccount: 'acct_123',
          }),
        );
        expect(JSON.stringify(createCheckoutSession.mock.calls)).not.toContain(
          'attacker.example',
        );
      }),
  );
});

type CancellationLockedRegistration = Pick<
  CancellationRegistrationRead,
  | 'checkInTime'
  | 'eventId'
  | 'guestCount'
  | 'id'
  | 'registrationOptionId'
  | 'status'
  | 'userId'
>;

type CancellationRegistrationRead = Pick<
  typeof eventRegistrations.$inferSelect,
  | 'checkInTime'
  | 'eventId'
  | 'guestCount'
  | 'id'
  | 'registrationOptionId'
  | 'status'
  | 'userId'
> & {
  readonly addonPurchases: readonly Pick<
    typeof eventRegistrationAddonPurchases.$inferSelect,
    'addonId' | 'purchasedQuantity' | 'quantity'
  >[];
  readonly event: Pick<typeof eventInstances.$inferSelect, 'start' | 'title'>;
  readonly registrationOption: Pick<
    typeof eventRegistrationOptions.$inferSelect,
    'cancellationDeadlineHoursBeforeStart' | 'id' | 'refundFeesOnCancellation'
  > & {
    readonly eventRegistrations: readonly (Pick<
      typeof eventRegistrations.$inferSelect,
      'id' | 'status'
    > & {
      readonly user: null | Pick<
        typeof users.$inferSelect,
        'communicationEmail' | 'email'
      >;
    })[];
  };
  readonly transactions: readonly CancellationTransactionRead[];
  readonly user: null | Pick<
    typeof users.$inferSelect,
    'communicationEmail' | 'email'
  >;
};

interface CancellationSqlStatement {
  readonly parameters: readonly unknown[];
  readonly statement: string;
}

type CancellationTransactionCommand = 'BEGIN' | 'COMMIT' | 'ROLLBACK';

type CancellationTransactionRead = Pick<
  typeof transactions.$inferSelect,
  | 'amount'
  | 'appFee'
  | 'currency'
  | 'eventId'
  | 'id'
  | 'method'
  | 'status'
  | 'stripeAccountId'
  | 'stripeChargeId'
  | 'stripeCheckoutCancellationRequestedAt'
  | 'stripeCheckoutSessionId'
  | 'stripeFee'
  | 'stripeNetAmount'
  | 'stripePaymentIntentId'
  | 'targetUserId'
  | 'type'
>;

const cancellationTimestamp = (value: Date | null) =>
  value?.toISOString().replace('Z', '') ?? null;

const createCancellationRegistration = (
  overrides: Partial<CancellationRegistrationRead> = {},
): CancellationRegistrationRead => ({
  addonPurchases: [],
  checkInTime: null,
  event: {
    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
    title: 'City tour',
  },
  eventId: 'event-1',
  guestCount: 0,
  id: 'registration-1',
  registrationOption: {
    cancellationDeadlineHoursBeforeStart: null,
    eventRegistrations: [],
    id: 'option-1',
    refundFeesOnCancellation: null,
  },
  registrationOptionId: 'option-1',
  status: 'CONFIRMED',
  transactions: [],
  user: {
    communicationEmail: 'attendee.contact@example.com',
    email: 'attendee@example.com',
  },
  userId: 'scanner-1',
  ...overrides,
});

const createCancellationTransaction = (
  overrides: Partial<CancellationTransactionRead> = {},
): CancellationTransactionRead => ({
  amount: 1000,
  appFee: null,
  currency: 'EUR',
  eventId: 'event-1',
  id: 'transaction-1',
  method: 'stripe',
  status: 'pending',
  stripeAccountId: 'acct_123',
  stripeChargeId: null,
  stripeCheckoutCancellationRequestedAt: null,
  stripeCheckoutSessionId: 'checkout-1',
  stripeFee: null,
  stripeNetAmount: null,
  stripePaymentIntentId: null,
  targetUserId: 'scanner-1',
  type: 'registration',
  ...overrides,
});

const cancellationRegistrationValues = (
  registration: CancellationRegistrationRead,
) => [
  cancellationTimestamp(registration.checkInTime),
  registration.eventId,
  registration.guestCount,
  registration.id,
  registration.registrationOptionId,
  registration.status,
  registration.userId,
  registration.addonPurchases.map((purchase) => ({ ...purchase })),
  {
    start: cancellationTimestamp(registration.event.start),
    title: registration.event.title,
  },
  {
    ...registration.registrationOption,
    eventRegistrations: registration.registrationOption.eventRegistrations.map(
      (waitlisted) => ({ ...waitlisted }),
    ),
  },
  registration.transactions.map((transaction) => ({
    amount: transaction.amount,
    appFee: transaction.appFee,
    id: transaction.id,
    method: transaction.method,
    status: transaction.status,
    stripeAccountId: transaction.stripeAccountId,
    stripeChargeId: transaction.stripeChargeId,
    stripeCheckoutCancellationRequestedAt: cancellationTimestamp(
      transaction.stripeCheckoutCancellationRequestedAt,
    ),
    stripeCheckoutSessionId: transaction.stripeCheckoutSessionId,
    stripeFee: transaction.stripeFee,
    stripeNetAmount: transaction.stripeNetAmount,
    stripePaymentIntentId: transaction.stripePaymentIntentId,
    type: transaction.type,
  })),
  registration.user,
];

const cancellationTransactionValues = (
  transaction: CancellationTransactionRead,
) => [
  transaction.amount,
  transaction.appFee,
  transaction.currency,
  transaction.eventId,
  transaction.id,
  transaction.method,
  transaction.status,
  transaction.stripeAccountId,
  transaction.stripeChargeId,
  cancellationTimestamp(transaction.stripeCheckoutCancellationRequestedAt),
  transaction.stripeCheckoutSessionId,
  transaction.stripeFee,
  transaction.stripeNetAmount,
  transaction.stripePaymentIntentId,
  transaction.targetUserId,
  transaction.type,
];

type CancellationQueryScope =
  | { readonly eventId: string; readonly kind: 'organizer' }
  | { readonly kind: 'participant'; readonly userId: string }
  | { readonly kind: 'tenant' };

const expectCancellationOwnerQuery = ({
  expiredCheckout = false,
  parameters,
  registrationId,
  scope,
  statement,
}: CancellationSqlStatement & {
  readonly expiredCheckout?: boolean;
  readonly registrationId: string;
  readonly scope: CancellationQueryScope;
}) => {
  const relationParameters = [1, 1, 'WAITLIST', tenant.id, 1, 1];
  switch (scope.kind) {
    case 'organizer': {
      if (expiredCheckout)
        throw new Error(
          'Organizer Checkout replay has no fixture in this suite',
        );
      expect(
        statement.endsWith(
          ` where (("d0"."${eventRegistrations.eventId.name}" = $7) and ("d0"."${eventRegistrations.id.name}" = $8) and (not ("d0"."${eventRegistrations.status.name}" = $9)) and ("d0"."${eventRegistrations.tenantId.name}" = $10)) limit $11`,
        ),
      ).toBe(true);
      expect(parameters).toEqual([
        ...relationParameters,
        scope.eventId,
        registrationId,
        'CANCELLED',
        tenant.id,
        1,
      ]);
      return;
    }
    case 'participant': {
      if (expiredCheckout) {
        expect(
          statement.endsWith(
            ` where (("d0"."${eventRegistrations.id.name}" = $7) and ("d0"."${eventRegistrations.tenantId.name}" = $8) and ("d0"."${eventRegistrations.userId.name}" = $9)) limit $10`,
          ),
        ).toBe(true);
        expect(parameters).toEqual([
          ...relationParameters,
          registrationId,
          tenant.id,
          scope.userId,
          1,
        ]);
      } else {
        expect(
          statement.endsWith(
            ` where (("d0"."${eventRegistrations.id.name}" = $7) and (not ("d0"."${eventRegistrations.status.name}" = $8)) and ("d0"."${eventRegistrations.tenantId.name}" = $9) and ("d0"."${eventRegistrations.userId.name}" = $10)) limit $11`,
          ),
        ).toBe(true);
        expect(parameters).toEqual([
          ...relationParameters,
          registrationId,
          'CANCELLED',
          tenant.id,
          scope.userId,
          1,
        ]);
      }
      return;
    }
    case 'tenant': {
      if (expiredCheckout)
        throw new Error('Tenant Checkout replay has no fixture in this suite');
      expect(
        statement.endsWith(
          ` where (("d0"."${eventRegistrations.id.name}" = $7) and (not ("d0"."${eventRegistrations.status.name}" = $8)) and ("d0"."${eventRegistrations.tenantId.name}" = $9)) limit $10`,
        ),
      ).toBe(true);
      expect(parameters).toEqual([
        ...relationParameters,
        registrationId,
        'CANCELLED',
        tenant.id,
        1,
      ]);
    }
  }
};

const expectCancellationOwnerLock = ({
  parameters,
  registrationId,
  scope,
  statement,
}: CancellationSqlStatement & {
  readonly registrationId: string;
  readonly scope: CancellationQueryScope;
}) => {
  const table = getTableName(eventRegistrations);
  switch (scope.kind) {
    case 'organizer': {
      expect(
        statement.endsWith(
          ` where (("${table}"."${eventRegistrations.id.name}" = $1) and ("${table}"."${eventRegistrations.tenantId.name}" = $2) and ("${table}"."${eventRegistrations.eventId.name}" = $3)) for update`,
        ),
      ).toBe(true);
      expect(parameters).toEqual([registrationId, tenant.id, scope.eventId]);
      return;
    }
    case 'participant': {
      expect(
        statement.endsWith(
          ` where (("${table}"."${eventRegistrations.id.name}" = $1) and ("${table}"."${eventRegistrations.tenantId.name}" = $2) and ("${table}"."${eventRegistrations.userId.name}" = $3)) for update`,
        ),
      ).toBe(true);
      expect(parameters).toEqual([registrationId, tenant.id, scope.userId]);
      return;
    }
    case 'tenant': {
      expect(
        statement.endsWith(
          ` where (("${table}"."${eventRegistrations.id.name}" = $1) and ("${table}"."${eventRegistrations.tenantId.name}" = $2)) for update`,
        ),
      ).toBe(true);
      expect(parameters).toEqual([registrationId, tenant.id]);
    }
  }
};

const readCancellationPreflight = ({
  activeTransferId,
  expiredCheckout = false,
  organizer = false,
  parameters,
  registration,
  scope,
  statement,
}: CancellationSqlStatement & {
  readonly activeTransferId?: string;
  readonly expiredCheckout?: boolean;
  readonly organizer?: boolean;
  readonly registration: CancellationRegistrationRead;
  readonly scope: CancellationQueryScope;
}) => {
  if (!statement.startsWith('select ') || statement.includes(' for update')) {
    return;
  }
  if (statement.includes(` from "${getTableName(registrationTransfers)}"`)) {
    expect(parameters).toEqual([
      registration.id,
      'open',
      'checkout_pending',
      'refund_pending',
      'refund_failed',
      registration.id,
      'checkout_pending',
      tenant.id,
      1,
    ]);
    expect(
      statement.endsWith(
        ` where (((((("d0"."${registrationTransfers.sourceRegistrationId.name}" = $1) and ("d0"."${registrationTransfers.status.name}" in ($2, $3, $4, $5)))) or ((("d0"."${registrationTransfers.recipientRegistrationId.name}" = $6) and ("d0"."${registrationTransfers.status.name}" = $7))))) and ("d0"."${registrationTransfers.tenantId.name}" = $8)) limit $9`,
      ),
    ).toBe(true);
    return activeTransferId ? [[activeTransferId]] : [];
  }
  if (!statement.includes(` from "${getTableName(eventRegistrations)}"`)) {
    return;
  }
  if (
    statement.includes(
      `"${eventRegistrationOptions.organizingRegistration.name}"`,
    )
  ) {
    expect(parameters).toEqual([
      1,
      registration.eventId,
      'CONFIRMED',
      tenant.id,
      'scanner-1',
    ]);
    expect(
      statement.endsWith(
        ` where (("d0"."${eventRegistrations.eventId.name}" = $2) and ("d0"."${eventRegistrations.status.name}" = $3) and ("d0"."${eventRegistrations.tenantId.name}" = $4) and ("d0"."${eventRegistrations.userId.name}" = $5))`,
      ),
    ).toBe(true);
    return organizer
      ? [['organizer-registration-1', { organizingRegistration: true }]]
      : [];
  }
  if (statement.includes(`"${eventRegistrations.checkInTime.name}"`)) {
    expectCancellationOwnerQuery({
      expiredCheckout,
      parameters,
      registrationId: registration.id,
      scope,
      statement,
    });
    return [cancellationRegistrationValues(registration)];
  }
  expect(parameters).toEqual([registration.id, tenant.id, 1]);
  expect(
    statement.endsWith(
      ` where (("d0"."${eventRegistrations.id.name}" = $1) and ("d0"."${eventRegistrations.tenantId.name}" = $2)) limit $3`,
    ),
  ).toBe(true);
  return [[registration.eventId]];
};

const readCancellationLock = ({
  activeTransfer,
  lockedRegistration,
  lockedTransactions,
  parameters,
  scope,
  statement,
}: CancellationSqlStatement & {
  readonly activeTransfer?: Pick<
    typeof registrationTransfers.$inferSelect,
    'id' | 'status'
  >;
  readonly lockedRegistration: CancellationLockedRegistration;
  readonly lockedTransactions: readonly CancellationTransactionRead[];
  readonly scope: CancellationQueryScope;
}) => {
  if (!statement.startsWith('select ') || !statement.includes(' for update')) {
    return;
  }
  if (statement.includes(` from "${getTableName(eventRegistrations)}"`)) {
    expectCancellationOwnerLock({
      parameters,
      registrationId: lockedRegistration.id,
      scope,
      statement,
    });
    return [
      [
        cancellationTimestamp(lockedRegistration.checkInTime),
        lockedRegistration.eventId,
        lockedRegistration.guestCount,
        lockedRegistration.id,
        lockedRegistration.registrationOptionId,
        lockedRegistration.status,
        lockedRegistration.userId,
      ],
    ];
  }
  if (statement.includes(` from "${getTableName(registrationTransfers)}"`)) {
    expect(parameters).toEqual([
      tenant.id,
      lockedRegistration.id,
      'open',
      'checkout_pending',
    ]);
    expect(
      statement.endsWith(
        ` where (("${getTableName(registrationTransfers)}"."${registrationTransfers.tenantId.name}" = $1) and ("${getTableName(registrationTransfers)}"."${registrationTransfers.sourceRegistrationId.name}" = $2) and ("${getTableName(registrationTransfers)}"."${registrationTransfers.status.name}" in ($3, $4))) for update`,
      ),
    ).toBe(true);
    return activeTransfer ? [[activeTransfer.id, activeTransfer.status]] : [];
  }
  if (statement.includes(` from "${getTableName(transactions)}"`)) {
    expect(parameters).toEqual([
      tenant.id,
      lockedRegistration.id,
      'addon',
      'registration',
    ]);
    expect(statement).toContain('order by');
    return lockedTransactions.map((row) => cancellationTransactionValues(row));
  }
  return;
};

const createCancellationReadDatabase = ({
  activeTransferId,
  organizer,
  registration = createCancellationRegistration(),
  scope = { kind: 'participant', userId: 'scanner-1' },
}: {
  readonly activeTransferId?: string;
  readonly organizer?: boolean;
  readonly registration?: CancellationRegistrationRead;
  readonly scope?: CancellationQueryScope;
} = {}) => {
  const queries: CancellationSqlStatement[] = [];
  const transactionCommands: CancellationTransactionCommand[] = [];
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        queries.push({ parameters, statement });
        const rows = readCancellationPreflight({
          ...(activeTransferId && { activeTransferId }),
          ...(organizer !== undefined && { organizer }),
          parameters,
          registration,
          scope,
          statement,
        });
        if (rows !== undefined) return rows;
        throw new Error(`Unexpected cancellation preflight SQL: ${statement}`);
      }),
    transactionControl: (command) =>
      Effect.sync(() => {
        transactionCommands.push(command);
        throw new Error(
          'A preflight cancellation must not start a transaction',
        );
      }),
  });
  return { databaseLayer, queries, transactionCommands };
};

const createCancellationLockConflictDatabase = ({
  activeTransfer,
  lockedRegistration,
  lockedTransactions = [],
  registration,
  scope = { kind: 'participant', userId: 'scanner-1' },
}: {
  readonly activeTransfer?: Pick<
    typeof registrationTransfers.$inferSelect,
    'id' | 'status'
  >;
  readonly lockedRegistration: CancellationLockedRegistration;
  readonly lockedTransactions?: readonly CancellationTransactionRead[];
  readonly registration: CancellationRegistrationRead;
  readonly scope?: CancellationQueryScope;
}) => {
  const queries: CancellationSqlStatement[] = [];
  const transactionCommands: CancellationTransactionCommand[] = [];
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        queries.push({ parameters, statement });
        const preflightRows = readCancellationPreflight({
          parameters,
          registration,
          scope,
          statement,
        });
        if (preflightRows !== undefined) return preflightRows;
        const lockedRows = readCancellationLock({
          ...(activeTransfer && { activeTransfer }),
          lockedRegistration,
          lockedTransactions,
          parameters,
          scope,
          statement,
        });
        if (lockedRows !== undefined) return lockedRows;
        throw new Error(`Unexpected cancellation conflict SQL: ${statement}`);
      }),
    transactionControl: (command) =>
      Effect.sync(() => {
        transactionCommands.push(command);
      }),
  });
  return { databaseLayer, queries, transactionCommands };
};

const createFreeCancellationDatabase = ({
  cancellationDeadlineHoursBeforeStart = 0,
  organizer = false,
  registration = createCancellationRegistration(),
  scope = { kind: 'participant', userId: 'scanner-1' },
}: {
  readonly cancellationDeadlineHoursBeforeStart?: number;
  readonly organizer?: boolean;
  readonly registration?: CancellationRegistrationRead;
  readonly scope?: CancellationQueryScope;
} = {}) => {
  const queries: CancellationSqlStatement[] = [];
  const writes: CancellationSqlStatement[] = [];
  const insertedEmails: Pick<
    typeof emailOutbox.$inferInsert,
    'html' | 'idempotencyKey' | 'kind' | 'text' | 'toEmail'
  >[] = [];
  const transactionCommands: CancellationTransactionCommand[] = [];
  let transactionOpen = false;
  const acquisition: typeof registrationAcquisitions.$inferSelect = {
    acquiredAt: new Date('2026-07-10T12:00:00.000Z'),
    eventId: registration.eventId,
    id: `acquisition-${registration.id}`,
    kind: 'initial',
    operationKey: `initial-registration:${registration.id}`,
    ordinal: 0,
    ownerUserId: registration.userId,
    previousAcquisitionId: null,
    registrationId: registration.id,
    spotCount: registration.guestCount + 1,
    tenantId: tenant.id,
    transferId: null,
  };
  const component: typeof registrationAcquisitionComponents.$inferSelect = {
    acquiredAt: acquisition.acquiredAt,
    acquisitionId: acquisition.id,
    acquisitionPaymentId: null,
    allocationKey: 'registration',
    applicationFeeAmount: 0,
    baseAmount: 0,
    currency: 'EUR',
    eventId: registration.eventId,
    grossAmount: 0,
    id: 'acquisition-component-registration',
    kind: 'registration',
    netAmount: 0,
    purchaseId: null,
    purchaseLotId: null,
    quantity: registration.guestCount + 1,
    registrationId: registration.id,
    stripeFeeAmount: 0,
    taxAmount: 0,
    taxRateDisplayName: null,
    taxRateInclusive: null,
    taxRatePercentage: null,
    tenantId: tenant.id,
  };
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        queries.push({ parameters, statement });
        const preflightRows = readCancellationPreflight({
          organizer,
          parameters,
          registration,
          scope,
          statement,
        });
        if (preflightRows !== undefined) return preflightRows;
        expect(transactionOpen).toBe(true);
        const lockedRows = readCancellationLock({
          lockedRegistration: registration,
          lockedTransactions: [],
          parameters,
          scope,
          statement,
        });
        if (lockedRows !== undefined) return lockedRows;
        if (
          statement.startsWith('select ') &&
          statement.includes(' for update')
        ) {
          if (
            statement.includes(
              ` from "${getTableName(registrationAcquisitions)}"`,
            )
          ) {
            expect(registration.status).toBe('CONFIRMED');
            expect(parameters).toEqual([tenant.id, registration.id, 1]);
            return [
              [
                cancellationTimestamp(acquisition.acquiredAt),
                acquisition.eventId,
                acquisition.id,
                acquisition.kind,
                acquisition.operationKey,
                acquisition.ordinal,
                acquisition.ownerUserId,
                acquisition.previousAcquisitionId,
                acquisition.registrationId,
                acquisition.spotCount,
                acquisition.tenantId,
                acquisition.transferId,
              ],
            ];
          }
          if (
            statement.includes(
              ` from "${getTableName(registrationAcquisitionPayments)}"`,
            )
          ) {
            expect(parameters).toEqual([acquisition.id]);
            return [];
          }
          if (
            statement.includes(
              ` from "${getTableName(registrationAcquisitionComponents)}"`,
            )
          ) {
            expect(parameters).toEqual([acquisition.id]);
            return [
              [
                cancellationTimestamp(component.acquiredAt),
                component.acquisitionId,
                component.acquisitionPaymentId,
                component.allocationKey,
                component.applicationFeeAmount,
                component.baseAmount,
                component.currency,
                component.eventId,
                component.grossAmount,
                component.id,
                component.kind,
                component.netAmount,
                component.purchaseId,
                component.purchaseLotId,
                component.quantity,
                component.registrationId,
                component.stripeFeeAmount,
                component.taxAmount,
                component.taxRateDisplayName,
                component.taxRateInclusive,
                component.taxRatePercentage,
                component.tenantId,
              ],
            ];
          }
          if (
            statement.includes(
              ` from "${getTableName(eventRegistrationAddonPurchases)}"`,
            )
          ) {
            expect(parameters).toEqual(
              statement.includes(
                `"${eventRegistrationAddonPurchases.eventId.name}" =`,
              )
                ? [registration.id, registration.eventId, tenant.id]
                : [registration.id, tenant.id],
            );
            return [];
          }
          if (statement.includes(` from "${getTableName(tenants)}"`)) {
            expect(parameters).toEqual([tenant.id]);
            return [[cancellationDeadlineHoursBeforeStart, true]];
          }
          if (
            statement.includes(
              ` from "${getTableName(eventRegistrationOptions)}"`,
            )
          ) {
            expect(parameters).toEqual([
              registration.registrationOptionId,
              registration.eventId,
            ]);
            return [
              [
                registration.registrationOption
                  .cancellationDeadlineHoursBeforeStart,
                registration.registrationOption.refundFeesOnCancellation,
              ],
            ];
          }
        }
        if (
          statement.startsWith(`update "${getTableName(eventRegistrations)}"`)
        ) {
          expect(parameters).toEqual([
            expect.any(String),
            'CANCELLED',
            registration.id,
            tenant.id,
            registration.status,
            registration.userId,
          ]);
          expect(statement).toContain('returning "id"');
          writes.push({ parameters, statement });
          return [[registration.id]];
        }
        if (
          statement.startsWith(
            `update "${getTableName(eventRegistrationOptions)}"`,
          )
        ) {
          const spots = registration.guestCount + 1;
          if (registration.status === 'CONFIRMED') {
            expect(statement).toContain(
              `"${eventRegistrationOptions.confirmedSpots.name}" - $1`,
            );
            expect(parameters).toEqual([
              spots,
              expect.any(String),
              registration.registrationOptionId,
              spots,
            ]);
          } else if (registration.status === 'WAITLIST') {
            expect(statement).toContain(
              `"${eventRegistrationOptions.waitlistSpots.name}" - $2`,
            );
            expect(parameters).toEqual([
              expect.any(String),
              spots,
              registration.registrationOptionId,
              spots,
            ]);
          } else {
            throw new Error(
              'An unpaid manual application cannot release reserved spots',
            );
          }
          expect(statement).toContain(' >= ');
          expect(statement).toContain('returning "id"');
          writes.push({ parameters, statement });
          return [[registration.registrationOptionId]];
        }
        if (
          statement.startsWith(`insert into "${getTableName(emailOutbox)}"`)
        ) {
          const [
            id,
            tenantId,
            fromEmail,
            fromName,
            html,
            idempotencyKey,
            kind,
            replyToEmail,
            replyToName,
            subject,
            text,
            toEmail,
          ] = parameters;
          if (
            parameters.length !== 12 ||
            typeof id !== 'string' ||
            tenantId !== tenant.id ||
            fromEmail !== 'no-reply@notifications.evorto.app' ||
            fromName !== 'Evorto' ||
            typeof html !== 'string' ||
            typeof idempotencyKey !== 'string' ||
            (kind !== 'registrationCancelled' &&
              kind !== 'waitlistSpotAvailable') ||
            replyToEmail !== tenant.emailSenderEmail ||
            replyToName !== tenant.emailSenderName ||
            typeof subject !== 'string' ||
            typeof text !== 'string' ||
            typeof toEmail !== 'string'
          )
            throw new Error('Unexpected cancellation email SQL parameters');
          expect(statement).toContain(
            `on conflict ("${emailOutbox.idempotencyKey.name}") do nothing`,
          );
          insertedEmails.push({ html, idempotencyKey, kind, text, toEmail });
          writes.push({ parameters, statement });
          return [];
        }
        throw new Error(`Unexpected free cancellation SQL: ${statement}`);
      }),
    transactionControl: (command) =>
      Effect.sync(() => {
        transactionCommands.push(command);
        transactionOpen = command === 'BEGIN';
      }),
  });
  return {
    databaseLayer,
    insertedEmails,
    queries,
    transactionCommands,
    writes,
  };
};

const createPendingCancellationDatabase = ({
  cancelledBeforeFinalizationLock = false,
  guestCount = 0,
  pendingTransaction = createCancellationTransaction(),
}: {
  readonly cancelledBeforeFinalizationLock?: boolean;
  readonly guestCount?: number;
  readonly pendingTransaction?: CancellationTransactionRead;
} = {}) => {
  const registration = createCancellationRegistration({
    guestCount,
    status: 'PENDING',
    transactions: [pendingTransaction],
  });
  const scope: CancellationQueryScope = {
    kind: 'participant',
    userId: 'scanner-1',
  };
  const lifecycle: string[] = [];
  const transactionCommands: CancellationTransactionCommand[] = [];
  const writes: (CancellationSqlStatement & {
    readonly transaction: number;
  })[] = [];
  let transactionNumber = 0;
  let transactionOpen = false;
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        const preflightRows = readCancellationPreflight({
          expiredCheckout: transactionNumber > 0,
          parameters,
          registration,
          scope,
          statement,
        });
        if (preflightRows !== undefined) return preflightRows;
        expect(transactionOpen).toBe(true);
        const alreadyCancelled =
          cancelledBeforeFinalizationLock && transactionNumber === 2;
        const lockedRegistration: CancellationLockedRegistration = {
          ...registration,
          status: alreadyCancelled ? 'CANCELLED' : 'PENDING',
        };
        const lockedTransaction: CancellationTransactionRead = {
          ...pendingTransaction,
          status: alreadyCancelled ? 'cancelled' : pendingTransaction.status,
        };
        const lockedRows = readCancellationLock({
          lockedRegistration,
          lockedTransactions: [lockedTransaction],
          parameters,
          scope,
          statement,
        });
        if (lockedRows !== undefined) return lockedRows;
        if (statement.startsWith(`update "${getTableName(transactions)}"`)) {
          if (
            statement.includes(
              `"${transactions.stripeCheckoutCancellationRequestedAt.name}" =`,
            )
          ) {
            const requestedAt = parameters[1];
            if (
              typeof requestedAt !== 'string' ||
              !Number.isFinite(Date.parse(requestedAt))
            ) {
              throw new TypeError(
                'Cancellation request timestamp must be a PostgreSQL timestamp parameter',
              );
            }
            expect(transactionNumber).toBe(1);
            expect(parameters).toEqual([
              expect.any(String),
              requestedAt,
              pendingTransaction.id,
              tenant.id,
              registration.id,
              'stripe',
              'pending',
              pendingTransaction.stripeCheckoutSessionId,
              'registration',
            ]);
            expect(statement).toContain(
              `"${transactions.stripeCheckoutCancellationRequestedAt.name}" is null`,
            );
            pendingTransaction.stripeCheckoutCancellationRequestedAt = new Date(
              requestedAt,
            );
            lifecycle.push('mark-cancellation');
          } else if (statement.includes('"status" =')) {
            expect(transactionNumber).toBe(2);
            expect(parameters).toEqual([
              expect.any(String),
              'cancelled',
              pendingTransaction.id,
              registration.id,
              'stripe',
              pendingTransaction.stripeAccountId,
              pendingTransaction.stripeCheckoutSessionId,
              tenant.id,
              'pending',
              'registration',
            ]);
            expect(statement).toContain(
              `"${transactions.stripeCheckoutCancellationRequestedAt.name}" is not null`,
            );
            lifecycle.push('cancel-payment');
          } else {
            throw new Error(
              `Unexpected pending cancellation payment update: ${statement}`,
            );
          }
          expect(statement).toContain('returning "id"');
          writes.push({
            parameters,
            statement,
            transaction: transactionNumber,
          });
          return [[pendingTransaction.id]];
        }
        if (
          statement.startsWith('select ') &&
          statement.includes(' for update')
        ) {
          if (
            statement.includes(
              ` from "${getTableName(eventRegistrationAddonPurchases)}"`,
            )
          ) {
            expect(parameters).toEqual(
              statement.includes(
                `"${eventRegistrationAddonPurchases.eventId.name}" =`,
              )
                ? [registration.id, registration.eventId, tenant.id]
                : [registration.id, tenant.id],
            );
            return [];
          }
          if (statement.includes(` from "${getTableName(tenants)}"`)) {
            expect(parameters).toEqual([tenant.id]);
            return [[0, true]];
          }
          if (
            statement.includes(
              ` from "${getTableName(eventRegistrationOptions)}"`,
            )
          ) {
            expect(parameters).toEqual([
              registration.registrationOptionId,
              registration.eventId,
            ]);
            return [[null, null]];
          }
        }
        if (
          statement.startsWith(`update "${getTableName(eventRegistrations)}"`)
        ) {
          expect(transactionNumber).toBe(2);
          expect(parameters).toEqual([
            expect.any(String),
            'CANCELLED',
            registration.id,
            tenant.id,
            'PENDING',
            registration.userId,
          ]);
          expect(statement).toContain('returning "id"');
          writes.push({
            parameters,
            statement,
            transaction: transactionNumber,
          });
          lifecycle.push('cancel-registration');
          return [[registration.id]];
        }
        if (
          statement.startsWith(
            `update "${getTableName(eventRegistrationOptions)}"`,
          )
        ) {
          expect(transactionNumber).toBe(2);
          const spots = guestCount + 1;
          expect(statement).toContain(
            `"${eventRegistrationOptions.reservedSpots.name}" - $1`,
          );
          expect(statement).toContain(' >= ');
          expect(statement).toContain('returning "id"');
          expect(parameters).toEqual([
            spots,
            expect.any(String),
            registration.registrationOptionId,
            spots,
          ]);
          writes.push({
            parameters,
            statement,
            transaction: transactionNumber,
          });
          lifecycle.push('release-reservation');
          return [[registration.registrationOptionId]];
        }
        if (
          statement.startsWith(`insert into "${getTableName(emailOutbox)}"`)
        ) {
          expect(transactionNumber).toBe(2);
          expect(statement).toContain(
            `on conflict ("${emailOutbox.idempotencyKey.name}") do nothing`,
          );
          expect(parameters).toEqual([
            expect.any(String),
            tenant.id,
            'no-reply@notifications.evorto.app',
            'Evorto',
            expect.any(String),
            `registration-cancelled/${tenant.id}/${registration.id}`,
            'registrationCancelled',
            tenant.emailSenderEmail,
            tenant.emailSenderName,
            expect.any(String),
            expect.any(String),
            'attendee.contact@example.com',
          ]);
          writes.push({
            parameters,
            statement,
            transaction: transactionNumber,
          });
          lifecycle.push('queue-cancellation-email');
          return [];
        }
        throw new Error(`Unexpected pending cancellation SQL: ${statement}`);
      }),
    transactionControl: (command) =>
      Effect.sync(() => {
        transactionCommands.push(command);
        lifecycle.push(command);
        transactionOpen = command === 'BEGIN';
        if (command === 'BEGIN') transactionNumber++;
      }),
  });
  return {
    databaseLayer,
    lifecycle,
    pendingTransaction,
    transactionCommands,
    writes,
  };
};

const createPaidCancellationDatabase = ({
  mode = 'registration',
  refundFeesOnCancellation = true,
  settlement = mode === 'addon'
    ? { appFee: 100, stripeFee: 50, stripeNetAmount: 850 }
    : { appFee: 250, stripeFee: 75, stripeNetAmount: 2175 },
}: {
  readonly mode?: 'addon' | 'invalidCash' | 'registration';
  readonly refundFeesOnCancellation?: boolean;
  readonly settlement?: Pick<
    typeof transactions.$inferSelect,
    'appFee' | 'stripeFee' | 'stripeNetAmount'
  >;
} = {}) => {
  if (
    settlement.appFee === null ||
    settlement.stripeFee === null ||
    settlement.stripeNetAmount === null
  ) {
    throw new Error(
      'A paid cancellation fixture requires finalized settlement amounts',
    );
  }
  const addon = mode === 'addon';
  const scope: CancellationQueryScope =
    mode === 'invalidCash'
      ? { kind: 'participant', userId: 'scanner-1' }
      : { kind: 'tenant' };
  const sourceTransaction = createCancellationTransaction({
    amount: addon ? 1000 : 2500,
    appFee: settlement.appFee,
    id: addon ? 'addon-transaction-1' : 'transaction-1',
    method: mode === 'invalidCash' ? 'cash' : 'stripe',
    status: 'successful',
    stripeAccountId: 'acct_persisted',
    stripeChargeId: addon ? 'ch_addon' : 'ch_123',
    stripeCheckoutSessionId: addon ? 'checkout-addon-1' : 'checkout-1',
    stripeFee: settlement.stripeFee,
    stripeNetAmount: settlement.stripeNetAmount,
    stripePaymentIntentId: addon ? 'pi_addon' : 'pi_123',
    targetUserId: mode === 'invalidCash' ? 'scanner-1' : 'attendee-1',
    type: addon ? 'addon' : 'registration',
  });
  const registration = createCancellationRegistration({
    addonPurchases: addon
      ? [{ addonId: 'addon-1', purchasedQuantity: 4, quantity: 4 }]
      : [],
    guestCount: addon ? 0 : 1,
    transactions: [sourceTransaction],
    userId: mode === 'invalidCash' ? 'scanner-1' : 'attendee-1',
  });
  const acquiredAt = new Date('2026-07-10T12:00:00.000Z');
  const acquisition: typeof registrationAcquisitions.$inferSelect = {
    acquiredAt,
    eventId: registration.eventId,
    id: `acquisition-${registration.id}`,
    kind: 'initial',
    operationKey: `initial-registration:${registration.id}`,
    ordinal: 0,
    ownerUserId: registration.userId,
    previousAcquisitionId: null,
    registrationId: registration.id,
    spotCount: registration.guestCount + 1,
    tenantId: tenant.id,
    transferId: null,
  };
  const payment: typeof registrationAcquisitionPayments.$inferSelect = {
    acquisitionId: acquisition.id,
    attachedAt: acquiredAt,
    eventId: registration.eventId,
    id: 'acquisition-payment-1',
    registrationId: registration.id,
    tenantId: tenant.id,
    transactionId: sourceTransaction.id,
  };
  const registrationComponent: typeof registrationAcquisitionComponents.$inferSelect =
    {
      acquiredAt,
      acquisitionId: acquisition.id,
      acquisitionPaymentId: addon ? null : payment.id,
      allocationKey: 'registration',
      applicationFeeAmount: addon ? 0 : settlement.appFee,
      baseAmount: addon ? 0 : sourceTransaction.amount,
      currency: 'EUR',
      eventId: registration.eventId,
      grossAmount: addon ? 0 : sourceTransaction.amount,
      id: 'acquisition-component-registration',
      kind: 'registration',
      netAmount: addon ? 0 : settlement.stripeNetAmount,
      purchaseId: null,
      purchaseLotId: null,
      quantity: registration.guestCount + 1,
      registrationId: registration.id,
      stripeFeeAmount: addon ? 0 : settlement.stripeFee,
      taxAmount: 0,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
      tenantId: tenant.id,
    };
  const purchase: typeof eventRegistrationAddonPurchases.$inferSelect = {
    addonId: 'addon-1',
    cancelledQuantity: 0,
    createdAt: acquiredAt,
    eventId: registration.eventId,
    id: 'purchase-1',
    includedQuantity: 0,
    purchasedQuantity: 4,
    quantity: 4,
    redeemedQuantity: 1,
    refundAllocatedPurchasedQuantity: 0,
    registrationId: registration.id,
    registrationOptionId: registration.registrationOptionId,
    taxRateDisplayName: null,
    taxRateInclusive: null,
    taxRatePercentage: null,
    tenantId: tenant.id,
    unitPrice: 250,
    updatedAt: acquiredAt,
  };
  const lot: typeof eventRegistrationAddonPurchaseLots.$inferSelect = {
    applicationFeeAmount: settlement.appFee,
    baseAmount: 1000,
    cancelledQuantity: 0,
    createdAt: acquiredAt,
    currency: 'EUR',
    eventId: registration.eventId,
    grossAmount: 1000,
    id: 'lot-1',
    netAmount: settlement.stripeNetAmount,
    paymentAllocationFinalizedAt: acquiredAt,
    purchaseId: purchase.id,
    quantity: 4,
    redeemedQuantity: 1,
    refundAllocatedApplicationFeeAmount: 0,
    refundAllocatedGrossAmount: 0,
    refundAllocatedNetAmount: 0,
    refundAllocatedQuantity: 0,
    registrationId: registration.id,
    registrationOptionId: registration.registrationOptionId,
    sourceLineKey: 'addon:purchase-1',
    sourceTransactionId: sourceTransaction.id,
    stripeFeeAmount: settlement.stripeFee,
    taxAmount: 0,
    taxRateDisplayName: null,
    taxRateInclusive: null,
    taxRatePercentage: null,
    tenantId: tenant.id,
    unitPrice: 250,
    updatedAt: acquiredAt,
  };
  const addonComponent: typeof registrationAcquisitionComponents.$inferSelect =
    {
      ...registrationComponent,
      acquisitionPaymentId: payment.id,
      allocationKey: `addon-lot:${lot.id}`,
      applicationFeeAmount: settlement.appFee,
      baseAmount: 1000,
      grossAmount: 1000,
      id: 'acquisition-component-addon-1',
      kind: 'addon_lot',
      netAmount: settlement.stripeNetAmount,
      purchaseId: purchase.id,
      purchaseLotId: lot.id,
      quantity: 4,
      stripeFeeAmount: settlement.stripeFee,
    };
  const components = addon
    ? [registrationComponent, addonComponent]
    : [registrationComponent];
  const refundClaims: CancellationSqlStatement[] = [];
  const refundAllocations: CancellationSqlStatement[] = [];
  const writes: CancellationSqlStatement[] = [];
  const transactionCommands: CancellationTransactionCommand[] = [];
  let transactionNumber = 0;
  let transactionOpen = false;
  let fulfillmentEventId: string | undefined;
  let refundClaimId: string | undefined;
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        const preflightRows = readCancellationPreflight({
          parameters,
          registration,
          scope,
          statement,
        });
        if (preflightRows !== undefined) return preflightRows;
        expect(transactionOpen).toBe(true);
        if (
          statement.startsWith('select ') &&
          statement.includes(` from "${getTableName(transactions)}"`)
        ) {
          if (
            statement.includes(`"${transactions.eventRegistrationId.name}",`)
          ) {
            expect(statement).toContain(' for update');
            expect(parameters).toEqual([sourceTransaction.id, tenant.id]);
            return [
              [
                sourceTransaction.amount,
                sourceTransaction.currency,
                registration.eventId,
                registration.id,
                sourceTransaction.method,
                sourceTransaction.status,
                sourceTransaction.stripeAccountId,
                registration.userId,
                tenant.id,
                sourceTransaction.type,
              ],
            ];
          }
          if (!statement.includes(' for update')) {
            expect(parameters).toEqual(
              statement.includes('limit ')
                ? [
                    sourceTransaction.id,
                    `registration-cancellation:${registration.id}:${sourceTransaction.id}`,
                    tenant.id,
                    'refund',
                    1,
                  ]
                : [sourceTransaction.id, tenant.id, 'refund', 'cancelled'],
            );
            expect(statement).toContain(
              `"${transactions.stripeRefundApplicationFee.name}"`,
            );
            return [];
          }
        }
        const lockedRows = readCancellationLock({
          lockedRegistration: registration,
          lockedTransactions: [sourceTransaction],
          parameters,
          scope,
          statement,
        });
        if (lockedRows !== undefined) return lockedRows;
        if (
          statement.startsWith('select ') &&
          statement.includes(' for update')
        ) {
          if (
            statement.includes(
              ` from "${getTableName(registrationAcquisitions)}"`,
            )
          ) {
            expect(parameters).toEqual([tenant.id, registration.id, 1]);
            return [
              [
                cancellationTimestamp(acquisition.acquiredAt),
                acquisition.eventId,
                acquisition.id,
                acquisition.kind,
                acquisition.operationKey,
                acquisition.ordinal,
                acquisition.ownerUserId,
                acquisition.previousAcquisitionId,
                acquisition.registrationId,
                acquisition.spotCount,
                acquisition.tenantId,
                acquisition.transferId,
              ],
            ];
          }
          if (
            statement.includes(
              ` from "${getTableName(registrationAcquisitionPayments)}"`,
            )
          ) {
            expect(parameters).toEqual([acquisition.id]);
            return [
              [
                payment.acquisitionId,
                cancellationTimestamp(payment.attachedAt),
                payment.eventId,
                payment.id,
                payment.registrationId,
                payment.tenantId,
                payment.transactionId,
              ],
            ];
          }
          if (
            statement.includes(
              ` from "${getTableName(registrationAcquisitionComponents)}"`,
            )
          ) {
            expect(parameters).toEqual([acquisition.id]);
            return components.map((component) => [
              cancellationTimestamp(component.acquiredAt),
              component.acquisitionId,
              component.acquisitionPaymentId,
              component.allocationKey,
              component.applicationFeeAmount,
              component.baseAmount,
              component.currency,
              component.eventId,
              component.grossAmount,
              component.id,
              component.kind,
              component.netAmount,
              component.purchaseId,
              component.purchaseLotId,
              component.quantity,
              component.registrationId,
              component.stripeFeeAmount,
              component.taxAmount,
              component.taxRateDisplayName,
              component.taxRateInclusive,
              component.taxRatePercentage,
              component.tenantId,
            ]);
          }
          if (
            statement.includes(
              ` from "${getTableName(eventRegistrationAddonPurchases)}"`,
            )
          ) {
            if (
              statement.startsWith(
                `select "${eventRegistrationAddonPurchases.id.name}" from `,
              )
            ) {
              expect(parameters).toEqual([registration.id, tenant.id]);
              return addon ? [[purchase.id]] : [];
            }
            expect(parameters).toEqual([
              registration.id,
              registration.eventId,
              tenant.id,
            ]);
            return addon
              ? [
                  [
                    purchase.addonId,
                    purchase.cancelledQuantity,
                    cancellationTimestamp(purchase.createdAt),
                    purchase.eventId,
                    purchase.id,
                    purchase.includedQuantity,
                    purchase.purchasedQuantity,
                    purchase.quantity,
                    purchase.redeemedQuantity,
                    purchase.refundAllocatedPurchasedQuantity,
                    purchase.registrationId,
                    purchase.registrationOptionId,
                    purchase.taxRateDisplayName,
                    purchase.taxRateInclusive,
                    purchase.taxRatePercentage,
                    purchase.tenantId,
                    purchase.unitPrice,
                    cancellationTimestamp(purchase.updatedAt),
                  ],
                ]
              : [];
          }
          if (
            statement.includes(
              ` from "${getTableName(eventRegistrationAddonPurchaseLots)}"`,
            )
          ) {
            expect(addon).toBe(true);
            expect(parameters).toEqual([purchase.id, tenant.id]);
            return [
              [
                lot.applicationFeeAmount,
                lot.baseAmount,
                lot.cancelledQuantity,
                cancellationTimestamp(lot.createdAt),
                lot.currency,
                lot.eventId,
                lot.grossAmount,
                lot.id,
                lot.netAmount,
                cancellationTimestamp(lot.paymentAllocationFinalizedAt),
                lot.purchaseId,
                lot.quantity,
                lot.redeemedQuantity,
                lot.refundAllocatedApplicationFeeAmount,
                lot.refundAllocatedGrossAmount,
                lot.refundAllocatedNetAmount,
                lot.refundAllocatedQuantity,
                lot.registrationId,
                lot.registrationOptionId,
                lot.sourceLineKey,
                lot.sourceTransactionId,
                lot.stripeFeeAmount,
                lot.taxAmount,
                lot.taxRateDisplayName,
                lot.taxRateInclusive,
                lot.taxRatePercentage,
                lot.tenantId,
                lot.unitPrice,
                cancellationTimestamp(lot.updatedAt),
              ],
            ];
          }
          if (statement.includes(` from "${getTableName(tenants)}"`)) {
            expect(parameters).toEqual([tenant.id]);
            return [[0, refundFeesOnCancellation]];
          }
          if (
            statement.includes(
              ` from "${getTableName(eventRegistrationOptions)}"`,
            )
          ) {
            expect(parameters).toEqual([
              registration.registrationOptionId,
              registration.eventId,
            ]);
            return [[0, refundFeesOnCancellation]];
          }
          if (
            statement.includes(
              ` from "${getTableName(registrationAcquisitionRefundAllocations)}"`,
            )
          ) {
            expect(parameters).toEqual([acquisition.id, tenant.id]);
            return [];
          }
        }
        expect(mode).not.toBe('invalidCash');
        if (
          statement.startsWith(
            `insert into "${getTableName(eventRegistrationAddonFulfillmentEvents)}"`,
          )
        ) {
          const id = parameters[3];
          if (typeof id !== 'string')
            throw new Error('Missing cancellation fulfillment event ID');
          expect(parameters).toEqual([
            'user',
            'organizer-1',
            registration.eventId,
            id,
            `registration-cancel:${registration.id}:${purchase.id}`,
            purchase.id,
            3,
            'Registration cancelled by organizer',
            'no_monetary_refund_required',
            true,
            registration.id,
            tenant.id,
            'cancelled',
          ]);
          fulfillmentEventId = id;
          writes.push({ parameters, statement });
          return [];
        }
        if (
          statement.startsWith(
            `insert into "${getTableName(eventRegistrationAddonFulfillmentAllocations)}"`,
          )
        ) {
          expect(parameters).toEqual([
            fulfillmentEventId,
            purchase.id,
            lot.id,
            3,
            'purchased',
            tenant.id,
          ]);
          writes.push({ parameters, statement });
          return [];
        }
        if (
          statement.startsWith(
            `update "${getTableName(eventRegistrationAddonPurchaseLots)}"`,
          )
        ) {
          expect(statement).toContain(
            `"${eventRegistrationAddonPurchaseLots.cancelledQuantity.name}" + $1`,
          );
          expect(parameters).toEqual([3, expect.any(String), lot.id]);
          writes.push({ parameters, statement });
          return [];
        }
        if (
          statement.startsWith(
            `update "${getTableName(eventRegistrationAddonPurchases)}"`,
          )
        ) {
          expect(statement).toContain(
            `"${eventRegistrationAddonPurchases.cancelledQuantity.name}" + $1`,
          );
          expect(statement).toContain(' <= ');
          expect(parameters).toEqual([3, expect.any(String), purchase.id, 3]);
          writes.push({ parameters, statement });
          return [[purchase.id]];
        }
        if (statement.startsWith(`update "${getTableName(eventAddons)}"`)) {
          expect(statement).toContain(
            `"${eventAddons.totalAvailableQuantity.name}" + $1`,
          );
          expect(parameters).toEqual([
            3,
            expect.any(String),
            purchase.addonId,
            registration.eventId,
          ]);
          writes.push({ parameters, statement });
          return [[purchase.addonId]];
        }
        if (
          statement.startsWith(`update "${getTableName(eventRegistrations)}"`)
        ) {
          expect(parameters).toEqual([
            expect.any(String),
            'CANCELLED',
            registration.id,
            tenant.id,
            'CONFIRMED',
            registration.userId,
          ]);
          writes.push({ parameters, statement });
          return [[registration.id]];
        }
        if (
          statement.startsWith(
            `update "${getTableName(eventRegistrationOptions)}"`,
          )
        ) {
          const spots = registration.guestCount + 1;
          expect(statement).toContain(
            `"${eventRegistrationOptions.confirmedSpots.name}" - $1`,
          );
          expect(parameters).toEqual([
            spots,
            expect.any(String),
            registration.registrationOptionId,
            spots,
          ]);
          writes.push({ parameters, statement });
          return [[registration.registrationOptionId]];
        }
        if (
          statement.startsWith(`insert into "${getTableName(transactions)}"`)
        ) {
          const id = parameters[0];
          if (typeof id !== 'string')
            throw new Error('Missing durable refund claim ID');
          expect(parameters).toHaveLength(18);
          expect(statement).toContain('on conflict do nothing');
          expect(statement).toContain('returning "id"');
          refundClaimId = id;
          refundClaims.push({ parameters, statement });
          writes.push({ parameters, statement });
          return [[id]];
        }
        if (
          statement.startsWith(
            `insert into "${getTableName(registrationAcquisitionRefundAllocations)}"`,
          )
        ) {
          expect(parameters).toHaveLength(19);
          refundAllocations.push({ parameters, statement });
          writes.push({ parameters, statement });
          return [];
        }
        if (
          statement.startsWith(
            `update "${getTableName(eventRegistrationAddonFulfillmentEvents)}"`,
          )
        ) {
          expect(parameters).toEqual([
            refundClaimId ? 'claims_created' : 'no_monetary_refund_required',
            fulfillmentEventId,
          ]);
          writes.push({ parameters, statement });
          return [];
        }
        if (
          statement.startsWith(`insert into "${getTableName(emailOutbox)}"`)
        ) {
          expect(parameters).toEqual([
            expect.any(String),
            tenant.id,
            'no-reply@notifications.evorto.app',
            'Evorto',
            expect.any(String),
            `registration-cancelled/${tenant.id}/${registration.id}`,
            'registrationCancelled',
            tenant.emailSenderEmail,
            tenant.emailSenderName,
            expect.any(String),
            expect.any(String),
            'attendee.contact@example.com',
          ]);
          expect(statement).toContain(
            `on conflict ("${emailOutbox.idempotencyKey.name}") do nothing`,
          );
          writes.push({ parameters, statement });
          return [];
        }
        if (statement.startsWith(`update "${getTableName(transactions)}"`)) {
          expect(transactionNumber).toBe(2);
          expect(statement).toContain(
            `"${transactions.stripeRefundClaimLeaseId.name}" =`,
          );
          expect(parameters).toContain(refundClaimId);
          // This newly queued claim is not acquired by the immediate processing attempt.
          // The worker's Stripe dispatch behavior has its own payment-domain coverage.
          return [];
        }
        throw new Error(`Unexpected paid cancellation SQL: ${statement}`);
      }),
    transactionControl: (command) =>
      Effect.sync(() => {
        transactionCommands.push(command);
        transactionOpen = command === 'BEGIN';
        if (command === 'BEGIN') transactionNumber++;
      }),
  });
  return {
    databaseLayer,
    refundAllocations,
    refundClaims,
    transactionCommands,
    writes,
  };
};

describe('event registration cancellation handlers', () => {
  it('resolves registration option cancellation policy over tenant defaults', () => {
    expect(resolveCancellationDeadlineHoursBeforeStart(null, 120)).toBe(120);
    expect(resolveCancellationDeadlineHoursBeforeStart(0, 120)).toBe(0);
    expect(resolveRefundFeesOnCancellation(null, true)).toBe(true);
    expect(resolveRefundFeesOnCancellation(false, true)).toBe(false);
  });

  it('derives owner cancellation availability from the effective deadline', () => {
    const eventStart = new Date('2026-09-19T09:00:00.000Z');
    const beforeDeadline = new Date('2026-09-18T08:59:59.999Z');
    const atDeadline = new Date('2026-09-18T09:00:00.000Z');

    expect(
      registrationCancellationAvailability({
        checkInTime: null,
        deadlineHoursBeforeStart: resolveCancellationDeadlineHoursBeforeStart(
          null,
          24,
        ),
        eventStart,
        now: beforeDeadline,
      }),
    ).toEqual({
      cancellationAvailable: true,
      cancellationBlockedReason: 'none',
    });
    expect(
      registrationCancellationAvailability({
        checkInTime: null,
        deadlineHoursBeforeStart: resolveCancellationDeadlineHoursBeforeStart(
          null,
          24,
        ),
        eventStart,
        now: atDeadline,
      }),
    ).toEqual({
      cancellationAvailable: false,
      cancellationBlockedReason: 'deadlinePassed',
    });
    expect(
      registrationCancellationAvailability({
        checkInTime: null,
        deadlineHoursBeforeStart: resolveCancellationDeadlineHoursBeforeStart(
          0,
          24,
        ),
        eventStart,
        now: atDeadline,
      }),
    ).toEqual({
      cancellationAvailable: true,
      cancellationBlockedReason: 'none',
    });
  });

  it('reports check-in and event start before the deadline fallback', () => {
    const eventStart = new Date('2026-09-19T09:00:00.000Z');

    expect(
      registrationCancellationAvailability({
        checkInTime: new Date('2026-09-18T08:00:00.000Z'),
        deadlineHoursBeforeStart: 48,
        eventStart,
        now: new Date('2026-09-18T09:00:00.000Z'),
      }),
    ).toEqual({
      cancellationAvailable: false,
      cancellationBlockedReason: 'checkedIn',
    });
    expect(
      registrationCancellationAvailability({
        checkInTime: null,
        deadlineHoursBeforeStart: 0,
        eventStart,
        now: eventStart,
      }),
    ).toEqual({
      cancellationAvailable: false,
      cancellationBlockedReason: 'eventStarted',
    });
  });

  it('enforces the cancellation boundary and derives exact Stripe refund terms', () => {
    const eventStart = new Date('2026-07-10T14:00:00.000Z');
    expect(
      hasReachedRegistrationCancellationDeadline({
        deadlineHoursBeforeStart: 2,
        eventStart,
        now: new Date('2026-07-10T11:59:59.999Z'),
      }),
    ).toBe(false);
    expect(
      hasReachedRegistrationCancellationDeadline({
        deadlineHoursBeforeStart: 2,
        eventStart,
        now: new Date('2026-07-10T12:00:00.000Z'),
      }),
    ).toBe(true);
    expect(
      registrationCancellationStripeRefundTerms({
        grossAmount: 2500,
        refundFeesOnCancellation: true,
        stripeNetAmount: 2175,
      }),
    ).toEqual({ amount: 2500, applicationFeeRefunded: true });
    expect(
      registrationCancellationStripeRefundTerms({
        grossAmount: 2500,
        refundFeesOnCancellation: false,
        stripeNetAmount: 2175,
      }),
    ).toEqual({ amount: 2175, applicationFeeRefunded: false });
    expect(
      registrationCancellationStripeRefundTerms({
        grossAmount: 2500,
        refundFeesOnCancellation: false,
        stripeNetAmount: null,
      }),
    ).toBeUndefined();
    expect(
      registrationCancellationStripeRefundTerms({
        grossAmount: 1000,
        refundFeesOnCancellation: false,
        stripeNetAmount: 0,
      }),
    ).toEqual({ amount: 0, applicationFeeRefunded: false });
    for (const stripeNetAmount of [-1, NaN, 0.5]) {
      expect(
        registrationCancellationStripeRefundTerms({
          grossAmount: 1000,
          refundFeesOnCancellation: false,
          stripeNetAmount,
        }),
      ).toBeUndefined();
    }
  });

  it.effect(
    'rejects an already-stale confirmation before reconciliation or cancellation side effects',
    () =>
      Effect.gen(function* () {
        const retrieveCharge = vi.fn();
        const retrievePaymentIntent = vi.fn();
        const stripe = createStripeClientDouble();
        vi.spyOn(stripe.charges, 'retrieve').mockImplementation(retrieveCharge);
        vi.spyOn(stripe.paymentIntents, 'retrieve').mockImplementation(
          retrievePaymentIntent,
        );
        const { databaseLayer, queries, transactionCommands } =
          createCancellationReadDatabase({
            registration: createCancellationRegistration({
              addonPurchases: [
                { addonId: 'addon-1', purchasedQuantity: 1, quantity: 1 },
              ],
              transactions: [
                createCancellationTransaction({
                  amount: 2500,
                  status: 'successful',
                  stripePaymentIntentId: 'pi_123',
                }),
              ],
            }),
          });

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: true,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(createSqlContextLayer({ databaseLayer, stripe })),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toContain(
          'nothing was cancelled, no refund was created, and no spots or inventory were released',
        );
        expect(queries).toHaveLength(1);
        expect(transactionCommands).toEqual([]);
        expect(retrieveCharge).not.toHaveBeenCalled();
        expect(retrievePaymentIntent).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rejects a registration status change after confirmation before any cancellation write',
    () =>
      Effect.gen(function* () {
        const registration = createCancellationRegistration();
        const { databaseLayer, queries, transactionCommands } =
          createCancellationLockConflictDatabase({
            lockedRegistration: { ...registration, status: 'PENDING' },
            registration,
          });

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(createSqlContextLayer({ databaseLayer })),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toContain(
          'nothing was cancelled, no refund was created, and no spots or inventory were released',
        );
        expect(
          queries.every(({ statement }) => statement.startsWith('select ')),
        ).toBe(true);
        expect(transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
  );

  it.effect(
    'rejects a registration payment-state change after confirmation before any cancellation write',
    () =>
      Effect.gen(function* () {
        const registration = createCancellationRegistration({
          status: 'PENDING',
        });
        const { databaseLayer, queries, transactionCommands } =
          createCancellationLockConflictDatabase({
            lockedRegistration: registration,
            lockedTransactions: [createCancellationTransaction()],
            registration,
          });

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: false,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(createSqlContextLayer({ databaseLayer })),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toContain(
          'nothing was cancelled, no refund was created, and no spots or inventory were released',
        );
        expect(
          queries.every(({ statement }) => statement.startsWith('select ')),
        ).toBe(true);
        expect(transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
  );

  it.effect(
    'blocks participant cancellation at the configured tenant deadline without mutating state',
    () =>
      Effect.gen(function* () {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-07-01T09:00:00.000Z'));
        const { databaseLayer, transactionCommands } =
          createCancellationReadDatabase({
            registration: createCancellationRegistration({
              event: {
                start: new Date('2026-09-19T09:00:00.000Z'),
                title: 'City tour',
              },
            }),
          });

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.flip,
          Effect.ensuring(Effect.sync(() => vi.useRealTimers())),
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              nowIso: '2026-09-18T09:00:00.000Z',
              tenant: {
                ...tenant,
                cancellationDeadlineHoursBeforeStart: 24,
              },
              user: createUser({
                permissions: ['events:cancelRegistrations'],
              }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'The participant cancellation deadline has passed, so this request did not cancel the registration, create a refund, or release its spots.',
        );
        expect(transactionCommands).toEqual([]);
      }),
  );

  it.effect(
    'allows event organizers to cancel after the participant deadline',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transactionCommands, writes } =
          createFreeCancellationDatabase({
            cancellationDeadlineHoursBeforeStart: 120,
            organizer: true,
            registration: createCancellationRegistration({
              userId: 'attendee-1',
            }),
            scope: { eventId: 'event-1', kind: 'organizer' },
          });

        yield* eventRegistrationHandlers['events.cancelEventRegistration'](
          {
            eventId: 'event-1',
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelEventRegistration'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              tenant: {
                ...tenant,
                cancellationDeadlineHoursBeforeStart: 120,
              },
              user: createUser({
                permissions: ['events:cancelRegistrations'],
              }),
            }),
          ),
        );

        expect(
          writes.filter(({ statement }) => statement.startsWith('update ')),
        ).toHaveLength(2);
        expect(writes[1]?.statement).toContain(
          `"${eventRegistrationOptions.confirmedSpots.name}" - $1`,
        );
        expect(writes[1]?.parameters).toEqual([
          1,
          expect.any(String),
          'option-1',
          1,
        ]);
        expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );

  it.effect(
    'rejects event registration cancellation without organizer access',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, queries, transactionCommands } =
          createCancellationReadDatabase();

        const error = yield* eventRegistrationHandlers[
          'events.cancelEventRegistration'
        ](
          {
            eventId: 'event-1',
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelEventRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(createSqlContextLayer({ databaseLayer })),
        );

        expect(error['_tag']).toBe('RpcForbiddenError');
        expect(queries).toHaveLength(1);
        expect(transactionCommands).toEqual([]);
      }),
  );

  it.effect(
    'requires the separate cancellation capability for organizer add-on cancellation',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, queries, transactionCommands } =
          createCancellationReadDatabase();

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistrationAddon'
        ](
          {
            operationKey: 'cancel-addon-1',
            quantity: 1,
            reason: 'Damaged item',
            refundRequested: false,
            registrationAddonId: 'registration-addon-1',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistrationAddon'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcForbiddenError');
        if (error._tag !== 'RpcForbiddenError')
          throw new Error('Expected a forbidden registration mutation');
        expect(error.permission).toBe('events:cancelRegistrations');
        expect(queries).toHaveLength(1);
        expect(transactionCommands).toEqual([]);
      }),
  );

  it.effect(
    'uses a registration option override to allow participant cancellation',
    () =>
      Effect.gen(function* () {
        const registration = createCancellationRegistration();
        const { databaseLayer, transactionCommands, writes } =
          createFreeCancellationDatabase({
            cancellationDeadlineHoursBeforeStart: 120,
            registration: {
              ...registration,
              registrationOption: {
                ...registration.registrationOption,
                cancellationDeadlineHoursBeforeStart: 0,
              },
            },
          });

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              tenant: {
                ...tenant,
                cancellationDeadlineHoursBeforeStart: 120,
              },
            }),
          ),
        );

        expect(
          writes.filter(({ statement }) => statement.startsWith('update ')),
        ).toHaveLength(2);
        expect(writes[1]?.statement).toContain(
          `"${eventRegistrationOptions.confirmedSpots.name}" - $1`,
        );
        expect(writes[1]?.parameters).toEqual([
          1,
          expect.any(String),
          'option-1',
          1,
        ]);
        expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );

  it.effect(
    'cancels confirmed guest registrations and releases buyer plus guest spots',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transactionCommands, writes } =
          createFreeCancellationDatabase({
            registration: createCancellationRegistration({ guestCount: 2 }),
          });

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(Effect.provide(createSqlContextLayer({ databaseLayer })));

        expect(writes[1]?.statement).toContain(
          `"${eventRegistrationOptions.confirmedSpots.name}" - $1`,
        );
        expect(writes[1]?.parameters).toEqual([
          3,
          expect.any(String),
          'option-1',
          3,
        ]);
        expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );

  it.effect(
    'queues participant cancellation and informational waitlist emails in the cancellation transaction',
    () =>
      Effect.gen(function* () {
        const registration = createCancellationRegistration({ guestCount: 2 });
        const { databaseLayer, insertedEmails, transactionCommands } =
          createFreeCancellationDatabase({
            registration: {
              ...registration,
              registrationOption: {
                ...registration.registrationOption,
                eventRegistrations: [
                  {
                    id: 'waitlist-registration-1',
                    status: 'WAITLIST',
                    user: {
                      communicationEmail: 'waitlist.contact@example.com',
                      email: 'waitlist@example.com',
                    },
                  },
                ],
              },
            },
          });

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(Effect.provide(createSqlContextLayer({ databaseLayer })));

        expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
        expect(insertedEmails).toEqual([
          expect.objectContaining({
            idempotencyKey: 'registration-cancelled/tenant-1/registration-1',
            kind: 'registrationCancelled',
            toEmail: 'attendee.contact@example.com',
          }),
          expect.objectContaining({
            idempotencyKey:
              'waitlist-spot-available/tenant-1/waitlist-registration-1/cancellation-registration-1',
            kind: 'waitlistSpotAvailable',
            toEmail: 'waitlist.contact@example.com',
          }),
        ]);
        expect(insertedEmails[0]?.['html']).toContain(
          'https://tenant.example.com/events/event-1',
        );
        expect(insertedEmails[1]?.['text']).toContain(
          'does not reserve a spot',
        );
      }),
  );

  it.effect(
    'passes the platform administrator actor to the cancellation email',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, insertedEmails, transactionCommands } =
          createFreeCancellationDatabase({
            registration: createCancellationRegistration({
              guestCount: 2,
              userId: 'attendee-1',
            }),
            scope: { kind: 'tenant' },
          });

        yield* cancelRegistrationForTenant({
          cancelledBy: 'platformAdministrator',
          enforceParticipantDeadline: false,
          executiveUserId: null,
          registrationId: 'registration-1',
          targetTenant: tenant,
        }).pipe(Effect.provide(createSqlContextLayer({ databaseLayer })));

        expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
        expect(insertedEmails).toHaveLength(1);
        expect(insertedEmails[0]?.['text']).toContain(
          'A platform administrator cancelled your registration',
        );
      }),
  );

  it.effect(
    'fails closed when a persisted non-Stripe payment reaches cancellation',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transactionCommands, writes } =
          createPaidCancellationDatabase({ mode: 'invalidCash' });

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(createSqlContextLayer({ databaseLayer })),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toContain(
          'Stripe payment ownership or acquisition settlement is inconsistent',
        );
        expect(writes).toEqual([]);
        expect(transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
  );

  it.effect(
    'creates an exact Stripe refund claim when a free registration has only a paid add-on source',
    () =>
      Effect.gen(function* () {
        const {
          databaseLayer,
          refundAllocations,
          refundClaims,
          transactionCommands,
        } = createPaidCancellationDatabase({ mode: 'addon' });

        const outcome = yield* cancelRegistrationForTenant({
          cancelledBy: 'organizer',
          enforceParticipantDeadline: false,
          executiveUserId: 'organizer-1',
          registrationId: 'registration-1',
          targetTenant: tenant,
        }).pipe(Effect.provide(createSqlContextLayer({ databaseLayer })));

        expect(outcome).toEqual(
          expect.objectContaining({
            refundClaimId: expect.any(String),
            refundTransactionId: expect.any(String),
            status: 'cancelled',
          }),
        );
        expect(refundClaims).toHaveLength(1);
        expect(refundClaims[0]?.parameters).toEqual([
          expect.any(String),
          tenant.id,
          -750,
          'Registration refund claim for source transaction addon-transaction-1',
          'EUR',
          'event-1',
          'registration-1',
          'organizer-1',
          false,
          'stripe',
          'registration-cancellation:registration-1:addon-transaction-1',
          'addon-transaction-1',
          'pending',
          'acct_persisted',
          true,
          expect.any(String),
          'attendee-1',
          'refund',
        ]);
        expect(refundAllocations).toHaveLength(1);
        expect(refundAllocations[0]?.parameters).toEqual([
          'acquisition-registration-1',
          'acquisition-payment-1',
          75,
          true,
          'acquisition-component-addon-1',
          'event-1',
          expect.any(String),
          750,
          expect.any(String),
          637,
          'registration-cancellation:registration-1:acquisition-component-addon-1',
          'addon_cancellation',
          'purchase-1',
          3,
          750,
          refundClaims[0]?.parameters[0],
          'registration-1',
          38,
          tenant.id,
        ]);
        expect(transactionCommands).toEqual([
          'BEGIN',
          'COMMIT',
          'BEGIN',
          'COMMIT',
        ]);
      }),
  );

  it.effect(
    'cancels a paid add-on without a refund claim when its refundable net is zero',
    () =>
      Effect.gen(function* () {
        const {
          databaseLayer,
          refundAllocations,
          refundClaims,
          transactionCommands,
          writes,
        } = createPaidCancellationDatabase({
          mode: 'addon',
          refundFeesOnCancellation: false,
          settlement: { appFee: 950, stripeFee: 50, stripeNetAmount: 0 },
        });

        const outcome = yield* cancelRegistrationForTenant({
          cancelledBy: 'organizer',
          enforceParticipantDeadline: false,
          executiveUserId: 'organizer-1',
          registrationId: 'registration-1',
          targetTenant: tenant,
        }).pipe(Effect.provide(createSqlContextLayer({ databaseLayer })));

        expect(outcome).toEqual({
          refundClaimId: null,
          refundTransactionId: null,
          status: 'cancelled',
        });
        expect(refundClaims).toEqual([]);
        expect(refundAllocations).toEqual([]);
        expect(writes).toContainEqual({
          parameters: ['no_monetary_refund_required', expect.any(String)],
          statement: expect.stringContaining(
            `update "${getTableName(eventRegistrationAddonFulfillmentEvents)}"`,
          ),
        });
        expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );

  it.effect(
    'persists a durable Stripe refund claim against its historical Stripe account',
    () =>
      Effect.gen(function* () {
        let cancellationTransition:
          | Parameters<
              NonNullable<
                Parameters<typeof cancelRegistrationForTenant>[0]['onCancelled']
              >
            >[1]
          | undefined;
        const {
          databaseLayer,
          refundAllocations,
          refundClaims,
          transactionCommands,
          writes,
        } = createPaidCancellationDatabase();
        const stripe = createStripeClientDouble();

        yield* cancelRegistrationForTenant({
          cancelledBy: 'organizer',
          enforceParticipantDeadline: false,
          executiveUserId: null,
          onCancelled: (_tx, transition) => {
            cancellationTransition = transition;
            return Effect.void;
          },
          registrationId: 'registration-1',
          targetTenant: {
            ...tenant,
            stripeAccountId: 'acct_123',
          },
        }).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        const counterUpdate = writes.find(({ statement }) =>
          statement.startsWith(
            `update "${getTableName(eventRegistrationOptions)}"`,
          ),
        );
        expect(counterUpdate?.statement).toContain(
          `"${eventRegistrationOptions.confirmedSpots.name}" - $1`,
        );
        expect(counterUpdate?.parameters).toEqual([
          2,
          expect.any(String),
          'option-1',
          2,
        ]);
        expect(stripe.refunds.create).not.toHaveBeenCalled();
        expect(refundClaims).toHaveLength(1);
        expect(refundClaims[0]?.parameters).toEqual([
          expect.any(String),
          tenant.id,
          -2500,
          'Registration refund claim for source transaction transaction-1',
          'EUR',
          'event-1',
          'registration-1',
          null,
          false,
          'stripe',
          'registration-cancellation:registration-1:transaction-1',
          'transaction-1',
          'pending',
          'acct_persisted',
          true,
          expect.any(String),
          'attendee-1',
          'refund',
        ]);
        const nextAttemptAt = refundClaims[0]?.parameters[15];
        if (typeof nextAttemptAt !== 'string')
          throw new Error('Refund retry timestamp missing');
        expect(Number.isFinite(Date.parse(nextAttemptAt))).toBe(true);
        expect(refundClaims[0]?.parameters[13]).not.toBe('acct_123');
        expect(refundAllocations).toHaveLength(1);
        expect(refundAllocations[0]?.parameters).toEqual([
          'acquisition-registration-1',
          'acquisition-payment-1',
          250,
          true,
          'acquisition-component-registration',
          'event-1',
          null,
          2500,
          expect.any(String),
          2175,
          'registration-cancellation:registration-1:acquisition-component-registration',
          'registration_cancellation',
          null,
          2,
          2500,
          refundClaims[0]?.parameters[0],
          'registration-1',
          75,
          tenant.id,
        ]);
        expect(cancellationTransition).toEqual({
          checkInTime: null,
          eventId: 'event-1',
          guestCount: 1,
          refundTransactionId: expect.any(String),
          refundTransactionStatus: 'pending',
          registrationId: 'registration-1',
          registrationOptionId: 'option-1',
          statusAfter: 'CANCELLED',
          statusBefore: 'CONFIRMED',
          userId: 'attendee-1',
        });
        expect(transactionCommands).toEqual([
          'BEGIN',
          'COMMIT',
          'BEGIN',
          'COMMIT',
        ]);
      }),
  );

  it.effect(
    'keeps an unbound pending payment claim and its reserved spot intact',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transactionCommands } =
          createCancellationReadDatabase({
            registration: createCancellationRegistration({
              status: 'PENDING',
              transactions: [
                createCancellationTransaction({
                  stripeCheckoutSessionId: null,
                }),
              ],
            }),
          });

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: true,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(createSqlContextLayer({ databaseLayer })),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Payment setup is still being reconciled, so this request did not cancel the registration or release its reserved spots. Retry payment setup, then retry cancellation.',
        );
        expect(transactionCommands).toEqual([]);
      }),
  );

  it.effect(
    'refuses generic recipient cancellation before expiring an active transfer checkout',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transactionCommands } =
          createCancellationReadDatabase({
            activeTransferId: 'transfer-1',
            registration: createCancellationRegistration({
              guestCount: 3,
              id: 'recipient-registration-1',
              status: 'PENDING',
              transactions: [
                createCancellationTransaction({
                  id: 'recipient-transaction-1',
                  stripeCheckoutSessionId: 'checkout-transfer-1',
                }),
              ],
            }),
          });
        const stripe = createStripeClientDouble();

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: true,
            expectedStatus: 'PENDING',
            registrationId: 'recipient-registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(createSqlContextLayer({ databaseLayer, stripe })),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain('active transfer');
        expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
        expect(transactionCommands).toEqual([]);
      }),
  );

  it.effect(
    'rolls back cancellation when a transfer becomes active under the registration lock',
    () =>
      Effect.gen(function* () {
        const registration = createCancellationRegistration();
        const { databaseLayer, queries, transactionCommands } =
          createCancellationLockConflictDatabase({
            activeTransfer: {
              id: 'transfer-race',
              status: 'open',
            },
            lockedRegistration: registration,
            registration,
          });

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(createSqlContextLayer({ databaseLayer })),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain('active transfer');
        expect(
          queries.every(({ statement }) => statement.startsWith('select ')),
        ).toBe(true);
        expect(transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
  );

  it.effect(
    'does not release a checkout claim that becomes bound after preflight',
    () =>
      Effect.gen(function* () {
        const registration = createCancellationRegistration({
          status: 'PENDING',
        });
        const { databaseLayer, queries, transactionCommands } =
          createCancellationLockConflictDatabase({
            lockedRegistration: registration,
            lockedTransactions: [
              createCancellationTransaction({
                id: 'transaction-race',
                stripeCheckoutSessionId: 'checkout-race',
              }),
            ],
            registration,
          });
        const stripe = createStripeClientDouble();

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: false,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
          Effect.flip,
        );
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Registration status or payment state changed after confirmation, so nothing was cancelled, no refund was created, and no spots or inventory were released. Refresh, review the current registration, then confirm again.',
        );
        expect(
          queries.every(({ statement }) => statement.startsWith('select ')),
        ).toBe(true);
        expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
        expect(transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
  );

  it.effect(
    'keeps a bound checkout claim and reservation when Stripe expiry fails',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transactionCommands, writes } =
          createPendingCancellationDatabase();
        const stripe = createStripeClientDouble();
        vi.mocked(stripe.checkout.sessions.expire).mockRejectedValueOnce(
          new Error('Stripe unavailable'),
        );
        vi.mocked(stripe.checkout.sessions.retrieve).mockRejectedValueOnce(
          new Error('Stripe unavailable'),
        );

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: true,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe(
          'Checkout cancellation could not be confirmed, so this request did not cancel the registration or release its reserved spots. Refresh before retrying.',
        );
        expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
          'checkout-1',
          undefined,
          { stripeAccount: 'acct_123' },
        );
        expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(
          'checkout-1',
          undefined,
          { stripeAccount: 'acct_123' },
        );
        expect(writes).toHaveLength(1);
        expect(writes[0]?.statement).toContain(
          `"${transactions.stripeCheckoutCancellationRequestedAt.name}" =`,
        );
        expect(writes[0]?.statement).toContain('update "transactions"');
        expect(writes[0]?.transaction).toBe(1);
        expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );

  it.effect(
    'treats a concurrently expired and locally cancelled checkout as success',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transactionCommands, writes } =
          createPendingCancellationDatabase({
            cancelledBeforeFinalizationLock: true,
          });
        const stripe = createStripeClientDouble();
        vi.mocked(stripe.checkout.sessions.expire).mockRejectedValueOnce(
          new Error('Checkout is already expired'),
        );
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValueOnce(
          checkoutSessionResponse({ id: 'checkout-1', status: 'expired' }),
        );

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: true,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(
          'checkout-1',
          undefined,
          { stripeAccount: 'acct_123' },
        );
        expect(transactionCommands).toEqual([
          'BEGIN',
          'COMMIT',
          'BEGIN',
          'COMMIT',
        ]);
        expect(writes).toHaveLength(1);
        expect(writes[0]?.transaction).toBe(1);
        expect(writes[0]?.statement).toContain(
          `"${transactions.stripeCheckoutCancellationRequestedAt.name}" =`,
        );
      }),
  );

  it.effect(
    'does not release reservations when payment completion wins cancellation finalization',
    () =>
      Effect.gen(function* () {
        const {
          databaseLayer,
          pendingTransaction,
          transactionCommands,
          writes,
        } = createPendingCancellationDatabase({
          pendingTransaction: createCancellationTransaction({
            id: 'transaction-race',
            stripeCheckoutSessionId: 'checkout-race',
          }),
        });
        const stripe = createStripeClientDouble({
          expireCheckoutSession: vi.fn(async () => {
            pendingTransaction.status = 'successful';
            return checkoutSessionResponse({
              id: 'checkout-race',
              status: 'expired',
            });
          }),
        });

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: true,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain(
          'nothing was cancelled, no refund was created, and no spots or inventory were released',
        );
        expect(writes).toHaveLength(1);
        expect(writes[0]?.statement).toContain(
          `"${transactions.stripeCheckoutCancellationRequestedAt.name}" =`,
        );
        expect(writes[0]?.transaction).toBe(1);
        expect(
          pendingTransaction.stripeCheckoutCancellationRequestedAt,
        ).toBeInstanceOf(Date);
        expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );

  it.effect(
    'cancels unapproved manual applications without releasing reserved spots',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transactionCommands, writes } =
          createFreeCancellationDatabase({
            registration: createCancellationRegistration({ status: 'PENDING' }),
          });

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: false,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(Effect.provide(createSqlContextLayer({ databaseLayer })));

        expect(
          writes.filter(({ statement }) => statement.startsWith('update ')),
        ).toEqual([
          expect.objectContaining({
            parameters: [
              expect.any(String),
              'CANCELLED',
              'registration-1',
              tenant.id,
              'PENDING',
              'scanner-1',
            ],
            statement: expect.stringContaining('update "event_registrations"'),
          }),
        ]);
        expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );

  it.effect(
    'cancels pending guest registrations and releases buyer plus guest reserved spots',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, lifecycle, transactionCommands, writes } =
          createPendingCancellationDatabase({ guestCount: 2 });
        const stripe = createStripeClientDouble({
          expireCheckoutSession: vi.fn(async () => {
            lifecycle.push('stripe-expire');
            return checkoutSessionResponse({
              id: 'checkout-1',
              status: 'expired',
            });
          }),
        });

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: true,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        const counterUpdate = writes.find(({ statement }) =>
          statement.startsWith('update "event_registration_options"'),
        );
        expect(counterUpdate?.statement).toContain(
          `"${eventRegistrationOptions.reservedSpots.name}" - $1`,
        );
        expect(counterUpdate?.parameters).toEqual([
          3,
          expect.any(String),
          'option-1',
          3,
        ]);
        expect(counterUpdate?.transaction).toBe(2);
        expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
          'checkout-1',
          undefined,
          { stripeAccount: 'acct_123' },
        );
        expect(transactionCommands).toEqual([
          'BEGIN',
          'COMMIT',
          'BEGIN',
          'COMMIT',
        ]);
        expect(lifecycle).toEqual([
          'BEGIN',
          'mark-cancellation',
          'COMMIT',
          'stripe-expire',
          'BEGIN',
          'cancel-registration',
          'release-reservation',
          'queue-cancellation-email',
          'cancel-payment',
          'COMMIT',
        ]);
      }),
  );

  it.effect('rejects checked-in registration cancellation', () =>
    Effect.gen(function* () {
      const { databaseLayer, transactionCommands } =
        createCancellationReadDatabase({
          registration: createCancellationRegistration({
            checkInTime: new Date(),
          }),
        });

      const error = yield* eventRegistrationHandlers[
        'events.cancelRegistration'
      ](
        {
          expectedPaymentPending: false,
          expectedStatus: 'CONFIRMED',
          registrationId: 'registration-1',
        },
        handlerOptions('events.cancelRegistration'),
      ).pipe(
        Effect.flip,
        Effect.provide(createSqlContextLayer({ databaseLayer })),
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Checked-in registrations cannot be cancelled',
      );
      expect(transactionCommands).toEqual([]);
    }),
  );

  it.effect(
    'cancels waitlisted registrations and releases a waitlist spot',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transactionCommands, writes } =
          createFreeCancellationDatabase({
            registration: createCancellationRegistration({
              status: 'WAITLIST',
            }),
          });

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: false,
            expectedStatus: 'WAITLIST',
            registrationId: 'registration-1',
          },
          handlerOptions('events.cancelRegistration'),
        ).pipe(Effect.provide(createSqlContextLayer({ databaseLayer })));

        expect(
          writes.filter(({ statement }) => statement.startsWith('update ')),
        ).toHaveLength(2);
        expect(writes[1]?.statement).toContain(
          `"${eventRegistrationOptions.waitlistSpots.name}" - $2`,
        );
        expect(writes[1]?.parameters).toEqual([
          expect.any(String),
          1,
          'option-1',
          1,
        ]);
        expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );
});

describe('event registration transfer handlers', () => {
  it.effect(
    'returns eligible transfer targets for organizer-assisted transfer',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createTransferTargetsDatabase();
        const result = yield* eventRegistrationHandlers[
          'events.findTransferTargets'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            search: 'alex',
          },
          handlerOptions('events.findTransferTargets'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, fixture.database),
            }),
          ),
        );

        expect(result).toEqual([
          {
            email: 'alex@example.com',
            firstName: 'Alex',
            id: 'target-user-1',
            lastName: 'Able',
          },
        ]);
        fixture.expectComplete();
      }),
  );

  it.effect(
    'returns transfer targets for unrestricted registration options',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createTransferTargetsDatabase({
          registrationOptionRoleIds: [],
        });
        const result = yield* eventRegistrationHandlers[
          'events.findTransferTargets'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            search: 'alex',
          },
          handlerOptions('events.findTransferTargets'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, fixture.database),
            }),
          ),
        );

        expect(result).toEqual([
          {
            email: 'alex@example.com',
            firstName: 'Alex',
            id: 'target-user-1',
            lastName: 'Able',
          },
          {
            email: 'other@example.com',
            firstName: 'Other',
            id: 'other-user-1',
            lastName: 'Role',
          },
        ]);
        fixture.expectComplete();
      }),
  );

  it.effect(
    'returns targets for checked-in, paid, and source-discounted fixed bundles',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createTransferTargetsDatabase({
          hasCheckedInHistory: true,
          hasPaidSource: true,
          hasSourceDiscount: true,
        });
        const result = yield* eventRegistrationHandlers[
          'events.findTransferTargets'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            search: 'alex',
          },
          handlerOptions('events.findTransferTargets'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, fixture.database),
            }),
          ),
        );

        expect(result).toEqual([
          {
            email: 'alex@example.com',
            firstName: 'Alex',
            id: 'target-user-1',
            lastName: 'Able',
          },
        ]);
        fixture.expectComplete();
      }),
  );

  it.effect(
    'previews without writes and commits only the matching reviewed bundle',
    () =>
      Effect.gen(function* () {
        const { database, insertedEmails, lockOrder, updateSets } =
          yield* createTransferDatabase();

        const preview = yield* previewEventRegistrationTransfer().pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(preview).toMatchObject({
          bundle: {
            addOns: [],
            checkedInGuestCount: 0,
            checkInTime: null,
            guestCount: 0,
          },
          completionMode: 'databaseOnly',
          pricing: {
            recipientBundlePrice: 0,
            sourceRefundAmountDue: 0,
          },
          recipient: { id: 'target-user-1' },
          source: { id: 'attendee-1' },
        });
        expect(preview.previewVersion).not.toHaveLength(0);
        expect(insertedEmails).toEqual([]);
        expect(updateSets).toEqual([]);

        yield* eventRegistrationHandlers['events.transferEventRegistration'](
          {
            eventId: 'event-1',
            previewVersion: preview.previewVersion,
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          handlerOptions('events.transferEventRegistration'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(updateSets).toEqual([
          expect.objectContaining({ userId: 'target-user-1' }),
        ]);
        expect(lockOrder.slice(0, 3)).toEqual([
          'registration',
          'memberships',
          'roles',
        ]);
        expect(lockOrder.indexOf('terms')).toBeGreaterThan(
          lockOrder.indexOf('roles'),
        );
        expect(insertedEmails).toEqual([
          expect.objectContaining({
            idempotencyKey:
              'registration-transferred/tenant-1/registration-1/direct-registration-transfer:acquisition-registration-1/previousOwner/attendee-1',
            kind: 'registrationTransferred',
            toEmail: 'attendee.contact@example.com',
          }),
          expect.objectContaining({
            idempotencyKey:
              'registration-transferred/tenant-1/registration-1/direct-registration-transfer:acquisition-registration-1/newOwner/target-user-1',
            kind: 'registrationTransferred',
            toEmail: 'target.contact@example.com',
          }),
        ]);
        expect(insertedEmails[1]?.html).toContain(
          'https://tenant.example.com/events/event-1',
        );
      }),
  );

  it.effect(
    'rejects confirmation when fulfillment changes after the reviewed preview',
    () =>
      Effect.gen(function* () {
        const {
          database,
          insertedEmails,
          mutateFirstAddonFulfillment,
          updateSets,
        } = yield* createTransferDatabase({
          bundleAddonPurchases: [
            { price: 0, purchasedQuantity: 1, redeemedQuantity: 0 },
          ],
        });
        const preview = yield* previewEventRegistrationTransfer().pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        mutateFirstAddonFulfillment();

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            previewVersion: preview.previewVersion,
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          handlerOptions('events.transferEventRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe(
          'The registration bundle changed after it was reviewed. Review the transfer again before confirming.',
        );
        expect(insertedEmails).toEqual([]);
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'requires recipient claim when the registration option has participant questions',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          registrationQuestionIds: ['question-1'],
        });

        const error = yield* previewEventRegistrationTransfer().pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toContain(
          'Create a private transfer offer so the recipient can answer the current questions',
        );
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects a legacy transfer when a concurrent active transfer wins the registration lock',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          lockedActiveTransfers: [
            {
              id: 'transfer-1',
              recipientRegistrationId: null,
              sourceRegistrationId: 'registration-1',
              status: 'open',
            },
          ],
        });

        const error = yield* previewEventRegistrationTransfer().pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain('active transfer');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'allows participants to transfer their own confirmed unpaid registration by target email',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          organizerRegistrations: [],
          participantCommit: true,
        });

        yield* eventRegistrationHandlers['events.transferMyRegistration'](
          {
            registrationId: 'registration-1',
            targetEmail: ' TARGET@EXAMPLE.COM ',
          },
          handlerOptions('events.transferMyRegistration'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
              user: createUser({ id: 'attendee-1' }),
            }),
          ),
        );

        expect(updateSets).toEqual([
          expect.objectContaining({ userId: 'target-user-1' }),
        ]);
      }),
  );

  it.effect(
    'preserves checked-in and fulfilled history during a free direct transfer',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          bundleAddonPurchases: [
            { price: 0, purchasedQuantity: 1, redeemedQuantity: 1 },
          ],
          registration: {
            appliedDiscountedPrice: null,
            appliedDiscountType: null,
            checkInTime: new Date('2026-07-01T10:00:00.000Z'),
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            guestCount: 1,
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            transactions: [],
            userId: 'attendee-1',
          },
        });

        yield* previewAndTransferEventRegistration().pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(updateSets).toEqual([
          expect.objectContaining({ userId: 'target-user-1' }),
        ]);
      }),
  );

  it.effect(
    'treats a registration option with paid disabled as free even when a stale price remains',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          registration: {
            appliedDiscountedPrice: null,
            appliedDiscountType: null,
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
              title: 'City tour',
            },
            eventId: 'event-1',
            guestCount: 2,
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            transactions: [],
            userId: 'attendee-1',
          },
          registrationOptionIsPaid: false,
          registrationOptionPrice: 1200,
        });

        const preview = yield* previewAndTransferEventRegistration().pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(preview).toMatchObject({
          bundle: { guestCount: 2, guestUnitPrice: 0 },
          completionMode: 'databaseOnly',
          pricing: {
            recipientBundlePrice: 0,
            recipientRegistrationPrice: 0,
          },
          registrationOption: { currentPrice: 0 },
        });
        expect(updateSets).toEqual([
          expect.objectContaining({
            basePriceAtRegistration: 0,
            userId: 'target-user-1',
          }),
        ]);
      }),
  );

  it.effect('allows transfer to unrestricted registration options', () =>
    Effect.gen(function* () {
      const { database, updateSets } = yield* createTransferDatabase({
        registrationOptionRoleIds: [],
        targetTenantUser: {
          id: 'target-tenant-user-1',
          roles: [],
        },
      });

      yield* previewAndTransferEventRegistration().pipe(
        Effect.provide(
          createSqlContextLayer({
            databaseLayer: Layer.succeed(Database, database),
          }),
        ),
      );

      expect(updateSets).toEqual([
        expect.objectContaining({ userId: 'target-user-1' }),
      ]);
    }),
  );

  it.effect(
    'rejects participant transfer when the target email is not an existing user',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          participantCommit: true,
          targetLookupEmail: 'missing@example.com',
          targetUser: null,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferMyRegistration'
        ](
          {
            registrationId: 'registration-1',
            targetEmail: 'missing@example.com',
          },
          handlerOptions('events.transferMyRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
              user: createUser({ id: 'attendee-1' }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(error.message).toBe('Target user not found');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'does not reveal existing users outside the tenant during participant transfer',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          participantCommit: true,
          targetTenantUser: null,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferMyRegistration'
        ](
          {
            registrationId: 'registration-1',
            targetEmail: 'target@example.com',
          },
          handlerOptions('events.transferMyRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
              user: createUser({ id: 'attendee-1' }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(error.message).toBe('Target user not found');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect('rejects transfer without organizer access', () =>
    Effect.gen(function* () {
      const { database, updateSets } = yield* createTransferDatabase({
        organizerRegistrations: [],
      });

      const error = yield* eventRegistrationHandlers[
        'events.transferEventRegistration'
      ](
        {
          eventId: 'event-1',
          previewVersion: unusedTransferPreviewVersion,
          registrationId: 'registration-1',
          targetUserId: 'target-user-1',
        },
        handlerOptions('events.transferEventRegistration'),
      ).pipe(
        Effect.flip,
        Effect.provide(
          createSqlContextLayer({
            databaseLayer: Layer.succeed(Database, database),
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(updateSets).toEqual([]);
    }),
  );

  it.effect(
    'routes a paid registration bundle through a private offer and recipient claim',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          registration: {
            appliedDiscountedPrice: null,
            appliedDiscountType: null,
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            transactions: [
              {
                amount: 1200,
                status: 'successful',
                type: 'registration',
              },
            ],
            userId: 'attendee-1',
          },
        });

        const error = yield* previewEventRegistrationTransfer().pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'This registration bundle cannot be reassigned directly. Create a private transfer offer so the recipient claim can apply current pricing and source refunds atomically.',
        );
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects direct transfer when the registration has a completed paid add-on',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          registration: {
            appliedDiscountedPrice: null,
            appliedDiscountType: null,
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            transactions: [
              {
                amount: 1200,
                status: 'successful',
                type: 'addon',
              },
            ],
            userId: 'attendee-1',
          },
        });

        const error = yield* previewEventRegistrationTransfer().pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain('Create a private transfer offer');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'allows direct transfer when the recipient current discount makes the bundle free',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          discountProviders: {
            esnCard: { config: {}, status: 'enabled' },
          },
          recipientDiscountCards: [
            {
              type: 'esnCard',
              validFrom: new Date('2000-01-01T00:00:00.000Z'),
              validTo: new Date('2100-01-01T00:00:00.000Z'),
            },
          ],
          registration: {
            appliedDiscountedPrice: 0,
            appliedDiscountType: 'esnCard',
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            transactions: [],
            userId: 'attendee-1',
          },
          registrationOptionDiscounts: [
            { discountedPrice: 0, discountType: 'esnCard' },
          ],
          registrationOptionPrice: 1200,
        });

        yield* previewAndTransferEventRegistration().pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(updateSets).toEqual([
          expect.objectContaining({ userId: 'target-user-1' }),
        ]);
      }),
  );

  it.effect(
    'routes a source-discounted bundle through a private offer when the recipient price is positive',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          registration: {
            appliedDiscountedPrice: 0,
            appliedDiscountType: 'esnCard',
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            transactions: [],
            userId: 'attendee-1',
          },
          registrationOptionPrice: 1200,
        });

        const error = yield* previewEventRegistrationTransfer().pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain('Create a private transfer offer');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect('rejects transfer when the target user is not role-eligible', () =>
    Effect.gen(function* () {
      const { database, updateSets } = yield* createTransferDatabase({
        targetTenantUser: {
          id: 'target-tenant-user-1',
          roles: [{ id: 'other-role-1' }],
        },
      });

      const error = yield* eventRegistrationHandlers[
        'events.transferEventRegistration'
      ](
        {
          eventId: 'event-1',
          previewVersion: unusedTransferPreviewVersion,
          registrationId: 'registration-1',
          targetUserId: 'target-user-1',
        },
        handlerOptions('events.transferEventRegistration'),
      ).pipe(
        Effect.flip,
        Effect.provide(
          createSqlContextLayer({
            databaseLayer: Layer.succeed(Database, database),
          }),
        ),
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Target user is not eligible for this registration option',
      );
      expect(updateSets).toEqual([]);
    }),
  );

  it.effect(
    'rejects transfer when the target role is removed after preflight but before the locked eligibility check',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          lockedTargetRoleIds: [],
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            previewVersion: unusedTransferPreviewVersion,
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          handlerOptions('events.transferEventRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe(
          'Target user is not eligible for this registration option',
        );
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects direct transfer when the locked event is no longer approved',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          lockedEventStatus: 'DRAFT',
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            previewVersion: unusedTransferPreviewVersion,
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          handlerOptions('events.transferEventRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe('Registration can no longer be transferred');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects direct transfer after the option deadline but before event start',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          lockedEventStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
          lockedOptionTransferDeadlineHoursBeforeStart: 48,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            previewVersion: unusedTransferPreviewVersion,
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          handlerOptions('events.transferEventRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe('Registration can no longer be transferred');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rechecks mutation time when a registration lock wait crosses the event start',
    () =>
      Effect.gen(function* () {
        const handlerStart = new Date('2026-09-20T10:00:00.000Z');
        vi.useFakeTimers();
        vi.setSystemTime(handlerStart);
        try {
          const eventStart = new Date('2026-09-20T11:00:00.000Z');
          const { database, updateSets } = yield* createTransferDatabase({
            afterRegistrationLock: () => {
              vi.setSystemTime(new Date('2026-09-20T12:00:00.000Z'));
            },
            lockedEventStart: eventStart,
            registration: {
              appliedDiscountedPrice: null,
              appliedDiscountType: null,
              checkInTime: null,
              event: { start: eventStart, title: 'City tour' },
              eventId: 'event-1',
              guestCount: 0,
              id: 'registration-1',
              registrationOptionId: 'option-1',
              status: 'CONFIRMED',
              transactions: [],
              user: {
                communicationEmail: 'attendee.contact@example.com',
                email: 'attendee@example.com',
              },
              userId: 'attendee-1',
            },
          });

          const error = yield* eventRegistrationHandlers[
            'events.transferEventRegistration'
          ](
            {
              eventId: 'event-1',
              previewVersion: unusedTransferPreviewVersion,
              registrationId: 'registration-1',
              targetUserId: 'target-user-1',
            },
            handlerOptions('events.transferEventRegistration'),
          ).pipe(
            Effect.flip,
            Effect.provide(
              createSqlContextLayer({
                databaseLayer: Layer.succeed(Database, database),
              }),
            ),
          );

          expect(error).toBeInstanceOf(EventRegistrationConflictError);
          expect(error.message).toBe(
            'Registration can no longer be transferred',
          );
          expect(updateSets).toEqual([]);
        } finally {
          vi.useRealTimers();
        }
      }),
  );

  it.effect(
    'rejects transfer when the target user is outside the current tenant',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          targetTenantUser: null,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            previewVersion: unusedTransferPreviewVersion,
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          handlerOptions('events.transferEventRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(error.message).toBe('Target tenant user not found');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects transfer when the target membership disappears under the lock',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          lockedTargetMembership: false,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            previewVersion: unusedTransferPreviewVersion,
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          handlerOptions('events.transferEventRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(error.message).toBe('Target tenant user not found');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects transfer when the target already has an active registration',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          existingTargetRegistration: { id: 'target-registration-1' },
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            previewVersion: unusedTransferPreviewVersion,
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          handlerOptions('events.transferEventRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Target user already has an active registration',
        );
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects transfer when a target registration appears after preflight',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          concurrentTargetRegistration: { id: 'target-registration-race' },
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            previewVersion: unusedTransferPreviewVersion,
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          handlerOptions('events.transferEventRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Target user already has an active registration',
        );
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'maps a concurrent active-registration update violation to a target conflict',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          updateError: new SqlError({
            reason: new UniqueViolation({
              cause: new Error('duplicate active registration'),
              constraint: activeEventRegistrationUniqueIndexName,
            }),
          }),
        });

        const preview = yield* previewEventRegistrationTransfer().pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            previewVersion: preview.previewVersion,
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          handlerOptions('events.transferEventRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe(
          'Target user already has an active registration',
        );
        expect(updateSets).toEqual([
          expect.objectContaining({ userId: 'target-user-1' }),
        ]);
      }),
  );

  it.effect(
    'allows direct transfer after the source payment has been fully refunded',
    () =>
      Effect.gen(function* () {
        const { database, sourceTransactions, updateSets } =
          yield* createTransferDatabase({
            registration: {
              appliedDiscountedPrice: null,
              appliedDiscountType: null,
              checkInTime: null,
              event: {
                start: new Date(Date.now() + 24 * 60 * 60 * 1000),
              },
              eventId: 'event-1',
              id: 'registration-1',
              registrationOptionId: 'option-1',
              status: 'CONFIRMED',
              transactions: [
                {
                  amount: 1200,
                  id: 'source-registration-payment',
                  status: 'successful',
                  type: 'registration',
                },
              ],
              userId: 'attendee-1',
            },
            sourceRefunds: [
              {
                amount: -1200,
                method: 'stripe',
                sourceTransactionId: 'source-registration-payment',
                status: 'successful',
                stripeRefundStatus: 'succeeded',
              },
            ],
          });

        expect(sourceTransactions[0]).not.toHaveProperty('createdAt');

        yield* previewAndTransferEventRegistration().pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(updateSets).toEqual([
          expect.objectContaining({ userId: 'target-user-1' }),
        ]);
      }),
  );

  it.effect('fails closed for a refund owned by a different user', () =>
    Effect.gen(function* () {
      const { database, updateSets } = yield* createTransferDatabase({
        registration: {
          appliedDiscountedPrice: null,
          appliedDiscountType: null,
          checkInTime: null,
          event: {
            start: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          eventId: 'event-1',
          id: 'registration-1',
          registrationOptionId: 'option-1',
          status: 'CONFIRMED',
          transactions: [
            {
              amount: 1200,
              id: 'source-registration-payment',
              status: 'successful',
              type: 'registration',
            },
          ],
          userId: 'attendee-1',
        },
        sourceRefunds: [
          {
            amount: -1200,
            method: 'stripe',
            sourceTransactionId: 'source-registration-payment',
            status: 'successful',
            stripeRefundStatus: 'succeeded',
            targetUserId: 'other-user',
          },
        ],
      });

      const error = yield* previewEventRegistrationTransfer().pipe(
        Effect.flip,
        Effect.provide(
          createSqlContextLayer({
            databaseLayer: Layer.succeed(Database, database),
          }),
        ),
      );

      expect(error).toBeInstanceOf(EventRegistrationConflictError);
      expect(error.message).toContain(
        'Source refund ownership is inconsistent',
      );
      expect(updateSets).toEqual([]);
    }),
  );

  it.effect('fails closed while an earlier source refund is unresolved', () =>
    Effect.gen(function* () {
      const { database, updateSets } = yield* createTransferDatabase({
        registration: {
          appliedDiscountedPrice: null,
          appliedDiscountType: null,
          checkInTime: null,
          event: {
            start: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          eventId: 'event-1',
          id: 'registration-1',
          registrationOptionId: 'option-1',
          status: 'CONFIRMED',
          transactions: [
            {
              amount: 1200,
              id: 'source-registration-payment',
              status: 'successful',
              type: 'registration',
            },
          ],
          userId: 'attendee-1',
        },
        sourceRefunds: [
          {
            amount: -1200,
            method: 'stripe',
            sourceTransactionId: 'source-registration-payment',
            status: 'pending',
            stripeRefundStatus: 'pending',
          },
        ],
      });

      const error = yield* eventRegistrationHandlers[
        'events.transferEventRegistration'
      ](
        {
          eventId: 'event-1',
          previewVersion: unusedTransferPreviewVersion,
          registrationId: 'registration-1',
          targetUserId: 'target-user-1',
        },
        handlerOptions('events.transferEventRegistration'),
      ).pipe(
        Effect.flip,
        Effect.provide(
          createSqlContextLayer({
            databaseLayer: Layer.succeed(Database, database),
          }),
        ),
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'An earlier source refund is unresolved. Resolve it before creating a private transfer offer.',
      );
      expect(updateSets).toEqual([]);
    }),
  );

  it.effect(
    'routes a currently paid purchased add-on through a private offer',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          bundleAddonPurchases: [{ price: 499, purchasedQuantity: 1 }],
        });

        const error = yield* previewEventRegistrationTransfer().pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain('Create a private transfer offer');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'locks the target membership and rejects transfer at the tenant active limit',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = yield* createTransferDatabase({
          activeTargetRegistrations: [{ id: 'active-registration-1' }],
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            previewVersion: unusedTransferPreviewVersion,
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          handlerOptions('events.transferEventRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer: Layer.succeed(Database, database),
              tenant: {
                ...tenant,
                maxActiveRegistrationsPerUser: 1,
              },
            }),
          ),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe('Active registration limit reached');
        expect(updateSets).toEqual([]);
      }),
  );
});

describe('event registration scan handlers', () => {
  it.effect('rejects scan reads for users who cannot check in this event', () =>
    Effect.gen(function* () {
      const databaseLayer = createScanReadDatabaseLayer({
        registration: scannedRegistration,
      });

      const error = yield* eventRegistrationHandlers[
        'events.registrationScanned'
      ](
        { registrationId: 'registration-1' },
        handlerOptions('events.registrationScanned'),
      ).pipe(
        Effect.flip,
        Effect.provide(createSqlContextLayer({ databaseLayer })),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
    }),
  );

  it.effect('disables scan check-in before the pre-start window opens', () =>
    Effect.gen(function* () {
      const databaseLayer = createScanReadDatabaseLayer({
        registration: {
          ...scannedRegistration,
          event: {
            ...scannedRegistration.event,
            start: new Date(Date.now() + 2 * 60 * 60 * 1000),
          },
        },
      });

      const result = yield* eventRegistrationHandlers[
        'events.registrationScanned'
      ](
        { registrationId: 'registration-1' },
        handlerOptions('events.registrationScanned'),
      ).pipe(
        Effect.provide(
          createSqlContextLayer({
            databaseLayer,
            user: createUser({ permissions: ['events:organizeAll'] }),
          }),
        ),
      );

      expect(result.allowCheckin).toBe(false);
      expect(result.checkInTimingIssue).toBe(true);
      expect(result.registrationStatus).toBe('CONFIRMED');
      expect(result.registrationStatusIssue).toBe(false);
      expect(result.sameUserIssue).toBe(false);
    }),
  );

  it.effect(
    'evaluates the scan window against the configured server clock',
    () =>
      Effect.gen(function* () {
        const nowIso = '2026-09-15T12:00:00.000Z';
        const databaseLayer = createScanReadDatabaseLayer({
          registration: {
            ...scannedRegistration,
            event: {
              ...scannedRegistration.event,
              start: new Date('2026-09-15T12:30:00.000Z'),
            },
          },
        });

        const result = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ](
          { registrationId: 'registration-1' },
          handlerOptions('events.registrationScanned'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              nowIso,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(result.allowCheckin).toBe(true);
        expect(result.checkInTimingIssue).toBe(false);
      }),
  );

  it.effect(
    'maps an invalid configured server clock to a typed scan error',
    () =>
      Effect.gen(function* () {
        const databaseLayer = createScanReadDatabaseLayer({
          registration: scannedRegistration,
        });

        const error = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ](
          { registrationId: 'registration-1' },
          handlerOptions('events.registrationScanned'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              nowIso: 'not-a-date',
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe('Invalid E2E_NOW_ISO server clock value');
      }),
  );

  for (const status of nonConfirmedRegistrationStatuses) {
    it.effect(`disables scan check-in for ${status} registrations`, () =>
      Effect.gen(function* () {
        const databaseLayer = createScanReadDatabaseLayer({
          registration: {
            ...scannedRegistration,
            status,
          },
        });

        const result = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ](
          { registrationId: 'registration-1' },
          handlerOptions('events.registrationScanned'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(result.allowCheckin).toBe(false);
        expect(result.registrationStatus).toBe(status);
        expect(result.registrationStatusIssue).toBe(true);
        expect(result.sameUserIssue).toBe(false);
      }),
    );
  }

  it.effect(
    'allows scanning remaining guests after the buyer is checked in',
    () =>
      Effect.gen(function* () {
        const databaseLayer = createScanReadDatabaseLayer({
          registration: {
            ...scannedRegistration,
            checkedInGuestCount: 1,
            checkInTime: new Date(),
            guestCount: 2,
          },
        });

        const result = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ](
          { registrationId: 'registration-1' },
          handlerOptions('events.registrationScanned'),
        ).pipe(
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(result.allowCheckin).toBe(true);
        expect(result.alreadyCheckedInIssue).toBe(false);
        expect(result.attendeeCheckedIn).toBe(true);
        expect(result.checkedInGuestCount).toBe(1);
        expect(result.checkInTimingIssue).toBe(false);
        expect(result.guestCount).toBe(2);
        expect(result.remainingGuestCount).toBe(1);
      }),
  );

  it.effect(
    'records check-in and increments the option counter for an organizer',
    () =>
      Effect.gen(function* () {
        const nowIso = '2026-09-15T12:00:00.000Z';
        const { databaseLayer, transactionCommands, updateCalls } =
          createCurrentCheckInDatabase({
            mode: 'checkIn',
            organizer: true,
            registration: {
              checkedInGuestCount: 0,
              checkInTime: null,
              event: {
                start: new Date('2026-09-15T12:30:00.000Z'),
              },
              eventId: 'event-1',
              guestCount: 0,
              id: 'registration-1',
              registrationOptionId: 'option-1',
              status: 'CONFIRMED',
              userId: 'attendee-1',
            },
          });
        const result = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: 0, registrationId: 'registration-1' },
          handlerOptions('events.checkInRegistration'),
        ).pipe(
          Effect.provide(createSqlContextLayer({ databaseLayer, nowIso })),
        );

        expect(result.alreadyCheckedIn).toBe(false);
        expect(result.checkInTime).toBe(nowIso);
        expect(updateCalls).toEqual(['registration', 'option']);
        expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );

  it.effect('refuses check-in while the source transfer is active', () =>
    Effect.gen(function* () {
      const { databaseLayer, transactionCommands } =
        createCurrentCheckInDatabase({
          activeTransferId: 'transfer-1',
          registration: {
            checkedInGuestCount: 0,
            checkInTime: null,
            event: { start: new Date(Date.now() + 30 * 60 * 1000) },
            eventId: 'event-1',
            guestCount: 0,
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            userId: 'attendee-1',
          },
        });
      const error = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        { guestCheckInCount: 0, registrationId: 'registration-1' },
        handlerOptions('events.checkInRegistration'),
      ).pipe(
        Effect.flip,
        Effect.provide(
          createSqlContextLayer({
            databaseLayer,
            user: createUser({ permissions: ['events:organizeAll'] }),
          }),
        ),
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toContain('active transfer');
      expect(transactionCommands).toEqual([]);
    }),
  );

  it.effect(
    'rolls back check-in when a transfer becomes active under the registration lock',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transactionCommands, updateCalls } =
          createCurrentCheckInDatabase({
            mode: 'lockedTransfer',
            registration: {
              checkedInGuestCount: 0,
              checkInTime: null,
              event: {
                start: new Date(Date.now() + 30 * 60 * 1000),
              },
              eventId: 'event-1',
              guestCount: 0,
              id: 'registration-1',
              registrationOptionId: 'option-1',
              status: 'CONFIRMED',
              userId: 'attendee-1',
            },
          });
        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: 0, registrationId: 'registration-1' },
          handlerOptions('events.checkInRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain('active transfer');
        expect(updateCalls).toEqual([]);
        expect(transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
  );

  it.effect('records selected guest check-ins with the attendee check-in', () =>
    Effect.gen(function* () {
      const { databaseLayer, transactionCommands, updateCalls } =
        createCurrentCheckInDatabase({
          guestCheckInCount: 2,
          mode: 'checkIn',
          organizer: true,
          registration: {
            checkedInGuestCount: 0,
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 30 * 60 * 1000),
            },
            eventId: 'event-1',
            guestCount: 2,
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            userId: 'attendee-1',
          },
        });
      const result = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        {
          guestCheckInCount: 2,
          registrationId: 'registration-1',
        },
        handlerOptions('events.checkInRegistration'),
      ).pipe(Effect.provide(createSqlContextLayer({ databaseLayer })));

      expect(result.alreadyCheckedIn).toBe(false);
      expect(updateCalls).toEqual(['registration', 'option']);
      expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
    }),
  );

  it.effect(
    'rejects negative guest check-in counts before reading registration state',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, queries, transactionCommands } =
          createCurrentCheckInDatabase({});
        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: -1, registrationId: 'registration-1' },
          handlerOptions('events.checkInRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Guest check-in count must be a non-negative integer',
        );
        expect(queries).toEqual([]);
        expect(transactionCommands).toEqual([]);
      }),
  );

  it.effect(
    'rejects guest check-in counts above remaining guests before writing',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transactionCommands } =
          createCurrentCheckInDatabase({
            organizer: true,
            registration: {
              checkedInGuestCount: 1,
              checkInTime: null,
              event: {
                start: new Date(Date.now() + 30 * 60 * 1000),
              },
              eventId: 'event-1',
              guestCount: 2,
              id: 'registration-1',
              registrationOptionId: 'option-1',
              status: 'CONFIRMED',
              userId: 'attendee-1',
            },
          });
        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: 2, registrationId: 'registration-1' },
          handlerOptions('events.checkInRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Guest check-in count exceeds remaining guests',
        );
        expect(transactionCommands).toEqual([]);
      }),
  );

  it.effect('rejects check-in before the pre-start window opens', () =>
    Effect.gen(function* () {
      const { databaseLayer, transactionCommands } =
        createCurrentCheckInDatabase({
          registration: {
            checkedInGuestCount: 0,
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 2 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            guestCount: 0,
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            userId: 'attendee-1',
          },
        });
      const error = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        { guestCheckInCount: 0, registrationId: 'registration-1' },
        handlerOptions('events.checkInRegistration'),
      ).pipe(
        Effect.flip,
        Effect.provide(
          createSqlContextLayer({
            databaseLayer,
            user: createUser({ permissions: ['events:organizeAll'] }),
          }),
        ),
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe('Check-in is not open for this event yet');
      expect(transactionCommands).toEqual([]);
    }),
  );

  it.effect('treats duplicate check-in as an idempotent success', () =>
    Effect.gen(function* () {
      const checkInTime = new Date('2026-09-18T09:45:00.000Z');
      const { databaseLayer, transactionCommands } =
        createCurrentCheckInDatabase({
          organizer: true,
          registration: {
            checkedInGuestCount: 0,
            checkInTime,
            event: {
              start: new Date(Date.now() + 2 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            guestCount: 0,
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            userId: 'attendee-1',
          },
        });
      const result = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        { guestCheckInCount: 0, registrationId: 'registration-1' },
        handlerOptions('events.checkInRegistration'),
      ).pipe(Effect.provide(createSqlContextLayer({ databaseLayer })));

      expect(result).toEqual({
        alreadyCheckedIn: true,
        checkInTime: '2026-09-18T09:45:00.000Z',
      });
      expect(transactionCommands).toEqual([]);
    }),
  );

  it.effect('rejects users checking in their own registration', () =>
    Effect.gen(function* () {
      const { databaseLayer } = createCurrentCheckInDatabase({
        organizer: true,
        registration: {
          checkedInGuestCount: 0,
          checkInTime: null,
          event: {
            start: new Date(Date.now() + 30 * 60 * 1000),
          },
          eventId: 'event-1',
          guestCount: 0,
          id: 'registration-1',
          registrationOptionId: 'option-1',
          status: 'CONFIRMED',
          userId: 'scanner-1',
        },
      });
      const error = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        { guestCheckInCount: 0, registrationId: 'registration-1' },
        handlerOptions('events.checkInRegistration'),
      ).pipe(
        Effect.flip,
        Effect.provide(createSqlContextLayer({ databaseLayer })),
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Users cannot check in their own registration',
      );
    }),
  );

  for (const status of nonConfirmedRegistrationStatuses) {
    it.effect(`rejects direct check-in for ${status} registrations`, () =>
      Effect.gen(function* () {
        const { databaseLayer, transactionCommands } =
          createCurrentCheckInDatabase({
            registration: {
              checkedInGuestCount: 0,
              checkInTime: null,
              event: {
                start: new Date(Date.now() + 30 * 60 * 1000),
              },
              eventId: 'event-1',
              guestCount: 0,
              id: 'registration-1',
              registrationOptionId: 'option-1',
              status,
              userId: 'attendee-1',
            },
          });
        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: 0, registrationId: 'registration-1' },
          handlerOptions('events.checkInRegistration'),
        ).pipe(
          Effect.flip,
          Effect.provide(
            createSqlContextLayer({
              databaseLayer,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Only confirmed registrations can be checked in',
        );
        expect(transactionCommands).toEqual([]);
      }),
    );
  }
});
