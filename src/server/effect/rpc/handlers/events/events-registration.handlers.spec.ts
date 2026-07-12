import type Stripe from 'stripe';

import { describe, expect, it, vi } from '@effect/vitest';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Cause, ConfigProvider, Effect, Exit, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { SqlError, UniqueViolation } from 'effect/unstable/sql/SqlError';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  activeEventRegistrationUniqueIndexName,
  addonToEventRegistrationOptions,
  emailOutbox,
  eventAddons,
  eventRegistrationAddonFulfillmentEvents,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrations,
  registrationAcquisitionComponents,
  registrationAcquisitionPayments,
  registrationAcquisitionRefundAllocations,
  registrationAcquisitions,
  registrationTransfers,
  rolesToTenantUsers,
  tenants,
  tenantStripeTaxRates,
  transactions,
  userDiscountCards,
  users,
  usersToTenants,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { RegistrationAcquisitionWriteError } from '../../../../registrations/registration-acquisition-write';
import { RegistrationTransferMutationConflict } from '../../../../registrations/registration-transfer-mutation-guard';
import { StripeClient } from '../../../../stripe-client';
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

type StripeClientDouble = Pick<Stripe, 'checkout' | 'refunds'>;

const createStripeClientDouble = ({
  createCheckoutSession = vi.fn(),
  expireCheckoutSession = vi.fn((sessionId: string) =>
    Promise.resolve({
      id: sessionId,
      status: 'expired',
    } as Stripe.Checkout.Session),
  ),
  retrieveCheckoutSession = vi.fn((sessionId: string) =>
    Promise.resolve({
      id: sessionId,
      status: 'open',
    } as Stripe.Checkout.Session),
  ),
}: {
  createCheckoutSession?: ReturnType<typeof vi.fn>;
  expireCheckoutSession?: ReturnType<typeof vi.fn>;
  retrieveCheckoutSession?: ReturnType<typeof vi.fn>;
} = {}): StripeClientDouble =>
  ({
    checkout: {
      sessions: {
        create: createCheckoutSession,
        expire: expireCheckoutSession,
        retrieve: retrieveCheckoutSession,
      },
    },
    refunds: {
      create: vi.fn(),
    },
  }) as StripeClientDouble;

const emptyHandlerOptions = {
  headers: Headers.fromInput({}),
};

const registrationConfigProviderLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: {
      BASE_URL: 'https://deployment.example',
      NODE_ENV: 'production',
      RESEND_API_KEY: 're_test_123',
    },
  }),
);

const tenant = {
  cancellationDeadlineHoursBeforeStart: 0,
  currency: 'EUR' as const,
  defaultLocation: null,
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
  locale: 'en',
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
} = {}) => ({
  attributes: [],
  auth0Id: `auth0|${id}`,
  communicationEmail: `${id}.contact@example.com`,
  email: `${id}@example.com`,
  firstName: 'Scan',
  iban: null,
  id,
  lastName: 'User',
  paypalEmail: null,
  permissions,
  roleIds: [],
});

const createContextLayer = ({
  database,
  nowIso,
  stripe = createStripeClientDouble(),
  tenant: currentTenant = tenant,
  user = createUser(),
}: {
  database: object;
  nowIso?: string;
  stripe?: StripeClientDouble;
  tenant?: typeof tenant;
  user?: ReturnType<typeof createUser>;
}) => {
  const databaseWithDefaults = {
    ...database,
    query: {
      registrationTransfers: {
        findFirst: () => Effect.succeed(undefined),
      },
      ...('query' in database &&
        typeof database.query === 'object' &&
        database.query),
    },
  };
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
    Layer.succeed(Database, databaseWithDefaults as DatabaseClient),
    Layer.succeed(StripeClient, stripe as Stripe),
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: {
          BASE_URL: 'https://app.example',
          NODE_ENV: 'production',
          RESEND_API_KEY: 're_test_123',
          ...(nowIso && { E2E_NOW_ISO: nowIso }),
        },
      }),
    ),
  );
};

const scannedRegistration = {
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

const expectCounterDecrement = (
  updateSet: unknown,
  field: 'confirmedSpots' | 'reservedSpots' | 'waitlistSpots',
  amount: number,
) => {
  const sqlUpdate = (
    updateSet as Record<string, { queryChunks?: readonly unknown[] }>
  )[field];

  expect(sqlUpdate).toEqual(
    expect.objectContaining({
      queryChunks: expect.arrayContaining([amount]),
    }),
  );
};

const rowsWithFor = <A>(rows: readonly A[]) =>
  Object.assign(Effect.succeed(rows), {
    for: () => Effect.succeed(rows),
  });

const orderedRows = <A>(rows: readonly A[]) => ({
  for: () => Effect.succeed(rows),
  limit: () => rowsWithFor(rows),
});

interface AcquisitionSourceTransaction {
  readonly amount?: number;
  readonly appFee?: null | number;
  readonly currency?: string;
  readonly eventId?: string;
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

const createRegistrationMutationGuardSelect = ({
  activeTransfers = [],
  status = 'CONFIRMED',
}: {
  activeTransfers?: readonly {
    id: string;
    recipientRegistrationId: null | string;
    sourceRegistrationId: string;
    status: 'checkout_pending' | 'open' | 'refund_failed' | 'refund_pending';
  }[];
  status?: 'CONFIRMED' | 'PENDING';
} = {}) => ({
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        for: () =>
          Effect.succeed(
            table === eventRegistrations
              ? [{ status }]
              : table === registrationTransfers
                ? activeTransfers
                : [],
          ),
      }),
    }),
  }),
});

const createCancellationTransactionSelect = ({
  activeTransfers = [],
  addonLots = [],
  addonPurchases = [],
  cancellationDeadlineHoursBeforeStart = 0,
  checkInTime = null,
  eventId = 'event-1',
  guestCount = 0,
  id = 'registration-1',
  refundFeesOnCancellation = true,
  registrationOptionCancellationDeadlineHoursBeforeStart = null,
  registrationOptionId = 'option-1',
  registrationOptionRefundFeesOnCancellation = null,
  status,
  transactions: currentTransactions = [],
  userId = 'attendee-1',
}: {
  activeTransfers?: readonly {
    id: string;
    recipientRegistrationId: null | string;
    sourceRegistrationId: string;
    status: 'checkout_pending' | 'open' | 'refund_failed' | 'refund_pending';
  }[];
  addonLots?: readonly Record<string, unknown>[];
  addonPurchases?: readonly object[];
  cancellationDeadlineHoursBeforeStart?: number;
  checkInTime?: Date | null;
  eventId?: string;
  guestCount?: number;
  id?: string;
  refundFeesOnCancellation?: boolean;
  registrationOptionCancellationDeadlineHoursBeforeStart?: null | number;
  registrationOptionId?: string;
  registrationOptionRefundFeesOnCancellation?: boolean | null;
  status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
  transactions?: readonly AcquisitionSourceTransaction[];
  userId?: string;
}) => {
  const acquisitionRows = createAcquisitionRows({
    addonLots,
    eventId,
    guestCount,
    registrationId: id,
    transactions: currentTransactions,
    userId,
  });

  return {
    select: (selection?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => {
          const lockedRows = (): readonly unknown[] => {
            if (table === eventRegistrations) {
              return [
                {
                  checkInTime,
                  eventId,
                  guestCount,
                  id,
                  registrationOptionId,
                  status,
                  userId,
                },
              ];
            }
            if (table === transactions) {
              if (
                selection &&
                ('stripeRefundApplicationFee' in selection ||
                  'applicationFeeRefunded' in selection)
              ) {
                return [];
              }
              return currentTransactions;
            }
            if (table === eventRegistrationAddonPurchases) {
              return addonPurchases;
            }
            if (table === eventRegistrationAddonPurchaseLots) {
              return addonLots;
            }
            if (table === registrationTransfers) {
              return activeTransfers;
            }
            if (table === registrationAcquisitions) {
              return status === 'CONFIRMED'
                ? [acquisitionRows.acquisition]
                : [];
            }
            if (table === registrationAcquisitionPayments) {
              return status === 'CONFIRMED' ? acquisitionRows.payments : [];
            }
            if (table === registrationAcquisitionComponents) {
              return status === 'CONFIRMED' ? acquisitionRows.components : [];
            }
            if (table === registrationAcquisitionRefundAllocations) {
              return [];
            }
            if (table === tenants) {
              return [
                {
                  cancellationDeadlineHoursBeforeStart,
                  refundFeesOnCancellation,
                  stripeAccountId: 'acct_persisted',
                },
              ];
            }
            if (table === eventRegistrationOptions) {
              return [
                {
                  cancellationDeadlineHoursBeforeStart:
                    registrationOptionCancellationDeadlineHoursBeforeStart,
                  refundFeesOnCancellation:
                    registrationOptionRefundFeesOnCancellation,
                },
              ];
            }
            return [];
          };
          const rows = lockedRows();
          return Object.assign(Effect.succeed([]), {
            for: () => Effect.succeed(rows),
            limit: () => rowsWithFor(rows),
            orderBy: () => orderedRows(rows),
          });
        },
      }),
    }),
  };
};

const createGuestCancellationDatabase = ({
  status,
  waitlistRegistrations = [],
}: {
  status: 'CONFIRMED' | 'PENDING';
  waitlistRegistrations?: readonly {
    id: string;
    status: 'WAITLIST';
    user: {
      communicationEmail: string;
      email: string;
    };
  }[];
}) => {
  const insertedEmails: Record<string, unknown>[] = [];
  const updateSets: unknown[] = [];
  const currentTransactions =
    status === 'PENDING'
      ? [
          {
            amount: 1000,
            currency: 'EUR',
            id: 'transaction-1',
            method: 'stripe',
            status: 'pending',
            stripeAccountId: 'acct_123',
            stripeChargeId: null,
            stripeCheckoutCancellationRequestedAt: null as Date | null,
            stripeCheckoutSessionId: 'checkout-1',
            stripePaymentIntentId: null,
            type: 'registration',
          },
        ]
      : [];
  const tx = {
    ...createCancellationTransactionSelect({
      guestCount: 2,
      status,
      transactions: currentTransactions,
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === emailOutbox) {
          insertedEmails.push(values);
        }
        return {
          onConflictDoNothing: () => Effect.void,
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => {
        if (
          table === transactions &&
          values !== null &&
          typeof values === 'object' &&
          'stripeCheckoutCancellationRequestedAt' in values &&
          values.stripeCheckoutCancellationRequestedAt instanceof Date
        ) {
          const pendingTransaction = currentTransactions[0];
          if (pendingTransaction) {
            pendingTransaction.stripeCheckoutCancellationRequestedAt =
              values.stripeCheckoutCancellationRequestedAt;
          }
        }
        updateSets.push(values);
        return {
          where: () => ({
            returning: () =>
              table === eventRegistrations ||
              table === eventRegistrationOptions ||
              table === transactions
                ? Effect.succeed([{ id: 'updated' }])
                : Effect.succeed([]),
          }),
        };
      },
    }),
  };
  const database = {
    query: {
      eventRegistrations: {
        findFirst: () =>
          Effect.succeed({
            checkedInGuestCount: 0,
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
              title: 'City tour',
            },
            eventId: 'event-1',
            guestCount: 2,
            id: 'registration-1',
            registrationOption: {
              eventRegistrations: waitlistRegistrations,
              id: 'option-1',
            },
            registrationOptionId: 'option-1',
            status,
            transactions: currentTransactions,
            user: {
              communicationEmail: 'attendee.contact@example.com',
              email: 'attendee@example.com',
            },
            userId: 'attendee-1',
          }),
      },
    },
    transaction: vi.fn((callback: (tx: typeof tx) => unknown) => callback(tx)),
  };

  return { database, insertedEmails, updateSets };
};

const createStripeAddonOnlyCancellationDatabase = () => {
  const insertedRefundAllocations: Record<string, unknown>[] = [];
  const insertedTransactions: Record<string, unknown>[] = [];
  const sourceTransaction = {
    amount: 1000,
    appFee: 100,
    currency: 'EUR' as const,
    eventId: 'event-1',
    eventRegistrationId: 'registration-1',
    id: 'addon-transaction-1',
    method: 'stripe' as const,
    status: 'successful' as const,
    stripeAccountId: 'acct_persisted',
    stripeChargeId: 'ch_addon',
    stripeCheckoutSessionId: 'checkout-addon-1',
    stripeFee: 50,
    stripeNetAmount: 850,
    stripePaymentIntentId: 'pi_addon',
    targetUserId: 'attendee-1',
    tenantId: 'tenant-1',
    type: 'addon' as const,
  };
  const purchase = {
    addonId: 'addon-1',
    cancelledQuantity: 0,
    id: 'purchase-1',
    includedQuantity: 0,
    purchasedQuantity: 4,
    quantity: 4,
    redeemedQuantity: 1,
  };
  const lot = {
    applicationFeeAmount: 100,
    baseAmount: 1000,
    cancelledQuantity: 0,
    currency: 'EUR' as const,
    grossAmount: 1000,
    id: 'lot-1',
    netAmount: 850,
    paymentAllocationFinalizedAt: new Date('2026-07-10T12:00:00.000Z'),
    purchaseId: purchase.id,
    quantity: 4,
    redeemedQuantity: 1,
    refundAllocatedApplicationFeeAmount: 0,
    refundAllocatedGrossAmount: 0,
    refundAllocatedNetAmount: 0,
    refundAllocatedQuantity: 0,
    sourceTransactionId: sourceTransaction.id,
    stripeFeeAmount: 50,
    taxRateInclusive: null,
    taxRatePercentage: null,
    unitPrice: 250,
  };
  const tx = {
    ...createCancellationTransactionSelect({
      addonLots: [lot],
      addonPurchases: [purchase],
      status: 'CONFIRMED',
      transactions: [sourceTransaction],
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === transactions) {
          insertedTransactions.push(values);
          return {
            onConflictDoNothing: () => ({
              returning: () => Effect.succeed([{ id: String(values['id']) }]),
            }),
          };
        }
        if (table === registrationAcquisitionRefundAllocations) {
          insertedRefundAllocations.push(values);
        }
        return Effect.void;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (
            table === eventRegistrationAddonPurchaseLots ||
            table === eventRegistrationAddonFulfillmentEvents
          ) {
            return Effect.void;
          }
          if (
            table === eventRegistrationAddonPurchases &&
            'refundAllocatedPurchasedQuantity' in values
          ) {
            return Effect.void;
          }
          if (table === transactions) {
            return {
              returning: () => Effect.succeed([]),
            };
          }
          return {
            returning: () => Effect.succeed([{ id: 'updated' }]),
          };
        },
      }),
    }),
  };
  const database = {
    query: {
      eventRegistrations: {
        findFirst: () =>
          Effect.succeed({
            addonPurchases: [
              {
                addonId: purchase.addonId,
                purchasedQuantity: purchase.purchasedQuantity,
                quantity: purchase.quantity,
              },
            ],
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            guestCount: 0,
            id: 'registration-1',
            registrationOption: {
              cancellationDeadlineHoursBeforeStart: 0,
              id: 'option-1',
              refundFeesOnCancellation: true,
            },
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            transactions: [sourceTransaction],
            userId: 'attendee-1',
          }),
      },
    },
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          table === transactions
            ? {
                limit: () => Effect.succeed([sourceTransaction]),
              }
            : Effect.succeed(
                table === eventRegistrationAddonPurchaseLots
                  ? [{ sourceTransactionId: sourceTransaction.id }]
                  : [],
              ),
      }),
    }),
    transaction: vi.fn((callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  return { database, insertedRefundAllocations, insertedTransactions };
};

const createTransferDatabase = ({
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
  registrationOptionPrice = 0,
  registrationOptionRoleIds = ['participant-role-1'],
  sourceRefunds = [],
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
  discountProviders?: {
    esnCard: {
      config: Record<string, never>;
      status: 'disabled' | 'enabled';
    };
  };
  existingTargetRegistration?: null | { id: string };
  lockedActiveTransfers?: readonly {
    id: string;
    recipientRegistrationId: null | string;
    sourceRegistrationId: string;
    status: 'checkout_pending' | 'open' | 'refund_failed' | 'refund_pending';
  }[];
  lockedEventStart?: Date;
  lockedEventStatus?: 'APPROVED' | 'CANCELLED' | 'DRAFT' | 'REVIEW';
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
  recipientDiscountCards?: readonly {
    type: 'esnCard';
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
  registrationOptionPrice?: number;
  registrationOptionRoleIds?: string[];
  sourceRefunds?: readonly {
    amount: number;
    method: 'cash' | 'stripe';
    sourceTransactionId: null | string;
    status: 'cancelled' | 'pending' | 'successful';
    stripeRefundStatus: 'failed' | 'pending' | 'succeeded';
  }[];
  targetTenantUser?: null | { id: string; roles: readonly { id: string }[] };
  targetUser?: null | {
    communicationEmail?: string;
    email?: string;
    firstName?: string;
    id: string;
    lastName?: string;
  };
  updateError?: unknown;
} = {}) => {
  const insertedEmails: Record<string, unknown>[] = [];
  const lockOrder: string[] = [];
  let eventRegistrationReadCount = 0;
  let transactionReadCount = 0;
  const updateSets: unknown[] = [];
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
  const select = () => ({
    from: (table: unknown) => {
      if (table === users) {
        return {
          where: () => ({
            limit: () => Effect.succeed(targetUser ? [targetUser] : []),
          }),
        };
      }
      if (table === usersToTenants) {
        const lockedMemberships =
          targetTenantUser && lockedTargetMembership
            ? [
                { id: 'source-tenant-user-1', userId: 'attendee-1' },
                { id: targetTenantUser.id, userId: targetUser?.id ?? '' },
              ]
            : [{ id: 'source-tenant-user-1', userId: 'attendee-1' }];
        return {
          where: () => ({
            orderBy: () => ({
              for: () => {
                lockOrder.push('memberships');
                return Effect.succeed(lockedMemberships);
              },
            }),
          }),
        };
      }
      if (table === rolesToTenantUsers) {
        const roleIds =
          lockedTargetRoleIds ??
          targetTenantUser?.roles.map(({ id }) => id) ??
          [];
        return {
          where: () => ({
            orderBy: () => ({
              for: () => {
                lockOrder.push('roles');
                return Effect.succeed(roleIds.map((roleId) => ({ roleId })));
              },
            }),
          }),
        };
      }
      if (table === eventRegistrations) {
        return {
          innerJoin: () => ({
            where: () => ({
              limit: () => Effect.succeed(activeTargetRegistrations),
            }),
          }),
          where: () => ({
            for: () => {
              lockOrder.push('registration');
              afterRegistrationLock?.();
              return Effect.succeed(
                registration
                  ? [
                      {
                        checkedInGuestCount:
                          registration.checkedInGuestCount ?? 0,
                        checkInTime: registration.checkInTime,
                        eventId: registration.eventId,
                        guestCount: registration.guestCount ?? 0,
                        registrationOptionId: registration.registrationOptionId,
                        status: registration.status,
                        userId: registration.userId,
                      },
                    ]
                  : [],
              );
            },
          }),
        };
      }
      if (table === registrationTransfers) {
        return {
          where: () => ({
            for: () => Effect.succeed(lockedActiveTransfers),
          }),
        };
      }
      if (table === registrationAcquisitions) {
        return {
          where: () => ({
            orderBy: () => orderedRows([acquisitionRows.acquisition]),
          }),
        };
      }
      if (table === registrationAcquisitionPayments) {
        return {
          where: () => ({
            orderBy: () => orderedRows(acquisitionRows.payments),
          }),
        };
      }
      if (table === registrationAcquisitionComponents) {
        return {
          where: () => ({
            orderBy: () => orderedRows(acquisitionRows.components),
          }),
        };
      }
      if (table === transactions) {
        const sourcePayments = normalizedSourceTransactions.filter(
          (transaction) =>
            transaction.status === 'successful' &&
            transaction.amount > 0 &&
            (transaction.type === 'registration' ||
              transaction.type === 'addon'),
        );
        const rows =
          transactionReadCount++ === 0 ? sourcePayments : sourceRefunds;
        return {
          where: () => ({
            for: () => Effect.succeed(rows),
            orderBy: () => ({
              for: () => Effect.succeed(rows),
            }),
          }),
        };
      }
      if (table === eventRegistrationOptions) {
        return {
          innerJoin: () => ({
            innerJoin: () => ({
              where: () => ({
                for: () => {
                  lockOrder.push('terms');
                  return Effect.succeed([
                    {
                      discountProviders,
                      eventStart:
                        lockedEventStart ??
                        registration?.event?.start ??
                        new Date(Date.now() + 24 * 60 * 60 * 1000),
                      eventStatus: lockedEventStatus,
                      optionPrice: registrationOptionPrice,
                      optionRoleIds:
                        lockedOptionRoleIds ?? registrationOptionRoleIds,
                      optionStripeTaxRateId: null,
                      optionTitle: 'Participant ticket',
                      optionTransferDeadlineHoursBeforeStart:
                        lockedOptionTransferDeadlineHoursBeforeStart,
                      stripeAccountId: null,
                      tenantTransferDeadlineHoursBeforeStart:
                        lockedTenantTransferDeadlineHoursBeforeStart,
                    },
                  ]);
                },
              }),
            }),
          }),
        };
      }
      if (table === eventRegistrationAddonPurchases) {
        return {
          innerJoin: () => ({
            where: () => ({
              orderBy: () => ({
                for: () => Effect.succeed(normalizedBundleAddonPurchases),
              }),
            }),
          }),
        };
      }
      if (table === eventRegistrationAddonPurchaseLots) {
        return {
          where: () => ({
            orderBy: () => ({
              for: () => Effect.succeed(normalizedBundleLots),
            }),
          }),
        };
      }
      if (table === userDiscountCards) {
        return {
          where: () => ({
            for: () => Effect.succeed(recipientDiscountCards),
          }),
        };
      }
      if (table === eventRegistrationOptionDiscounts) {
        return {
          where: () => ({
            for: () => Effect.succeed(registrationOptionDiscounts),
          }),
        };
      }
      return {
        where: () =>
          Object.assign(Effect.succeed([]), {
            for: () => Effect.succeed([]),
            limit: () => Effect.succeed([]),
            orderBy: () => ({ for: () => Effect.succeed([]) }),
          }),
      };
    },
  });
  const update = (table: unknown) => ({
    set: (values: unknown) => {
      updateSets.push(values);
      return {
        where: () => ({
          returning: () => {
            if (updateError) {
              return Effect.fail(updateError);
            }
            if (table === eventRegistrations) {
              return Effect.succeed([{ id: 'registration-1' }]);
            }
            return Effect.succeed([]);
          },
        }),
      };
    },
  });
  const insert = (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      if (table === emailOutbox) {
        insertedEmails.push(values);
      }
      return Object.assign(Effect.void, {
        onConflictDoNothing: () => Effect.void,
      });
    },
  });
  const transaction = {
    insert,
    query: {
      eventRegistrations: {
        findMany: () =>
          Effect.succeed(
            concurrentTargetRegistration ? [concurrentTargetRegistration] : [],
          ),
      },
    },
    select,
    update,
  };
  const database = {
    query: {
      eventRegistrationOptions: {
        findFirst: () =>
          Effect.succeed({
            roleIds: registrationOptionRoleIds,
          }),
      },
      eventRegistrations: {
        findFirst: vi.fn(() => {
          const isSourceRegistrationRead =
            eventRegistrationReadCount++ % 2 === 0;
          if (!isSourceRegistrationRead) {
            return Effect.succeed(existingTargetRegistration);
          }
          return Effect.succeed(
            registration
              ? {
                  ...registration,
                  user: registration.user
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
                }
              : null,
          );
        }),
        findMany: () => Effect.succeed(organizerRegistrations),
      },
      users: {
        findFirst: () => Effect.succeed(targetUser),
      },
      usersToTenants: {
        findFirst: () => Effect.succeed(targetTenantUser),
      },
    },
    select,
    transaction: (
      run: (currentTransaction: typeof transaction) => Effect.Effect<unknown>,
    ) => {
      transactionReadCount = 0;
      return run(transaction);
    },
    update,
  };

  return {
    database,
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
};

const previewEventRegistrationTransfer = Effect.fn(
  'previewEventRegistrationTransfer',
)(function* ({
  eventId = 'event-1',
  registrationId = 'registration-1',
  targetUserId = 'target-user-1',
}: {
  eventId?: string;
  registrationId?: string;
  targetUserId?: string;
} = {}) {
  const preview = yield* eventRegistrationHandlers[
    'events.previewEventRegistrationTransfer'
  ]({ eventId, registrationId, targetUserId }, emptyHandlerOptions);
  return preview;
});

const previewAndTransferEventRegistration = Effect.fn(
  'previewAndTransferEventRegistration',
)(function* ({
  eventId = 'event-1',
  registrationId = 'registration-1',
  targetUserId = 'target-user-1',
}: {
  eventId?: string;
  registrationId?: string;
  targetUserId?: string;
} = {}) {
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
    emptyHandlerOptions,
  );
  return preview;
});

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
} = {}) => {
  const tenantUserRows = [
    {
      email: 'current@example.com',
      firstName: 'Current',
      id: 'tenant-user-current',
      lastName: 'Owner',
      userId: 'attendee-1',
    },
    {
      email: 'alex@example.com',
      firstName: 'Alex',
      id: 'tenant-user-eligible',
      lastName: 'Able',
      userId: 'target-user-1',
    },
    {
      email: 'registered@example.com',
      firstName: 'Already',
      id: 'tenant-user-active',
      lastName: 'Registered',
      userId: 'already-registered-user',
    },
    {
      email: 'other@example.com',
      firstName: 'Other',
      id: 'tenant-user-ineligible',
      lastName: 'Role',
      userId: 'other-user-1',
    },
  ];
  const database = {
    query: {
      eventRegistrationOptions: {
        findFirst: () =>
          Effect.succeed({
            roleIds: registrationOptionRoleIds,
          }),
      },
      eventRegistrations: {
        findFirst: () =>
          Effect.succeed({
            appliedDiscountedPrice: hasSourceDiscount ? 0 : null,
            appliedDiscountType: hasSourceDiscount ? 'esnCard' : null,
            checkInTime: hasCheckedInHistory ? new Date() : null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            transactions: hasPaidSource
              ? [
                  {
                    amount: 1200,
                    status: 'successful',
                    type: 'registration',
                  },
                ]
              : [],
            userId: 'attendee-1',
          }),
        findMany: vi
          .fn()
          .mockReturnValueOnce(
            Effect.succeed([
              {
                id: 'organizer-registration-1',
                registrationOption: {
                  organizingRegistration: true,
                },
              },
            ]),
          )
          .mockReturnValueOnce(
            Effect.succeed([
              {
                userId: 'already-registered-user',
              },
            ]),
          ),
      },
      usersToTenants: {
        findMany: () =>
          Effect.succeed([
            {
              id: 'tenant-user-current',
              roles: [{ id: 'participant-role-1' }],
              user: {
                email: 'current@example.com',
                firstName: 'Current',
                id: 'attendee-1',
                lastName: 'Owner',
              },
              userId: 'attendee-1',
            },
            {
              id: 'tenant-user-eligible',
              roles: [{ id: 'participant-role-1' }],
              user: {
                email: 'alex@example.com',
                firstName: 'Alex',
                id: 'target-user-1',
                lastName: 'Able',
              },
              userId: 'target-user-1',
            },
            {
              id: 'tenant-user-active',
              roles: [{ id: 'participant-role-1' }],
              user: {
                email: 'registered@example.com',
                firstName: 'Already',
                id: 'already-registered-user',
                lastName: 'Registered',
              },
              userId: 'already-registered-user',
            },
            {
              id: 'tenant-user-ineligible',
              roles: [{ id: 'other-role-1' }],
              user: {
                email: 'other@example.com',
                firstName: 'Other',
                id: 'other-user-1',
                lastName: 'Role',
              },
              userId: 'other-user-1',
            },
          ]),
      },
    },
    select: () => ({
      from: (table: unknown) => {
        if (table === usersToTenants) {
          return {
            innerJoin: () => ({
              where: () => ({
                limit: () => Effect.succeed(tenantUserRows),
              }),
            }),
          };
        }

        if (table === rolesToTenantUsers) {
          return {
            where: () =>
              Effect.succeed([
                {
                  roleId: 'participant-role-1',
                  userTenantId: 'tenant-user-current',
                },
                {
                  roleId: 'participant-role-1',
                  userTenantId: 'tenant-user-eligible',
                },
                {
                  roleId: 'participant-role-1',
                  userTenantId: 'tenant-user-active',
                },
                {
                  roleId: 'other-role-1',
                  userTenantId: 'tenant-user-ineligible',
                },
              ]),
          };
        }

        throw new Error('Unexpected select table');
      },
    }),
  };

  return database;
};

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
        const includedPurchase = {
          addOn: { title: 'Included lunch' },
          addonId: 'addon-included',
          cancelledQuantity: 0,
          includedQuantity: 2,
          purchasedQuantity: 1,
          quantity: 3,
          redeemedQuantity: 0,
          unitPrice: 0,
        };
        const baseRegistration = {
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
        let statusReadCount = 0;
        const findMany = vi.fn(() => {
          const readIndex = statusReadCount++;
          const addonPurchaseOrders =
            readIndex === 1
              ? [
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
                ]
              : [];
          const addonPurchases =
            readIndex === 2
              ? [
                  {
                    ...includedPurchase,
                    cancelledQuantity: 1,
                    redeemedQuantity: 1,
                  },
                ]
              : [includedPurchase];
          return Effect.succeed([
            {
              ...baseRegistration,
              addonPurchaseOrders,
              addonPurchases,
              transactions: baseRegistration.transactions,
            },
          ]);
        });
        const registrationAddOnOptions = [
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
        const database = {
          query: {
            eventRegistrations: { findMany },
          },
          select: () => ({
            from: (table: unknown) => {
              if (table === addonToEventRegistrationOptions) {
                return {
                  innerJoin: () => ({
                    innerJoin: () => ({
                      leftJoin: () => ({
                        where: () => ({
                          orderBy: () =>
                            Effect.succeed(registrationAddOnOptions),
                        }),
                      }),
                    }),
                  }),
                };
              }
              if (table === registrationTransfers) {
                return {
                  where: () => Effect.succeed([]),
                };
              }
              throw new Error('Unexpected registration status select table');
            },
          }),
        };
        const getRegistrationStatus = () =>
          eventRegistrationHandlers['events.getRegistrationStatus'](
            { eventId: 'event-1' },
            emptyHandlerOptions,
          ).pipe(
            Effect.provide(
              createContextLayer({
                database,
                nowIso: now.toISOString(),
              }),
            ),
          );

        const availableResult = yield* getRegistrationStatus();
        const availableRegistration = availableResult.registrations[0];
        expect(availableRegistration).toBeDefined();
        expect(findMany).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            where: {
              eventId: 'event-1',
              status: { NOT: 'CANCELLED' },
              tenantId: 'tenant-1',
              userId: 'scanner-1',
            },
          }),
        );
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
      }),
  );
});

describe('event registration trusted URLs', () => {
  it.effect(
    'ignores forged request origins when creating Stripe checkout return URLs',
    () =>
      Effect.gen(function* () {
        const createCheckoutSession = vi.fn(() =>
          Promise.resolve({
            id: 'cs_test_123',
            payment_intent: null,
            url: 'https://checkout.stripe.test/cs_test_123',
          }),
        );
        const stripe = createStripeClientDouble({ createCheckoutSession });
        const registrationTransaction = {
          insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) =>
              table === eventRegistrations
                ? {
                    returning: () => Effect.succeed([{ id: 'registration-1' }]),
                  }
                : table === transactions
                  ? {
                      returning: () =>
                        Effect.succeed([
                          {
                            appFee: values['appFee'],
                            currency: values['currency'],
                            id: values['id'],
                            stripeAccountId: values['stripeAccountId'],
                            stripeCheckoutRequest:
                              values['stripeCheckoutRequest'],
                            stripeCheckoutSessionId: null,
                            stripeCheckoutUrl: null,
                          },
                        ]),
                    }
                  : Effect.void,
          }),
          query: {
            eventRegistrations: {
              findMany: () => Effect.succeed([]),
            },
          },
          select: () => ({
            from: (table: unknown) => ({
              where: () => ({
                for: () =>
                  table === tenants
                    ? Effect.succeed([{ stripeAccountId: 'acct_123' }])
                    : table === eventRegistrationOptions
                      ? Effect.succeed([{ stripeTaxRateId: 'txr_123' }])
                      : table === eventRegistrations
                        ? Effect.succeed([{ status: 'PENDING' }])
                        : Effect.succeed([
                            {
                              stripeCheckoutCancellationRequestedAt: null,
                              stripeCheckoutSessionId: null,
                            },
                          ]),
                orderBy: () => ({
                  for: () =>
                    table === tenantStripeTaxRates
                      ? Effect.succeed([
                          {
                            displayName: 'VAT',
                            inclusive: true,
                            percentage: '19',
                            stripeTaxRateId: 'txr_123',
                          },
                        ])
                      : Effect.succeed([]),
                }),
              }),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => ({
                returning: () => Effect.succeed([{ id: 'option-1' }]),
              }),
            }),
          }),
        };
        const database = {
          insert: () => ({
            values: () => Effect.void,
          }),
          query: {
            eventRegistrationOptions: {
              findFirst: () =>
                Effect.succeed({
                  closeRegistrationTime: new Date('2099-01-02T00:00:00.000Z'),
                  confirmedSpots: 0,
                  event: {
                    start: new Date('2099-01-01T12:00:00.000Z'),
                    status: 'APPROVED',
                    tenantId: tenant.id,
                    title: 'Trusted URL event',
                  },
                  eventId: 'event-1',
                  id: 'option-1',
                  isPaid: true,
                  openRegistrationTime: new Date('2000-01-01T00:00:00.000Z'),
                  organizingRegistration: false,
                  price: 1000,
                  questions: [],
                  registrationMode: 'fcfs',
                  reservedSpots: 0,
                  roleIds: [],
                  spots: 10,
                  stripeTaxRateId: 'txr_123',
                }),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
            tenantStripeTaxRates: {
              findFirst: () =>
                Effect.succeed({
                  displayName: 'VAT',
                  inclusive: true,
                  percentage: '19',
                }),
            },
            userDiscountCards: {
              findMany: () => Effect.succeed([]),
            },
          },
          select: () => ({
            from: () => ({
              innerJoin: () => ({
                leftJoin: () => ({
                  where: () => Effect.succeed([]),
                }),
              }),
            }),
          }),
          transaction: (
            run: (
              transaction: typeof registrationTransaction,
            ) => Effect.Effect<unknown>,
          ) => run(registrationTransaction),
          update: () => ({
            set: () => ({
              where: () => Effect.void,
            }),
          }),
        };
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
          attackerOptions,
        ).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(
            createContextLayer({
              database,
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
  });

  it.effect(
    'rejects an already-stale confirmation before reconciliation or cancellation side effects',
    () =>
      Effect.gen(function* () {
        const retrieveCharge = vi.fn();
        const retrievePaymentIntent = vi.fn();
        const stripe = {
          ...createStripeClientDouble(),
          charges: { retrieve: retrieveCharge },
          paymentIntents: { retrieve: retrievePaymentIntent },
        };
        const database = {
          insert: vi.fn(),
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [
                    {
                      addonId: 'addon-1',
                      purchasedQuantity: 1,
                      quantity: 1,
                    },
                  ],
                  id: 'registration-1',
                  status: 'CONFIRMED',
                  transactions: [
                    {
                      amount: 2500,
                      appFee: null,
                      id: 'transaction-1',
                      method: 'stripe',
                      status: 'successful',
                      stripeAccountId: 'acct_123',
                      stripeChargeId: null,
                      stripeFee: null,
                      stripeNetAmount: null,
                      stripePaymentIntentId: 'pi_123',
                      type: 'registration',
                    },
                  ],
                }),
            },
          },
          select: vi.fn(),
          transaction: vi.fn(),
          update: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: true,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(createContextLayer({ database, stripe })),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toContain(
          'nothing was cancelled, no refund was created, and no spots or inventory were released',
        );
        expect(database.select).not.toHaveBeenCalled();
        expect(database.insert).not.toHaveBeenCalled();
        expect(database.update).not.toHaveBeenCalled();
        expect(database.transaction).not.toHaveBeenCalled();
        expect(retrieveCharge).not.toHaveBeenCalled();
        expect(retrievePaymentIntent).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rejects a registration status change after confirmation before any cancellation write',
    () =>
      Effect.gen(function* () {
        const update = vi.fn();
        const insert = vi.fn();
        const tx = {
          ...createCancellationTransactionSelect({ status: 'PENDING' }),
          insert,
          update,
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
                  userId: 'scanner-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toContain(
          'nothing was cancelled, no refund was created, and no spots or inventory were released',
        );
        expect(update).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rejects a registration payment-state change after confirmation before any cancellation write',
    () =>
      Effect.gen(function* () {
        const update = vi.fn();
        const insert = vi.fn();
        const tx = {
          ...createCancellationTransactionSelect({
            status: 'PENDING',
            transactions: [
              {
                id: 'transaction-1',
                method: 'stripe',
                status: 'pending',
                type: 'registration',
              },
            ],
          }),
          insert,
          update,
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'PENDING',
                  transactions: [],
                  userId: 'scanner-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: false,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toContain(
          'nothing was cancelled, no refund was created, and no spots or inventory were released',
        );
        expect(update).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'blocks participant cancellation at the configured tenant deadline without mutating state',
    () =>
      Effect.gen(function* () {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-07-01T09:00:00.000Z'));
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkInTime: null,
                  event: {
                    start: new Date('2026-09-19T09:00:00.000Z'),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOption: {
                    cancellationDeadlineHoursBeforeStart: null,
                    id: 'option-1',
                    refundFeesOnCancellation: null,
                  },
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
                  userId: 'scanner-1',
                }),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.ensuring(Effect.sync(() => vi.useRealTimers())),
          Effect.provide(
            createContextLayer({
              database,
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
        expect(database.transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'allows event organizers to cancel after the participant deadline',
    () =>
      Effect.gen(function* () {
        const updateSets: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({
            cancellationDeadlineHoursBeforeStart: 120,
            status: 'CONFIRMED',
          }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () => {
                    if (
                      table === eventRegistrations ||
                      table === eventRegistrationOptions
                    ) {
                      return Effect.succeed([{ id: 'updated' }]);
                    }
                    return Effect.succeed([]);
                  },
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
                }),
              findMany: () =>
                Effect.succeed([
                  {
                    id: 'organizer-registration-1',
                    registrationOption: {
                      organizingRegistration: true,
                    },
                  },
                ]),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        yield* eventRegistrationHandlers['events.cancelEventRegistration'](
          {
            eventId: 'event-1',
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
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

        expect(updateSets).toEqual([
          { status: 'CANCELLED' },
          expect.objectContaining({ confirmedSpots: expect.anything() }),
        ]);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'rejects event registration cancellation without organizer access',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
                }),
              findMany: () => Effect.succeed([]),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.cancelEventRegistration'
        ](
          {
            eventId: 'event-1',
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('RpcForbiddenError');
        expect(database.transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'requires the separate cancellation capability for organizer add-on cancellation',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () => Effect.succeed({ eventId: 'event-1' }),
              findMany: () =>
                Effect.succeed([
                  {
                    id: 'organizer-registration-1',
                    registrationOption: { organizingRegistration: true },
                  },
                ]),
            },
          },
          transaction: vi.fn(),
        };

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
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('RpcForbiddenError');
        expect(error.permission).toBe('events:cancelRegistrations');
        expect(database.transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'uses a registration option override to allow participant cancellation',
    () =>
      Effect.gen(function* () {
        const updateSets: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({
            cancellationDeadlineHoursBeforeStart: 120,
            registrationOptionCancellationDeadlineHoursBeforeStart: 0,
            status: 'CONFIRMED',
          }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () => {
                    if (
                      table === eventRegistrations ||
                      table === eventRegistrationOptions
                    ) {
                      return Effect.succeed([{ id: 'updated' }]);
                    }
                    return Effect.succeed([]);
                  },
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOption: {
                    cancellationDeadlineHoursBeforeStart: 0,
                    id: 'option-1',
                    refundFeesOnCancellation: null,
                  },
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
              tenant: {
                ...tenant,
                cancellationDeadlineHoursBeforeStart: 120,
              },
            }),
          ),
        );

        expect(updateSets).toEqual([
          { status: 'CANCELLED' },
          expect.objectContaining({ confirmedSpots: expect.anything() }),
        ]);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'cancels confirmed guest registrations and releases buyer plus guest spots',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createGuestCancellationDatabase({
          status: 'CONFIRMED',
        });

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expectCounterDecrement(updateSets[1], 'confirmedSpots', 3);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'queues participant cancellation and informational waitlist emails in the cancellation transaction',
    () =>
      Effect.gen(function* () {
        const { database, insertedEmails } = createGuestCancellationDatabase({
          status: 'CONFIRMED',
          waitlistRegistrations: [
            {
              id: 'waitlist-registration-1',
              status: 'WAITLIST',
              user: {
                communicationEmail: 'waitlist.contact@example.com',
                email: 'waitlist@example.com',
              },
            },
          ],
        });

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database })));

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
        expect(insertedEmails[0]?.html).toContain(
          'https://tenant.example.com/events/event-1',
        );
        expect(insertedEmails[1]?.text).toContain('does not reserve a spot');
      }),
  );

  it.effect(
    'passes the platform administrator actor to the cancellation email',
    () =>
      Effect.gen(function* () {
        const { database, insertedEmails } = createGuestCancellationDatabase({
          status: 'CONFIRMED',
        });

        yield* cancelRegistrationForTenant({
          cancelledBy: 'platformAdministrator',
          enforceParticipantDeadline: false,
          executiveUserId: null,
          registrationId: 'registration-1',
          targetTenant: tenant,
        }).pipe(Effect.provide(createContextLayer({ database })));

        expect(insertedEmails).toHaveLength(1);
        expect(insertedEmails[0]?.text).toContain(
          'A platform administrator cancelled your registration',
        );
      }),
  );

  it.effect(
    'fails closed when a persisted non-Stripe payment reaches cancellation',
    () =>
      Effect.gen(function* () {
        const insert = vi.fn();
        const update = vi.fn();
        const sourceTransaction = {
          amount: 2500,
          currency: 'EUR' as const,
          id: 'transaction-1',
          method: 'cash' as const,
          status: 'successful' as const,
          stripeChargeId: null,
          stripeCheckoutSessionId: null,
          stripePaymentIntentId: null,
          targetUserId: 'attendee-1',
          type: 'registration' as const,
        };
        const tx = {
          ...createCancellationTransactionSelect({
            guestCount: 1,
            status: 'CONFIRMED',
            transactions: [sourceTransaction],
          }),
          insert,
          update,
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 1,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [sourceTransaction],
                  userId: 'attendee-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toContain(
          'Stripe payment ownership or acquisition settlement is inconsistent',
        );
        expect(insert).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'creates an exact Stripe refund claim when a free registration has only a paid add-on source',
    () =>
      Effect.gen(function* () {
        const { database, insertedRefundAllocations, insertedTransactions } =
          createStripeAddonOnlyCancellationDatabase();

        const outcome = yield* cancelRegistrationForTenant({
          cancelledBy: 'organizer',
          enforceParticipantDeadline: false,
          executiveUserId: 'organizer-1',
          registrationId: 'registration-1',
          targetTenant: tenant,
        }).pipe(Effect.provide(createContextLayer({ database })));

        expect(outcome).toEqual(
          expect.objectContaining({
            refundClaimId: expect.any(String),
            refundTransactionId: expect.any(String),
            status: 'cancelled',
          }),
        );
        expect(insertedTransactions).toEqual([
          expect.objectContaining({
            amount: -750,
            eventRegistrationId: 'registration-1',
            method: 'stripe',
            sourceTransactionId: 'addon-transaction-1',
            status: 'pending',
            targetUserId: 'attendee-1',
            type: 'refund',
          }),
        ]);
        expect(insertedRefundAllocations).toEqual([
          expect.objectContaining({
            acquisitionId: 'acquisition-registration-1',
            acquisitionPaymentId: 'acquisition-payment-1',
            applicationFeeAmount: 75,
            componentId: 'acquisition-component-addon-1',
            fulfillmentEventId: expect.any(String),
            grossEntitlementAmount: 750,
            netEntitlementAmount: 637,
            operationKind: 'addon_cancellation',
            purchaseId: 'purchase-1',
            quantity: 3,
            refundAmount: 750,
            stripeFeeAmount: 38,
          }),
        ]);
      }),
  );

  it.effect(
    'persists a durable Stripe refund claim against its historical Stripe account',
    () =>
      Effect.gen(function* () {
        let cancellationTransition: unknown;
        const insertedRefundAllocations: Record<string, unknown>[] = [];
        let insertedTransaction: Record<string, unknown> | undefined;
        const updateSets: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({
            guestCount: 1,
            status: 'CONFIRMED',
            transactions: [
              {
                amount: 2500,
                appFee: 250,
                currency: 'EUR',
                eventId: 'event-1',
                eventRegistrationId: 'registration-1',
                id: 'transaction-1',
                method: 'stripe',
                status: 'successful',
                stripeAccountId: 'acct_persisted',
                stripeChargeId: 'ch_123',
                stripeCheckoutSessionId: 'checkout-1',
                stripeFee: 75,
                stripeNetAmount: 2175,
                stripePaymentIntentId: 'pi_123',
                targetUserId: 'attendee-1',
                tenantId: 'tenant-1',
                type: 'registration',
              },
            ],
          }),
          insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => {
              if (table === transactions) {
                insertedTransaction = values;
              }
              if (table === registrationAcquisitionRefundAllocations) {
                insertedRefundAllocations.push(values);
                return Effect.void;
              }
              return {
                onConflictDoNothing: () => ({
                  returning: () =>
                    Effect.succeed([{ id: String(values['id']) }]),
                }),
                returning: () => Effect.succeed([{ id: String(values['id']) }]),
              };
            },
          }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              if (table === transactions) {
                return {
                  where: () => ({
                    returning: () => Effect.succeed([]),
                  }),
                };
              }
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () => {
                    if (
                      table === eventRegistrations ||
                      table === eventRegistrationOptions
                    ) {
                      return Effect.succeed([{ id: 'updated' }]);
                    }
                    return Effect.succeed([]);
                  },
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 1,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [
                    {
                      amount: 2500,
                      appFee: 250,
                      currency: 'EUR',
                      id: 'transaction-1',
                      method: 'stripe',
                      status: 'successful',
                      stripeAccountId: 'acct_persisted',
                      stripeChargeId: 'ch_123',
                      stripeCheckoutSessionId: 'checkout-1',
                      stripeFee: 75,
                      stripeNetAmount: 2175,
                      stripePaymentIntentId: 'pi_123',
                      type: 'registration',
                    },
                  ],
                  userId: 'attendee-1',
                }),
            },
          },
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () =>
                  Effect.succeed([
                    {
                      amount: 2500,
                      appFee: 250,
                      currency: 'EUR',
                      stripeAccountId: 'acct_persisted',
                      stripeChargeId: 'ch_123',
                      stripeFee: 75,
                      stripeNetAmount: 2175,
                      stripePaymentIntentId: 'pi_123',
                    },
                  ]),
              }),
            }),
          }),
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };
        const stripe = {
          checkout: {
            sessions: {
              expire: vi.fn(),
            },
          },
          refunds: {
            create: vi.fn(() =>
              Promise.resolve({ id: 're_123', status: 'succeeded' }),
            ),
          },
        };

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
            createContextLayer({
              database,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        expectCounterDecrement(updateSets[1], 'confirmedSpots', 2);
        expect(stripe.refunds.create).not.toHaveBeenCalled();
        expect(insertedTransaction).toEqual(
          expect.objectContaining({
            amount: -2500,
            currency: 'EUR',
            eventId: 'event-1',
            eventRegistrationId: 'registration-1',
            executiveUserId: null,
            manuallyCreated: false,
            method: 'stripe',
            sourceTransactionId: 'transaction-1',
            status: 'pending',
            stripeAccountId: 'acct_persisted',
            stripeRefundApplicationFee: true,
            stripeRefundNextAttemptAt: expect.any(Date),
            targetUserId: 'attendee-1',
            tenantId: 'tenant-1',
            type: 'refund',
          }),
        );
        expect(insertedTransaction?.['comment']).toContain(
          'Registration refund claim',
        );
        expect(insertedTransaction?.['stripeAccountId']).not.toBe('acct_123');
        expect(insertedRefundAllocations).toEqual([
          expect.objectContaining({
            acquisitionId: 'acquisition-registration-1',
            acquisitionPaymentId: 'acquisition-payment-1',
            componentId: 'acquisition-component-registration',
            operationKind: 'registration_cancellation',
            quantity: 2,
            refundAmount: 2500,
          }),
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
        expect(database.transaction).toHaveBeenCalledTimes(2);
      }),
  );

  it.effect(
    'keeps an unbound pending payment claim and its reserved spot intact',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'PENDING',
                  transactions: [
                    {
                      amount: 1000,
                      currency: 'EUR',
                      id: 'transaction-1',
                      method: 'stripe',
                      status: 'pending',
                      stripeAccountId: 'acct_123',
                      stripeChargeId: null,
                      stripeCheckoutSessionId: null,
                      stripePaymentIntentId: null,
                      type: 'registration',
                    },
                  ],
                }),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: true,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Payment setup is still being reconciled, so this request did not cancel the registration or release its reserved spots. Retry payment setup, then retry cancellation.',
        );
        expect(database.transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'refuses generic recipient cancellation before expiring an active transfer checkout',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 3,
                  id: 'recipient-registration-1',
                  registrationOptionId: 'option-1',
                  status: 'PENDING',
                  transactions: [
                    {
                      amount: 1000,
                      currency: 'EUR',
                      id: 'recipient-transaction-1',
                      method: 'stripe',
                      status: 'pending',
                      stripeAccountId: 'acct_123',
                      stripeChargeId: null,
                      stripeCheckoutSessionId: 'checkout-transfer-1',
                      stripePaymentIntentId: null,
                      type: 'registration',
                    },
                  ],
                  userId: 'scanner-1',
                }),
            },
            registrationTransfers: {
              findFirst: () =>
                Effect.succeed({
                  id: 'transfer-1',
                  recipientRegistrationId: 'recipient-registration-1',
                  status: 'checkout_pending',
                }),
            },
          },
          transaction: vi.fn(),
        };
        const stripe = createStripeClientDouble();

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: true,
            expectedStatus: 'PENDING',
            registrationId: 'recipient-registration-1',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(createContextLayer({ database, stripe })),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain('active transfer');
        expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
        expect(database.transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rolls back cancellation when a transfer becomes active under the registration lock',
    () =>
      Effect.gen(function* () {
        const tx = {
          ...createCancellationTransactionSelect({
            activeTransfers: [
              {
                id: 'transfer-race',
                recipientRegistrationId: null,
                sourceRegistrationId: 'registration-1',
                status: 'open',
              },
            ],
            status: 'CONFIRMED',
          }),
          update: vi.fn(),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
                  userId: 'scanner-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: false,
            expectedStatus: 'CONFIRMED',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain('active transfer');
        expect(tx.update).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'does not release a checkout claim that becomes bound after preflight',
    () =>
      Effect.gen(function* () {
        const pendingTransaction = {
          amount: 1000,
          currency: 'EUR',
          id: 'transaction-race',
          method: 'stripe',
          status: 'pending',
          stripeAccountId: 'acct_123',
          stripeChargeId: null,
          stripeCheckoutSessionId: 'checkout-race',
          stripePaymentIntentId: null,
          type: 'registration',
        };
        const updatedTables: unknown[] = [];
        const updateSets: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({
            status: 'PENDING',
            transactions: [pendingTransaction],
          }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updatedTables.push(table);
              updateSets.push(values);
              return {
                where: () =>
                  table === eventAddons
                    ? Effect.succeed([])
                    : {
                        returning: () =>
                          table === eventRegistrations ||
                          table === eventRegistrationOptions ||
                          table === transactions
                            ? Effect.succeed([{ id: 'updated' }])
                            : Effect.succeed([]),
                      },
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [{ addonId: 'addon-1', quantity: 2 }],
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'PENDING',
                  transactions: [],
                  userId: 'scanner-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };
        const stripe = createStripeClientDouble();

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          {
            expectedPaymentPending: false,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
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
        expect(updatedTables).toEqual([]);
        expect(updateSets).toEqual([]);
        expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'keeps a bound checkout claim and reservation when Stripe expiry fails',
    () =>
      Effect.gen(function* () {
        const pendingTransaction = {
          amount: 1000,
          currency: 'EUR',
          id: 'transaction-1',
          method: 'stripe',
          status: 'pending',
          stripeAccountId: 'acct_123',
          stripeChargeId: null,
          stripeCheckoutCancellationRequestedAt: null as Date | null,
          stripeCheckoutSessionId: 'checkout-1',
          stripePaymentIntentId: null,
          type: 'registration',
        };
        const updatedTables: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({
            status: 'PENDING',
            transactions: [pendingTransaction],
          }),
          update: (table: unknown) => ({
            set: (values: Record<string, unknown>) => {
              updatedTables.push(table);
              if (
                values.stripeCheckoutCancellationRequestedAt instanceof Date
              ) {
                pendingTransaction.stripeCheckoutCancellationRequestedAt =
                  values.stripeCheckoutCancellationRequestedAt;
              }
              return {
                where: () => ({
                  returning: () => Effect.succeed([{ id: 'transaction-1' }]),
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'PENDING',
                  transactions: [pendingTransaction],
                  userId: 'scanner-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };
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
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
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
        expect(updatedTables).toEqual([transactions]);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'treats a concurrently expired and locally cancelled checkout as success',
    () =>
      Effect.gen(function* () {
        const pendingTransaction = {
          amount: 1000,
          currency: 'EUR',
          id: 'transaction-1',
          method: 'stripe',
          status: 'pending',
          stripeAccountId: 'acct_123',
          stripeChargeId: null,
          stripeCheckoutCancellationRequestedAt: null as Date | null,
          stripeCheckoutSessionId: 'checkout-1',
          stripePaymentIntentId: null,
          type: 'registration',
        };
        const cancelledTransaction = {
          ...pendingTransaction,
          status: 'cancelled',
          stripeCheckoutCancellationRequestedAt: new Date(),
        };
        const markingTx = {
          ...createCancellationTransactionSelect({
            status: 'PENDING',
            transactions: [pendingTransaction],
          }),
          update: () => ({
            set: (values: Record<string, unknown>) => {
              if (
                values.stripeCheckoutCancellationRequestedAt instanceof Date
              ) {
                pendingTransaction.stripeCheckoutCancellationRequestedAt =
                  values.stripeCheckoutCancellationRequestedAt;
              }
              return {
                where: () => ({
                  returning: () => Effect.succeed([{ id: 'transaction-1' }]),
                }),
              };
            },
          }),
        };
        const finalizedTx = {
          ...createCancellationTransactionSelect({
            status: 'CANCELLED',
            transactions: [cancelledTransaction],
          }),
          update: vi.fn(),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'PENDING',
                  transactions: [pendingTransaction],
                  userId: 'scanner-1',
                }),
            },
          },
          transaction: vi
            .fn()
            .mockImplementationOnce(
              (callback: (tx: typeof markingTx) => unknown) =>
                callback(markingTx),
            )
            .mockImplementationOnce(
              (callback: (tx: typeof finalizedTx) => unknown) =>
                callback(finalizedTx),
            ),
        };
        const stripe = createStripeClientDouble();
        vi.mocked(stripe.checkout.sessions.expire).mockRejectedValueOnce(
          new Error('Checkout is already expired'),
        );
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValueOnce({
          id: 'checkout-1',
          status: 'expired',
        } as Stripe.Checkout.Session);

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: true,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
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
        expect(database.transaction).toHaveBeenCalledTimes(2);
        expect(finalizedTx.update).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'does not release reservations when payment completion wins cancellation finalization',
    () =>
      Effect.gen(function* () {
        const paymentTransaction = {
          amount: 1000,
          appFee: null,
          currency: 'EUR',
          id: 'transaction-race',
          method: 'stripe',
          status: 'pending' as 'pending' | 'successful',
          stripeAccountId: 'acct_123',
          stripeChargeId: null,
          stripeCheckoutCancellationRequestedAt: null as Date | null,
          stripeCheckoutSessionId: 'checkout-race',
          stripeFee: null,
          stripeNetAmount: null,
          stripePaymentIntentId: null,
          type: 'registration',
        };
        const updateSets: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({
            status: 'PENDING',
            transactions: [paymentTransaction],
          }),
          update: () => ({
            set: (values: Record<string, unknown>) => {
              updateSets.push(values);
              if (
                values.stripeCheckoutCancellationRequestedAt instanceof Date
              ) {
                paymentTransaction.stripeCheckoutCancellationRequestedAt =
                  values.stripeCheckoutCancellationRequestedAt;
              }
              return {
                where: () => ({
                  returning: () => Effect.succeed([{ id: 'updated' }]),
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'PENDING',
                  transactions: [paymentTransaction],
                  userId: 'scanner-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };
        const stripe = createStripeClientDouble({
          expireCheckoutSession: vi.fn(async () => {
            paymentTransaction.status = 'successful';
            return {
              id: 'checkout-race',
              status: 'expired',
            } as Stripe.Checkout.Session;
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
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
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
        expect(updateSets).toEqual([
          {
            stripeCheckoutCancellationRequestedAt: expect.any(Date),
          },
        ]);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'cancels unapproved manual applications without releasing reserved spots',
    () =>
      Effect.gen(function* () {
        const updateSets: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({ status: 'PENDING' }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () =>
                    table === eventRegistrations
                      ? Effect.succeed([{ id: 'updated' }])
                      : Effect.succeed([]),
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'PENDING',
                  transactions: [],
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: false,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expect(updateSets).toEqual([{ status: 'CANCELLED' }]);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'cancels pending guest registrations and releases buyer plus guest reserved spots',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createGuestCancellationDatabase({
          status: 'PENDING',
        });
        const stripe = createStripeClientDouble();

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: true,
            expectedStatus: 'PENDING',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        const counterUpdate = updateSets.find(
          (updateSet) =>
            updateSet !== null &&
            typeof updateSet === 'object' &&
            'reservedSpots' in updateSet,
        );
        expectCounterDecrement(counterUpdate, 'reservedSpots', 3);
        expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
          'checkout-1',
          undefined,
          { stripeAccount: 'acct_123' },
        );
        expect(database.transaction.mock.invocationCallOrder[0]).toBeLessThan(
          vi.mocked(stripe.checkout.sessions.expire).mock
            .invocationCallOrder[0] ?? 0,
        );
        expect(database.transaction).toHaveBeenCalledTimes(2);
      }),
  );

  it.effect('rejects checked-in registration cancellation', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                checkedInGuestCount: 0,
                checkInTime: new Date(),
                event: {
                  start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                },
                guestCount: 0,
                id: 'registration-1',
                registrationOptionId: 'option-1',
                status: 'CONFIRMED',
                transactions: [],
              }),
          },
        },
        transaction: vi.fn(),
      };

      const error = yield* eventRegistrationHandlers[
        'events.cancelRegistration'
      ](
        {
          expectedPaymentPending: false,
          expectedStatus: 'CONFIRMED',
          registrationId: 'registration-1',
        },
        emptyHandlerOptions,
      ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Checked-in registrations cannot be cancelled',
      );
      expect(database.transaction).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    'cancels waitlisted registrations and releases a waitlist spot',
    () =>
      Effect.gen(function* () {
        const updateSets: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({ status: 'WAITLIST' }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () =>
                  table === transactions
                    ? Effect.succeed([])
                    : {
                        returning: () =>
                          table === eventRegistrations ||
                          table === eventRegistrationOptions
                            ? Effect.succeed([{ id: 'updated' }])
                            : Effect.succeed([]),
                      },
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'WAITLIST',
                  transactions: [],
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          {
            expectedPaymentPending: false,
            expectedStatus: 'WAITLIST',
            registrationId: 'registration-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expect(updateSets).toEqual([
          { status: 'CANCELLED' },
          expect.objectContaining({ waitlistSpots: expect.anything() }),
        ]);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );
});

describe('event registration transfer handlers', () => {
  it.effect(
    'returns eligible transfer targets for organizer-assisted transfer',
    () =>
      Effect.gen(function* () {
        const result = yield* eventRegistrationHandlers[
          'events.findTransferTargets'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            search: 'alex',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({ database: createTransferTargetsDatabase() }),
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
      }),
  );

  it.effect(
    'returns transfer targets for unrestricted registration options',
    () =>
      Effect.gen(function* () {
        const result = yield* eventRegistrationHandlers[
          'events.findTransferTargets'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            search: 'alex',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database: createTransferTargetsDatabase({
                registrationOptionRoleIds: [],
              }),
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
      }),
  );

  it.effect(
    'returns targets for checked-in, paid, and source-discounted fixed bundles',
    () =>
      Effect.gen(function* () {
        const result = yield* eventRegistrationHandlers[
          'events.findTransferTargets'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            search: 'alex',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database: createTransferTargetsDatabase({
                hasCheckedInHistory: true,
                hasPaidSource: true,
                hasSourceDiscount: true,
              }),
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
      }),
  );

  it.effect(
    'previews without writes and commits only the matching reviewed bundle',
    () =>
      Effect.gen(function* () {
        const { database, insertedEmails, lockOrder, updateSets } =
          createTransferDatabase();

        const preview = yield* previewEventRegistrationTransfer().pipe(
          Effect.provide(createContextLayer({ database })),
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
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database })));

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
              'registration-transferred/tenant-1/registration-1/previousOwner/attendee-1',
            kind: 'registrationTransferred',
            toEmail: 'attendee.contact@example.com',
          }),
          expect.objectContaining({
            idempotencyKey:
              'registration-transferred/tenant-1/registration-1/newOwner/target-user-1',
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
        } = createTransferDatabase({
          bundleAddonPurchases: [
            { price: 0, purchasedQuantity: 1, redeemedQuantity: 0 },
          ],
        });
        const preview = yield* previewEventRegistrationTransfer().pipe(
          Effect.provide(createContextLayer({ database })),
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
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe(
          'The registration bundle changed after it was reviewed. Review the transfer again before confirming.',
        );
        expect(insertedEmails).toEqual([]);
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects a legacy transfer when a concurrent active transfer wins the registration lock',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
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
          Effect.provide(createContextLayer({ database })),
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
        const { database, updateSets } = createTransferDatabase({
          organizerRegistrations: [],
        });

        yield* eventRegistrationHandlers['events.transferMyRegistration'](
          {
            registrationId: 'registration-1',
            targetEmail: ' TARGET@EXAMPLE.COM ',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
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
        const { database, updateSets } = createTransferDatabase({
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
          Effect.provide(createContextLayer({ database })),
        );

        expect(updateSets).toEqual([
          expect.objectContaining({ userId: 'target-user-1' }),
        ]);
      }),
  );

  it.effect('allows transfer to unrestricted registration options', () =>
    Effect.gen(function* () {
      const { database, updateSets } = createTransferDatabase({
        registrationOptionRoleIds: [],
        targetTenantUser: {
          id: 'target-tenant-user-1',
          roles: [],
        },
      });

      yield* previewAndTransferEventRegistration().pipe(
        Effect.provide(createContextLayer({ database })),
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
        const { database, updateSets } = createTransferDatabase({
          targetUser: null,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferMyRegistration'
        ](
          {
            registrationId: 'registration-1',
            targetEmail: 'missing@example.com',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
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
        const { database, updateSets } = createTransferDatabase({
          targetTenantUser: null,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferMyRegistration'
        ](
          {
            registrationId: 'registration-1',
            targetEmail: 'target@example.com',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
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
      const { database, updateSets } = createTransferDatabase({
        organizerRegistrations: [],
      });

      const error = yield* eventRegistrationHandlers[
        'events.transferEventRegistration'
      ](
        {
          eventId: 'event-1',
          registrationId: 'registration-1',
          targetUserId: 'target-user-1',
        },
        emptyHandlerOptions,
      ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(updateSets).toEqual([]);
    }),
  );

  it.effect(
    'routes a paid registration bundle through a private offer and recipient claim',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
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
          Effect.provide(createContextLayer({ database })),
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
        const { database, updateSets } = createTransferDatabase({
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
          Effect.provide(createContextLayer({ database })),
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
        const { database, updateSets } = createTransferDatabase({
          discountProviders: {
            esnCard: { config: {}, status: 'enabled' },
          },
          recipientDiscountCards: [{ type: 'esnCard', validTo: null }],
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
          Effect.provide(createContextLayer({ database })),
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
        const { database, updateSets } = createTransferDatabase({
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
          Effect.provide(createContextLayer({ database })),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain('Create a private transfer offer');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect('rejects transfer when the target user is not role-eligible', () =>
    Effect.gen(function* () {
      const { database, updateSets } = createTransferDatabase({
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
          registrationId: 'registration-1',
          targetUserId: 'target-user-1',
        },
        emptyHandlerOptions,
      ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

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
        const { database, updateSets } = createTransferDatabase({
          lockedTargetRoleIds: [],
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

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
        const { database, updateSets } = createTransferDatabase({
          lockedEventStatus: 'DRAFT',
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe('Registration can no longer be transferred');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects direct transfer after the option deadline but before event start',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          lockedEventStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
          lockedOptionTransferDeadlineHoursBeforeStart: 48,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

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
          const { database, updateSets } = createTransferDatabase({
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
              registrationId: 'registration-1',
              targetUserId: 'target-user-1',
            },
            emptyHandlerOptions,
          ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

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
        const { database, updateSets } = createTransferDatabase({
          targetTenantUser: null,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(error.message).toBe('Target tenant user not found');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects transfer when the target membership disappears under the lock',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          lockedTargetMembership: false,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(error.message).toBe('Target tenant user not found');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects transfer when the target already has an active registration',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          existingTargetRegistration: { id: 'target-registration-1' },
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

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
        const { database, updateSets } = createTransferDatabase({
          concurrentTargetRegistration: { id: 'target-registration-race' },
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

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
        const { database, updateSets } = createTransferDatabase({
          updateError: new EffectDrizzleQueryError({
            cause: Cause.fail(
              new SqlError({
                reason: new UniqueViolation({
                  cause: new Error('duplicate active registration'),
                  constraint: activeEventRegistrationUniqueIndexName,
                }),
              }),
            ),
            params: [],
            query: 'update event_registrations ...',
          }),
        });

        const preview = yield* previewEventRegistrationTransfer().pipe(
          Effect.provide(createContextLayer({ database })),
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
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

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
          createTransferDatabase({
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
          Effect.provide(createContextLayer({ database })),
        );

        expect(updateSets).toEqual([
          expect.objectContaining({ userId: 'target-user-1' }),
        ]);
      }),
  );

  it.effect('fails closed while an earlier source refund is unresolved', () =>
    Effect.gen(function* () {
      const { database, updateSets } = createTransferDatabase({
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
          registrationId: 'registration-1',
          targetUserId: 'target-user-1',
        },
        emptyHandlerOptions,
      ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

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
        const { database, updateSets } = createTransferDatabase({
          bundleAddonPurchases: [{ price: 499, purchasedQuantity: 1 }],
        });

        const error = yield* previewEventRegistrationTransfer().pipe(
          Effect.flip,
          Effect.provide(createContextLayer({ database })),
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
        const { database, updateSets } = createTransferDatabase({
          activeTargetRegistrations: [{ id: 'active-registration-1' }],
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
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
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () => Effect.succeed(scannedRegistration),
            findMany: () => Effect.succeed([]),
          },
        },
      };

      const error = yield* eventRegistrationHandlers[
        'events.registrationScanned'
      ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
        Effect.flip,
        Effect.provide(createContextLayer({ database })),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
    }),
  );

  it.effect('disables scan check-in before the pre-start window opens', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                ...scannedRegistration,
                event: {
                  ...scannedRegistration.event,
                  start: new Date(Date.now() + 2 * 60 * 60 * 1000),
                },
              }),
          },
        },
      };

      const result = yield* eventRegistrationHandlers[
        'events.registrationScanned'
      ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
        Effect.provide(
          createContextLayer({
            database,
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
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  ...scannedRegistration,
                  event: {
                    ...scannedRegistration.event,
                    start: new Date('2026-09-15T12:30:00.000Z'),
                  },
                }),
            },
          },
        };

        const result = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
          Effect.provide(
            createContextLayer({
              database,
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
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () => Effect.succeed(scannedRegistration),
            },
          },
        };

        const error = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
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
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  ...scannedRegistration,
                  status,
                }),
            },
          },
        };

        const result = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
          Effect.provide(
            createContextLayer({
              database,
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
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  ...scannedRegistration,
                  checkedInGuestCount: 1,
                  checkInTime: new Date(),
                  guestCount: 2,
                }),
            },
          },
        };

        const result = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
          Effect.provide(
            createContextLayer({
              database,
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
        const updateCalls: string[] = [];
        const tx = {
          ...createRegistrationMutationGuardSelect(),
          update: (table: unknown) => ({
            set: (values: { checkInTime?: Date }) => ({
              where: () => ({
                returning: () => {
                  if (table === eventRegistrations) {
                    updateCalls.push('registration');
                    return Effect.succeed([
                      {
                        checkedInGuestCount: 0,
                        checkInTime: values.checkInTime,
                        id: 'registration-1',
                      },
                    ]);
                  }

                  if (table === eventRegistrationOptions) {
                    updateCalls.push('option');
                    return Effect.succeed([{ id: 'option-1' }]);
                  }

                  return Effect.succeed([]);
                },
              }),
            }),
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
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
                }),
              findMany: () =>
                Effect.succeed([
                  {
                    id: 'organizer-registration-1',
                    registrationOption: {
                      organizingRegistration: true,
                    },
                  },
                ]),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        const result = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: 0, registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database, nowIso })));

        expect(result.alreadyCheckedIn).toBe(false);
        expect(result.checkInTime).toBe(nowIso);
        expect(updateCalls).toEqual(['registration', 'option']);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect('refuses check-in while the source transfer is active', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
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
              }),
          },
          registrationTransfers: {
            findFirst: () =>
              Effect.succeed({
                id: 'transfer-1',
                sourceRegistrationId: 'registration-1',
                status: 'open',
              }),
          },
        },
        transaction: vi.fn(),
      };

      const error = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        { guestCheckInCount: 0, registrationId: 'registration-1' },
        emptyHandlerOptions,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer({
            database,
            user: createUser({ permissions: ['events:organizeAll'] }),
          }),
        ),
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toContain('active transfer');
      expect(database.transaction).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    'rolls back check-in when a transfer becomes active under the registration lock',
    () =>
      Effect.gen(function* () {
        const tx = {
          ...createRegistrationMutationGuardSelect({
            activeTransfers: [
              {
                id: 'transfer-race',
                recipientRegistrationId: null,
                sourceRegistrationId: 'registration-1',
                status: 'open',
              },
            ],
          }),
          update: vi.fn(),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
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
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: 0, registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain('active transfer');
        expect(tx.update).not.toHaveBeenCalled();
      }),
  );

  it.effect('records selected guest check-ins with the attendee check-in', () =>
    Effect.gen(function* () {
      const updateSets: unknown[] = [];
      const tx = {
        ...createRegistrationMutationGuardSelect(),
        update: (table: unknown) => ({
          set: (values: unknown) => {
            updateSets.push(values);
            return {
              where: () => ({
                returning: () => {
                  if (table === eventRegistrations) {
                    return Effect.succeed([
                      {
                        checkedInGuestCount: 2,
                        checkInTime: new Date(),
                        id: 'registration-1',
                      },
                    ]);
                  }

                  if (table === eventRegistrationOptions) {
                    return Effect.succeed([{ id: 'option-1' }]);
                  }

                  return Effect.succeed([]);
                },
              }),
            };
          },
        }),
      };
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
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
              }),
            findMany: () =>
              Effect.succeed([
                {
                  id: 'organizer-registration-1',
                  registrationOption: {
                    organizingRegistration: true,
                  },
                },
              ]),
          },
        },
        transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
          callback(tx),
        ),
      };

      const result = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        {
          guestCheckInCount: 2,
          registrationId: 'registration-1',
        },
        emptyHandlerOptions,
      ).pipe(Effect.provide(createContextLayer({ database })));

      expect(result.alreadyCheckedIn).toBe(false);
      expect(updateSets).toEqual([
        expect.objectContaining({ checkInTime: expect.any(Date) }),
        expect.objectContaining({ checkedInSpots: expect.anything() }),
      ]);
    }),
  );

  it.effect(
    'rejects negative guest check-in counts before reading registration state',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: vi.fn(() =>
                Effect.die(new Error('registration lookup should not run')),
              ),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: -1, registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Guest check-in count must be a non-negative integer',
        );
        expect(
          database.query.eventRegistrations.findFirst,
        ).not.toHaveBeenCalled();
        expect(database.transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rejects guest check-in counts above remaining guests before writing',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
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
                }),
              findMany: () =>
                Effect.succeed([
                  {
                    id: 'organizer-registration-1',
                    registrationOption: {
                      organizingRegistration: true,
                    },
                  },
                ]),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: 2, registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Guest check-in count exceeds remaining guests',
        );
        expect(database.transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect('rejects check-in before the pre-start window opens', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
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
              }),
          },
        },
        transaction: vi.fn(),
      };

      const error = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        { guestCheckInCount: 0, registrationId: 'registration-1' },
        emptyHandlerOptions,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer({
            database,
            user: createUser({ permissions: ['events:organizeAll'] }),
          }),
        ),
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe('Check-in is not open for this event yet');
      expect(database.transaction).not.toHaveBeenCalled();
    }),
  );

  it.effect('treats duplicate check-in as an idempotent success', () =>
    Effect.gen(function* () {
      const checkInTime = new Date('2026-09-18T09:45:00.000Z');
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                checkedInGuestCount: 0,
                checkInTime,
                event: {
                  start: new Date(Date.now() + 2 * 60 * 60 * 1000),
                },
                eventId: 'event-1',
                id: 'registration-1',
                registrationOptionId: 'option-1',
                status: 'CONFIRMED',
                userId: 'attendee-1',
              }),
            findMany: () =>
              Effect.succeed([
                {
                  id: 'organizer-registration-1',
                  registrationOption: {
                    organizingRegistration: true,
                  },
                },
              ]),
          },
        },
        transaction: vi.fn(),
      };

      const result = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        { guestCheckInCount: 0, registrationId: 'registration-1' },
        emptyHandlerOptions,
      ).pipe(Effect.provide(createContextLayer({ database })));

      expect(result).toEqual({
        alreadyCheckedIn: true,
        checkInTime: '2026-09-18T09:45:00.000Z',
      });
      expect(database.transaction).not.toHaveBeenCalled();
    }),
  );

  it.effect('rejects users checking in their own registration', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
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
              }),
            findMany: () =>
              Effect.succeed([
                {
                  id: 'organizer-registration-1',
                  registrationOption: {
                    organizingRegistration: true,
                  },
                },
              ]),
          },
        },
      };

      const error = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        { guestCheckInCount: 0, registrationId: 'registration-1' },
        emptyHandlerOptions,
      ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Users cannot check in their own registration',
      );
    }),
  );

  for (const status of nonConfirmedRegistrationStatuses) {
    it.effect(`rejects direct check-in for ${status} registrations`, () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
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
                }),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: 0, registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Only confirmed registrations can be checked in',
        );
        expect(database.transaction).not.toHaveBeenCalled();
      }),
    );
  }
});
