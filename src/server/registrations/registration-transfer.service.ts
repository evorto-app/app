import type { DatabaseClient } from '@db/index';
import type Stripe from 'stripe';

import { createId } from '@db/create-id';
import { Database } from '@db/index';
import {
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchaseOrders,
  eventRegistrationAddonPurchases,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrationQuestions,
  eventRegistrations,
  registrationAcquisitionComponents,
  registrationAcquisitionPayments,
  registrationAcquisitions,
  type RegistrationCheckoutSnapshot,
  registrationTransferAnswers,
  registrationTransferBundleAddonPurchaseLots,
  registrationTransferBundleAddonPurchases,
  registrationTransferEvents,
  registrationTransferRefundPlanAcquisitionLinks,
  registrationTransferRefundPlanItems,
  registrationTransfers,
  rolesToTenantUsers,
  tenants,
  tenantStripeTaxRates,
  transactions,
  userDiscountCards,
  users,
  usersToTenants,
} from '@db/schema';
import { registrationTransferAddonAllocationKey } from '@shared/registration-transfer';
import {
  RegistrationTransferConflictError,
  RegistrationTransferInternalError,
  RegistrationTransferNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/registration-transfers.errors';
import {
  type RegistrationTransferAnswerInput,
  RegistrationTransferClaimRecord,
  RegistrationTransferClaimResult,
  RegistrationTransferOfferResult,
  RegistrationTransferRetryCheckoutResult,
} from '@shared/rpc-contracts/app-rpcs/registration-transfers.rpcs';
import {
  resolveTenantDiscountProviders,
  type TenantDiscountProviders,
} from '@shared/tenant-config';
import { and, desc, eq, inArray, isNull, not, or, sql } from 'drizzle-orm';
import { Cause, Context, Effect, Layer } from 'effect';

import type { Tenant } from '../../types/custom/tenant';
import type { User } from '../../types/custom/user';

import { getServerNow } from '../clock';
import {
  isUserEligibleForRegistrationOption,
  validateRegistrationQuestionAnswers,
} from '../effect/rpc/handlers/events/event-registration.service';
import { EventRegistrationConflictError } from '../effect/rpc/handlers/events/events.errors';
import {
  buildCheckoutSessionExpiresAt,
  buildCheckoutSessionIdempotencyKey,
  createHostedCheckoutSession,
  expireHostedCheckoutSession,
  retrieveHostedCheckoutSession,
  stripeCheckoutMinimumRemainingMinutes,
} from '../integrations/stripe-checkout';
import { enqueueRegistrationTransferredEmail } from '../notifications/email-delivery';
import { lockTenantStripeAccount } from '../payments/pending-stripe-obligations';
import {
  createRegistrationRefundClaim,
  processRegistrationRefundClaim,
} from '../payments/registration-refund';
import { tenantOutboundUrl } from '../tenant-outbound-url';
import {
  establishRegistrationAcquisition,
  settleAcquisitionComponentTerms,
} from './registration-acquisition-write';
import {
  completePaidRegistrationCheckout,
  registrationCheckoutInitialReconcileAt,
} from './registration-checkout-completion';
import { isActiveRegistrationTransferUniqueViolation } from './registration-transfer-constraint';
import {
  createRegistrationTransferCredentials,
  registrationTransferCredentialHashes,
} from './registration-transfer-credentials';
import { expireRegistrationTransferCheckout } from './registration-transfer-finalization';
import {
  registrationTransferTotalPrice,
  resolveRegistrationTransferPrice,
} from './registration-transfer-pricing';
import { resolveRegistrationTransferRefundLifecycle } from './registration-transfer-refund-lifecycle';
import { refundPlansExactlyCoverCurrentAcquisitionPayments } from './registration-transfer-refund-plan-coverage';
import { resolveRegistrationTransferDeadline } from './registration-transfer-state';

interface CancelRegistrationTransferInput {
  readonly tenant: TransferTenant;
  readonly transferId: string;
  readonly user: TransferUser;
}

interface ClaimRegistrationTransferInput {
  readonly answers: readonly RegistrationTransferAnswerInput[];
  readonly credential: string;
  readonly tenant: TransferTenant;
  readonly user: TransferUser;
}

interface CreateRegistrationTransferOfferInput {
  readonly registrationId: string;
  readonly tenant: TransferTenant;
  readonly user: TransferUser;
}

interface GetRegistrationTransferClaimInput {
  readonly credential: string;
  readonly tenant: TransferTenant;
  readonly user: TransferUser;
}

interface RegistrationTransferPaymentClaim {
  readonly appFee: number;
  readonly currency: typeof transactions.$inferSelect.currency;
  readonly id: string;
  readonly request: RegistrationCheckoutSnapshot;
  readonly stripeAccountId: string;
}

interface RetryRegistrationTransferCheckoutInput {
  readonly tenant: TransferTenant;
  readonly transferId: string;
  readonly user: TransferUser;
}

type TransferTenant = Pick<
  Tenant,
  | 'cancellationDeadlineHoursBeforeStart'
  | 'currency'
  | 'domain'
  | 'emailSenderEmail'
  | 'emailSenderName'
  | 'id'
  | 'maxActiveRegistrationsPerUser'
  | 'name'
  | 'refundFeesOnCancellation'
  | 'stripeAccountId'
  | 'transferDeadlineHoursBeforeStart'
>;

type TransferUser = Pick<
  User,
  'communicationEmail' | 'email' | 'id' | 'roleIds'
>;

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, RegistrationTransferInternalError, Database> =>
  Database.use((database) => operation(database)).pipe(
    Effect.mapError(
      (cause) =>
        new RegistrationTransferInternalError({
          cause,
          message: 'Registration transfer storage failed',
        }),
    ),
  );

const buildRegistrationTransferCheckoutParameters = ({
  paymentClaim,
  registrationId,
  tenantId,
  transferId,
}: {
  paymentClaim: RegistrationTransferPaymentClaim;
  registrationId: string;
  tenantId: string;
  transferId: string;
}): Stripe.Checkout.SessionCreateParams => ({
  cancel_url: `${paymentClaim.request.eventUrl}?transferStatus=cancel`,
  customer_email: paymentClaim.request.customerEmail,
  expires_at: paymentClaim.request.expiresAt,
  line_items: paymentClaim.request.lineItems.map((lineItem) => ({
    price_data: {
      currency: paymentClaim.currency,
      product_data: { name: lineItem.name },
      unit_amount: lineItem.unitAmount,
    },
    ...(lineItem.taxRateId && { tax_rates: [lineItem.taxRateId] }),
    quantity: lineItem.quantity,
  })),
  metadata: {
    registrationId,
    tenantId,
    transactionId: paymentClaim.id,
    transferId,
  },
  mode: 'payment',
  payment_intent_data: {
    application_fee_amount: paymentClaim.appFee,
  },
  success_url: `${paymentClaim.request.eventUrl}?transferStatus=success`,
});

export const resumeRegistrationTransferCheckout = Effect.fn(
  'resumeRegistrationTransferCheckout',
)(function* ({
  paymentClaim,
  registrationId,
  tenantId,
  transferId,
}: {
  paymentClaim: RegistrationTransferPaymentClaim;
  registrationId: string;
  tenantId: string;
  transferId: string;
}) {
  const session = yield* createHostedCheckoutSession(
    buildRegistrationTransferCheckoutParameters({
      paymentClaim,
      registrationId,
      tenantId,
      transferId,
    }),
    {
      idempotencyKey: buildCheckoutSessionIdempotencyKey({
        registrationId,
        transactionId: paymentClaim.id,
      }),
      stripeAccount: paymentClaim.stripeAccountId,
    },
  ).pipe(
    Effect.mapError(
      (error) =>
        new RegistrationTransferInternalError({
          cause: error,
          message:
            'Transfer payment setup is still pending. Retry without creating another transfer.',
        }),
    ),
  );
  if (!session.url) {
    return yield* new RegistrationTransferInternalError({
      message: 'Stripe Checkout did not provide a payment URL',
    });
  }

  const bound = yield* databaseEffect((database) =>
    database.transaction((tx) =>
      Effect.gen(function* () {
        const updatedTransactions = yield* tx
          .update(transactions)
          .set({
            stripeCheckoutReconcileAttempts: 0,
            stripeCheckoutReconcileLastError: null,
            stripeCheckoutReconcileLeaseExpiresAt: null,
            stripeCheckoutReconcileLeaseId: null,
            stripeCheckoutReconcileNextAt:
              registrationCheckoutInitialReconcileAt(),
            stripeCheckoutSessionId: session.id,
            stripeCheckoutUrl: session.url,
          })
          .where(
            and(
              eq(transactions.id, paymentClaim.id),
              eq(transactions.eventRegistrationId, registrationId),
              eq(transactions.status, 'pending'),
              eq(transactions.tenantId, tenantId),
              eq(transactions.type, 'registration'),
              isNull(transactions.stripeCheckoutSessionId),
            ),
          )
          .returning({ id: transactions.id });
        if (updatedTransactions.length === 1) return true;

        const existing = yield* tx
          .select({
            stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
            stripeCheckoutUrl: transactions.stripeCheckoutUrl,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.id, paymentClaim.id),
              eq(transactions.eventRegistrationId, registrationId),
              eq(transactions.status, 'pending'),
              eq(transactions.tenantId, tenantId),
            ),
          )
          .limit(1);
        return (
          existing[0]?.stripeCheckoutSessionId === session.id &&
          existing[0].stripeCheckoutUrl === session.url
        );
      }),
    ),
  );
  if (!bound) {
    yield* expireHostedCheckoutSession(
      session.id,
      paymentClaim.stripeAccountId,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new RegistrationTransferInternalError({
            cause,
            message:
              'Transfer payment state changed before Checkout was ready, and the unbound Checkout session could not be expired.',
          }),
      ),
    );
    return yield* new RegistrationTransferConflictError({
      message:
        'Transfer payment state changed before Checkout was ready. Refresh before retrying.',
    });
  }
  return session.url;
});

const resolveCurrentRegistrationTransferPrice = Effect.fn(
  'resolveCurrentRegistrationTransferPrice',
)(function* ({
  basePrice,
  eventStart,
  registrationOptionId,
  tenantId,
  userId,
}: {
  basePrice: number;
  eventStart: Date;
  registrationOptionId: string;
  tenantId: string;
  userId: string;
}) {
  if (basePrice <= 0) {
    return {
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      discountAmount: null,
      effectivePrice: 0,
    };
  }

  const [cards, discounts, tenantRows] = yield* Effect.all(
    [
      databaseEffect((database) =>
        database.query.userDiscountCards.findMany({
          columns: { type: true, validTo: true },
          where: {
            status: 'verified',
            tenantId,
            userId,
          },
        }),
      ),
      databaseEffect((database) =>
        database.query.eventRegistrationOptionDiscounts.findMany({
          columns: { discountedPrice: true, discountType: true },
          where: { registrationOptionId },
        }),
      ),
      databaseEffect((database) =>
        database
          .select({ discountProviders: tenants.discountProviders })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1),
      ),
    ],
    { concurrency: 'unbounded' },
  );
  const providerConfig: TenantDiscountProviders =
    resolveTenantDiscountProviders(tenantRows[0]?.discountProviders);
  const enabledDiscountTypes = new Set(
    Object.entries(providerConfig)
      .filter(([, provider]) => provider?.status === 'enabled')
      .map(([key]) => key),
  );

  return resolveRegistrationTransferPrice({
    basePrice,
    cards,
    discounts,
    enabledDiscountTypes,
    eventStart,
  });
});

const expireOpenRegistrationTransfer = Effect.fn(
  'expireOpenRegistrationTransfer',
)(function* ({
  actorUserId,
  now,
  tenantId,
  transferId,
}: {
  actorUserId: string;
  now: Date;
  tenantId: string;
  transferId: string;
}) {
  return yield* databaseEffect((database) =>
    database.transaction((tx) =>
      Effect.gen(function* () {
        const expired = yield* tx
          .update(registrationTransfers)
          .set({ expiredAt: now, status: 'expired' })
          .where(
            and(
              eq(registrationTransfers.id, transferId),
              eq(registrationTransfers.status, 'open'),
              eq(registrationTransfers.tenantId, tenantId),
            ),
          )
          .returning({ id: registrationTransfers.id });
        if (expired.length === 1) {
          yield* tx.insert(registrationTransferEvents).values({
            actorUserId,
            eventType: 'expired',
            fromStatus: 'open',
            tenantId,
            toStatus: 'expired',
            transferId,
          });
          return true;
        }
        return false;
      }),
    ),
  );
});

const createOffer = Effect.fn('RegistrationTransferService.createOffer')(
  function* ({
    registrationId,
    tenant,
    user,
  }: CreateRegistrationTransferOfferInput) {
    const now = getServerNow(undefined).toJSDate();
    const source = yield* databaseEffect((database) =>
      database.query.eventRegistrations.findFirst({
        columns: {
          eventId: true,
          guestCount: true,
          id: true,
          registrationOptionId: true,
          status: true,
          userId: true,
        },
        where: {
          id: registrationId,
          tenantId: tenant.id,
          userId: user.id,
        },
        with: {
          event: {
            columns: { start: true, status: true },
          },
          registrationOption: {
            columns: {
              transferDeadlineHoursBeforeStart: true,
            },
          },
        },
      }),
    );
    if (!source) {
      return yield* new RegistrationTransferNotFoundError({
        message: 'Registration not found',
      });
    }
    if (!source.event || !source.registrationOption) {
      return yield* new RegistrationTransferInternalError({
        message: 'Registration transfer relations are missing',
      });
    }
    if (source.status !== 'CONFIRMED') {
      return yield* new RegistrationTransferConflictError({
        message: 'Only confirmed registrations can be transferred',
      });
    }
    if (source.event.status !== 'APPROVED') {
      return yield* new RegistrationTransferConflictError({
        message: 'The event is not open for registration transfer',
      });
    }

    yield* resolveRegistrationTransferDeadline({
      eventStart: source.event.start,
      now,
      optionHoursBeforeStart:
        source.registrationOption.transferDeadlineHoursBeforeStart,
      tenantHoursBeforeStart: tenant.transferDeadlineHoursBeforeStart ?? 0,
    }).pipe(
      Effect.mapError(
        (error) =>
          new RegistrationTransferConflictError({ message: error.message }),
      ),
    );
    const credentials = createRegistrationTransferCredentials();

    const transferResult = yield* Database.use((database) =>
      database
        .transaction((tx) =>
          Effect.gen(function* () {
            const lockedSources = yield* tx
              .select({
                eventId: eventRegistrations.eventId,
                guestCount: eventRegistrations.guestCount,
                id: eventRegistrations.id,
                registrationOptionId: eventRegistrations.registrationOptionId,
                status: eventRegistrations.status,
                userId: eventRegistrations.userId,
              })
              .from(eventRegistrations)
              .where(
                and(
                  eq(eventRegistrations.id, source.id),
                  eq(eventRegistrations.tenantId, tenant.id),
                ),
              )
              .for('update');
            const lockedSource = lockedSources[0];
            if (
              !lockedSource ||
              lockedSource.status !== 'CONFIRMED' ||
              lockedSource.userId !== user.id ||
              lockedSource.eventId !== source.eventId ||
              lockedSource.registrationOptionId !== source.registrationOptionId
            ) {
              return yield* new RegistrationTransferConflictError({
                message:
                  'Source registration changed before the transfer offer could be created',
              });
            }

            const lockedTransferTerms = yield* tx
              .select({
                eventStart: eventInstances.start,
                eventStatus: eventInstances.status,
                optionTransferDeadlineHoursBeforeStart:
                  eventRegistrationOptions.transferDeadlineHoursBeforeStart,
                tenantTransferDeadlineHoursBeforeStart:
                  tenants.transferDeadlineHoursBeforeStart,
              })
              .from(eventRegistrationOptions)
              .innerJoin(
                eventInstances,
                eq(eventInstances.id, eventRegistrationOptions.eventId),
              )
              .innerJoin(tenants, eq(tenants.id, eventInstances.tenantId))
              .where(
                and(
                  eq(
                    eventRegistrationOptions.id,
                    lockedSource.registrationOptionId,
                  ),
                  eq(eventRegistrationOptions.eventId, lockedSource.eventId),
                  eq(eventInstances.tenantId, tenant.id),
                ),
              )
              .for('update');
            const lockedTransferTerm = lockedTransferTerms[0];
            if (
              !lockedTransferTerm ||
              lockedTransferTerm.eventStatus !== 'APPROVED'
            ) {
              return yield* new RegistrationTransferConflictError({
                message: 'The event is not open for registration transfer',
              });
            }
            const mutationNow = getServerNow(undefined).toJSDate();
            const lockedExpiresAt = yield* resolveRegistrationTransferDeadline({
              eventStart: lockedTransferTerm.eventStart,
              now: mutationNow,
              optionHoursBeforeStart:
                lockedTransferTerm.optionTransferDeadlineHoursBeforeStart,
              tenantHoursBeforeStart:
                lockedTransferTerm.tenantTransferDeadlineHoursBeforeStart,
            }).pipe(
              Effect.mapError(
                (error) =>
                  new RegistrationTransferConflictError({
                    message: error.message,
                  }),
              ),
            );

            const acquisitionRows = yield* tx
              .select({
                eventId: registrationAcquisitions.eventId,
                id: registrationAcquisitions.id,
                ordinal: registrationAcquisitions.ordinal,
                ownerUserId: registrationAcquisitions.ownerUserId,
                registrationId: registrationAcquisitions.registrationId,
              })
              .from(registrationAcquisitions)
              .where(
                and(
                  eq(registrationAcquisitions.registrationId, lockedSource.id),
                  eq(registrationAcquisitions.tenantId, tenant.id),
                ),
              )
              .orderBy(desc(registrationAcquisitions.ordinal))
              .limit(1)
              .for('update');
            const currentAcquisition = acquisitionRows[0];
            if (
              !currentAcquisition ||
              currentAcquisition.registrationId !== lockedSource.id ||
              currentAcquisition.eventId !== lockedSource.eventId ||
              currentAcquisition.ownerUserId !== user.id
            ) {
              return yield* new RegistrationTransferConflictError({
                message:
                  'Registration payment ownership is not initialized for the current owner.',
              });
            }

            const pendingAddonOrderCandidates = yield* tx
              .select({
                id: eventRegistrationAddonPurchaseOrders.id,
                transactionId:
                  eventRegistrationAddonPurchaseOrders.transactionId,
              })
              .from(eventRegistrationAddonPurchaseOrders)
              .where(
                and(
                  eq(
                    eventRegistrationAddonPurchaseOrders.registrationId,
                    lockedSource.id,
                  ),
                  eq(
                    eventRegistrationAddonPurchaseOrders.status,
                    'pending_payment',
                  ),
                  eq(eventRegistrationAddonPurchaseOrders.tenantId, tenant.id),
                ),
              )
              .limit(1);
            const pendingAddonOrder = pendingAddonOrderCandidates[0];
            if (pendingAddonOrder?.transactionId) {
              const pendingAddonTransactions = yield* tx
                .select({ id: transactions.id })
                .from(transactions)
                .where(
                  and(
                    eq(transactions.id, pendingAddonOrder.transactionId),
                    eq(transactions.eventRegistrationId, lockedSource.id),
                    eq(transactions.method, 'stripe'),
                    eq(transactions.status, 'pending'),
                    eq(transactions.tenantId, tenant.id),
                    eq(transactions.type, 'addon'),
                  ),
                )
                .for('update');
              const lockedAddonOrders = yield* tx
                .select({ id: eventRegistrationAddonPurchaseOrders.id })
                .from(eventRegistrationAddonPurchaseOrders)
                .where(
                  and(
                    eq(
                      eventRegistrationAddonPurchaseOrders.id,
                      pendingAddonOrder.id,
                    ),
                    eq(
                      eventRegistrationAddonPurchaseOrders.status,
                      'pending_payment',
                    ),
                    eq(
                      eventRegistrationAddonPurchaseOrders.transactionId,
                      pendingAddonOrder.transactionId,
                    ),
                  ),
                )
                .for('update');
              if (
                pendingAddonTransactions.length !== 1 ||
                lockedAddonOrders.length !== 1
              ) {
                return yield* new RegistrationTransferInternalError({
                  message:
                    'Pending add-on payment ownership changed before the transfer could be created',
                });
              }
              return yield* new RegistrationTransferConflictError({
                message:
                  'Finish or let the pending add-on Checkout expire before transferring this registration.',
              });
            }
            const sourceAddOnEntitlements = yield* tx
              .select({
                addonId: eventRegistrationAddonPurchases.addonId,
                cancelledQuantity:
                  eventRegistrationAddonPurchases.cancelledQuantity,
                eventId: eventRegistrationAddonPurchases.eventId,
                id: eventRegistrationAddonPurchases.id,
                includedQuantity:
                  eventRegistrationAddonPurchases.includedQuantity,
                purchasedQuantity:
                  eventRegistrationAddonPurchases.purchasedQuantity,
                quantity: eventRegistrationAddonPurchases.quantity,
                redeemedQuantity:
                  eventRegistrationAddonPurchases.redeemedQuantity,
                refundAllocatedPurchasedQuantity:
                  eventRegistrationAddonPurchases.refundAllocatedPurchasedQuantity,
                registrationOptionId:
                  eventRegistrationAddonPurchases.registrationOptionId,
                taxRateDisplayName:
                  eventRegistrationAddonPurchases.taxRateDisplayName,
                taxRateInclusive:
                  eventRegistrationAddonPurchases.taxRateInclusive,
                taxRatePercentage:
                  eventRegistrationAddonPurchases.taxRatePercentage,
                unitPrice: eventRegistrationAddonPurchases.unitPrice,
              })
              .from(eventRegistrationAddonPurchases)
              .where(
                and(
                  eq(
                    eventRegistrationAddonPurchases.registrationId,
                    lockedSource.id,
                  ),
                  eq(eventRegistrationAddonPurchases.tenantId, tenant.id),
                ),
              )
              .orderBy(eventRegistrationAddonPurchases.id)
              .for('update');
            const sourceAddOnPurchaseLots =
              sourceAddOnEntitlements.length === 0
                ? []
                : yield* tx
                    .select({
                      cancelledQuantity:
                        eventRegistrationAddonPurchaseLots.cancelledQuantity,
                      id: eventRegistrationAddonPurchaseLots.id,
                      purchaseId: eventRegistrationAddonPurchaseLots.purchaseId,
                      quantity: eventRegistrationAddonPurchaseLots.quantity,
                      redeemedQuantity:
                        eventRegistrationAddonPurchaseLots.redeemedQuantity,
                      refundAllocatedQuantity:
                        eventRegistrationAddonPurchaseLots.refundAllocatedQuantity,
                      sourceTransactionId:
                        eventRegistrationAddonPurchaseLots.sourceTransactionId,
                    })
                    .from(eventRegistrationAddonPurchaseLots)
                    .where(
                      and(
                        inArray(
                          eventRegistrationAddonPurchaseLots.purchaseId,
                          sourceAddOnEntitlements.map(({ id }) => id),
                        ),
                        eq(
                          eventRegistrationAddonPurchaseLots.tenantId,
                          tenant.id,
                        ),
                      ),
                    )
                    .orderBy(eventRegistrationAddonPurchaseLots.id)
                    .for('update');

            const acquisitionComponents = yield* tx
              .select({
                acquisitionPaymentId:
                  registrationAcquisitionComponents.acquisitionPaymentId,
                applicationFeeAmount:
                  registrationAcquisitionComponents.applicationFeeAmount,
                currency: registrationAcquisitionComponents.currency,
                grossAmount: registrationAcquisitionComponents.grossAmount,
                kind: registrationAcquisitionComponents.kind,
                netAmount: registrationAcquisitionComponents.netAmount,
                purchaseId: registrationAcquisitionComponents.purchaseId,
                purchaseLotId: registrationAcquisitionComponents.purchaseLotId,
                quantity: registrationAcquisitionComponents.quantity,
                stripeFeeAmount:
                  registrationAcquisitionComponents.stripeFeeAmount,
              })
              .from(registrationAcquisitionComponents)
              .where(
                and(
                  eq(
                    registrationAcquisitionComponents.acquisitionId,
                    currentAcquisition.id,
                  ),
                  eq(registrationAcquisitionComponents.tenantId, tenant.id),
                ),
              )
              .for('update');
            const acquisitionLotIds = acquisitionComponents.flatMap(
              (component) =>
                component.kind === 'addon_lot' && component.purchaseLotId
                  ? [component.purchaseLotId]
                  : [],
            );
            if (
              acquisitionComponents.filter(
                ({ kind }) => kind === 'registration',
              ).length !== 1 ||
              acquisitionComponents.find(({ kind }) => kind === 'registration')
                ?.quantity !==
                lockedSource.guestCount + 1 ||
              acquisitionLotIds.length !== sourceAddOnPurchaseLots.length ||
              new Set(acquisitionLotIds).size !== acquisitionLotIds.length ||
              sourceAddOnPurchaseLots.some((lot) => {
                const component = acquisitionComponents.find(
                  ({ purchaseLotId }) => purchaseLotId === lot.id,
                );
                return (
                  !component ||
                  component.purchaseId !== lot.purchaseId ||
                  component.quantity !== lot.quantity
                );
              })
            ) {
              return yield* new RegistrationTransferConflictError({
                message:
                  'Registration payment components are incomplete for the fixed transfer bundle.',
              });
            }

            const sourcePayments = yield* tx
              .select({
                acquisitionPaymentId: registrationAcquisitionPayments.id,
                amount: transactions.amount,
                appFee: transactions.appFee,
                currency: transactions.currency,
                eventId: transactions.eventId,
                id: transactions.id,
                method: transactions.method,
                status: transactions.status,
                stripeAccountId: transactions.stripeAccountId,
                stripeChargeId: transactions.stripeChargeId,
                stripeFee: transactions.stripeFee,
                stripeNetAmount: transactions.stripeNetAmount,
                stripePaymentIntentId: transactions.stripePaymentIntentId,
                targetUserId: transactions.targetUserId,
                type: transactions.type,
              })
              .from(registrationAcquisitionPayments)
              .innerJoin(
                transactions,
                and(
                  eq(
                    transactions.id,
                    registrationAcquisitionPayments.transactionId,
                  ),
                  eq(
                    transactions.tenantId,
                    registrationAcquisitionPayments.tenantId,
                  ),
                ),
              )
              .where(
                and(
                  eq(
                    registrationAcquisitionPayments.acquisitionId,
                    currentAcquisition.id,
                  ),
                  eq(registrationAcquisitionPayments.tenantId, tenant.id),
                  eq(transactions.eventRegistrationId, lockedSource.id),
                  eq(transactions.status, 'successful'),
                  eq(transactions.tenantId, tenant.id),
                  inArray(transactions.type, ['registration', 'addon']),
                  sql`${transactions.amount} > 0`,
                ),
              )
              .orderBy(transactions.id)
              .for('update');

            if (
              acquisitionComponents.some((component) =>
                component.grossAmount > 0
                  ? sourcePayments.every(
                      ({ acquisitionPaymentId }) =>
                        acquisitionPaymentId !== component.acquisitionPaymentId,
                    )
                  : component.acquisitionPaymentId !== null,
              ) ||
              sourcePayments.some((payment) => {
                const components = acquisitionComponents.filter(
                  ({ acquisitionPaymentId }) =>
                    acquisitionPaymentId === payment.acquisitionPaymentId,
                );
                return (
                  payment.appFee === null ||
                  payment.eventId !== lockedSource.eventId ||
                  payment.method !== 'stripe' ||
                  payment.status !== 'successful' ||
                  !payment.stripeAccountId ||
                  (!payment.stripeChargeId && !payment.stripePaymentIntentId) ||
                  payment.stripeFee === null ||
                  payment.stripeNetAmount === null ||
                  payment.targetUserId !== lockedSource.userId ||
                  (payment.type !== 'registration' &&
                    payment.type !== 'addon') ||
                  components.length === 0 ||
                  components.some(
                    (component) => component.currency !== payment.currency,
                  ) ||
                  components.reduce(
                    (sum, component) => sum + component.grossAmount,
                    0,
                  ) !== payment.amount ||
                  components.reduce(
                    (sum, component) => sum + component.applicationFeeAmount,
                    0,
                  ) !== payment.appFee ||
                  components.reduce(
                    (sum, component) => sum + component.stripeFeeAmount,
                    0,
                  ) !== payment.stripeFee ||
                  components.reduce(
                    (sum, component) => sum + component.netAmount,
                    0,
                  ) !== payment.stripeNetAmount
                );
              })
            ) {
              return yield* new RegistrationTransferConflictError({
                message:
                  'Registration acquisition payment settlement is inconsistent.',
              });
            }

            const existingRefunds =
              sourcePayments.length === 0
                ? []
                : yield* tx
                    .select({
                      amount: transactions.amount,
                      method: transactions.method,
                      sourceTransactionId: transactions.sourceTransactionId,
                      status: transactions.status,
                      stripeRefundStatus: transactions.stripeRefundStatus,
                    })
                    .from(transactions)
                    .where(
                      and(
                        eq(transactions.tenantId, tenant.id),
                        eq(transactions.type, 'refund'),
                        inArray(
                          transactions.sourceTransactionId,
                          sourcePayments.map(({ id }) => id),
                        ),
                      ),
                    )
                    .orderBy(transactions.id)
                    .for('update');
            if (
              existingRefunds.some(
                (refund) =>
                  refund.method !== 'stripe' ||
                  refund.status !== 'successful' ||
                  refund.stripeRefundStatus !== 'succeeded' ||
                  !refund.sourceTransactionId,
              )
            ) {
              return yield* new RegistrationTransferConflictError({
                message:
                  'An earlier source refund is unresolved, so the fixed bundle cannot transfer without risking a duplicate refund.',
              });
            }

            const lockedTenants = yield* tx
              .select({
                currency: tenants.currency,
                domain: tenants.domain,
                id: tenants.id,
                stripeAccountId: tenants.stripeAccountId,
              })
              .from(tenants)
              .where(eq(tenants.id, tenant.id))
              .for('update');
            const lockedTenant = lockedTenants[0];
            if (!lockedTenant) {
              return yield* new RegistrationTransferInternalError({
                message:
                  'Tenant disappeared before the transfer offer could be created',
              });
            }
            if (
              sourcePayments.some(
                (payment) =>
                  payment.method !== 'stripe' ||
                  !payment.stripeAccountId ||
                  payment.currency !== lockedTenant.currency ||
                  payment.targetUserId !== user.id ||
                  (!payment.stripeChargeId && !payment.stripePaymentIntentId),
              )
            ) {
              return yield* new RegistrationTransferConflictError({
                message:
                  'Every paid registration and add-on in this bundle must have exact Stripe ownership before it can transfer.',
              });
            }

            const priorRefundedBySource = new Map<string, number>();
            for (const refund of existingRefunds) {
              const sourceTransactionId = refund.sourceTransactionId;
              if (!sourceTransactionId || refund.amount >= 0) {
                return yield* new RegistrationTransferInternalError({
                  message: 'Source refund history has an invalid amount',
                });
              }
              priorRefundedBySource.set(
                sourceTransactionId,
                (priorRefundedBySource.get(sourceTransactionId) ?? 0) -
                  refund.amount,
              );
            }

            const claimUrl = yield* tenantOutboundUrl(
              lockedTenant,
              `/registration-transfers/${encodeURIComponent(credentials.claimToken)}`,
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new RegistrationTransferInternalError({
                    cause,
                    message:
                      'Registration transfer claim URL could not be created',
                  }),
              ),
            );
            const offerInsertNow = getServerNow(undefined).toJSDate();
            if (lockedExpiresAt <= offerInsertNow) {
              return yield* new RegistrationTransferConflictError({
                message: 'Registration can no longer be transferred',
              });
            }

            const inserted = yield* tx
              .insert(registrationTransfers)
              .values({
                claimCodeHash: credentials.claimCodeHash,
                claimTokenHash: credentials.claimTokenHash,
                eventId: lockedSource.eventId,
                expiresAt: lockedExpiresAt,
                registrationOptionId: lockedSource.registrationOptionId,
                sourceRegistrationId: lockedSource.id,
                sourceSpotCount: lockedSource.guestCount + 1,
                sourceUserId: user.id,
                status: 'open',
                tenantId: tenant.id,
              })
              .returning({ id: registrationTransfers.id });
            const transfer = inserted[0];
            if (!transfer) {
              return yield* new RegistrationTransferInternalError({
                message: 'Registration transfer offer was not persisted',
              });
            }
            if (sourceAddOnEntitlements.length > 0) {
              yield* tx.insert(registrationTransferBundleAddonPurchases).values(
                sourceAddOnEntitlements.map((purchase) => ({
                  addonId: purchase.addonId,
                  cancelledQuantity: purchase.cancelledQuantity,
                  eventId: purchase.eventId,
                  includedQuantity: purchase.includedQuantity,
                  purchasedQuantity: purchase.purchasedQuantity,
                  quantity: purchase.quantity,
                  redeemedQuantity: purchase.redeemedQuantity,
                  refundAllocatedPurchasedQuantity:
                    purchase.refundAllocatedPurchasedQuantity,
                  registrationOptionId: purchase.registrationOptionId,
                  sourcePurchaseId: purchase.id,
                  taxRateDisplayName: purchase.taxRateDisplayName,
                  taxRateInclusive: purchase.taxRateInclusive,
                  taxRatePercentage: purchase.taxRatePercentage,
                  tenantId: tenant.id,
                  transferId: transfer.id,
                  unitPrice: purchase.unitPrice,
                })),
              );
            }
            if (sourceAddOnPurchaseLots.length > 0) {
              yield* tx
                .insert(registrationTransferBundleAddonPurchaseLots)
                .values(
                  sourceAddOnPurchaseLots.map((lot) => ({
                    cancelledQuantity: lot.cancelledQuantity,
                    quantity: lot.quantity,
                    redeemedQuantity: lot.redeemedQuantity,
                    refundAllocatedQuantity: lot.refundAllocatedQuantity,
                    sourcePurchaseId: lot.purchaseId,
                    sourcePurchaseLotId: lot.id,
                    sourceTransactionId: lot.sourceTransactionId,
                    tenantId: tenant.id,
                    transferId: transfer.id,
                  })),
                );
            }
            if (sourcePayments.length > 0) {
              const plannedRefunds = sourcePayments.map((payment) => {
                const priorRefundedAmount =
                  priorRefundedBySource.get(payment.id) ?? 0;
                if (
                  priorRefundedAmount > payment.amount ||
                  !payment.stripeAccountId
                ) {
                  return;
                }
                return {
                  acquisitionPaymentId: payment.acquisitionPaymentId,
                  plan: {
                    applicationFeeRefunded: true,
                    currency: payment.currency,
                    operationKey: `registration-transfer-source:${transfer.id}:${payment.id}`,
                    originalAmount: payment.amount,
                    priorRefundedAmount,
                    refundAmountDue: payment.amount - priorRefundedAmount,
                    sourceRegistrationId: lockedSource.id,
                    sourceTransactionId: payment.id,
                    sourceTransactionType: payment.type,
                    stripeAccountId: payment.stripeAccountId,
                    tenantId: tenant.id,
                    transferId: transfer.id,
                  },
                };
              });
              if (plannedRefunds.includes(undefined)) {
                return yield* new RegistrationTransferInternalError({
                  message: 'Source refunds exceed an original Stripe payment',
                });
              }
              const validPlannedRefunds = plannedRefunds.filter(
                (item) => item !== undefined,
              );
              const insertedPlans = yield* tx
                .insert(registrationTransferRefundPlanItems)
                .values(validPlannedRefunds.map(({ plan }) => plan))
                .returning({
                  id: registrationTransferRefundPlanItems.id,
                  sourceTransactionId:
                    registrationTransferRefundPlanItems.sourceTransactionId,
                });
              if (insertedPlans.length !== validPlannedRefunds.length) {
                return yield* new RegistrationTransferInternalError({
                  message: 'Source refund provenance was not persisted',
                });
              }
              yield* tx
                .insert(registrationTransferRefundPlanAcquisitionLinks)
                .values(
                  insertedPlans.map((plan) => {
                    const planned = validPlannedRefunds.find(
                      ({ plan: candidate }) =>
                        candidate.sourceTransactionId ===
                        plan.sourceTransactionId,
                    );
                    if (!planned) {
                      throw new Error(
                        'Inserted transfer refund plan lost acquisition provenance',
                      );
                    }
                    return {
                      planItemId: plan.id,
                      sourceAcquisitionId: currentAcquisition.id,
                      sourceAcquisitionPaymentId: planned.acquisitionPaymentId,
                      sourceTransactionId: plan.sourceTransactionId,
                      tenantId: tenant.id,
                    };
                  }),
                );
            }
            yield* tx.insert(registrationTransferEvents).values({
              actorUserId: user.id,
              eventType: 'created',
              tenantId: tenant.id,
              toStatus: 'open',
              transferId: transfer.id,
            });
            return {
              claimUrl,
              expiresAt: lockedExpiresAt,
              transferRows: inserted,
            };
          }),
        )
        .pipe(
          Effect.catch(
            (
              error,
            ): Effect.Effect<
              never,
              | RegistrationTransferConflictError
              | RegistrationTransferInternalError
            > => {
              if (isActiveRegistrationTransferUniqueViolation(error)) {
                return Effect.fail(
                  new RegistrationTransferConflictError({
                    message:
                      'This registration already has an active transfer offer',
                  }),
                );
              }
              if (
                error instanceof RegistrationTransferConflictError ||
                error instanceof RegistrationTransferInternalError
              ) {
                return Effect.fail(error);
              }
              return Effect.fail(
                new RegistrationTransferInternalError({
                  cause: error,
                  message: 'Registration transfer offer could not be saved',
                }),
              );
            },
          ),
        ),
    );
    if (transferResult.transferRows.length !== 1) {
      return yield* new RegistrationTransferInternalError({
        message: 'Registration transfer offer was not persisted',
      });
    }

    return RegistrationTransferOfferResult.make({
      claimCode: credentials.claimCode,
      claimUrl: transferResult.claimUrl,
      expiresAt: transferResult.expiresAt.toISOString(),
      status: 'open' as const,
    });
  },
);

const getClaim = Effect.fn('RegistrationTransferService.getClaim')(function* ({
  credential,
  tenant,
  user,
}: GetRegistrationTransferClaimInput) {
  const credentialHashes = registrationTransferCredentialHashes(credential);
  const transferRows = yield* databaseEffect((database) =>
    database
      .select({
        compensationRefundTransactionId:
          registrationTransfers.compensationRefundTransactionId,
        eventEnd: eventInstances.end,
        eventId: eventInstances.id,
        eventStart: eventInstances.start,
        eventTitle: eventInstances.title,
        expiresAt: registrationTransfers.expiresAt,
        optionDescription: eventRegistrationOptions.description,
        optionId: eventRegistrationOptions.id,
        optionIsPaid: eventRegistrationOptions.isPaid,
        optionPrice: eventRegistrationOptions.price,
        optionTitle: eventRegistrationOptions.title,
        recipientUserId: registrationTransfers.recipientUserId,
        sourceCheckedInGuestCount: eventRegistrations.checkedInGuestCount,
        sourceCheckInTime: eventRegistrations.checkInTime,
        sourceRegistrationId: registrationTransfers.sourceRegistrationId,
        sourceSpotCount: registrationTransfers.sourceSpotCount,
        status: registrationTransfers.status,
        transferId: registrationTransfers.id,
      })
      .from(registrationTransfers)
      .innerJoin(
        eventInstances,
        eq(eventInstances.id, registrationTransfers.eventId),
      )
      .innerJoin(
        eventRegistrationOptions,
        eq(
          eventRegistrationOptions.id,
          registrationTransfers.registrationOptionId,
        ),
      )
      .innerJoin(
        eventRegistrations,
        and(
          eq(eventRegistrations.id, registrationTransfers.sourceRegistrationId),
          eq(eventRegistrations.tenantId, registrationTransfers.tenantId),
        ),
      )
      .where(
        and(
          eq(registrationTransfers.tenantId, tenant.id),
          or(
            inArray(registrationTransfers.claimTokenHash, credentialHashes),
            inArray(registrationTransfers.claimCodeHash, credentialHashes),
          ),
        ),
      )
      .limit(1),
  );
  const transfer = transferRows[0];
  if (
    !transfer ||
    (transfer.recipientUserId && transfer.recipientUserId !== user.id)
  ) {
    return yield* new RegistrationTransferNotFoundError({
      message: 'Registration transfer not found',
    });
  }

  const now = getServerNow(undefined).toJSDate();
  let status = transfer.status;
  if (transfer.status === 'open' && transfer.expiresAt <= now) {
    const expired = yield* expireOpenRegistrationTransfer({
      actorUserId: user.id,
      now,
      tenantId: tenant.id,
      transferId: transfer.transferId,
    });
    if (expired) status = 'expired';
  }
  const compensationRefundTransactionId =
    transfer.compensationRefundTransactionId;
  const [
    questions,
    bundleAddOns,
    currentPrice,
    sourceRefundPlans,
    compensationRefunds,
  ] = yield* Effect.all(
    [
      databaseEffect((database) =>
        database
          .select({
            description: eventRegistrationQuestions.description,
            id: eventRegistrationQuestions.id,
            required: eventRegistrationQuestions.required,
            title: eventRegistrationQuestions.title,
          })
          .from(eventRegistrationQuestions)
          .where(
            eq(
              eventRegistrationQuestions.registrationOptionId,
              transfer.optionId,
            ),
          ),
      ),
      databaseEffect((database) =>
        database
          .select({
            cancelledQuantity:
              registrationTransferBundleAddonPurchases.cancelledQuantity,
            currentUnitPrice: eventAddons.price,
            description: eventAddons.description,
            id: eventAddons.id,
            includedQuantity:
              registrationTransferBundleAddonPurchases.includedQuantity,
            purchasedQuantity:
              registrationTransferBundleAddonPurchases.purchasedQuantity,
            quantity: registrationTransferBundleAddonPurchases.quantity,
            redeemedQuantity:
              registrationTransferBundleAddonPurchases.redeemedQuantity,
            title: eventAddons.title,
          })
          .from(registrationTransferBundleAddonPurchases)
          .innerJoin(
            eventAddons,
            and(
              eq(
                eventAddons.id,
                registrationTransferBundleAddonPurchases.addonId,
              ),
              eq(
                eventAddons.eventId,
                registrationTransferBundleAddonPurchases.eventId,
              ),
            ),
          )
          .where(
            and(
              eq(
                registrationTransferBundleAddonPurchases.transferId,
                transfer.transferId,
              ),
              eq(registrationTransferBundleAddonPurchases.tenantId, tenant.id),
            ),
          ),
      ),
      resolveCurrentRegistrationTransferPrice({
        basePrice: transfer.optionPrice,
        eventStart: transfer.eventStart,
        registrationOptionId: transfer.optionId,
        tenantId: tenant.id,
        userId: user.id,
      }).pipe(Effect.map((price) => price.effectivePrice)),
      databaseEffect((database) =>
        database
          .select({
            planItemId: registrationTransferRefundPlanItems.id,
            refund: {
              id: transactions.id,
              manuallyCreated: transactions.manuallyCreated,
              method: transactions.method,
              status: transactions.status,
              stripeRefundAttempts: transactions.stripeRefundAttempts,
              stripeRefundClaimLeaseExpiresAt:
                transactions.stripeRefundClaimLeaseExpiresAt,
              stripeRefundClaimLeaseId: transactions.stripeRefundClaimLeaseId,
              stripeRefundMaxAttempts: transactions.stripeRefundMaxAttempts,
              stripeRefundNextAttemptAt: transactions.stripeRefundNextAttemptAt,
              stripeRefundStatus: transactions.stripeRefundStatus,
            },
            refundAmountDue:
              registrationTransferRefundPlanItems.refundAmountDue,
          })
          .from(registrationTransferRefundPlanItems)
          .leftJoin(
            transactions,
            and(
              eq(
                transactions.id,
                registrationTransferRefundPlanItems.refundTransactionId,
              ),
              eq(
                transactions.tenantId,
                registrationTransferRefundPlanItems.tenantId,
              ),
              eq(transactions.type, 'refund'),
            ),
          )
          .where(
            and(
              eq(
                registrationTransferRefundPlanItems.transferId,
                transfer.transferId,
              ),
              eq(registrationTransferRefundPlanItems.tenantId, tenant.id),
            ),
          ),
      ),
      compensationRefundTransactionId
        ? databaseEffect((database) =>
            database
              .select({
                id: transactions.id,
                manuallyCreated: transactions.manuallyCreated,
                method: transactions.method,
                status: transactions.status,
                stripeRefundAttempts: transactions.stripeRefundAttempts,
                stripeRefundClaimLeaseExpiresAt:
                  transactions.stripeRefundClaimLeaseExpiresAt,
                stripeRefundClaimLeaseId: transactions.stripeRefundClaimLeaseId,
                stripeRefundMaxAttempts: transactions.stripeRefundMaxAttempts,
                stripeRefundNextAttemptAt:
                  transactions.stripeRefundNextAttemptAt,
                stripeRefundStatus: transactions.stripeRefundStatus,
              })
              .from(transactions)
              .where(
                and(
                  eq(transactions.id, compensationRefundTransactionId),
                  eq(transactions.tenantId, tenant.id),
                  eq(transactions.type, 'refund'),
                ),
              )
              .limit(1),
          )
        : Effect.succeed([]),
    ],
    { concurrency: 'unbounded' },
  );

  const refundClaims =
    status === 'compensation_pending' || status === 'compensation_failed'
      ? compensationRefunds
      : sourceRefundPlans.flatMap(({ refund, refundAmountDue }) =>
          refundAmountDue > 0 ? [refund] : [],
        );

  return RegistrationTransferClaimRecord.make({
    bundle: {
      addOns: bundleAddOns.map((addOn) => ({
        ...addOn,
        remainingQuantity:
          addOn.quantity - addOn.redeemedQuantity - addOn.cancelledQuantity,
      })),
      checkedInGuestCount: transfer.sourceCheckedInGuestCount,
      checkInTime: transfer.sourceCheckInTime?.toISOString() ?? null,
      guestCount: transfer.sourceSpotCount - 1,
      guestUnitPrice: transfer.optionPrice,
    },
    event: {
      end: transfer.eventEnd.toISOString(),
      id: transfer.eventId,
      start: transfer.eventStart.toISOString(),
      title: transfer.eventTitle,
    },
    expiresAt: transfer.expiresAt.toISOString(),
    refundLifecycle: resolveRegistrationTransferRefundLifecycle({
      refunds: refundClaims,
      transferStatus: status,
    }),
    registrationOption: {
      currency: tenant.currency,
      currentPrice,
      description: transfer.optionDescription,
      id: transfer.optionId,
      isPaid: transfer.optionIsPaid,
      questions,
      title: transfer.optionTitle,
    },
    status,
    transferId: transfer.transferId,
  });
});

const cancel = Effect.fn('RegistrationTransferService.cancel')(function* ({
  tenant,
  transferId,
  user,
}: CancelRegistrationTransferInput) {
  const preflightRows = yield* databaseEffect((database) =>
    database
      .select({
        recipientCheckoutTransactionId:
          registrationTransfers.recipientCheckoutTransactionId,
        recipientRegistrationId: registrationTransfers.recipientRegistrationId,
        status: registrationTransfers.status,
        stripeAccountId: transactions.stripeAccountId,
        stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
      })
      .from(registrationTransfers)
      .leftJoin(
        transactions,
        eq(
          transactions.id,
          registrationTransfers.recipientCheckoutTransactionId,
        ),
      )
      .where(
        and(
          eq(registrationTransfers.id, transferId),
          or(
            eq(registrationTransfers.sourceUserId, user.id),
            eq(registrationTransfers.recipientUserId, user.id),
          ),
          eq(registrationTransfers.tenantId, tenant.id),
        ),
      )
      .limit(1),
  );
  const preflight = preflightRows[0];
  if (!preflight) {
    return yield* new RegistrationTransferNotFoundError({
      message: 'Registration transfer not found',
    });
  }
  if (preflight.status === 'cancelled') return;
  if (preflight.status !== 'checkout_pending' && preflight.status !== 'open') {
    return yield* new RegistrationTransferConflictError({
      message: `Registration transfer cannot be cancelled after it is ${preflight.status.replaceAll('_', ' ')}`,
    });
  }

  let expiredCheckout:
    | undefined
    | {
        readonly sessionId: string;
        readonly stripeAccountId: string;
        readonly transactionId: string;
      };
  let pendingIdentity:
    | undefined
    | {
        readonly registrationId: string;
        readonly transactionId: string;
      };
  if (preflight.status === 'checkout_pending') {
    if (
      !preflight.recipientCheckoutTransactionId ||
      !preflight.recipientRegistrationId
    ) {
      return yield* new RegistrationTransferInternalError({
        message: 'Transfer Checkout ownership is incomplete',
      });
    }
    pendingIdentity = {
      registrationId: preflight.recipientRegistrationId,
      transactionId: preflight.recipientCheckoutTransactionId,
    };
    if (preflight.stripeCheckoutSessionId && !preflight.stripeAccountId) {
      return yield* new RegistrationTransferInternalError({
        message: 'Transfer Checkout Stripe account is missing',
      });
    }
    if (preflight.stripeCheckoutSessionId && preflight.stripeAccountId) {
      const checkoutSession = yield* retrieveHostedCheckoutSession(
        preflight.stripeCheckoutSessionId,
        preflight.stripeAccountId,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new RegistrationTransferInternalError({
              cause,
              message:
                'Checkout cancellation could not be confirmed. The source registration and transfer remain unchanged.',
            }),
        ),
      );
      if (checkoutSession.status === 'complete') {
        return yield* new RegistrationTransferConflictError({
          message:
            'Checkout already completed. Refresh while payment finalization finishes.',
        });
      }
      const expiredSession =
        checkoutSession.status === 'expired'
          ? checkoutSession
          : yield* expireHostedCheckoutSession(
              preflight.stripeCheckoutSessionId,
              preflight.stripeAccountId,
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new RegistrationTransferInternalError({
                    cause,
                    message:
                      'Checkout cancellation could not be confirmed. The source registration and transfer remain unchanged.',
                  }),
              ),
            );
      if (expiredSession.status !== 'expired') {
        return yield* new RegistrationTransferInternalError({
          message:
            'Stripe did not confirm Checkout cancellation. The source registration and transfer remain unchanged.',
        });
      }
      expiredCheckout = {
        sessionId: preflight.stripeCheckoutSessionId,
        stripeAccountId: preflight.stripeAccountId,
        transactionId: preflight.recipientCheckoutTransactionId,
      };
    }
  }

  const now = getServerNow(undefined).toJSDate();
  const cancellationResult = yield* Database.use((database) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          const prelockedRegistrationRows = pendingIdentity
            ? yield* tx
                .select({
                  status: eventRegistrations.status,
                  userId: eventRegistrations.userId,
                })
                .from(eventRegistrations)
                .where(
                  and(
                    eq(eventRegistrations.id, pendingIdentity.registrationId),
                    eq(eventRegistrations.tenantId, tenant.id),
                  ),
                )
                .for('update')
            : [];
          const prelockedPaymentRows = pendingIdentity
            ? yield* tx
                .select({
                  id: transactions.id,
                  stripeAccountId: transactions.stripeAccountId,
                  stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
                })
                .from(transactions)
                .where(
                  and(
                    eq(transactions.id, pendingIdentity.transactionId),
                    eq(
                      transactions.eventRegistrationId,
                      pendingIdentity.registrationId,
                    ),
                    eq(transactions.status, 'pending'),
                    eq(transactions.tenantId, tenant.id),
                    eq(transactions.type, 'registration'),
                  ),
                )
                .for('update')
            : [];
          const lockedRows = yield* tx
            .select({
              recipientCheckoutTransactionId:
                registrationTransfers.recipientCheckoutTransactionId,
              recipientRegistrationId:
                registrationTransfers.recipientRegistrationId,
              sourceRegistrationId: registrationTransfers.sourceRegistrationId,
              sourceUserId: registrationTransfers.sourceUserId,
              status: registrationTransfers.status,
            })
            .from(registrationTransfers)
            .where(
              and(
                eq(registrationTransfers.id, transferId),
                or(
                  eq(registrationTransfers.sourceUserId, user.id),
                  eq(registrationTransfers.recipientUserId, user.id),
                ),
                eq(registrationTransfers.status, preflight.status),
                eq(registrationTransfers.tenantId, tenant.id),
              ),
            )
            .for('update');
          const locked = lockedRows[0];
          if (!locked) return { _tag: 'Changed' as const };

          if (locked.status === 'open') {
            const cancelledTransfers = yield* tx
              .update(registrationTransfers)
              .set({ cancelledAt: now, status: 'cancelled' })
              .where(
                and(
                  eq(registrationTransfers.id, transferId),
                  eq(registrationTransfers.status, 'open'),
                  eq(registrationTransfers.tenantId, tenant.id),
                ),
              )
              .returning({ id: registrationTransfers.id });
            if (cancelledTransfers.length !== 1) {
              return { _tag: 'Changed' as const };
            }
            yield* tx.insert(registrationTransferEvents).values({
              actorUserId: user.id,
              eventType: 'cancelled',
              fromStatus: 'open',
              tenantId: tenant.id,
              toStatus: 'cancelled',
              transferId,
            });
            return { _tag: 'Cancelled' as const };
          }

          if (
            !locked.recipientCheckoutTransactionId ||
            !locked.recipientRegistrationId
          ) {
            return yield* new RegistrationTransferInternalError({
              message: 'Transfer Checkout ownership is incomplete',
            });
          }
          const registration = prelockedRegistrationRows[0];
          const payment = prelockedPaymentRows[0];
          if (
            !pendingIdentity ||
            !registration ||
            !payment ||
            registration.status !== 'CONFIRMED' ||
            registration.userId !== locked.sourceUserId ||
            locked.recipientRegistrationId !== locked.sourceRegistrationId ||
            pendingIdentity.registrationId !== locked.recipientRegistrationId ||
            pendingIdentity.transactionId !==
              locked.recipientCheckoutTransactionId
          ) {
            return { _tag: 'Changed' as const };
          }
          const checkoutBindingMatches = expiredCheckout
            ? payment.id === expiredCheckout.transactionId &&
              payment.stripeAccountId === expiredCheckout.stripeAccountId &&
              payment.stripeCheckoutSessionId === expiredCheckout.sessionId
            : payment.stripeCheckoutSessionId === null;
          if (!checkoutBindingMatches) {
            return { _tag: 'Changed' as const };
          }

          const cancelledPayments = yield* tx
            .update(transactions)
            .set({
              status: 'cancelled',
              stripeCheckoutReconcileAttempts: 0,
              stripeCheckoutReconcileLastError: null,
              stripeCheckoutReconcileLeaseExpiresAt: null,
              stripeCheckoutReconcileLeaseId: null,
              stripeCheckoutReconcileNextAt: null,
            })
            .where(
              and(
                eq(transactions.id, locked.recipientCheckoutTransactionId),
                eq(transactions.status, 'pending'),
                eq(transactions.tenantId, tenant.id),
                eq(transactions.type, 'registration'),
              ),
            )
            .returning({ id: transactions.id });
          if (cancelledPayments.length !== 1) {
            return yield* new RegistrationTransferInternalError({
              message: 'Transfer Checkout payment could not be cancelled',
            });
          }

          const cancelledTransfers = yield* tx
            .update(registrationTransfers)
            .set({
              cancelledAt: now,
              reservedAdditionalSpots: 0,
              status: 'cancelled',
            })
            .where(
              and(
                eq(registrationTransfers.id, transferId),
                eq(registrationTransfers.status, 'checkout_pending'),
                eq(registrationTransfers.tenantId, tenant.id),
              ),
            )
            .returning({ id: registrationTransfers.id });
          if (cancelledTransfers.length !== 1) {
            return { _tag: 'Changed' as const };
          }
          yield* tx.insert(registrationTransferEvents).values({
            actorUserId: user.id,
            eventType: 'cancelled',
            fromStatus: 'checkout_pending',
            tenantId: tenant.id,
            toStatus: 'cancelled',
            transferId,
          });
          return { _tag: 'Cancelled' as const };
        }),
      )
      .pipe(
        Effect.catch((error) =>
          error instanceof RegistrationTransferInternalError
            ? Effect.fail(error)
            : Effect.fail(
                new RegistrationTransferInternalError({
                  cause: error,
                  message: 'Registration transfer cancellation failed',
                }),
              ),
        ),
      ),
  );
  if (cancellationResult._tag === 'Changed') {
    return yield* new RegistrationTransferConflictError({
      message:
        'Registration transfer state changed while cancellation was starting. Refresh and retry.',
    });
  }
});

const claim = Effect.fn('RegistrationTransferService.claim')(function* ({
  answers,
  credential,
  tenant,
  user,
}: ClaimRegistrationTransferInput) {
  const now = getServerNow(undefined).toJSDate();
  const credentialHashes = registrationTransferCredentialHashes(credential);
  const claimRows = yield* databaseEffect((database) =>
    database
      .select({
        eventEnd: eventInstances.end,
        eventId: eventInstances.id,
        eventStart: eventInstances.start,
        eventStatus: eventInstances.status,
        eventTitle: eventInstances.title,
        expiresAt: registrationTransfers.expiresAt,
        optionEventId: eventRegistrationOptions.eventId,
        optionId: eventRegistrationOptions.id,
        optionPrice: eventRegistrationOptions.price,
        optionRoleIds: eventRegistrationOptions.roleIds,
        optionStripeTaxRateId: eventRegistrationOptions.stripeTaxRateId,
        recipientCheckoutTransactionId:
          registrationTransfers.recipientCheckoutTransactionId,
        recipientRegistrationId: registrationTransfers.recipientRegistrationId,
        recipientUserId: registrationTransfers.recipientUserId,
        sourceRegistrationId: registrationTransfers.sourceRegistrationId,
        sourceSpotCount: registrationTransfers.sourceSpotCount,
        sourceStatus: eventRegistrations.status,
        sourceUserId: registrationTransfers.sourceUserId,
        status: registrationTransfers.status,
        transferId: registrationTransfers.id,
      })
      .from(registrationTransfers)
      .innerJoin(
        eventRegistrations,
        eq(eventRegistrations.id, registrationTransfers.sourceRegistrationId),
      )
      .innerJoin(
        eventRegistrationOptions,
        eq(
          eventRegistrationOptions.id,
          registrationTransfers.registrationOptionId,
        ),
      )
      .innerJoin(
        eventInstances,
        eq(eventInstances.id, registrationTransfers.eventId),
      )
      .where(
        and(
          eq(registrationTransfers.tenantId, tenant.id),
          or(
            inArray(registrationTransfers.claimTokenHash, credentialHashes),
            inArray(registrationTransfers.claimCodeHash, credentialHashes),
          ),
        ),
      )
      .limit(1),
  );
  const transfer = claimRows[0];
  if (!transfer) {
    return yield* new RegistrationTransferNotFoundError({
      message: 'Registration transfer not found',
    });
  }
  if (transfer.recipientUserId && transfer.recipientUserId !== user.id) {
    return yield* new RegistrationTransferNotFoundError({
      message: 'Registration transfer not found',
    });
  }
  if (transfer.sourceUserId === user.id) {
    return yield* new RegistrationTransferConflictError({
      message: 'You cannot claim your own registration transfer',
    });
  }
  if (
    (transfer.status === 'checkout_pending' ||
      transfer.status === 'completed' ||
      transfer.status === 'refund_pending' ||
      transfer.status === 'refund_failed') &&
    transfer.recipientRegistrationId
  ) {
    if (
      transfer.status === 'checkout_pending' &&
      transfer.recipientCheckoutTransactionId
    ) {
      const recipientCheckoutTransactionId =
        transfer.recipientCheckoutTransactionId;
      const recipientRegistrationId = transfer.recipientRegistrationId;
      const paymentRows = yield* databaseEffect((database) =>
        database
          .select({
            appFee: transactions.appFee,
            currency: transactions.currency,
            id: transactions.id,
            request: transactions.stripeCheckoutRequest,
            stripeAccountId: transactions.stripeAccountId,
            stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
            stripeCheckoutUrl: transactions.stripeCheckoutUrl,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.id, recipientCheckoutTransactionId),
              eq(transactions.eventRegistrationId, recipientRegistrationId),
              eq(transactions.status, 'pending'),
              eq(transactions.tenantId, tenant.id),
            ),
          )
          .limit(1),
      );
      const payment = paymentRows[0];
      const checkoutUrl =
        payment &&
        !payment.stripeCheckoutSessionId &&
        payment.appFee !== null &&
        payment.request &&
        payment.stripeAccountId
          ? yield* resumeRegistrationTransferCheckout({
              paymentClaim: {
                appFee: payment.appFee,
                currency: payment.currency,
                id: payment.id,
                request: payment.request,
                stripeAccountId: payment.stripeAccountId,
              },
              registrationId: recipientRegistrationId,
              tenantId: tenant.id,
              transferId: transfer.transferId,
            })
          : payment?.stripeCheckoutUrl;
      if (!checkoutUrl) {
        return yield* new RegistrationTransferInternalError({
          message:
            'Transfer payment setup is incomplete. Retry Checkout without creating another transfer.',
        });
      }
      return RegistrationTransferClaimResult.make({
        checkoutUrl,
        eventId: transfer.eventId,
        registrationId: recipientRegistrationId,
        status: 'paymentPending' as const,
      });
    }
    return RegistrationTransferClaimResult.make({
      eventId: transfer.eventId,
      registrationId: transfer.recipientRegistrationId,
      status: 'confirmed' as const,
    });
  }
  if (transfer.status !== 'open') {
    return yield* new RegistrationTransferConflictError({
      message: `Registration transfer is ${transfer.status.replaceAll('_', ' ')}`,
    });
  }
  if (transfer.expiresAt <= now) {
    yield* expireOpenRegistrationTransfer({
      actorUserId: user.id,
      now,
      tenantId: tenant.id,
      transferId: transfer.transferId,
    });
    return yield* new RegistrationTransferConflictError({
      message: 'Registration transfer has expired',
    });
  }
  if (
    transfer.sourceStatus !== 'CONFIRMED' ||
    transfer.eventStatus !== 'APPROVED' ||
    transfer.optionEventId !== transfer.eventId
  ) {
    return yield* new RegistrationTransferConflictError({
      message: 'Source registration is no longer transferable',
    });
  }
  const recipientRegistrationId = transfer.sourceRegistrationId;
  const paymentTransactionId = createId();
  const recipientSpotCount = transfer.sourceSpotCount;
  const guestCount = transfer.sourceSpotCount - 1;

  const claimResult = yield* Database.use((database) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          const lockedSources = yield* tx
            .select({
              guestCount: eventRegistrations.guestCount,
              status: eventRegistrations.status,
              userId: eventRegistrations.userId,
            })
            .from(eventRegistrations)
            .where(
              and(
                eq(eventRegistrations.id, transfer.sourceRegistrationId),
                eq(eventRegistrations.status, 'CONFIRMED'),
                eq(eventRegistrations.tenantId, tenant.id),
                eq(eventRegistrations.userId, transfer.sourceUserId),
              ),
            )
            .for('update');
          const lockedSource = lockedSources[0];
          if (!lockedSource || lockedSource.guestCount !== guestCount) {
            return { _tag: 'Unavailable' as const };
          }

          const lockedTransfers = yield* tx
            .select({
              expiresAt: registrationTransfers.expiresAt,
              sourceRegistrationId: registrationTransfers.sourceRegistrationId,
              sourceUserId: registrationTransfers.sourceUserId,
              status: registrationTransfers.status,
            })
            .from(registrationTransfers)
            .where(
              and(
                eq(registrationTransfers.id, transfer.transferId),
                eq(registrationTransfers.status, 'open'),
                eq(registrationTransfers.tenantId, tenant.id),
              ),
            )
            .for('update');
          const lockedTransfer = lockedTransfers[0];
          const lockedNow = getServerNow(undefined).toJSDate();
          if (
            !lockedTransfer ||
            lockedTransfer.expiresAt <= lockedNow ||
            lockedTransfer.sourceRegistrationId !==
              transfer.sourceRegistrationId ||
            lockedTransfer.sourceUserId !== transfer.sourceUserId
          ) {
            return { _tag: 'Unavailable' as const };
          }
          const currentAcquisitionRows = yield* tx
            .select({
              eventId: registrationAcquisitions.eventId,
              id: registrationAcquisitions.id,
              ordinal: registrationAcquisitions.ordinal,
              ownerUserId: registrationAcquisitions.ownerUserId,
            })
            .from(registrationAcquisitions)
            .where(
              and(
                eq(
                  registrationAcquisitions.registrationId,
                  transfer.sourceRegistrationId,
                ),
                eq(registrationAcquisitions.tenantId, tenant.id),
              ),
            )
            .orderBy(desc(registrationAcquisitions.ordinal))
            .limit(1)
            .for('update');
          const currentAcquisition = currentAcquisitionRows[0];
          if (
            !currentAcquisition ||
            currentAcquisition.eventId !== transfer.eventId ||
            currentAcquisition.ownerUserId !== transfer.sourceUserId
          ) {
            return { _tag: 'Unavailable' as const };
          }

          const bundleSnapshots = yield* tx
            .select({
              addonId: registrationTransferBundleAddonPurchases.addonId,
              cancelledQuantity:
                registrationTransferBundleAddonPurchases.cancelledQuantity,
              id: registrationTransferBundleAddonPurchases.sourcePurchaseId,
              includedQuantity:
                registrationTransferBundleAddonPurchases.includedQuantity,
              purchasedQuantity:
                registrationTransferBundleAddonPurchases.purchasedQuantity,
              quantity: registrationTransferBundleAddonPurchases.quantity,
              redeemedQuantity:
                registrationTransferBundleAddonPurchases.redeemedQuantity,
              refundAllocatedPurchasedQuantity:
                registrationTransferBundleAddonPurchases.refundAllocatedPurchasedQuantity,
              taxRateDisplayName:
                registrationTransferBundleAddonPurchases.taxRateDisplayName,
              taxRateInclusive:
                registrationTransferBundleAddonPurchases.taxRateInclusive,
              taxRatePercentage:
                registrationTransferBundleAddonPurchases.taxRatePercentage,
              unitPrice: registrationTransferBundleAddonPurchases.unitPrice,
            })
            .from(registrationTransferBundleAddonPurchases)
            .where(
              and(
                eq(
                  registrationTransferBundleAddonPurchases.transferId,
                  transfer.transferId,
                ),
                eq(
                  registrationTransferBundleAddonPurchases.tenantId,
                  tenant.id,
                ),
              ),
            )
            .orderBy(registrationTransferBundleAddonPurchases.sourcePurchaseId)
            .for('update');
          const sourceFulfillment = yield* tx
            .select({
              addonId: eventRegistrationAddonPurchases.addonId,
              cancelledQuantity:
                eventRegistrationAddonPurchases.cancelledQuantity,
              id: eventRegistrationAddonPurchases.id,
              includedQuantity:
                eventRegistrationAddonPurchases.includedQuantity,
              purchasedQuantity:
                eventRegistrationAddonPurchases.purchasedQuantity,
              quantity: eventRegistrationAddonPurchases.quantity,
              redeemedQuantity:
                eventRegistrationAddonPurchases.redeemedQuantity,
              refundAllocatedPurchasedQuantity:
                eventRegistrationAddonPurchases.refundAllocatedPurchasedQuantity,
              taxRateDisplayName:
                eventRegistrationAddonPurchases.taxRateDisplayName,
              taxRateInclusive:
                eventRegistrationAddonPurchases.taxRateInclusive,
              taxRatePercentage:
                eventRegistrationAddonPurchases.taxRatePercentage,
              unitPrice: eventRegistrationAddonPurchases.unitPrice,
            })
            .from(eventRegistrationAddonPurchases)
            .where(
              and(
                eq(
                  eventRegistrationAddonPurchases.registrationId,
                  transfer.sourceRegistrationId,
                ),
                eq(eventRegistrationAddonPurchases.tenantId, tenant.id),
              ),
            )
            .orderBy(eventRegistrationAddonPurchases.id)
            .for('update');
          const currentSourceLots =
            sourceFulfillment.length === 0
              ? []
              : yield* tx
                  .select({
                    cancelledQuantity:
                      eventRegistrationAddonPurchaseLots.cancelledQuantity,
                    id: eventRegistrationAddonPurchaseLots.id,
                    purchaseId: eventRegistrationAddonPurchaseLots.purchaseId,
                    quantity: eventRegistrationAddonPurchaseLots.quantity,
                    redeemedQuantity:
                      eventRegistrationAddonPurchaseLots.redeemedQuantity,
                    refundAllocatedQuantity:
                      eventRegistrationAddonPurchaseLots.refundAllocatedQuantity,
                    sourceTransactionId:
                      eventRegistrationAddonPurchaseLots.sourceTransactionId,
                  })
                  .from(eventRegistrationAddonPurchaseLots)
                  .where(
                    and(
                      inArray(
                        eventRegistrationAddonPurchaseLots.purchaseId,
                        sourceFulfillment.map(({ id }) => id),
                      ),
                      eq(
                        eventRegistrationAddonPurchaseLots.tenantId,
                        tenant.id,
                      ),
                    ),
                  )
                  .orderBy(eventRegistrationAddonPurchaseLots.id)
                  .for('update');
          const sealedSourceLots = yield* tx
            .select({
              cancelledQuantity:
                registrationTransferBundleAddonPurchaseLots.cancelledQuantity,
              id: registrationTransferBundleAddonPurchaseLots.sourcePurchaseLotId,
              purchaseId:
                registrationTransferBundleAddonPurchaseLots.sourcePurchaseId,
              quantity: registrationTransferBundleAddonPurchaseLots.quantity,
              redeemedQuantity:
                registrationTransferBundleAddonPurchaseLots.redeemedQuantity,
              refundAllocatedQuantity:
                registrationTransferBundleAddonPurchaseLots.refundAllocatedQuantity,
              sourceTransactionId:
                registrationTransferBundleAddonPurchaseLots.sourceTransactionId,
            })
            .from(registrationTransferBundleAddonPurchaseLots)
            .where(
              and(
                eq(
                  registrationTransferBundleAddonPurchaseLots.transferId,
                  transfer.transferId,
                ),
                eq(
                  registrationTransferBundleAddonPurchaseLots.tenantId,
                  tenant.id,
                ),
              ),
            )
            .orderBy(
              registrationTransferBundleAddonPurchaseLots.sourcePurchaseLotId,
            )
            .for('update');
          if (
            bundleSnapshots.length !== sourceFulfillment.length ||
            bundleSnapshots.some((snapshot, index) => {
              const current = sourceFulfillment[index];
              return (
                !current ||
                snapshot.id !== current.id ||
                snapshot.addonId !== current.addonId ||
                snapshot.quantity !== current.quantity ||
                snapshot.includedQuantity !== current.includedQuantity ||
                snapshot.purchasedQuantity !== current.purchasedQuantity ||
                snapshot.redeemedQuantity !== current.redeemedQuantity ||
                snapshot.cancelledQuantity !== current.cancelledQuantity ||
                snapshot.refundAllocatedPurchasedQuantity !==
                  current.refundAllocatedPurchasedQuantity ||
                snapshot.unitPrice !== current.unitPrice ||
                snapshot.taxRateDisplayName !== current.taxRateDisplayName ||
                snapshot.taxRateInclusive !== current.taxRateInclusive ||
                snapshot.taxRatePercentage !== current.taxRatePercentage
              );
            }) ||
            sealedSourceLots.length !== currentSourceLots.length ||
            sealedSourceLots.some((snapshot, index) => {
              const current = currentSourceLots[index];
              return (
                !current ||
                snapshot.id !== current.id ||
                snapshot.purchaseId !== current.purchaseId ||
                snapshot.quantity !== current.quantity ||
                snapshot.redeemedQuantity !== current.redeemedQuantity ||
                snapshot.cancelledQuantity !== current.cancelledQuantity ||
                snapshot.refundAllocatedQuantity !==
                  current.refundAllocatedQuantity ||
                snapshot.sourceTransactionId !== current.sourceTransactionId
              );
            })
          ) {
            return { _tag: 'Unavailable' as const };
          }

          const lockedStripeAccountId = yield* lockTenantStripeAccount(
            tx,
            tenant.id,
          );
          const lockedTenants = yield* tx
            .select({
              currency: tenants.currency,
              discountProviders: tenants.discountProviders,
              domain: tenants.domain,
              emailSenderEmail: tenants.emailSenderEmail,
              emailSenderName: tenants.emailSenderName,
              id: tenants.id,
              maxActiveRegistrationsPerUser:
                tenants.maxActiveRegistrationsPerUser,
              name: tenants.name,
            })
            .from(tenants)
            .where(eq(tenants.id, tenant.id))
            .limit(1);
          const lockedTenant = lockedTenants[0];
          if (!lockedTenant) {
            return { _tag: 'NotMember' as const };
          }
          const eventUrl = yield* tenantOutboundUrl(
            lockedTenant,
            `/events/${encodeURIComponent(transfer.eventId)}`,
          ).pipe(
            Effect.mapError(
              (cause) =>
                new RegistrationTransferInternalError({
                  cause,
                  message: 'Transfer event URL could not be created',
                }),
            ),
          );

          const memberships = yield* tx
            .select({ id: usersToTenants.id })
            .from(usersToTenants)
            .where(
              and(
                eq(usersToTenants.tenantId, tenant.id),
                eq(usersToTenants.userId, user.id),
              ),
            )
            .for('update');
          const membership = memberships[0];
          if (memberships.length !== 1 || !membership) {
            return { _tag: 'NotMember' as const };
          }
          const recipientUsers = yield* tx
            .select({
              communicationEmail: users.communicationEmail,
              email: users.email,
            })
            .from(users)
            .where(eq(users.id, user.id));
          const lockedRoleAssignments = yield* tx
            .select({ roleId: rolesToTenantUsers.roleId })
            .from(rolesToTenantUsers)
            .where(
              and(
                eq(rolesToTenantUsers.tenantId, tenant.id),
                eq(rolesToTenantUsers.userTenantId, membership.id),
              ),
            )
            .for('update');
          const lockedTerms = yield* tx
            .select({
              eventStart: eventInstances.start,
              eventStatus: eventInstances.status,
              eventTitle: eventInstances.title,
              optionEventId: eventRegistrationOptions.eventId,
              optionPrice: eventRegistrationOptions.price,
              optionRoleIds: eventRegistrationOptions.roleIds,
              optionStripeTaxRateId: eventRegistrationOptions.stripeTaxRateId,
            })
            .from(eventRegistrationOptions)
            .innerJoin(
              eventInstances,
              eq(eventInstances.id, eventRegistrationOptions.eventId),
            )
            .where(
              and(
                eq(eventRegistrationOptions.id, transfer.optionId),
                eq(eventRegistrationOptions.eventId, transfer.eventId),
                eq(eventInstances.tenantId, tenant.id),
              ),
            )
            .for('update');
          const recipientUser = recipientUsers[0];
          const lockedOption = lockedTerms[0];
          if (
            !recipientUser ||
            !lockedOption ||
            lockedOption.eventStatus !== 'APPROVED' ||
            lockedOption.optionEventId !== transfer.eventId
          ) {
            return { _tag: 'Unavailable' as const };
          }
          if (
            !isUserEligibleForRegistrationOption({
              optionRoleIds: lockedOption.optionRoleIds,
              userRoleIds: lockedRoleAssignments.map(
                (assignment) => assignment.roleId,
              ),
            })
          ) {
            return { _tag: 'Ineligible' as const };
          }
          const questionRows = yield* tx
            .select({
              id: eventRegistrationQuestions.id,
              required: eventRegistrationQuestions.required,
            })
            .from(eventRegistrationQuestions)
            .where(
              eq(
                eventRegistrationQuestions.registrationOptionId,
                transfer.optionId,
              ),
            )
            .for('update');
          const answerInserts = yield* Effect.try({
            catch: (error) =>
              error instanceof EventRegistrationConflictError
                ? new RegistrationTransferConflictError({
                    message: error.message,
                  })
                : new RegistrationTransferInternalError({
                    cause: error,
                    message: 'Registration question validation failed',
                  }),
            try: () =>
              validateRegistrationQuestionAnswers({
                answers,
                questions: questionRows,
              }),
          });

          const lockedBundleAddOns =
            bundleSnapshots.length === 0
              ? []
              : yield* tx
                  .select({
                    addOnId: eventAddons.id,
                    price: eventAddons.price,
                    stripeTaxRateId: eventAddons.stripeTaxRateId,
                    title: eventAddons.title,
                  })
                  .from(eventAddons)
                  .where(
                    and(
                      eq(eventAddons.eventId, transfer.eventId),
                      inArray(
                        eventAddons.id,
                        bundleSnapshots.map(({ addonId }) => addonId),
                      ),
                    ),
                  )
                  .orderBy(eventAddons.id)
                  .for('update');
          if (lockedBundleAddOns.length !== bundleSnapshots.length) {
            return { _tag: 'TermsChanged' as const };
          }
          const taxRateIds = [
            lockedOption.optionStripeTaxRateId,
            ...lockedBundleAddOns.map((addOn) => addOn.stripeTaxRateId),
          ].filter((taxRateId): taxRateId is string => Boolean(taxRateId));
          const lockedTaxRates =
            taxRateIds.length === 0 || !lockedStripeAccountId
              ? []
              : yield* tx
                  .select({
                    displayName: tenantStripeTaxRates.displayName,
                    inclusive: tenantStripeTaxRates.inclusive,
                    percentage: tenantStripeTaxRates.percentage,
                    stripeTaxRateId: tenantStripeTaxRates.stripeTaxRateId,
                  })
                  .from(tenantStripeTaxRates)
                  .where(
                    and(
                      eq(tenantStripeTaxRates.tenantId, tenant.id),
                      eq(
                        tenantStripeTaxRates.stripeAccountId,
                        lockedStripeAccountId,
                      ),
                      eq(tenantStripeTaxRates.active, true),
                      eq(tenantStripeTaxRates.inclusive, true),
                      inArray(tenantStripeTaxRates.stripeTaxRateId, taxRateIds),
                    ),
                  )
                  .for('update');
          const lockedTaxRateById = new Map(
            lockedTaxRates.map((taxRate) => [taxRate.stripeTaxRateId, taxRate]),
          );
          if (
            taxRateIds.some(
              (taxRateId) =>
                lockedTaxRateById.get(taxRateId)?.percentage === null ||
                !lockedTaxRateById.has(taxRateId),
            )
          ) {
            return { _tag: 'TermsChanged' as const };
          }
          const pricedBundleAddOns = bundleSnapshots.map((snapshot) => {
            const addOn = lockedBundleAddOns.find(
              (candidate) => candidate.addOnId === snapshot.addonId,
            );
            if (!addOn) return;
            const taxRate = addOn.stripeTaxRateId
              ? lockedTaxRateById.get(addOn.stripeTaxRateId)
              : undefined;
            return {
              ...addOn,
              includedQuantity: snapshot.includedQuantity,
              purchasedQuantity: snapshot.purchasedQuantity,
              quantity: snapshot.quantity,
              sourcePurchaseId: snapshot.id,
              taxRateDisplayName: taxRate?.displayName ?? null,
              taxRateInclusive: taxRate?.inclusive ?? null,
              taxRatePercentage: taxRate?.percentage ?? null,
            };
          });
          if (pricedBundleAddOns.includes(undefined)) {
            return { _tag: 'TermsChanged' as const };
          }
          const bundleAddOns = pricedBundleAddOns.filter(
            (addOn) => addOn !== undefined,
          );

          const lockedDiscountCards = yield* tx
            .select({
              type: userDiscountCards.type,
              validTo: userDiscountCards.validTo,
            })
            .from(userDiscountCards)
            .where(
              and(
                eq(userDiscountCards.status, 'verified'),
                eq(userDiscountCards.tenantId, tenant.id),
                eq(userDiscountCards.userId, user.id),
              ),
            )
            .for('update');
          const lockedDiscounts = yield* tx
            .select({
              discountedPrice: eventRegistrationOptionDiscounts.discountedPrice,
              discountType: eventRegistrationOptionDiscounts.discountType,
            })
            .from(eventRegistrationOptionDiscounts)
            .where(
              eq(
                eventRegistrationOptionDiscounts.registrationOptionId,
                transfer.optionId,
              ),
            )
            .for('update');
          const providerConfig = resolveTenantDiscountProviders(
            lockedTenant.discountProviders,
          );
          const enabledDiscountTypes = new Set(
            Object.entries(providerConfig)
              .filter(([, provider]) => provider?.status === 'enabled')
              .map(([key]) => key),
          );
          const discountResolution = resolveRegistrationTransferPrice({
            basePrice: lockedOption.optionPrice,
            cards: lockedDiscountCards,
            discounts: lockedDiscounts,
            enabledDiscountTypes,
            eventStart: lockedOption.eventStart,
          });
          const selectedAddonTotal = bundleAddOns.reduce(
            (total, addOn) => total + addOn.price * addOn.purchasedQuantity,
            0,
          );
          const totalPrice = registrationTransferTotalPrice({
            addOnTotal: selectedAddonTotal,
            effectivePrice: discountResolution.effectivePrice,
            guestCount,
            guestUnitPrice: lockedOption.optionPrice,
          });
          const requiresCheckout = totalPrice > 0;
          if (requiresCheckout && !lockedStripeAccountId) {
            return { _tag: 'StripeUnavailable' as const };
          }
          const checkoutExpiresAt = requiresCheckout
            ? Math.min(
                buildCheckoutSessionExpiresAt(30, {
                  pinnedNowIso: lockedNow.toISOString(),
                }),
                Math.floor(lockedTransfer.expiresAt.getTime() / 1000),
              )
            : undefined;
          if (
            checkoutExpiresAt !== undefined &&
            checkoutExpiresAt * 1000 <=
              lockedNow.getTime() +
                stripeCheckoutMinimumRemainingMinutes * 60 * 1000
          ) {
            return { _tag: 'CheckoutWindowTooShort' as const };
          }
          const checkoutLineItems: RegistrationCheckoutSnapshot['lineItems'][number][] =
            [];
          if (discountResolution.effectivePrice > 0) {
            checkoutLineItems.push({
              name: `Registration fee for ${lockedOption.eventTitle}`,
              quantity: 1,
              ...(lockedOption.optionStripeTaxRateId && {
                taxRateId: lockedOption.optionStripeTaxRateId,
              }),
              unitAmount: discountResolution.effectivePrice,
            });
          }
          if (guestCount > 0) {
            checkoutLineItems.push({
              name: `Guest registration fee for ${lockedOption.eventTitle}`,
              quantity: guestCount,
              ...(lockedOption.optionStripeTaxRateId && {
                taxRateId: lockedOption.optionStripeTaxRateId,
              }),
              unitAmount: lockedOption.optionPrice,
            });
          }
          for (const addOn of bundleAddOns) {
            if (addOn.price <= 0 || addOn.purchasedQuantity <= 0) continue;
            checkoutLineItems.push({
              addonId: addOn.addOnId,
              allocationKey: registrationTransferAddonAllocationKey(
                transfer.transferId,
                addOn.sourcePurchaseId,
              ),
              kind: 'addon',
              name: `${addOn.title} add-on for ${lockedOption.eventTitle}`,
              quantity: addOn.purchasedQuantity,
              ...(addOn.stripeTaxRateId && {
                taxRateId: addOn.stripeTaxRateId,
              }),
              unitAmount: addOn.price,
            });
          }
          let paymentClaim: RegistrationTransferPaymentClaim | undefined;
          if (
            requiresCheckout &&
            checkoutExpiresAt !== undefined &&
            lockedStripeAccountId
          ) {
            paymentClaim = {
              appFee: Math.round(totalPrice * 0.035),
              currency: lockedTenant.currency,
              id: paymentTransactionId,
              request: {
                customerEmail: recipientUser.email,
                eventTitle: lockedOption.eventTitle,
                eventUrl,
                expiresAt: checkoutExpiresAt,
                lineItems: checkoutLineItems,
                notificationEmail:
                  recipientUser.communicationEmail?.trim() ||
                  recipientUser.email,
              },
              stripeAccountId: lockedStripeAccountId,
            };
          }
          const selectedTaxRate = lockedOption.optionStripeTaxRateId
            ? lockedTaxRateById.get(lockedOption.optionStripeTaxRateId)
            : undefined;

          const existingRecipient = yield* tx
            .select({ id: eventRegistrations.id })
            .from(eventRegistrations)
            .where(
              and(
                eq(eventRegistrations.eventId, transfer.eventId),
                not(eq(eventRegistrations.status, 'CANCELLED')),
                eq(eventRegistrations.tenantId, tenant.id),
                eq(eventRegistrations.userId, user.id),
              ),
            )
            .limit(1);
          if (existingRecipient.length > 0) {
            return { _tag: 'AlreadyRegistered' as const };
          }
          const activeLimit = Math.max(
            0,
            Math.trunc(lockedTenant.maxActiveRegistrationsPerUser ?? 0),
          );
          if (activeLimit > 0) {
            const activeFuture = yield* tx
              .select({ id: eventRegistrations.id })
              .from(eventRegistrations)
              .innerJoin(
                eventInstances,
                eq(eventInstances.id, eventRegistrations.eventId),
              )
              .where(
                and(
                  eq(eventRegistrations.tenantId, tenant.id),
                  eq(eventRegistrations.userId, user.id),
                  not(eq(eventRegistrations.status, 'CANCELLED')),
                  sql`${eventInstances.start} > ${now}`,
                ),
              )
              .limit(activeLimit);
            if (activeFuture.length >= activeLimit) {
              return { _tag: 'TenantLimit' as const };
            }
          }

          if (answerInserts.length > 0) {
            yield* tx.insert(registrationTransferAnswers).values(
              answerInserts.map((answer) => ({
                answer: answer.answer,
                questionId: answer.questionId,
                tenantId: tenant.id,
                transferId: transfer.transferId,
              })),
            );
          }

          for (const addOn of bundleAddOns) {
            const updatedSnapshots = yield* tx
              .update(registrationTransferBundleAddonPurchases)
              .set({
                recipientStripeTaxRateId: addOn.stripeTaxRateId,
                recipientTaxRateDisplayName: addOn.taxRateDisplayName,
                recipientTaxRateInclusive: addOn.taxRateInclusive,
                recipientTaxRatePercentage: addOn.taxRatePercentage,
                recipientUnitPrice: addOn.price,
              })
              .where(
                and(
                  eq(
                    registrationTransferBundleAddonPurchases.sourcePurchaseId,
                    addOn.sourcePurchaseId,
                  ),
                  eq(
                    registrationTransferBundleAddonPurchases.tenantId,
                    tenant.id,
                  ),
                  eq(
                    registrationTransferBundleAddonPurchases.transferId,
                    transfer.transferId,
                  ),
                ),
              )
              .returning({
                sourcePurchaseId:
                  registrationTransferBundleAddonPurchases.sourcePurchaseId,
              });
            if (updatedSnapshots.length !== 1) {
              return yield* new RegistrationTransferInternalError({
                message:
                  'Transfer add-on pricing changed before it could be sealed',
              });
            }
          }

          if (paymentClaim) {
            const paymentMutationNow = getServerNow(undefined).toJSDate();
            if (lockedTransfer.expiresAt <= paymentMutationNow) {
              return yield* new RegistrationTransferConflictError({
                message: 'Registration transfer has expired',
              });
            }
            if (
              paymentClaim.request.expiresAt * 1000 <=
              paymentMutationNow.getTime() +
                stripeCheckoutMinimumRemainingMinutes * 60 * 1000
            ) {
              return yield* new RegistrationTransferConflictError({
                message:
                  'There is not enough time before this transfer expires to start payment',
              });
            }
            yield* tx.insert(transactions).values({
              amount: totalPrice,
              appFee: paymentClaim.appFee,
              comment: `Registration transfer payment for ${lockedOption.eventTitle}`,
              currency: paymentClaim.currency,
              eventId: transfer.eventId,
              eventRegistrationId: recipientRegistrationId,
              executiveUserId: user.id,
              id: paymentClaim.id,
              method: 'stripe',
              status: 'pending',
              stripeAccountId: paymentClaim.stripeAccountId,
              stripeCheckoutRequest: paymentClaim.request,
              targetUserId: user.id,
              tenantId: tenant.id,
              type: 'registration',
            });
            yield* tx
              .update(registrationTransfers)
              .set({
                recipientAppliedDiscountedPrice:
                  discountResolution.appliedDiscountedPrice,
                recipientAppliedDiscountType:
                  discountResolution.appliedDiscountType,
                recipientBasePrice: lockedOption.optionPrice,
                recipientCheckoutTransactionId: paymentClaim.id,
                recipientDiscountAmount: discountResolution.discountAmount,
                recipientRegistrationId,
                recipientSpotCount,
                recipientStripeTaxRateId: lockedOption.optionStripeTaxRateId,
                recipientTaxRateDisplayName: selectedTaxRate?.displayName,
                recipientTaxRateInclusive: selectedTaxRate?.inclusive,
                recipientTaxRatePercentage: selectedTaxRate?.percentage,
                recipientUserId: user.id,
                reservedAdditionalSpots: 0,
                status: 'checkout_pending',
              })
              .where(
                and(
                  eq(registrationTransfers.id, transfer.transferId),
                  eq(registrationTransfers.status, 'open'),
                  eq(registrationTransfers.tenantId, tenant.id),
                ),
              );
            yield* tx.insert(registrationTransferEvents).values([
              {
                actorUserId: user.id,
                eventType: 'claimed',
                fromStatus: 'open',
                tenantId: tenant.id,
                toStatus: 'checkout_pending',
                transferId: transfer.transferId,
              },
              {
                actorUserId: user.id,
                eventType: 'checkout_started',
                fromStatus: 'open',
                tenantId: tenant.id,
                toStatus: 'checkout_pending',
                transferId: transfer.transferId,
              },
            ]);
            return {
              _tag: 'PaymentPending' as const,
              paymentClaim,
              refundClaimIds: [] as const,
            };
          }

          const currentAcquisitionPayments = yield* tx
            .select({
              id: registrationAcquisitionPayments.id,
              transactionId: registrationAcquisitionPayments.transactionId,
            })
            .from(registrationAcquisitionPayments)
            .where(
              and(
                eq(
                  registrationAcquisitionPayments.acquisitionId,
                  currentAcquisition.id,
                ),
                eq(registrationAcquisitionPayments.tenantId, tenant.id),
              ),
            )
            .orderBy(registrationAcquisitionPayments.transactionId)
            .for('update');

          const refundPlans = yield* tx
            .select({
              applicationFeeRefunded:
                registrationTransferRefundPlanItems.applicationFeeRefunded,
              currency: registrationTransferRefundPlanItems.currency,
              id: registrationTransferRefundPlanItems.id,
              operationKey: registrationTransferRefundPlanItems.operationKey,
              originalAmount:
                registrationTransferRefundPlanItems.originalAmount,
              priorRefundedAmount:
                registrationTransferRefundPlanItems.priorRefundedAmount,
              refundAmountDue:
                registrationTransferRefundPlanItems.refundAmountDue,
              refundTransactionId:
                registrationTransferRefundPlanItems.refundTransactionId,
              sourceAcquisitionId:
                registrationTransferRefundPlanAcquisitionLinks.sourceAcquisitionId,
              sourceAcquisitionPaymentId:
                registrationTransferRefundPlanAcquisitionLinks.sourceAcquisitionPaymentId,
              sourceAmount: transactions.amount,
              sourceCurrency: transactions.currency,
              sourceMethod: transactions.method,
              sourceStatus: transactions.status,
              sourceStripeAccountId: transactions.stripeAccountId,
              sourceStripeChargeId: transactions.stripeChargeId,
              sourceStripePaymentIntentId: transactions.stripePaymentIntentId,
              sourceTargetUserId: transactions.targetUserId,
              sourceTransactionId:
                registrationTransferRefundPlanItems.sourceTransactionId,
              sourceTransactionType: transactions.type,
              stripeAccountId:
                registrationTransferRefundPlanItems.stripeAccountId,
            })
            .from(registrationTransferRefundPlanItems)
            .innerJoin(
              registrationTransferRefundPlanAcquisitionLinks,
              and(
                eq(
                  registrationTransferRefundPlanAcquisitionLinks.planItemId,
                  registrationTransferRefundPlanItems.id,
                ),
                eq(
                  registrationTransferRefundPlanAcquisitionLinks.sourceTransactionId,
                  registrationTransferRefundPlanItems.sourceTransactionId,
                ),
                eq(
                  registrationTransferRefundPlanAcquisitionLinks.tenantId,
                  registrationTransferRefundPlanItems.tenantId,
                ),
              ),
            )
            .innerJoin(
              registrationAcquisitionPayments,
              and(
                eq(
                  registrationAcquisitionPayments.id,
                  registrationTransferRefundPlanAcquisitionLinks.sourceAcquisitionPaymentId,
                ),
                eq(
                  registrationAcquisitionPayments.acquisitionId,
                  registrationTransferRefundPlanAcquisitionLinks.sourceAcquisitionId,
                ),
                eq(
                  registrationAcquisitionPayments.transactionId,
                  registrationTransferRefundPlanAcquisitionLinks.sourceTransactionId,
                ),
                eq(
                  registrationAcquisitionPayments.tenantId,
                  registrationTransferRefundPlanAcquisitionLinks.tenantId,
                ),
              ),
            )
            .innerJoin(
              transactions,
              and(
                eq(
                  transactions.id,
                  registrationTransferRefundPlanItems.sourceTransactionId,
                ),
                eq(
                  transactions.tenantId,
                  registrationTransferRefundPlanItems.tenantId,
                ),
              ),
            )
            .where(
              and(
                eq(
                  registrationTransferRefundPlanItems.transferId,
                  transfer.transferId,
                ),
                eq(registrationTransferRefundPlanItems.tenantId, tenant.id),
              ),
            )
            .orderBy(registrationTransferRefundPlanItems.sourceTransactionId)
            .for('update');
          const sourceTransactionIds = refundPlans.map(
            ({ sourceTransactionId }) => sourceTransactionId,
          );
          const priorRefunds =
            sourceTransactionIds.length === 0
              ? []
              : yield* tx
                  .select({
                    amount: transactions.amount,
                    method: transactions.method,
                    sourceTransactionId: transactions.sourceTransactionId,
                    status: transactions.status,
                    stripeRefundStatus: transactions.stripeRefundStatus,
                  })
                  .from(transactions)
                  .where(
                    and(
                      eq(transactions.tenantId, tenant.id),
                      eq(transactions.type, 'refund'),
                      inArray(
                        transactions.sourceTransactionId,
                        sourceTransactionIds,
                      ),
                    ),
                  )
                  .orderBy(transactions.id)
                  .for('update');
          const priorRefundedBySource = new Map<string, number>();
          for (const refund of priorRefunds) {
            if (
              !refund.sourceTransactionId ||
              refund.amount >= 0 ||
              refund.method !== 'stripe' ||
              refund.status !== 'successful' ||
              refund.stripeRefundStatus !== 'succeeded'
            ) {
              return { _tag: 'Unavailable' as const };
            }
            priorRefundedBySource.set(
              refund.sourceTransactionId,
              (priorRefundedBySource.get(refund.sourceTransactionId) ?? 0) -
                refund.amount,
            );
          }
          if (
            !refundPlansExactlyCoverCurrentAcquisitionPayments({
              currentAcquisitionId: currentAcquisition.id,
              currentPayments: currentAcquisitionPayments,
              refundPlans,
            }) ||
            refundPlans.some(
              (plan) =>
                plan.refundTransactionId !== null ||
                plan.sourceAcquisitionId !== currentAcquisition.id ||
                !plan.sourceAcquisitionPaymentId ||
                plan.sourceAmount !== plan.originalAmount ||
                plan.sourceCurrency !== plan.currency ||
                plan.sourceMethod !== 'stripe' ||
                plan.sourceStatus !== 'successful' ||
                plan.sourceStripeAccountId !== plan.stripeAccountId ||
                (!plan.sourceStripeChargeId &&
                  !plan.sourceStripePaymentIntentId) ||
                plan.sourceTargetUserId !== transfer.sourceUserId ||
                (plan.sourceTransactionType !== 'registration' &&
                  plan.sourceTransactionType !== 'addon') ||
                (priorRefundedBySource.get(plan.sourceTransactionId) ?? 0) !==
                  plan.priorRefundedAmount,
            )
          ) {
            return { _tag: 'Unavailable' as const };
          }

          const recipientAcquisitionTerms = [
            {
              allocationKey: 'registration',
              baseAmount: 0,
              id: 'registration',
              kind: 'registration' as const,
              quantity: recipientSpotCount,
              taxRateDisplayName: selectedTaxRate?.displayName ?? null,
              taxRateInclusive: selectedTaxRate?.inclusive ?? null,
              taxRatePercentage: selectedTaxRate?.percentage ?? null,
            },
            ...currentSourceLots.flatMap((lot) => {
              const addOn = bundleAddOns.find(
                ({ sourcePurchaseId }) => sourcePurchaseId === lot.purchaseId,
              );
              return addOn
                ? [
                    {
                      allocationKey: `addon-lot:${lot.id}`,
                      baseAmount: 0,
                      id: `addon-lot:${lot.id}`,
                      kind: 'addon_lot' as const,
                      purchaseId: lot.purchaseId,
                      purchaseLotId: lot.id,
                      quantity: lot.quantity,
                      taxRateDisplayName: addOn.taxRateDisplayName,
                      taxRateInclusive: addOn.taxRateInclusive,
                      taxRatePercentage: addOn.taxRatePercentage,
                    },
                  ]
                : [];
            }),
          ];
          const recipientAcquisitionComponents =
            settleAcquisitionComponentTerms({
              terms: recipientAcquisitionTerms,
            });
          if (
            !recipientAcquisitionComponents ||
            recipientAcquisitionTerms.length !== currentSourceLots.length + 1
          ) {
            return { _tag: 'TermsChanged' as const };
          }
          const ownershipMutationNow = getServerNow(undefined).toJSDate();
          if (lockedTransfer.expiresAt <= ownershipMutationNow) {
            return yield* new RegistrationTransferConflictError({
              message: 'Registration transfer has expired',
            });
          }
          const completedAt = ownershipMutationNow;
          const transferredRegistrations = yield* tx
            .update(eventRegistrations)
            .set({
              appliedDiscountedPrice: discountResolution.appliedDiscountedPrice,
              appliedDiscountType: discountResolution.appliedDiscountType,
              basePriceAtRegistration: lockedOption.optionPrice,
              discountAmount: discountResolution.discountAmount,
              stripeTaxRateId: lockedOption.optionStripeTaxRateId,
              taxRateDisplayName: selectedTaxRate?.displayName,
              taxRateInclusive: selectedTaxRate?.inclusive,
              taxRatePercentage: selectedTaxRate?.percentage,
              userId: user.id,
            })
            .where(
              and(
                eq(eventRegistrations.id, transfer.sourceRegistrationId),
                eq(eventRegistrations.status, 'CONFIRMED'),
                eq(eventRegistrations.tenantId, tenant.id),
                eq(eventRegistrations.userId, transfer.sourceUserId),
              ),
            )
            .returning({ id: eventRegistrations.id });
          if (transferredRegistrations.length !== 1) {
            return { _tag: 'Unavailable' as const };
          }
          yield* establishRegistrationAcquisition(tx, {
            acquiredAt: completedAt,
            components: recipientAcquisitionComponents,
            currency: lockedTenant.currency,
            eventId: transfer.eventId,
            kind: 'claim_transfer',
            operationKey: `registration-transfer:${transfer.transferId}`,
            ownerUserId: user.id,
            registrationId: recipientRegistrationId,
            spotCount: recipientSpotCount,
            tenantId: tenant.id,
            transferId: transfer.transferId,
          }).pipe(
            Effect.mapError(
              (cause) =>
                new RegistrationTransferInternalError({
                  cause,
                  message:
                    'Recipient acquisition could not be established after transfer',
                }),
            ),
          );

          yield* tx
            .delete(eventRegistrationQuestionAnswers)
            .where(
              eq(
                eventRegistrationQuestionAnswers.registrationId,
                recipientRegistrationId,
              ),
            );
          if (answerInserts.length > 0) {
            yield* tx.insert(eventRegistrationQuestionAnswers).values(
              answerInserts.map((answer) => ({
                answer: answer.answer,
                questionId: answer.questionId,
                registrationId: recipientRegistrationId,
              })),
            );
          }

          const refundClaimIds: string[] = [];
          for (const plan of refundPlans) {
            if (plan.refundAmountDue === 0) continue;
            const refundClaim = yield* createRegistrationRefundClaim(tx, {
              amount: plan.refundAmountDue,
              applicationFeeRefunded: plan.applicationFeeRefunded,
              currency: plan.currency,
              eventId: transfer.eventId,
              eventRegistrationId: transfer.sourceRegistrationId,
              executiveUserId: transfer.sourceUserId,
              operationKey: plan.operationKey,
              sourceTransactionId: plan.sourceTransactionId,
              stripeAccountId: plan.stripeAccountId,
              targetUserId: transfer.sourceUserId,
              tenantId: tenant.id,
            });
            const attachedPlans = yield* tx
              .update(registrationTransferRefundPlanItems)
              .set({ refundTransactionId: refundClaim.id })
              .where(
                and(
                  eq(registrationTransferRefundPlanItems.id, plan.id),
                  isNull(
                    registrationTransferRefundPlanItems.refundTransactionId,
                  ),
                  eq(registrationTransferRefundPlanItems.tenantId, tenant.id),
                  eq(
                    registrationTransferRefundPlanItems.transferId,
                    transfer.transferId,
                  ),
                ),
              )
              .returning({ id: registrationTransferRefundPlanItems.id });
            if (attachedPlans.length !== 1) {
              return yield* new RegistrationTransferInternalError({
                message: 'Source refund plan changed during transfer',
              });
            }
            refundClaimIds.push(refundClaim.id);
          }

          const sourceUsers = yield* tx
            .select({
              communicationEmail: users.communicationEmail,
              email: users.email,
            })
            .from(users)
            .where(eq(users.id, transfer.sourceUserId))
            .limit(1);
          const sourceUser = sourceUsers[0];
          if (!sourceUser) {
            return yield* new RegistrationTransferInternalError({
              message: 'Source registration owner is missing',
            });
          }
          yield* enqueueRegistrationTransferredEmail(tx, {
            eventTitle: lockedOption.eventTitle,
            eventUrl,
            recipientRole: 'previousOwner',
            recipientUserId: transfer.sourceUserId,
            registrationId: recipientRegistrationId,
            tenant: lockedTenant,
            to: sourceUser.communicationEmail?.trim() || sourceUser.email,
          });
          yield* enqueueRegistrationTransferredEmail(tx, {
            eventTitle: lockedOption.eventTitle,
            eventUrl,
            recipientRole: 'newOwner',
            recipientUserId: user.id,
            registrationId: recipientRegistrationId,
            tenant: lockedTenant,
            to: recipientUser.communicationEmail?.trim() || recipientUser.email,
          });
          const nextStatus =
            refundClaimIds.length > 0 ? 'refund_pending' : 'completed';
          const completedTransfers = yield* tx
            .update(registrationTransfers)
            .set({
              completedAt: refundClaimIds.length > 0 ? null : completedAt,
              ownershipTransferredAt: completedAt,
              recipientAppliedDiscountedPrice:
                discountResolution.appliedDiscountedPrice,
              recipientAppliedDiscountType:
                discountResolution.appliedDiscountType,
              recipientBasePrice: lockedOption.optionPrice,
              recipientConfirmedAt: completedAt,
              recipientDiscountAmount: discountResolution.discountAmount,
              recipientRegistrationId,
              recipientSpotCount,
              recipientStripeTaxRateId: lockedOption.optionStripeTaxRateId,
              recipientTaxRateDisplayName: selectedTaxRate?.displayName,
              recipientTaxRateInclusive: selectedTaxRate?.inclusive,
              recipientTaxRatePercentage: selectedTaxRate?.percentage,
              recipientUserId: user.id,
              reservedAdditionalSpots: 0,
              status: nextStatus,
            })
            .where(
              and(
                eq(registrationTransfers.id, transfer.transferId),
                eq(registrationTransfers.status, 'open'),
                eq(registrationTransfers.tenantId, tenant.id),
              ),
            )
            .returning({ id: registrationTransfers.id });
          if (completedTransfers.length !== 1) {
            return yield* new RegistrationTransferInternalError({
              message: 'Transfer state changed during ownership reassignment',
            });
          }
          yield* tx.insert(registrationTransferEvents).values([
            {
              actorUserId: user.id,
              eventType: 'claimed',
              fromStatus: 'open',
              tenantId: tenant.id,
              toStatus: nextStatus,
              transferId: transfer.transferId,
            },
            {
              actorUserId: user.id,
              eventType: 'recipient_confirmed',
              fromStatus: 'open',
              tenantId: tenant.id,
              toStatus: nextStatus,
              transferId: transfer.transferId,
            },
            {
              actorUserId: user.id,
              eventType: 'ownership_transferred',
              fromStatus: 'open',
              tenantId: tenant.id,
              toStatus: nextStatus,
              transferId: transfer.transferId,
            },
            ...(refundClaimIds.length > 0
              ? [
                  {
                    actorUserId: user.id,
                    eventType: 'refund_queued' as const,
                    fromStatus: 'open' as const,
                    tenantId: tenant.id,
                    toStatus: 'refund_pending' as const,
                    transferId: transfer.transferId,
                  },
                ]
              : []),
          ]);
          return {
            _tag: 'Confirmed' as const,
            paymentClaim: undefined,
            refundClaimIds,
          };
        }),
      )
      .pipe(
        Effect.catch((error) =>
          error instanceof RegistrationTransferConflictError ||
          error instanceof RegistrationTransferInternalError
            ? Effect.fail(error)
            : Effect.fail(
                new RegistrationTransferInternalError({
                  cause: error,
                  message: 'Registration transfer claim failed',
                }),
              ),
        ),
      ),
  );
  switch (claimResult._tag) {
    case 'AlreadyRegistered': {
      return yield* new RegistrationTransferConflictError({
        message: 'You already have an active registration for this event',
      });
    }
    case 'CheckoutWindowTooShort': {
      return yield* new RegistrationTransferConflictError({
        message:
          'There is not enough time before this transfer expires to start payment',
      });
    }
    case 'Confirmed': {
      for (const refundClaimId of claimResult.refundClaimIds) {
        yield* processRegistrationRefundClaim(refundClaimId).pipe(
          Effect.catchCause((cause) => {
            const interruptReasons = cause.reasons.filter(
              (reason): reason is Cause.Interrupt =>
                Cause.isInterruptReason(reason),
            );
            return interruptReasons.length > 0
              ? Effect.failCause(Cause.fromReasons<never>(interruptReasons))
              : Effect.logError(
                  'Registration transfer refund remains queued after immediate processing failed',
                ).pipe(
                  Effect.annotateLogs({
                    cause: String(cause),
                    refundClaimId,
                    transferId: transfer.transferId,
                  }),
                );
          }),
        );
      }
      return RegistrationTransferClaimResult.make({
        eventId: transfer.eventId,
        registrationId: recipientRegistrationId,
        status: 'confirmed' as const,
      });
    }
    case 'Ineligible': {
      return yield* new RegistrationTransferConflictError({
        message: 'You are not eligible for this registration option',
      });
    }
    case 'NotMember': {
      return yield* new RegistrationTransferNotFoundError({
        message: 'Registration transfer not found',
      });
    }
    case 'PaymentPending': {
      const checkoutUrl = yield* resumeRegistrationTransferCheckout({
        paymentClaim: claimResult.paymentClaim,
        registrationId: recipientRegistrationId,
        tenantId: tenant.id,
        transferId: transfer.transferId,
      });
      return RegistrationTransferClaimResult.make({
        checkoutUrl,
        eventId: transfer.eventId,
        registrationId: recipientRegistrationId,
        status: 'paymentPending' as const,
      });
    }
    case 'StripeUnavailable': {
      return yield* new RegistrationTransferInternalError({
        message: 'Tenant Stripe account is not configured',
      });
    }
    case 'TenantLimit': {
      return yield* new RegistrationTransferConflictError({
        message: 'Active registration limit reached',
      });
    }
    case 'TermsChanged': {
      return yield* new RegistrationTransferConflictError({
        message:
          'Registration pricing or tax terms changed while claiming. Review the current details and retry.',
      });
    }
    case 'Unavailable': {
      return yield* new RegistrationTransferConflictError({
        message: 'Registration transfer is no longer available',
      });
    }
  }
});

const retryCheckout = Effect.fn('RegistrationTransferService.retryCheckout')(
  function* ({
    tenant,
    transferId,
    user,
  }: RetryRegistrationTransferCheckoutInput) {
    const rows = yield* databaseEffect((database) =>
      database
        .select({
          appFee: transactions.appFee,
          currency: transactions.currency,
          recipientRegistrationId:
            registrationTransfers.recipientRegistrationId,
          request: transactions.stripeCheckoutRequest,
          stripeAccountId: transactions.stripeAccountId,
          stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
          stripeCheckoutUrl: transactions.stripeCheckoutUrl,
          transactionId: transactions.id,
        })
        .from(registrationTransfers)
        .innerJoin(
          transactions,
          eq(
            transactions.id,
            registrationTransfers.recipientCheckoutTransactionId,
          ),
        )
        .where(
          and(
            eq(registrationTransfers.id, transferId),
            eq(registrationTransfers.recipientUserId, user.id),
            eq(registrationTransfers.status, 'checkout_pending'),
            eq(registrationTransfers.tenantId, tenant.id),
            eq(transactions.status, 'pending'),
            eq(transactions.tenantId, tenant.id),
            eq(transactions.type, 'registration'),
          ),
        )
        .limit(1),
    );
    const row = rows[0];
    if (!row?.recipientRegistrationId) {
      return yield* new RegistrationTransferNotFoundError({
        message: 'Pending transfer Checkout not found',
      });
    }
    const recipientRegistrationId = row.recipientRegistrationId;
    if (row.stripeCheckoutSessionId) {
      if (!row.stripeAccountId || !row.stripeCheckoutUrl) {
        return yield* new RegistrationTransferInternalError({
          message:
            'Persisted transfer Checkout ownership is incomplete and cannot be retried automatically',
        });
      }
      const checkoutSession = yield* retrieveHostedCheckoutSession(
        row.stripeCheckoutSessionId,
        row.stripeAccountId,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new RegistrationTransferInternalError({
              cause,
              message:
                'Transfer Checkout status could not be verified. Refresh and retry.',
            }),
        ),
      );
      if (checkoutSession.status === 'open') {
        return RegistrationTransferRetryCheckoutResult.make({
          checkoutUrl: row.stripeCheckoutUrl,
          status: 'paymentPending' as const,
        });
      }
      if (checkoutSession.status === 'complete') {
        yield* completePaidRegistrationCheckout(
          {
            registrationId: recipientRegistrationId,
            stripeAccountId: row.stripeAccountId,
            stripeCheckoutSessionId: row.stripeCheckoutSessionId,
            tenantId: tenant.id,
            transactionId: row.transactionId,
          },
          checkoutSession,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new RegistrationTransferInternalError({
                cause,
                message:
                  'Completed transfer Checkout could not be reconciled. Refresh and retry.',
              }),
          ),
        );
        return RegistrationTransferRetryCheckoutResult.make({
          status: 'reconciled' as const,
        });
      }
      if (checkoutSession.status === 'expired') {
        yield* databaseEffect((database) =>
          database.transaction((tx) =>
            expireRegistrationTransferCheckout(tx, {
              registrationId: recipientRegistrationId,
              tenantId: tenant.id,
              transactionId: row.transactionId,
            }),
          ),
        );
        return yield* new RegistrationTransferConflictError({
          message:
            'Checkout expired. The source registration bundle is unchanged; start a new transfer offer if needed.',
        });
      }
      return yield* new RegistrationTransferConflictError({
        message: 'Transfer Checkout is no longer available.',
      });
    }
    if (
      row.appFee === null ||
      !row.request ||
      !row.stripeAccountId ||
      row.stripeCheckoutSessionId
    ) {
      return yield* new RegistrationTransferInternalError({
        message:
          'Transfer payment setup is incomplete and cannot be retried automatically',
      });
    }
    const checkoutUrl = yield* resumeRegistrationTransferCheckout({
      paymentClaim: {
        appFee: row.appFee,
        currency: row.currency,
        id: row.transactionId,
        request: row.request,
        stripeAccountId: row.stripeAccountId,
      },
      registrationId: recipientRegistrationId,
      tenantId: tenant.id,
      transferId,
    });
    yield* databaseEffect((database) =>
      database.insert(registrationTransferEvents).values({
        actorUserId: user.id,
        eventType: 'checkout_retried',
        fromStatus: 'checkout_pending',
        tenantId: tenant.id,
        toStatus: 'checkout_pending',
        transferId,
      }),
    );
    return RegistrationTransferRetryCheckoutResult.make({
      checkoutUrl,
      status: 'paymentPending' as const,
    });
  },
);

export class RegistrationTransferService extends Context.Service<RegistrationTransferService>()(
  '@server/registrations/RegistrationTransferService',
  {
    make: Effect.succeed({
      cancel,
      claim,
      createOffer,
      getClaim,
      retryCheckout,
    }),
  },
) {
  static readonly Default = Layer.effect(
    RegistrationTransferService,
    RegistrationTransferService.make,
  );
}
