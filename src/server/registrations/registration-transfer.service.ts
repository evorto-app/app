import type { DatabaseClient } from '@db/index';
import type {
  RegistrationTransferAddonInput,
  RegistrationTransferAnswerInput,
} from '@shared/rpc-contracts/app-rpcs/registration-transfers.rpcs';
import type Stripe from 'stripe';

import { createId } from '@db/create-id';
import { Database } from '@db/index';
import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrationQuestions,
  eventRegistrations,
  type RegistrationCheckoutSnapshot,
  registrationTransferEvents,
  registrationTransfers,
  rolesToTenantUsers,
  tenants,
  tenantStripeTaxRates,
  transactions,
  userDiscountCards,
  users,
  usersToTenants,
} from '@db/schema';
import { registrationSpotCount } from '@shared/registration-spots';
import {
  RegistrationTransferConflictError,
  RegistrationTransferInternalError,
  RegistrationTransferNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/registration-transfers.errors';
import {
  resolveTenantDiscountProviders,
  type TenantDiscountProviders,
} from '@shared/tenant-config';
import { and, eq, gte, inArray, isNull, not, or, sql } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';

import type { Tenant } from '../../types/custom/tenant';
import type { User } from '../../types/custom/user';

import { getServerNow } from '../clock';
import {
  isUserEligibleForRegistrationOption,
  validateRegistrationAddons,
  validateRegistrationQuestionAnswers,
} from '../effect/rpc/handlers/events/event-registration.service';
import { EventRegistrationConflictError } from '../effect/rpc/handlers/events/events.errors';
import {
  buildCheckoutSessionExpiresAt,
  buildCheckoutSessionIdempotencyKey,
  createHostedCheckoutSession,
  expireHostedCheckoutSession,
  retrieveHostedCheckoutSession,
} from '../integrations/stripe-checkout';
import { enqueueRegistrationTransferredEmail } from '../notifications/email-delivery';
import { lockTenantStripeAccount } from '../payments/pending-stripe-obligations';
import {
  ensureRegistrationPaymentFeeSnapshot,
  RegistrationPaymentFeeSnapshotRetryableError,
} from '../payments/registration-payment-fee-snapshot';
import {
  createRegistrationRefundClaim,
  processRegistrationRefundClaim,
} from '../payments/registration-refund';
import { tenantOutboundUrl } from '../tenant-outbound-url';
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
import {
  registrationTransferCapacityDelta,
  type RegistrationTransferRefundPlan,
  resolveRegistrationFeeRefund,
  resolveRegistrationTransferDeadline,
  resolveRegistrationTransferRefundPlan,
} from './registration-transfer-state';

interface CancelRegistrationTransferInput {
  readonly tenant: TransferTenant;
  readonly transferId: string;
  readonly user: TransferUser;
}

interface ClaimRegistrationTransferInput {
  readonly addOns: readonly RegistrationTransferAddonInput[];
  readonly answers: readonly RegistrationTransferAnswerInput[];
  readonly credential: string;
  readonly guestCount: number;
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
  | 'canonicalRootUrl'
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

const resumeRegistrationTransferCheckout = Effect.fn(
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
    ).pipe(Effect.ignore);
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
          checkInTime: true,
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
              refundFeesOnCancellation: true,
              transferDeadlineHoursBeforeStart: true,
            },
          },
          transactions: {
            columns: {
              amount: true,
              id: true,
              method: true,
              status: true,
              stripeNetAmount: true,
              type: true,
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
    if (source.checkInTime) {
      return yield* new RegistrationTransferConflictError({
        message: 'Checked-in registrations cannot be transferred',
      });
    }
    if (source.event.status !== 'APPROVED') {
      return yield* new RegistrationTransferConflictError({
        message: 'The event is not open for registration transfer',
      });
    }

    const expiresAt = yield* resolveRegistrationTransferDeadline({
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
    const successfulPayments = source.transactions.filter(
      (transaction) =>
        transaction.amount > 0 &&
        transaction.status === 'successful' &&
        transaction.type === 'registration',
    );
    if (successfulPayments.length > 1) {
      return yield* new RegistrationTransferInternalError({
        message: 'Registration has multiple successful payment owners',
      });
    }
    const sourcePayment = successfulPayments[0];
    if (sourcePayment && sourcePayment.method !== 'stripe') {
      return yield* new RegistrationTransferConflictError({
        message:
          'Only Stripe-paid registrations can use automatic paid transfer',
      });
    }
    const refundFees = resolveRegistrationFeeRefund({
      optionRefundFees: source.registrationOption.refundFeesOnCancellation,
      tenantRefundFees: tenant.refundFeesOnCancellation ?? true,
    });
    let refundPlan: RegistrationTransferRefundPlan | undefined;
    if (
      sourcePayment &&
      (refundFees || sourcePayment.stripeNetAmount !== null)
    ) {
      refundPlan = yield* resolveRegistrationTransferRefundPlan(
        {
          amount: sourcePayment.amount,
          stripeNetAmount: sourcePayment.stripeNetAmount,
        },
        refundFees,
      ).pipe(
        Effect.mapError(
          (error) =>
            new RegistrationTransferInternalError({
              message: error.message,
            }),
        ),
      );
    }
    const credentials = createRegistrationTransferCredentials();

    const transferResult = yield* Database.use((database) =>
      database
        .transaction((tx) =>
          Effect.gen(function* () {
            const lockedSources = yield* tx
              .select({
                checkedInGuestCount: eventRegistrations.checkedInGuestCount,
                checkInTime: eventRegistrations.checkInTime,
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
              lockedSource.checkInTime !== null ||
              lockedSource.checkedInGuestCount !== 0 ||
              lockedSource.eventId !== source.eventId ||
              lockedSource.registrationOptionId !== source.registrationOptionId
            ) {
              return yield* new RegistrationTransferConflictError({
                message:
                  'Source registration changed before the transfer offer could be created',
              });
            }

            if (sourcePayment) {
              const lockedSourcePayments = yield* tx
                .select({ id: transactions.id })
                .from(transactions)
                .where(
                  and(
                    eq(transactions.id, sourcePayment.id),
                    eq(transactions.eventRegistrationId, lockedSource.id),
                    eq(transactions.status, 'successful'),
                    eq(transactions.tenantId, tenant.id),
                    eq(transactions.type, 'registration'),
                  ),
                )
                .for('update');
              if (lockedSourcePayments.length !== 1) {
                return yield* new RegistrationTransferConflictError({
                  message:
                    'Source payment changed before the transfer offer could be created',
                });
              }
            }
            const sourceAddOnEntitlements = yield* tx
              .select({
                cancelledQuantity:
                  eventRegistrationAddonPurchases.cancelledQuantity,
                id: eventRegistrationAddonPurchases.id,
                redeemedQuantity:
                  eventRegistrationAddonPurchases.redeemedQuantity,
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
            if (sourceAddOnEntitlements.length > 0) {
              yield* tx
                .select({ id: eventRegistrationAddonPurchaseLots.id })
                .from(eventRegistrationAddonPurchaseLots)
                .where(
                  and(
                    inArray(
                      eventRegistrationAddonPurchaseLots.purchaseId,
                      sourceAddOnEntitlements.map(({ id }) => id),
                    ),
                    eq(eventRegistrationAddonPurchaseLots.tenantId, tenant.id),
                  ),
                )
                .orderBy(eventRegistrationAddonPurchaseLots.id)
                .for('update');
            }
            if (
              sourceAddOnEntitlements.some(
                (entitlement) =>
                  entitlement.redeemedQuantity > 0 ||
                  entitlement.cancelledQuantity > 0,
              )
            ) {
              return yield* new RegistrationTransferConflictError({
                message:
                  'Redeemed or cancelled add-ons must be resolved before transferring this registration.',
              });
            }

            const lockedTenants = yield* tx
              .select({
                canonicalRootUrl: tenants.canonicalRootUrl,
                domain: tenants.domain,
                id: tenants.id,
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

            const inserted = yield* tx
              .insert(registrationTransfers)
              .values({
                claimCodeHash: credentials.claimCodeHash,
                claimTokenHash: credentials.claimTokenHash,
                eventId: lockedSource.eventId,
                expiresAt,
                registrationOptionId: lockedSource.registrationOptionId,
                sourcePaymentTransactionId: sourcePayment?.id,
                sourceRefundAmount: refundPlan?.amount,
                sourceRefundApplicationFee:
                  refundPlan?.applicationFeeRefunded ?? refundFees,
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
            yield* tx.insert(registrationTransferEvents).values({
              actorUserId: user.id,
              eventType: 'created',
              tenantId: tenant.id,
              toStatus: 'open',
              transferId: transfer.id,
            });
            return { claimUrl, transferRows: inserted };
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

    return {
      claimCode: credentials.claimCode,
      claimUrl: transferResult.claimUrl,
      expiresAt: expiresAt.toISOString(),
      status: 'open' as const,
    };
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
        eventEnd: eventInstances.end,
        eventId: eventInstances.id,
        eventStart: eventInstances.start,
        eventTitle: eventInstances.title,
        expiresAt: registrationTransfers.expiresAt,
        optionDescription: eventRegistrationOptions.description,
        optionId: eventRegistrationOptions.id,
        optionIsPaid: eventRegistrationOptions.isPaid,
        optionOrganizing: eventRegistrationOptions.organizingRegistration,
        optionPrice: eventRegistrationOptions.price,
        optionTitle: eventRegistrationOptions.title,
        recipientUserId: registrationTransfers.recipientUserId,
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
  const [questions, addOns, currentPrice] = yield* Effect.all(
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
            allowMultiple: eventAddons.allowMultiple,
            availableQuantity: eventAddons.totalAvailableQuantity,
            description: eventAddons.description,
            id: eventAddons.id,
            maxQuantityPerUser: eventAddons.maxQuantityPerUser,
            title: eventAddons.title,
            unitPrice: eventAddons.price,
          })
          .from(eventAddons)
          .innerJoin(
            addonToEventRegistrationOptions,
            eq(addonToEventRegistrationOptions.addonId, eventAddons.id),
          )
          .where(
            and(
              eq(eventAddons.allowPurchaseDuringRegistration, true),
              eq(eventAddons.eventId, transfer.eventId),
              eq(
                addonToEventRegistrationOptions.registrationOptionId,
                transfer.optionId,
              ),
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
    ],
    { concurrency: 'unbounded' },
  );

  return {
    event: {
      end: transfer.eventEnd.toISOString(),
      id: transfer.eventId,
      start: transfer.eventStart.toISOString(),
      title: transfer.eventTitle,
    },
    expiresAt: transfer.expiresAt.toISOString(),
    registrationOption: {
      addOns,
      currency: tenant.currency,
      currentPrice,
      description: transfer.optionDescription,
      guestAllowance: { allowed: !transfer.optionOrganizing },
      id: transfer.optionId,
      isPaid: transfer.optionIsPaid,
      questions,
      title: transfer.optionTitle,
    },
    status,
    transferId: transfer.transferId,
  };
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
          const prelockedRecipientRows = pendingIdentity
            ? yield* tx
                .select({
                  registrationOptionId: eventRegistrations.registrationOptionId,
                  status: eventRegistrations.status,
                })
                .from(eventRegistrations)
                .where(
                  and(
                    eq(eventRegistrations.id, pendingIdentity.registrationId),
                    eq(eventRegistrations.status, 'PENDING'),
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
              eventId: registrationTransfers.eventId,
              recipientCheckoutTransactionId:
                registrationTransfers.recipientCheckoutTransactionId,
              recipientRegistrationId:
                registrationTransfers.recipientRegistrationId,
              reservedAdditionalSpots:
                registrationTransfers.reservedAdditionalSpots,
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
          const recipient = prelockedRecipientRows[0];
          const payment = prelockedPaymentRows[0];
          if (
            !pendingIdentity ||
            !recipient ||
            !payment ||
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

          const cancelledRecipients = yield* tx
            .update(eventRegistrations)
            .set({ status: 'CANCELLED' })
            .where(
              and(
                eq(eventRegistrations.id, locked.recipientRegistrationId),
                eq(eventRegistrations.status, 'PENDING'),
                eq(eventRegistrations.tenantId, tenant.id),
              ),
            )
            .returning({ id: eventRegistrations.id });
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
          const releasedOptions = yield* tx
            .update(eventRegistrationOptions)
            .set({
              reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - ${locked.reservedAdditionalSpots}`,
            })
            .where(
              and(
                eq(eventRegistrationOptions.id, recipient.registrationOptionId),
                eq(eventRegistrationOptions.eventId, locked.eventId),
                gte(
                  eventRegistrationOptions.reservedSpots,
                  locked.reservedAdditionalSpots,
                ),
              ),
            )
            .returning({ id: eventRegistrationOptions.id });
          if (
            cancelledRecipients.length !== 1 ||
            cancelledPayments.length !== 1 ||
            releasedOptions.length !== 1
          ) {
            return yield* new RegistrationTransferInternalError({
              message: 'Transfer Checkout reservation could not be released',
            });
          }

          const recipientAddOns = yield* tx
            .select({
              addonId: eventRegistrationAddonPurchases.addonId,
              quantity: eventRegistrationAddonPurchases.quantity,
            })
            .from(eventRegistrationAddonPurchases)
            .where(
              eq(
                eventRegistrationAddonPurchases.registrationId,
                locked.recipientRegistrationId,
              ),
            )
            .for('update');
          for (const recipientAddOn of recipientAddOns) {
            const releasedAddOns = yield* tx
              .update(eventAddons)
              .set({
                totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${recipientAddOn.quantity}`,
              })
              .where(
                and(
                  eq(eventAddons.id, recipientAddOn.addonId),
                  eq(eventAddons.eventId, locked.eventId),
                ),
              )
              .returning({ id: eventAddons.id });
            if (releasedAddOns.length !== 1) {
              return yield* new RegistrationTransferInternalError({
                message:
                  'Transfer Checkout add-on inventory could not be released',
              });
            }
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
  addOns,
  answers,
  credential,
  guestCount,
  tenant,
  user,
}: ClaimRegistrationTransferInput) {
  const now = getServerNow(undefined).toJSDate();
  if (!Number.isInteger(guestCount) || guestCount < 0) {
    return yield* new RegistrationTransferConflictError({
      message: 'Guest count must be a non-negative integer',
    });
  }
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
        optionIsPaid: eventRegistrationOptions.isPaid,
        optionOrganizing: eventRegistrationOptions.organizingRegistration,
        optionPrice: eventRegistrationOptions.price,
        optionRoleIds: eventRegistrationOptions.roleIds,
        optionStripeTaxRateId: eventRegistrationOptions.stripeTaxRateId,
        recipientCheckoutTransactionId:
          registrationTransfers.recipientCheckoutTransactionId,
        recipientRegistrationId: registrationTransfers.recipientRegistrationId,
        recipientUserId: registrationTransfers.recipientUserId,
        sourceCheckInTime: eventRegistrations.checkInTime,
        sourcePaymentTransactionId:
          registrationTransfers.sourcePaymentTransactionId,
        sourceRefundAmount: registrationTransfers.sourceRefundAmount,
        sourceRefundApplicationFee:
          registrationTransfers.sourceRefundApplicationFee,
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
      return {
        checkoutUrl,
        eventId: transfer.eventId,
        registrationId: recipientRegistrationId,
        status: 'paymentPending' as const,
      };
    }
    return {
      eventId: transfer.eventId,
      registrationId: transfer.recipientRegistrationId,
      status: 'confirmed' as const,
    };
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
    transfer.sourceCheckInTime ||
    transfer.eventStatus !== 'APPROVED' ||
    transfer.optionEventId !== transfer.eventId
  ) {
    return yield* new RegistrationTransferConflictError({
      message: 'Source registration is no longer transferable',
    });
  }
  let sourceRefundAmount = transfer.sourceRefundAmount;
  if (transfer.sourcePaymentTransactionId && sourceRefundAmount === null) {
    const snapshot = yield* ensureRegistrationPaymentFeeSnapshot(
      transfer.sourcePaymentTransactionId,
    ).pipe(
      Effect.mapError((error) =>
        error instanceof RegistrationPaymentFeeSnapshotRetryableError
          ? new RegistrationTransferConflictError({
              message: `${error.message}. The offer and source registration are unchanged.`,
            })
          : new RegistrationTransferInternalError({
              cause: error,
              message: 'Source payment fee reconciliation failed',
            }),
      ),
    );
    const refundPlan = yield* resolveRegistrationTransferRefundPlan(
      {
        amount: snapshot.grossAmount,
        stripeNetAmount: snapshot.stripeNetAmount,
      },
      transfer.sourceRefundApplicationFee,
    ).pipe(
      Effect.mapError(
        (error) =>
          new RegistrationTransferInternalError({ message: error.message }),
      ),
    );
    sourceRefundAmount = refundPlan.amount;
  }

  const recipientRegistrationId = createId();
  const paymentTransactionId = createId();
  const recipientSpotCount = registrationSpotCount(guestCount);
  const capacity = registrationTransferCapacityDelta({
    recipientSpotCount,
    sourceSpotCount: transfer.sourceSpotCount,
  });

  const claimResult = yield* Database.use((database) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          const lockedSources = yield* tx
            .select({
              checkedInGuestCount: eventRegistrations.checkedInGuestCount,
              checkInTime: eventRegistrations.checkInTime,
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
          if (
            !lockedSource ||
            lockedSource.checkInTime ||
            lockedSource.checkedInGuestCount !== 0
          ) {
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
          if (
            !lockedTransfer ||
            lockedTransfer.expiresAt <= now ||
            lockedTransfer.sourceRegistrationId !==
              transfer.sourceRegistrationId ||
            lockedTransfer.sourceUserId !== transfer.sourceUserId
          ) {
            return { _tag: 'Unavailable' as const };
          }

          if (transfer.sourcePaymentTransactionId) {
            const sourcePayments = yield* tx
              .select({ id: transactions.id })
              .from(transactions)
              .where(
                and(
                  eq(transactions.id, transfer.sourcePaymentTransactionId),
                  eq(
                    transactions.eventRegistrationId,
                    transfer.sourceRegistrationId,
                  ),
                  eq(transactions.status, 'successful'),
                  eq(transactions.tenantId, tenant.id),
                  eq(transactions.type, 'registration'),
                ),
              )
              .for('update');
            if (sourcePayments.length !== 1) {
              return { _tag: 'Unavailable' as const };
            }
          }
          const sourceFulfillment = yield* tx
            .select({
              cancelledQuantity:
                eventRegistrationAddonPurchases.cancelledQuantity,
              id: eventRegistrationAddonPurchases.id,
              redeemedQuantity:
                eventRegistrationAddonPurchases.redeemedQuantity,
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
          if (sourceFulfillment.length > 0) {
            yield* tx
              .select({ id: eventRegistrationAddonPurchaseLots.id })
              .from(eventRegistrationAddonPurchaseLots)
              .where(
                and(
                  inArray(
                    eventRegistrationAddonPurchaseLots.purchaseId,
                    sourceFulfillment.map(({ id }) => id),
                  ),
                  eq(eventRegistrationAddonPurchaseLots.tenantId, tenant.id),
                ),
              )
              .orderBy(eventRegistrationAddonPurchaseLots.id)
              .for('update');
          }
          if (
            sourceFulfillment.some(
              (entitlement) =>
                entitlement.redeemedQuantity > 0 ||
                entitlement.cancelledQuantity > 0,
            )
          ) {
            return { _tag: 'Unavailable' as const };
          }

          const lockedStripeAccountId = yield* lockTenantStripeAccount(
            tx,
            tenant.id,
          );
          const lockedTenants = yield* tx
            .select({
              canonicalRootUrl: tenants.canonicalRootUrl,
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
          const lockedRecipients = yield* tx
            .select({
              communicationEmail: users.communicationEmail,
              email: users.email,
            })
            .from(users)
            .where(eq(users.id, user.id))
            .for('update');
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
              optionOrganizing: eventRegistrationOptions.organizingRegistration,
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
          const lockedRecipient = lockedRecipients[0];
          const lockedOption = lockedTerms[0];
          if (
            !lockedRecipient ||
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
          if (lockedOption.optionOrganizing && guestCount > 0) {
            return { _tag: 'GuestsUnavailable' as const };
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

          const lockedAvailableAddOns = yield* tx
            .select({
              addOnId: eventAddons.id,
              allowMultiple: eventAddons.allowMultiple,
              allowPurchaseDuringRegistration:
                eventAddons.allowPurchaseDuringRegistration,
              includedQuantity:
                addonToEventRegistrationOptions.includedQuantity,
              maxQuantityPerUser: eventAddons.maxQuantityPerUser,
              optionalPurchaseQuantity:
                addonToEventRegistrationOptions.optionalPurchaseQuantity,
              price: eventAddons.price,
              stripeTaxRateId: eventAddons.stripeTaxRateId,
              title: eventAddons.title,
              totalAvailableQuantity: eventAddons.totalAvailableQuantity,
            })
            .from(eventAddons)
            .innerJoin(
              addonToEventRegistrationOptions,
              eq(addonToEventRegistrationOptions.addonId, eventAddons.id),
            )
            .where(
              and(
                eq(eventAddons.eventId, transfer.eventId),
                eq(
                  addonToEventRegistrationOptions.registrationOptionId,
                  transfer.optionId,
                ),
              ),
            )
            .for('update');
          const taxRateIds = [
            lockedOption.optionStripeTaxRateId,
            ...lockedAvailableAddOns.map((addOn) => addOn.stripeTaxRateId),
          ].filter((taxRateId): taxRateId is string => Boolean(taxRateId));
          const lockedTaxRates =
            taxRateIds.length === 0
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
                      inArray(tenantStripeTaxRates.stripeTaxRateId, taxRateIds),
                    ),
                  )
                  .for('update');
          const lockedTaxRateById = new Map(
            lockedTaxRates.map((taxRate) => [taxRate.stripeTaxRateId, taxRate]),
          );
          if (
            taxRateIds.some((taxRateId) => !lockedTaxRateById.has(taxRateId))
          ) {
            return { _tag: 'TermsChanged' as const };
          }
          const availableAddOns = lockedAvailableAddOns.map((addOn) => {
            const taxRate = addOn.stripeTaxRateId
              ? lockedTaxRateById.get(addOn.stripeTaxRateId)
              : undefined;
            return {
              ...addOn,
              taxRateDisplayName: taxRate?.displayName ?? null,
              taxRateInclusive: taxRate?.inclusive ?? null,
              taxRatePercentage: taxRate?.percentage ?? null,
            };
          });
          const selectedAddOns = yield* Effect.try({
            catch: (error) =>
              error instanceof EventRegistrationConflictError
                ? new RegistrationTransferConflictError({
                    message: error.message,
                  })
                : new RegistrationTransferInternalError({
                    cause: error,
                    message: 'Registration add-on validation failed',
                  }),
            try: () => validateRegistrationAddons({ addOns, availableAddOns }),
          });
          const addOnPurchasePlans = selectedAddOns.map((addOn) => ({
            addOn,
            purchaseId: createId(),
            ...(addOn.selectedQuantity > 0 && { purchaseLotId: createId() }),
          }));

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
          const selectedAddonTotal = selectedAddOns.reduce(
            (total, addOn) => total + addOn.price * addOn.selectedQuantity,
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
                buildCheckoutSessionExpiresAt(30),
                Math.floor(lockedTransfer.expiresAt.getTime() / 1000),
              )
            : undefined;
          if (
            checkoutExpiresAt !== undefined &&
            checkoutExpiresAt * 1000 <= now.getTime() + 30 * 60 * 1000
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
          for (const { addOn, purchaseLotId } of addOnPurchasePlans) {
            if (addOn.price <= 0) continue;
            checkoutLineItems.push({
              addonId: addOn.addOnId,
              allocationKey: `addon-lot:${purchaseLotId}`,
              kind: 'addon',
              name: `${addOn.title} add-on for ${lockedOption.eventTitle}`,
              quantity: addOn.selectedQuantity,
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
                customerEmail: lockedRecipient.email,
                eventTitle: lockedOption.eventTitle,
                eventUrl,
                expiresAt: checkoutExpiresAt,
                lineItems: checkoutLineItems,
                notificationEmail:
                  lockedRecipient.communicationEmail?.trim() ||
                  lockedRecipient.email,
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

          const capacityCondition = requiresCheckout
            ? sql`${eventRegistrationOptions.confirmedSpots} + ${eventRegistrationOptions.reservedSpots} + ${capacity.additionalReservation} <= ${eventRegistrationOptions.spots}`
            : capacity.confirmedDelta > 0
              ? sql`${eventRegistrationOptions.confirmedSpots} + ${eventRegistrationOptions.reservedSpots} + ${capacity.confirmedDelta} <= ${eventRegistrationOptions.spots}`
              : gte(
                  eventRegistrationOptions.confirmedSpots,
                  transfer.sourceSpotCount,
                );
          const updatedOptions = yield* tx
            .update(eventRegistrationOptions)
            .set(
              requiresCheckout
                ? {
                    reservedSpots: sql`${eventRegistrationOptions.reservedSpots} + ${capacity.additionalReservation}`,
                  }
                : {
                    confirmedSpots: sql`${eventRegistrationOptions.confirmedSpots} + ${capacity.confirmedDelta}`,
                  },
            )
            .where(
              and(
                eq(eventRegistrationOptions.id, transfer.optionId),
                eq(eventRegistrationOptions.eventId, transfer.eventId),
                capacityCondition,
              ),
            )
            .returning({ id: eventRegistrationOptions.id });
          if (updatedOptions.length !== 1) {
            return { _tag: 'CapacityFull' as const };
          }

          const sourceAddOns = requiresCheckout
            ? []
            : yield* tx
                .select({
                  addonId: eventRegistrationAddonPurchases.addonId,
                  quantity: eventRegistrationAddonPurchases.quantity,
                })
                .from(eventRegistrationAddonPurchases)
                .where(
                  eq(
                    eventRegistrationAddonPurchases.registrationId,
                    transfer.sourceRegistrationId,
                  ),
                )
                .for('update');
          const sourceAddOnQuantities = new Map(
            sourceAddOns.map((addOn) => [addOn.addonId, addOn.quantity]),
          );
          const selectedAddOnQuantities = new Map(
            selectedAddOns.map((addOn) => [
              addOn.addOnId,
              addOn.fulfilledQuantity,
            ]),
          );
          const affectedAddOnIds = new Set([
            ...sourceAddOnQuantities.keys(),
            ...selectedAddOnQuantities.keys(),
          ]);
          for (const addOnId of affectedAddOnIds) {
            const sourceQuantity = sourceAddOnQuantities.get(addOnId) ?? 0;
            const recipientQuantity = selectedAddOnQuantities.get(addOnId) ?? 0;
            const quantityToReserve = requiresCheckout
              ? recipientQuantity
              : Math.max(0, recipientQuantity - sourceQuantity);
            const quantityToRelease = requiresCheckout
              ? 0
              : Math.max(0, sourceQuantity - recipientQuantity);
            const changedAddOns = yield* tx
              .update(eventAddons)
              .set({
                totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} - ${quantityToReserve} + ${quantityToRelease}`,
              })
              .where(
                and(
                  eq(eventAddons.id, addOnId),
                  eq(eventAddons.eventId, transfer.eventId),
                  gte(eventAddons.totalAvailableQuantity, quantityToReserve),
                ),
              )
              .returning({ id: eventAddons.id });
            if (changedAddOns.length !== 1) {
              return yield* new RegistrationTransferConflictError({
                message: 'Add-on quantity is no longer available',
              });
            }
          }

          yield* tx.insert(eventRegistrations).values({
            appliedDiscountedPrice: discountResolution.appliedDiscountedPrice,
            appliedDiscountType: discountResolution.appliedDiscountType,
            basePriceAtRegistration: lockedOption.optionPrice,
            discountAmount: discountResolution.discountAmount,
            eventId: transfer.eventId,
            guestCount,
            id: recipientRegistrationId,
            registrationOptionId: transfer.optionId,
            status: requiresCheckout ? 'PENDING' : 'CONFIRMED',
            stripeTaxRateId: lockedOption.optionStripeTaxRateId,
            taxRateDisplayName: selectedTaxRate?.displayName,
            taxRateInclusive: selectedTaxRate?.inclusive,
            taxRatePercentage: selectedTaxRate?.percentage,
            tenantId: tenant.id,
            userId: user.id,
          });
          if (answerInserts.length > 0) {
            yield* tx.insert(eventRegistrationQuestionAnswers).values(
              answerInserts.map((answer) => ({
                answer: answer.answer,
                questionId: answer.questionId,
                registrationId: recipientRegistrationId,
              })),
            );
          }
          for (const {
            addOn,
            purchaseId,
            purchaseLotId,
          } of addOnPurchasePlans) {
            yield* tx.insert(eventRegistrationAddonPurchases).values({
              addonId: addOn.addOnId,
              eventId: transfer.eventId,
              id: purchaseId,
              includedQuantity: addOn.includedQuantity,
              purchasedQuantity: addOn.selectedQuantity,
              quantity: addOn.fulfilledQuantity,
              redeemedQuantity: 0,
              refundAllocatedPurchasedQuantity: 0,
              registrationId: recipientRegistrationId,
              registrationOptionId: transfer.optionId,
              taxRateDisplayName: addOn.taxRateDisplayName,
              taxRateInclusive: addOn.taxRateInclusive,
              taxRatePercentage: addOn.taxRatePercentage,
              tenantId: tenant.id,
              unitPrice: addOn.price,
            });
            if (purchaseLotId) {
              const hasNoPayment = addOn.price === 0;
              yield* tx.insert(eventRegistrationAddonPurchaseLots).values({
                ...(hasNoPayment && {
                  applicationFeeAmount: 0,
                  grossAmount: 0,
                  netAmount: 0,
                  paymentAllocationFinalizedAt: now,
                  stripeFeeAmount: 0,
                  taxAmount: 0,
                }),
                baseAmount: addOn.price * addOn.selectedQuantity,
                currency: lockedTenant.currency,
                eventId: transfer.eventId,
                id: purchaseLotId,
                purchaseId,
                quantity: addOn.selectedQuantity,
                registrationId: recipientRegistrationId,
                registrationOptionId: transfer.optionId,
                sourceLineKey: `addon-lot:${purchaseLotId}`,
                ...(!hasNoPayment &&
                  paymentClaim && {
                    sourceTransactionId: paymentClaim.id,
                  }),
                taxRateDisplayName: addOn.taxRateDisplayName,
                taxRateInclusive: addOn.taxRateInclusive,
                taxRatePercentage: addOn.taxRatePercentage,
                tenantId: tenant.id,
                unitPrice: addOn.price,
              });
            }
          }

          if (paymentClaim) {
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
                recipientCheckoutTransactionId: paymentClaim.id,
                recipientRegistrationId,
                recipientSpotCount,
                recipientUserId: user.id,
                reservedAdditionalSpots: capacity.additionalReservation,
                sourceRefundAmount,
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
              refundClaimId: undefined,
            };
          }

          const cancelledSources = yield* tx
            .update(eventRegistrations)
            .set({ status: 'CANCELLED' })
            .where(
              and(
                eq(eventRegistrations.id, transfer.sourceRegistrationId),
                eq(eventRegistrations.status, 'CONFIRMED'),
                eq(eventRegistrations.tenantId, tenant.id),
                eq(eventRegistrations.userId, transfer.sourceUserId),
              ),
            )
            .returning({ id: eventRegistrations.id });
          if (cancelledSources.length !== 1) {
            return { _tag: 'Unavailable' as const };
          }

          let refundClaimId: string | undefined;
          if (
            transfer.sourcePaymentTransactionId &&
            sourceRefundAmount !== null &&
            sourceRefundAmount > 0
          ) {
            const sourcePayments = yield* tx
              .select({
                currency: transactions.currency,
                stripeAccountId: transactions.stripeAccountId,
              })
              .from(transactions)
              .where(
                and(
                  eq(transactions.id, transfer.sourcePaymentTransactionId),
                  eq(transactions.status, 'successful'),
                  eq(transactions.tenantId, tenant.id),
                  eq(transactions.type, 'registration'),
                ),
              )
              .for('update');
            const sourcePayment = sourcePayments[0];
            if (!sourcePayment?.stripeAccountId) {
              return yield* new RegistrationTransferInternalError({
                message: 'Source Stripe payment ownership is missing',
              });
            }
            const refundClaim = yield* createRegistrationRefundClaim(tx, {
              amount: sourceRefundAmount,
              applicationFeeRefunded: transfer.sourceRefundApplicationFee,
              currency: sourcePayment.currency,
              eventId: transfer.eventId,
              eventRegistrationId: transfer.sourceRegistrationId,
              executiveUserId: transfer.sourceUserId,
              operationKey: `registration-transfer-source:${transfer.transferId}`,
              sourceTransactionId: transfer.sourcePaymentTransactionId,
              stripeAccountId: sourcePayment.stripeAccountId,
              targetUserId: transfer.sourceUserId,
              tenantId: tenant.id,
            });
            refundClaimId = refundClaim.id;
          }

          const sourceUsers = yield* tx
            .select({
              communicationEmail: users.communicationEmail,
              email: users.email,
            })
            .from(users)
            .where(eq(users.id, transfer.sourceUserId))
            .for('update')
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
            to:
              lockedRecipient.communicationEmail?.trim() ||
              lockedRecipient.email,
          });
          const completedAt = new Date();
          const nextStatus = refundClaimId ? 'refund_pending' : 'completed';
          yield* tx
            .update(registrationTransfers)
            .set({
              completedAt: refundClaimId ? null : completedAt,
              recipientConfirmedAt: completedAt,
              recipientRegistrationId,
              recipientSpotCount,
              recipientUserId: user.id,
              refundTransactionId: refundClaimId,
              sourceCancelledAt: completedAt,
              sourceRefundAmount,
              status: nextStatus,
            })
            .where(eq(registrationTransfers.id, transfer.transferId));
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
              eventType: 'source_cancelled',
              fromStatus: 'open',
              tenantId: tenant.id,
              toStatus: nextStatus,
              transferId: transfer.transferId,
            },
            ...(refundClaimId
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
            refundClaimId,
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
    case 'CapacityFull': {
      return yield* new RegistrationTransferConflictError({
        message: 'Registration option has no capacity for the selected guests',
      });
    }
    case 'CheckoutWindowTooShort': {
      return yield* new RegistrationTransferConflictError({
        message:
          'There is not enough time before this transfer expires to start payment',
      });
    }
    case 'Confirmed': {
      if (claimResult.refundClaimId) {
        yield* processRegistrationRefundClaim(claimResult.refundClaimId).pipe(
          Effect.catchCause((cause) =>
            Effect.logError(
              'Registration transfer refund remains queued after immediate processing failed',
            ).pipe(
              Effect.annotateLogs({
                cause: String(cause),
                refundClaimId: claimResult.refundClaimId,
                transferId: transfer.transferId,
              }),
            ),
          ),
        );
      }
      return {
        eventId: transfer.eventId,
        registrationId: recipientRegistrationId,
        status: 'confirmed' as const,
      };
    }
    case 'GuestsUnavailable': {
      return yield* new RegistrationTransferConflictError({
        message: 'Guest spots are only available for participant options',
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
      return {
        checkoutUrl,
        eventId: transfer.eventId,
        registrationId: recipientRegistrationId,
        status: 'paymentPending' as const,
      };
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
        return {
          checkoutUrl: row.stripeCheckoutUrl,
          status: 'paymentPending' as const,
        };
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
        return { status: 'reconciled' as const };
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
            'Checkout expired. Its transfer reservation was released; start a new transfer offer if needed.',
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
    return { checkoutUrl, status: 'paymentPending' as const };
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
