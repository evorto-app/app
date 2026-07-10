import { Database, type DatabaseClient } from '@db/index';
import {
  eventAddons,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  registrationTransfers,
  transactions,
} from '@db/schema';
import { registrationSpotCount } from '@shared/registration-spots';
import {
  and,
  asc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import {
  Cause,
  Clock,
  Duration,
  Effect,
  Result,
  Schedule,
  Schema,
} from 'effect';
import { randomUUID } from 'node:crypto';

import {
  expireHostedCheckoutSession,
  retrieveHostedCheckoutSession,
} from '../integrations/stripe-checkout';
import {
  completePaidRegistrationCheckout,
  type RegistrationCheckoutCompletionIdentity,
} from './registration-checkout-completion';
import {
  type ExpiredRegistrationTransferCheckoutCandidate,
  expireRegistrationTransferCheckout,
  selectExpiredRegistrationTransferCheckoutCandidates,
} from './registration-transfer-finalization';

const defaultCleanupBatchSize = 25;
const maximumCleanupBatchSize = 100;
const cleanupInterval = Duration.seconds(30);
const checkoutReconcileLeaseDurationMs = 60_000;
const checkoutReconcileMaximumBackoffMs = 5 * 60_000;
const checkoutReconcileMinimumBackoffMs = 5000;

export interface ExpiredCheckoutCleanupOptions {
  readonly batchSize?: number;
  readonly nowEpochSeconds?: number;
}

export interface ExpiredCheckoutCleanupSummary {
  readonly cancelled: number;
  readonly failed: number;
  readonly scanned: number;
  readonly skipped: number;
}

export class ExpiredCheckoutCleanupInvariantError extends Schema.TaggedErrorClass<ExpiredCheckoutCleanupInvariantError>()(
  'ExpiredCheckoutCleanupInvariantError',
  {
    message: Schema.String,
    registrationId: Schema.String,
    transactionId: Schema.String,
  },
) {}

export const normalizeExpiredCheckoutCleanupBatchSize = (
  batchSize = defaultCleanupBatchSize,
): number =>
  Number.isFinite(batchSize)
    ? Math.min(maximumCleanupBatchSize, Math.max(1, Math.trunc(batchSize)))
    : defaultCleanupBatchSize;

const pendingRegistrationClaimPredicate = () =>
  and(
    eq(transactions.method, 'stripe'),
    eq(transactions.status, 'pending'),
    eq(transactions.type, 'registration'),
    isNotNull(transactions.eventRegistrationId),
    sql<boolean>`not exists (
      select 1
      from ${registrationTransfers}
      where ${registrationTransfers.recipientCheckoutTransactionId} = ${transactions.id}
    )`,
  );

const expiredRegistrationClaimPredicate = (nowEpochSeconds: number) =>
  and(
    pendingRegistrationClaimPredicate(),
    isNotNull(transactions.stripeCheckoutRequest),
    sql<boolean>`jsonb_path_exists(
      ${transactions.stripeCheckoutRequest},
      '$.expiresAt ? (@.type() == "number" && @ <= $deadline)'::jsonpath,
      jsonb_build_object('deadline', ${nowEpochSeconds})
    )`,
  );

export const expiredUnboundRegistrationClaimPredicate = (
  nowEpochSeconds: number,
) =>
  and(
    expiredRegistrationClaimPredicate(nowEpochSeconds),
    isNull(transactions.stripeCheckoutSessionId),
  );

export const expiredBoundRegistrationClaimPredicate = (
  nowEpochSeconds: number,
) =>
  and(
    expiredRegistrationClaimPredicate(nowEpochSeconds),
    isNotNull(transactions.stripeCheckoutSessionId),
  );

const pendingBoundRegistrationClaimPredicate = () =>
  and(
    pendingRegistrationClaimPredicate(),
    isNotNull(transactions.stripeCheckoutSessionId),
  );

export interface BoundExpiredCheckoutCandidate extends ExpiredCheckoutCandidate {
  readonly stripeAccountId: string;
  readonly stripeCheckoutSessionId: string;
}

export interface DueBoundRegistrationCheckoutCandidate extends RegistrationCheckoutCompletionIdentity {
  readonly attempts: number;
  readonly expiresAt: number;
  readonly leaseId: string;
}

export interface ExpiredCheckoutCandidate {
  readonly registrationId: string;
  readonly tenantId: string;
  readonly transactionId: string;
}

export const dueBoundRegistrationCheckoutPredicate = (now: Date) =>
  and(
    eq(transactions.method, 'stripe'),
    eq(transactions.status, 'pending'),
    eq(transactions.type, 'registration'),
    isNotNull(transactions.eventRegistrationId),
    isNotNull(transactions.stripeAccountId),
    isNotNull(transactions.stripeCheckoutRequest),
    isNotNull(transactions.stripeCheckoutSessionId),
    or(
      isNull(transactions.stripeCheckoutReconcileNextAt),
      lte(transactions.stripeCheckoutReconcileNextAt, now),
    ),
    or(
      isNull(transactions.stripeCheckoutReconcileLeaseExpiresAt),
      lte(transactions.stripeCheckoutReconcileLeaseExpiresAt, now),
    ),
  );

export const checkoutReconcileBackoffMs = (attempts: number): number =>
  Math.min(
    checkoutReconcileMaximumBackoffMs,
    checkoutReconcileMinimumBackoffMs *
      2 ** Math.min(10, Math.max(0, Math.trunc(attempts) - 1)),
  );

export const nextRegistrationCheckoutReconcileAt = (input: {
  readonly attempts: number;
  readonly expiresAt: number;
  readonly noLaterThanExpiry: boolean;
  readonly now: Date;
}): Date => {
  const nextBackoffAt = new Date(
    input.now.getTime() + checkoutReconcileBackoffMs(input.attempts),
  );
  if (!input.noLaterThanExpiry) return nextBackoffAt;

  const expiresAt = new Date(input.expiresAt * 1000);
  return expiresAt > input.now && expiresAt < nextBackoffAt
    ? expiresAt
    : nextBackoffAt;
};

/**
 * Claims a bounded fair batch and commits its leases before callers make any
 * Stripe request. Concurrent workers skip rows leased by the first worker and
 * can continue with later due claims instead of starving behind them.
 */
export const claimDueBoundRegistrationCheckoutCandidates = Effect.fn(
  'claimDueBoundRegistrationCheckoutCandidates',
)(function* (
  database: DatabaseClient,
  input: {
    readonly leaseDurationMs?: number;
    readonly limit: number;
    readonly now: Date;
  },
) {
  return yield* database.transaction((tx) =>
    Effect.gen(function* () {
      const dueClaims = yield* tx
        .select({
          attempts: transactions.stripeCheckoutReconcileAttempts,
          checkoutRequest: transactions.stripeCheckoutRequest,
          createdAt: transactions.createdAt,
          registrationId: transactions.eventRegistrationId,
          stripeAccountId: transactions.stripeAccountId,
          stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
          tenantId: transactions.tenantId,
          transactionId: transactions.id,
        })
        .from(transactions)
        .where(dueBoundRegistrationCheckoutPredicate(input.now))
        .orderBy(
          sql`${transactions.stripeCheckoutReconcileNextAt} asc nulls first`,
          asc(transactions.createdAt),
          asc(transactions.id),
        )
        .limit(input.limit)
        .for('update', { of: transactions, skipLocked: true });

      const candidates: DueBoundRegistrationCheckoutCandidate[] = [];
      for (const dueClaim of dueClaims) {
        if (
          !dueClaim.checkoutRequest ||
          !dueClaim.registrationId ||
          !dueClaim.stripeAccountId ||
          !dueClaim.stripeCheckoutSessionId
        ) {
          continue;
        }
        const leaseId = randomUUID();
        const leaseExpiresAt = new Date(
          input.now.getTime() +
            (input.leaseDurationMs ?? checkoutReconcileLeaseDurationMs),
        );
        const claimed = yield* tx
          .update(transactions)
          .set({
            stripeCheckoutReconcileAttempts: sql`${transactions.stripeCheckoutReconcileAttempts} + 1`,
            stripeCheckoutReconcileLeaseExpiresAt: leaseExpiresAt,
            stripeCheckoutReconcileLeaseId: leaseId,
          })
          .where(
            and(
              dueBoundRegistrationCheckoutPredicate(input.now),
              eq(transactions.id, dueClaim.transactionId),
            ),
          )
          .returning({
            attempts: transactions.stripeCheckoutReconcileAttempts,
          });
        const claim = claimed[0];
        if (!claim) continue;

        candidates.push({
          attempts: claim.attempts,
          expiresAt: dueClaim.checkoutRequest.expiresAt,
          leaseId,
          registrationId: dueClaim.registrationId,
          stripeAccountId: dueClaim.stripeAccountId,
          stripeCheckoutSessionId: dueClaim.stripeCheckoutSessionId,
          tenantId: dueClaim.tenantId,
          transactionId: dueClaim.transactionId,
        });
      }
      return candidates;
    }),
  );
});

const failInvariant = (candidate: ExpiredCheckoutCandidate, message: string) =>
  Effect.fail(
    new ExpiredCheckoutCleanupInvariantError({
      message,
      registrationId: candidate.registrationId,
      transactionId: candidate.transactionId,
    }),
  );

const cancelExpiredRegistrationClaim = Effect.fn(
  'cancelExpiredRegistrationClaim',
)(function* (
  candidate: ExpiredCheckoutCandidate,
  nowEpochSeconds: number,
  binding?: {
    readonly stripeAccountId: string;
    readonly stripeCheckoutSessionId: string;
  },
  requireExpiredRequest = true,
) {
  yield* Effect.annotateCurrentSpan({
    registrationId: candidate.registrationId,
    tenantId: candidate.tenantId,
    transactionId: candidate.transactionId,
  });

  const exactClaimPredicate = binding
    ? and(
        requireExpiredRequest
          ? expiredBoundRegistrationClaimPredicate(nowEpochSeconds)
          : pendingBoundRegistrationClaimPredicate(),
        eq(transactions.stripeAccountId, binding.stripeAccountId),
        eq(
          transactions.stripeCheckoutSessionId,
          binding.stripeCheckoutSessionId,
        ),
      )
    : expiredUnboundRegistrationClaimPredicate(nowEpochSeconds);

  return yield* Database.use((database) =>
    database.transaction((tx) =>
      Effect.gen(function* () {
        // Registration cancellation and checkout binding take this lock first.
        // Keeping the same order makes a concurrent binder either win cleanly
        // or observe the completed cancellation after this transaction commits.
        const lockedRegistrations = yield* tx
          .select({
            eventId: eventRegistrations.eventId,
            guestCount: eventRegistrations.guestCount,
            id: eventRegistrations.id,
            registrationOptionId: eventRegistrations.registrationOptionId,
          })
          .from(eventRegistrations)
          .where(
            and(
              eq(eventRegistrations.id, candidate.registrationId),
              eq(eventRegistrations.status, 'PENDING'),
              eq(eventRegistrations.tenantId, candidate.tenantId),
            ),
          )
          .for('update');
        const lockedRegistration = lockedRegistrations[0];
        if (!lockedRegistration) {
          return 'skipped' as const;
        }

        const lockedClaims = yield* tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              exactClaimPredicate,
              eq(transactions.id, candidate.transactionId),
              eq(transactions.eventRegistrationId, candidate.registrationId),
              eq(transactions.tenantId, candidate.tenantId),
            ),
          )
          .for('update');
        if (lockedClaims.length !== 1) {
          return 'skipped' as const;
        }

        const cancelledRegistrations = yield* tx
          .update(eventRegistrations)
          .set({ status: 'CANCELLED' })
          .where(
            and(
              eq(eventRegistrations.id, lockedRegistration.id),
              eq(eventRegistrations.status, 'PENDING'),
              eq(eventRegistrations.tenantId, candidate.tenantId),
            ),
          )
          .returning({ id: eventRegistrations.id });
        if (cancelledRegistrations.length !== 1) {
          return yield* failInvariant(
            candidate,
            'Failed to cancel expired checkout registration',
          );
        }

        const reservedSpotCount = registrationSpotCount(
          lockedRegistration.guestCount,
        );
        const releasedOptions = yield* tx
          .update(eventRegistrationOptions)
          .set({
            reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - ${reservedSpotCount}`,
          })
          .where(
            and(
              eq(
                eventRegistrationOptions.id,
                lockedRegistration.registrationOptionId,
              ),
              eq(eventRegistrationOptions.eventId, lockedRegistration.eventId),
              gte(eventRegistrationOptions.reservedSpots, reservedSpotCount),
            ),
          )
          .returning({ id: eventRegistrationOptions.id });
        if (releasedOptions.length !== 1) {
          return yield* failInvariant(
            candidate,
            'Failed to release expired checkout capacity',
          );
        }

        const addOnPurchases = yield* tx
          .select({
            addonId: eventRegistrationAddonPurchases.addonId,
            quantity: eventRegistrationAddonPurchases.quantity,
          })
          .from(eventRegistrationAddonPurchases)
          .where(
            eq(
              eventRegistrationAddonPurchases.registrationId,
              lockedRegistration.id,
            ),
          )
          .orderBy(asc(eventRegistrationAddonPurchases.addonId));
        for (const addOnPurchase of addOnPurchases) {
          const releasedAddOns = yield* tx
            .update(eventAddons)
            .set({
              totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${addOnPurchase.quantity}`,
            })
            .where(
              and(
                eq(eventAddons.id, addOnPurchase.addonId),
                eq(eventAddons.eventId, lockedRegistration.eventId),
              ),
            )
            .returning({ id: eventAddons.id });
          if (releasedAddOns.length !== 1) {
            return yield* failInvariant(
              candidate,
              'Failed to release expired checkout add-on inventory',
            );
          }
        }

        const cancelledClaims = yield* tx
          .update(transactions)
          .set({
            status: 'cancelled',
            stripeCheckoutReconcileLastError: null,
            stripeCheckoutReconcileLeaseExpiresAt: null,
            stripeCheckoutReconcileLeaseId: null,
            stripeCheckoutReconcileNextAt: null,
          })
          .where(
            and(
              exactClaimPredicate,
              eq(transactions.id, candidate.transactionId),
              eq(transactions.eventRegistrationId, lockedRegistration.id),
              eq(transactions.tenantId, candidate.tenantId),
            ),
          )
          .returning({ id: transactions.id });
        if (cancelledClaims.length !== 1) {
          return yield* failInvariant(
            candidate,
            'Failed to cancel expired checkout payment claim',
          );
        }

        return 'cancelled' as const;
      }),
    ),
  );
});

export const cancelExpiredUnboundRegistrationClaim = Effect.fn(
  'cancelExpiredUnboundRegistrationClaim',
)(function* (candidate: ExpiredCheckoutCandidate, nowEpochSeconds: number) {
  return yield* cancelExpiredRegistrationClaim(candidate, nowEpochSeconds);
});

export const cancelExpiredBoundRegistrationClaim = Effect.fn(
  'cancelExpiredBoundRegistrationClaim',
)(function* (
  candidate: BoundExpiredCheckoutCandidate,
  nowEpochSeconds: number,
) {
  return yield* cancelExpiredRegistrationClaim(candidate, nowEpochSeconds, {
    stripeAccountId: candidate.stripeAccountId,
    stripeCheckoutSessionId: candidate.stripeCheckoutSessionId,
  });
});

export const cancelTerminalBoundRegistrationCheckout = Effect.fn(
  'cancelTerminalBoundRegistrationCheckout',
)(function* (candidate: BoundExpiredCheckoutCandidate) {
  const transferExpiry = yield* Database.use((database) =>
    database.transaction((tx) =>
      Effect.gen(function* () {
        const registrations = yield* tx
          .select({ id: eventRegistrations.id })
          .from(eventRegistrations)
          .where(
            and(
              eq(eventRegistrations.id, candidate.registrationId),
              eq(eventRegistrations.status, 'PENDING'),
              eq(eventRegistrations.tenantId, candidate.tenantId),
            ),
          )
          .for('update');
        if (registrations.length !== 1) return 'skipped' as const;

        const claims = yield* tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              eq(transactions.id, candidate.transactionId),
              eq(transactions.eventRegistrationId, candidate.registrationId),
              eq(transactions.method, 'stripe'),
              eq(transactions.status, 'pending'),
              eq(transactions.stripeAccountId, candidate.stripeAccountId),
              eq(
                transactions.stripeCheckoutSessionId,
                candidate.stripeCheckoutSessionId,
              ),
              eq(transactions.tenantId, candidate.tenantId),
              eq(transactions.type, 'registration'),
            ),
          )
          .for('update');
        if (claims.length !== 1) return 'skipped' as const;

        return yield* expireRegistrationTransferCheckout(tx, {
          registrationId: candidate.registrationId,
          tenantId: candidate.tenantId,
          transactionId: candidate.transactionId,
        });
      }),
    ),
  );
  if (transferExpiry === 'expired') return 'cancelled' as const;
  if (transferExpiry === 'alreadyExpired' || transferExpiry === 'skipped') {
    return 'skipped' as const;
  }

  return yield* cancelExpiredRegistrationClaim(
    candidate,
    0,
    {
      stripeAccountId: candidate.stripeAccountId,
      stripeCheckoutSessionId: candidate.stripeCheckoutSessionId,
    },
    false,
  );
});

export const boundExpiredCheckoutReconciliationAction = (
  status: null | string,
): 'cancel' | 'expire' | 'skip' => {
  if (status === 'expired') return 'cancel';
  if (status === 'open') return 'expire';
  return 'skip';
};

export const reconcileExpiredBoundRegistrationCheckout = Effect.fn(
  'reconcileExpiredBoundRegistrationCheckout',
)(function* (
  candidate: BoundExpiredCheckoutCandidate,
  nowEpochSeconds: number,
) {
  const existingSession = yield* retrieveHostedCheckoutSession(
    candidate.stripeCheckoutSessionId,
    candidate.stripeAccountId,
  );
  const action = boundExpiredCheckoutReconciliationAction(
    existingSession.status,
  );
  if (action === 'skip') return 'skipped' as const;

  const expiredSession =
    action === 'cancel'
      ? existingSession
      : yield* expireHostedCheckoutSession(
          candidate.stripeCheckoutSessionId,
          candidate.stripeAccountId,
        );
  if (expiredSession.status !== 'expired') return 'skipped' as const;

  return yield* cancelExpiredBoundRegistrationClaim(candidate, nowEpochSeconds);
});

export const reconcileExpiredRegistrationTransferCheckout = Effect.fn(
  'reconcileExpiredRegistrationTransferCheckout',
)(function* (candidate: ExpiredRegistrationTransferCheckoutCandidate) {
  if (candidate.stripeCheckoutSessionId) {
    if (!candidate.stripeAccountId) {
      return yield* failInvariant(
        candidate,
        'Expired transfer Checkout is missing its persisted Stripe account',
      );
    }
    const existingSession = yield* retrieveHostedCheckoutSession(
      candidate.stripeCheckoutSessionId,
      candidate.stripeAccountId,
    );
    const action = boundExpiredCheckoutReconciliationAction(
      existingSession.status,
    );
    if (action === 'skip') return 'skipped' as const;
    const expiredSession =
      action === 'cancel'
        ? existingSession
        : yield* expireHostedCheckoutSession(
            candidate.stripeCheckoutSessionId,
            candidate.stripeAccountId,
          );
    if (expiredSession.status !== 'expired') return 'skipped' as const;
  }

  const expiryStatus = yield* Database.use((database) =>
    database.transaction((tx) =>
      expireRegistrationTransferCheckout(tx, {
        registrationId: candidate.registrationId,
        tenantId: candidate.tenantId,
        transactionId: candidate.transactionId,
      }),
    ),
  );
  return expiryStatus === 'expired'
    ? ('cancelled' as const)
    : ('skipped' as const);
});

const rescheduleBoundRegistrationCheckout = Effect.fn(
  'rescheduleBoundRegistrationCheckout',
)(function* (
  candidate: DueBoundRegistrationCheckoutCandidate,
  input: {
    readonly error?: string;
    readonly noLaterThanExpiry: boolean;
    readonly now: Date;
  },
) {
  const nextAt = nextRegistrationCheckoutReconcileAt({
    attempts: candidate.attempts,
    expiresAt: candidate.expiresAt,
    noLaterThanExpiry: input.noLaterThanExpiry,
    now: input.now,
  });
  const updated = yield* Database.use((database) =>
    database
      .update(transactions)
      .set({
        stripeCheckoutReconcileLastError: input.error?.slice(0, 2000) ?? null,
        stripeCheckoutReconcileLeaseExpiresAt: null,
        stripeCheckoutReconcileLeaseId: null,
        stripeCheckoutReconcileNextAt: nextAt,
      })
      .where(
        and(
          eq(transactions.id, candidate.transactionId),
          eq(transactions.eventRegistrationId, candidate.registrationId),
          eq(transactions.method, 'stripe'),
          eq(transactions.status, 'pending'),
          eq(transactions.stripeAccountId, candidate.stripeAccountId),
          eq(transactions.stripeCheckoutReconcileLeaseId, candidate.leaseId),
          eq(
            transactions.stripeCheckoutSessionId,
            candidate.stripeCheckoutSessionId,
          ),
          eq(transactions.tenantId, candidate.tenantId),
          eq(transactions.type, 'registration'),
        ),
      )
      .returning({ id: transactions.id }),
  );
  return updated.length === 1 ? ('rescheduled' as const) : ('skipped' as const);
});

const expireDueBoundRegistrationCheckout = Effect.fn(
  'expireDueBoundRegistrationCheckout',
)(function* (candidate: DueBoundRegistrationCheckoutCandidate) {
  return yield* cancelTerminalBoundRegistrationCheckout(candidate);
});

export const reconcileDueBoundRegistrationCheckout = Effect.fn(
  'reconcileDueBoundRegistrationCheckout',
)(function* (
  candidate: DueBoundRegistrationCheckoutCandidate,
  now = new Date(),
) {
  const session = yield* retrieveHostedCheckoutSession(
    candidate.stripeCheckoutSessionId,
    candidate.stripeAccountId,
  );
  if (session.status === 'complete' && session.payment_status === 'paid') {
    yield* completePaidRegistrationCheckout(candidate, session);
    return 'completed' as const;
  }

  const nowEpochSeconds = Math.floor(now.getTime() / 1000);
  if (session.status === 'expired') {
    return yield* expireDueBoundRegistrationCheckout(candidate);
  }
  if (session.status === 'open' && nowEpochSeconds >= candidate.expiresAt) {
    const expiredSession = yield* expireHostedCheckoutSession(
      candidate.stripeCheckoutSessionId,
      candidate.stripeAccountId,
    );
    if (expiredSession.status === 'expired') {
      return yield* expireDueBoundRegistrationCheckout(candidate);
    }
  }

  return yield* rescheduleBoundRegistrationCheckout(candidate, {
    noLaterThanExpiry:
      session.status === 'open' && nowEpochSeconds < candidate.expiresAt,
    now,
  });
});

const checkoutReconcileFailureMessage = (failure: unknown): string =>
  failure instanceof Error
    ? failure.message
    : 'Registration Checkout reconciliation failed';

export const processDueBoundRegistrationCheckouts = Effect.fn(
  'processDueBoundRegistrationCheckouts',
)(function* (options: ExpiredCheckoutCleanupOptions = {}) {
  const now =
    options.nowEpochSeconds === undefined
      ? new Date(yield* Clock.currentTimeMillis)
      : new Date(options.nowEpochSeconds * 1000);
  const batchSize = normalizeExpiredCheckoutCleanupBatchSize(options.batchSize);
  const dueClaims = yield* Database.use((database) =>
    claimDueBoundRegistrationCheckoutCandidates(database, {
      limit: batchSize,
      now,
    }),
  );

  let cancelled = 0;
  let failed = 0;
  let skipped = 0;
  for (const candidate of dueClaims) {
    const outcome = yield* Effect.result(
      reconcileDueBoundRegistrationCheckout(candidate, now),
    );
    if (Result.isFailure(outcome)) {
      failed += 1;
      const error = checkoutReconcileFailureMessage(outcome.failure);
      yield* rescheduleBoundRegistrationCheckout(candidate, {
        error,
        noLaterThanExpiry: false,
        now,
      }).pipe(Effect.ignore);
      yield* Effect.logError(
        'Failed to reconcile bound registration Checkout',
      ).pipe(
        Effect.annotateLogs({
          error,
          registrationId: candidate.registrationId,
          stripeAccountId: candidate.stripeAccountId,
          stripeCheckoutSessionId: candidate.stripeCheckoutSessionId,
          tenantId: candidate.tenantId,
          transactionId: candidate.transactionId,
        }),
      );
      continue;
    }
    if (outcome.success === 'cancelled') {
      cancelled += 1;
    } else {
      skipped += 1;
    }
    if (outcome.success === 'completed') {
      yield* Effect.logInfo('Recovered completed registration Checkout').pipe(
        Effect.annotateLogs({
          registrationId: candidate.registrationId,
          stripeCheckoutSessionId: candidate.stripeCheckoutSessionId,
          tenantId: candidate.tenantId,
          transactionId: candidate.transactionId,
        }),
      );
    }
  }

  return {
    cancelled,
    failed,
    scanned: dueClaims.length,
    skipped,
  } satisfies ExpiredCheckoutCleanupSummary;
});

export const processExpiredUnboundRegistrationCheckouts = Effect.fn(
  'processExpiredUnboundRegistrationCheckouts',
)(function* (options: ExpiredCheckoutCleanupOptions = {}) {
  const nowEpochSeconds =
    options.nowEpochSeconds ??
    Math.floor((yield* Clock.currentTimeMillis) / 1000);
  const batchSize = normalizeExpiredCheckoutCleanupBatchSize(options.batchSize);
  const dueClaims = yield* Database.use((database) =>
    database
      .select({
        registrationId: transactions.eventRegistrationId,
        tenantId: transactions.tenantId,
        transactionId: transactions.id,
      })
      .from(transactions)
      .where(expiredUnboundRegistrationClaimPredicate(nowEpochSeconds))
      .orderBy(asc(transactions.createdAt), asc(transactions.id))
      .limit(batchSize),
  );

  let cancelled = 0;
  let failed = 0;
  let skipped = 0;

  for (const dueClaim of dueClaims) {
    if (!dueClaim.registrationId) {
      skipped += 1;
      continue;
    }
    const candidate = {
      registrationId: dueClaim.registrationId,
      tenantId: dueClaim.tenantId,
      transactionId: dueClaim.transactionId,
    } satisfies ExpiredCheckoutCandidate;
    const outcome = yield* Effect.result(
      cancelExpiredUnboundRegistrationClaim(candidate, nowEpochSeconds),
    );
    if (Result.isFailure(outcome)) {
      failed += 1;
      yield* Effect.logError(
        'Failed to clean up expired unbound registration checkout',
      ).pipe(
        Effect.annotateLogs({
          error: outcome.failure,
          registrationId: candidate.registrationId,
          tenantId: candidate.tenantId,
          transactionId: candidate.transactionId,
        }),
      );
      continue;
    }
    if (outcome.success === 'cancelled') {
      cancelled += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    cancelled,
    failed,
    scanned: dueClaims.length,
    skipped,
  } satisfies ExpiredCheckoutCleanupSummary;
});

export const processExpiredBoundRegistrationCheckouts = Effect.fn(
  'processExpiredBoundRegistrationCheckouts',
)(function* (options: ExpiredCheckoutCleanupOptions = {}) {
  const nowEpochSeconds =
    options.nowEpochSeconds ??
    Math.floor((yield* Clock.currentTimeMillis) / 1000);
  const batchSize = normalizeExpiredCheckoutCleanupBatchSize(options.batchSize);
  const dueClaims = yield* Database.use((database) =>
    database
      .select({
        registrationId: transactions.eventRegistrationId,
        stripeAccountId: transactions.stripeAccountId,
        stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
        tenantId: transactions.tenantId,
        transactionId: transactions.id,
      })
      .from(transactions)
      .where(expiredBoundRegistrationClaimPredicate(nowEpochSeconds))
      .orderBy(asc(transactions.createdAt), asc(transactions.id))
      .limit(batchSize),
  );

  let cancelled = 0;
  let failed = 0;
  let skipped = 0;

  for (const dueClaim of dueClaims) {
    if (
      !dueClaim.registrationId ||
      !dueClaim.stripeAccountId ||
      !dueClaim.stripeCheckoutSessionId
    ) {
      failed += 1;
      yield* Effect.logError(
        'Expired bound registration checkout is missing persisted ownership',
      ).pipe(
        Effect.annotateLogs({
          registrationId: dueClaim.registrationId,
          tenantId: dueClaim.tenantId,
          transactionId: dueClaim.transactionId,
        }),
      );
      continue;
    }
    const candidate = {
      registrationId: dueClaim.registrationId,
      stripeAccountId: dueClaim.stripeAccountId,
      stripeCheckoutSessionId: dueClaim.stripeCheckoutSessionId,
      tenantId: dueClaim.tenantId,
      transactionId: dueClaim.transactionId,
    } satisfies BoundExpiredCheckoutCandidate;
    const outcome = yield* Effect.result(
      reconcileExpiredBoundRegistrationCheckout(candidate, nowEpochSeconds),
    );
    if (Result.isFailure(outcome)) {
      failed += 1;
      yield* Effect.logError(
        'Failed to reconcile expired bound registration checkout',
      ).pipe(
        Effect.annotateLogs({
          error: outcome.failure,
          registrationId: candidate.registrationId,
          stripeAccountId: candidate.stripeAccountId,
          stripeCheckoutSessionId: candidate.stripeCheckoutSessionId,
          tenantId: candidate.tenantId,
          transactionId: candidate.transactionId,
        }),
      );
      continue;
    }
    if (outcome.success === 'cancelled') {
      cancelled += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    cancelled,
    failed,
    scanned: dueClaims.length,
    skipped,
  } satisfies ExpiredCheckoutCleanupSummary;
});

export const processExpiredRegistrationTransferCheckouts = Effect.fn(
  'processExpiredRegistrationTransferCheckouts',
)(function* (options: ExpiredCheckoutCleanupOptions = {}) {
  const nowEpochSeconds =
    options.nowEpochSeconds ??
    Math.floor((yield* Clock.currentTimeMillis) / 1000);
  const batchSize = normalizeExpiredCheckoutCleanupBatchSize(options.batchSize);
  const dueTransfers = yield* Database.use((database) =>
    selectExpiredRegistrationTransferCheckoutCandidates(database, {
      limit: batchSize,
      nowEpochSeconds,
    }),
  );

  let cancelled = 0;
  let failed = 0;
  let skipped = 0;
  for (const candidate of dueTransfers) {
    const outcome = yield* Effect.result(
      reconcileExpiredRegistrationTransferCheckout(candidate),
    );
    if (Result.isFailure(outcome)) {
      failed += 1;
      yield* Effect.logError(
        'Failed to reconcile expired registration transfer Checkout',
      ).pipe(
        Effect.annotateLogs({
          error: outcome.failure,
          registrationId: candidate.registrationId,
          tenantId: candidate.tenantId,
          transactionId: candidate.transactionId,
          transferId: candidate.transferId,
        }),
      );
      continue;
    }
    if (outcome.success === 'cancelled') {
      cancelled += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    cancelled,
    failed,
    scanned: dueTransfers.length,
    skipped,
  } satisfies ExpiredCheckoutCleanupSummary;
});

export const processExpiredRegistrationCheckouts = Effect.fn(
  'processExpiredRegistrationCheckouts',
)(function* (options: ExpiredCheckoutCleanupOptions = {}) {
  const nowEpochSeconds =
    options.nowEpochSeconds ??
    Math.floor((yield* Clock.currentTimeMillis) / 1000);
  const effectiveOptions = { ...options, nowEpochSeconds };
  const unbound =
    yield* processExpiredUnboundRegistrationCheckouts(effectiveOptions);
  const bound = yield* processDueBoundRegistrationCheckouts(effectiveOptions);
  const transfers =
    yield* processExpiredRegistrationTransferCheckouts(effectiveOptions);

  return {
    cancelled: unbound.cancelled + bound.cancelled + transfers.cancelled,
    failed: unbound.failed + bound.failed + transfers.failed,
    scanned: unbound.scanned + bound.scanned + transfers.scanned,
    skipped: unbound.skipped + bound.skipped + transfers.skipped,
  } satisfies ExpiredCheckoutCleanupSummary;
});

const runExpiredCheckoutCleanupIteration =
  processExpiredRegistrationCheckouts().pipe(
    Effect.tap((summary) =>
      summary.scanned > 0
        ? Effect.logInfo('Processed expired registration checkouts').pipe(
            Effect.annotateLogs(summary),
          )
        : Effect.void,
    ),
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.logError(
            'Expired registration checkout cleanup iteration failed',
          ).pipe(Effect.annotateLogs({ cause: String(cause) })),
    ),
  );

export const runExpiredRegistrationCheckoutCleanupWorker =
  runExpiredCheckoutCleanupIteration.pipe(
    Effect.repeat(Schedule.spaced(cleanupInterval)),
  );
