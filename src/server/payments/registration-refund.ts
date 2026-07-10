import type Stripe from 'stripe';

import { createId } from '@db/create-id';
import { Database, type DatabaseClient } from '@db/index';
import { transactions } from '@db/schema';
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { Cause, Clock, Effect, Result, Schedule, Schema } from 'effect';

import { reconcileRegistrationTransferRefund } from '../registrations/registration-transfer-refund-reconciliation';
import { StripeClient } from '../stripe-client';
import { lockTenantStripeAccount } from './pending-stripe-obligations';

const refundClaimLeaseMs = 10 * 60 * 1000;
const refundWorkerInterval = Schedule.spaced('30 seconds');
const defaultRefundBatchSize = 25;
const maximumRefundBatchSize = 100;

export const registrationRefundSourcePaymentPredicate = (input: {
  readonly eventRegistrationId: string;
  readonly sourceTransactionId: string;
  readonly stripeAccountId: string;
  readonly tenantId: string;
}) =>
  and(
    eq(transactions.id, input.sourceTransactionId),
    eq(transactions.eventRegistrationId, input.eventRegistrationId),
    eq(transactions.method, 'stripe'),
    eq(transactions.status, 'successful'),
    eq(transactions.stripeAccountId, input.stripeAccountId),
    eq(transactions.tenantId, input.tenantId),
    inArray(transactions.type, ['registration', 'addon']),
  );

export interface CreateRegistrationRefundClaimInput {
  readonly amount: number;
  readonly applicationFeeRefunded: boolean;
  readonly currency: typeof transactions.$inferSelect.currency;
  readonly eventId: string;
  readonly eventRegistrationId: string;
  readonly executiveUserId?: null | string;
  readonly operationKey: string;
  readonly sourceTransactionId: string;
  readonly stripeAccountId: string;
  readonly targetUserId: string;
  readonly tenantId: string;
}

export type RegistrationRefundRequeueEligibility =
  'active' | 'ambiguous' | 'newGeneration' | 'resumeGeneration' | 'succeeded';

export interface RegistrationRefundRequeueState {
  readonly attempts: number;
  readonly generation: number;
  readonly refundId: null | string;
  readonly status: typeof transactions.$inferSelect.status;
  readonly stripeRefundStatus: null | PersistedStripeRefundStatus;
}

export interface RegistrationRefundWorkerSummary {
  readonly exhausted: number;
  readonly failed: number;
  readonly processed: number;
  readonly scanned: number;
  readonly skipped: number;
}

type PersistedStripeRefundStatus = NonNullable<
  typeof transactions.$inferSelect.stripeRefundStatus
>;

export class RegistrationRefundClaimError extends Schema.TaggedErrorClass<RegistrationRefundClaimError>()(
  'RegistrationRefundClaimError',
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    refundClaimId: Schema.String,
  },
) {}

export class RegistrationRefundRequeueError extends Schema.TaggedErrorClass<RegistrationRefundRequeueError>()(
  'RegistrationRefundRequeueError',
  {
    message: Schema.String,
    refundClaimId: Schema.String,
  },
) {}

export const registrationRefundRequeueEligibility = (claim: {
  readonly attempts: number;
  readonly leaseExpiresAt: Date | null;
  readonly leaseId: null | string;
  readonly maxAttempts: number;
  readonly nextAttemptAt: Date | null;
  readonly refundId: null | string;
  readonly status: typeof transactions.$inferSelect.status;
  readonly stripeRefundStatus: null | PersistedStripeRefundStatus;
}): RegistrationRefundRequeueEligibility => {
  if (
    claim.status === 'successful' ||
    claim.stripeRefundStatus === 'succeeded'
  ) {
    return 'succeeded';
  }
  if (
    claim.status !== 'pending' ||
    claim.leaseId !== null ||
    claim.leaseExpiresAt !== null ||
    claim.nextAttemptAt !== null
  ) {
    return 'ambiguous';
  }
  if (
    claim.stripeRefundStatus === 'failed' ||
    claim.stripeRefundStatus === 'canceled'
  ) {
    return claim.refundId ? 'newGeneration' : 'ambiguous';
  }
  if (claim.attempts >= claim.maxAttempts) {
    return 'resumeGeneration';
  }
  return 'active';
};

export const registrationRefundIdempotencyKey = (
  refundClaimId: string,
  generation = 0,
) =>
  generation === 0
    ? `registration-refund:${refundClaimId}`
    : `registration-refund:${refundClaimId}:generation:${generation}`;

export const normalizeRegistrationRefundBatchSize = (
  batchSize = defaultRefundBatchSize,
): number =>
  Number.isFinite(batchSize)
    ? Math.min(maximumRefundBatchSize, Math.max(1, Math.trunc(batchSize)))
    : defaultRefundBatchSize;

export const registrationRefundRetryDelayMs = (attempts: number): number =>
  Math.min(30 * 60 * 1000, 1000 * 2 ** Math.max(0, attempts - 1));

export const registrationRefundClaimInsert = (
  refundClaimId: string,
  input: CreateRegistrationRefundClaimInput,
  operationKey: string,
  nextAttemptAt: Date,
): typeof transactions.$inferInsert => ({
  amount: -input.amount,
  comment: `Registration refund claim for source transaction ${input.sourceTransactionId}`,
  currency: input.currency,
  eventId: input.eventId,
  eventRegistrationId: input.eventRegistrationId,
  executiveUserId: input.executiveUserId ?? null,
  id: refundClaimId,
  manuallyCreated: false,
  method: 'stripe',
  refundOperationKey: operationKey,
  sourceTransactionId: input.sourceTransactionId,
  status: 'pending',
  stripeAccountId: input.stripeAccountId,
  stripeRefundApplicationFee: input.applicationFeeRefunded,
  stripeRefundNextAttemptAt: nextAttemptAt,
  targetUserId: input.targetUserId,
  tenantId: input.tenantId,
  type: 'refund',
});

export const createRegistrationRefundClaim = Effect.fn(
  'createRegistrationRefundClaim',
)(function* (
  database: Pick<DatabaseClient, 'insert' | 'select'>,
  input: CreateRegistrationRefundClaimInput,
) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return yield* new RegistrationRefundClaimError({
      message: 'Refund amount must be a positive integer',
      refundClaimId: input.sourceTransactionId,
    });
  }

  const operationKey = input.operationKey.trim();
  if (operationKey.length === 0 || operationKey.length > 100) {
    return yield* new RegistrationRefundClaimError({
      message: 'Refund operation key must contain between 1 and 100 characters',
      refundClaimId: input.sourceTransactionId,
    });
  }

  const sourceTransactions = yield* database
    .select({
      amount: transactions.amount,
      currency: transactions.currency,
      eventId: transactions.eventId,
      eventRegistrationId: transactions.eventRegistrationId,
      method: transactions.method,
      status: transactions.status,
      stripeAccountId: transactions.stripeAccountId,
      targetUserId: transactions.targetUserId,
      tenantId: transactions.tenantId,
      type: transactions.type,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.id, input.sourceTransactionId),
        eq(transactions.tenantId, input.tenantId),
      ),
    )
    .for('update');
  const sourceTransaction = sourceTransactions[0];
  if (
    !sourceTransaction ||
    (sourceTransaction.type !== 'registration' &&
      sourceTransaction.type !== 'addon') ||
    sourceTransaction.method !== 'stripe' ||
    sourceTransaction.status !== 'successful' ||
    sourceTransaction.amount <= 0 ||
    sourceTransaction.currency !== input.currency ||
    sourceTransaction.eventId !== input.eventId ||
    sourceTransaction.eventRegistrationId !== input.eventRegistrationId ||
    sourceTransaction.stripeAccountId !== input.stripeAccountId ||
    sourceTransaction.targetUserId !== input.targetUserId
  ) {
    return yield* new RegistrationRefundClaimError({
      message: 'Refund source transaction does not match the persisted payment',
      refundClaimId: input.sourceTransactionId,
    });
  }

  const lockedStripeAccountId = yield* lockTenantStripeAccount(
    database,
    input.tenantId,
  );
  if (
    !lockedStripeAccountId ||
    lockedStripeAccountId !== input.stripeAccountId
  ) {
    return yield* new RegistrationRefundClaimError({
      message:
        'Tenant Stripe account changed before the refund obligation could be claimed',
      refundClaimId: input.sourceTransactionId,
    });
  }

  const existingOperationClaims = yield* database
    .select({
      amount: transactions.amount,
      id: transactions.id,
      stripeRefundApplicationFee: transactions.stripeRefundApplicationFee,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.sourceTransactionId, input.sourceTransactionId),
        eq(transactions.refundOperationKey, operationKey),
        eq(transactions.tenantId, input.tenantId),
        eq(transactions.type, 'refund'),
      ),
    )
    .limit(1);
  const existingOperationClaim = existingOperationClaims[0];
  if (existingOperationClaim) {
    if (
      existingOperationClaim.amount !== -input.amount ||
      existingOperationClaim.stripeRefundApplicationFee !==
        input.applicationFeeRefunded
    ) {
      return yield* new RegistrationRefundClaimError({
        message: 'Refund operation key was already used with different terms',
        refundClaimId: existingOperationClaim.id,
      });
    }
    return { id: existingOperationClaim.id };
  }

  const activeRefundClaims = yield* database
    .select({
      amount: transactions.amount,
      applicationFeeRefunded: transactions.stripeRefundApplicationFee,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.sourceTransactionId, input.sourceTransactionId),
        eq(transactions.tenantId, input.tenantId),
        eq(transactions.type, 'refund'),
        ne(transactions.status, 'cancelled'),
      ),
    );
  const alreadyClaimedAmount = activeRefundClaims.reduce(
    (total, claim) => total + Math.abs(claim.amount),
    0,
  );
  if (alreadyClaimedAmount + input.amount > sourceTransaction.amount) {
    return yield* new RegistrationRefundClaimError({
      message: 'Refund claims exceed the successful source payment',
      refundClaimId: input.sourceTransactionId,
    });
  }
  const refundClaimId = createId();
  const insertedClaims = yield* database
    .insert(transactions)
    .values(
      registrationRefundClaimInsert(
        refundClaimId,
        input,
        operationKey,
        new Date(),
      ),
    )
    .onConflictDoNothing()
    .returning({ id: transactions.id });
  const claim = insertedClaims[0];
  if (!claim) {
    const concurrentClaims = yield* database
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.sourceTransactionId, input.sourceTransactionId),
          eq(transactions.refundOperationKey, operationKey),
          eq(transactions.tenantId, input.tenantId),
          eq(transactions.type, 'refund'),
        ),
      )
      .limit(1);
    const concurrentClaim = concurrentClaims[0];
    if (concurrentClaim) {
      return concurrentClaim;
    }
    return yield* new RegistrationRefundClaimError({
      message: 'Failed to persist registration refund claim',
      refundClaimId,
    });
  }

  return claim;
});

export const requeueRegistrationRefundClaim = Effect.fn(
  'requeueRegistrationRefundClaim',
)(function* (
  database: Pick<DatabaseClient, 'select' | 'update'>,
  input: {
    readonly reason: string;
    readonly refundClaimId: string;
    readonly tenantId: string;
  },
) {
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) {
    return yield* new RegistrationRefundRequeueError({
      message: 'Refund requeue reason must contain 1 to 500 characters',
      refundClaimId: input.refundClaimId,
    });
  }

  const claimRows = yield* database
    .select({
      attempts: transactions.stripeRefundAttempts,
      generation: transactions.stripeRefundGeneration,
      leaseExpiresAt: transactions.stripeRefundClaimLeaseExpiresAt,
      leaseId: transactions.stripeRefundClaimLeaseId,
      maxAttempts: transactions.stripeRefundMaxAttempts,
      nextAttemptAt: transactions.stripeRefundNextAttemptAt,
      refundId: transactions.stripeRefundId,
      status: transactions.status,
      stripeAccountId: transactions.stripeAccountId,
      stripeRefundStatus: transactions.stripeRefundStatus,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.id, input.refundClaimId),
        eq(transactions.method, 'stripe'),
        eq(transactions.tenantId, input.tenantId),
        eq(transactions.type, 'refund'),
      ),
    )
    .for('update');
  const claim = claimRows[0];
  if (!claim) {
    return yield* new RegistrationRefundRequeueError({
      message: 'Refund claim not found',
      refundClaimId: input.refundClaimId,
    });
  }

  const eligibility = registrationRefundRequeueEligibility(claim);
  if (eligibility === 'succeeded') {
    return yield* new RegistrationRefundRequeueError({
      message: 'A succeeded refund cannot be requeued',
      refundClaimId: input.refundClaimId,
    });
  }
  if (eligibility === 'active') {
    return yield* new RegistrationRefundRequeueError({
      message: 'An active refund claim cannot be requeued',
      refundClaimId: input.refundClaimId,
    });
  }
  if (eligibility === 'ambiguous') {
    return yield* new RegistrationRefundRequeueError({
      message:
        'Refund state is ambiguous or leased and cannot be safely requeued',
      refundClaimId: input.refundClaimId,
    });
  }

  const lockedStripeAccountId = yield* lockTenantStripeAccount(
    database,
    input.tenantId,
  );
  if (
    !lockedStripeAccountId ||
    lockedStripeAccountId !== claim.stripeAccountId
  ) {
    return yield* new RegistrationRefundRequeueError({
      message: 'Refund Stripe account ownership changed before requeue',
      refundClaimId: input.refundClaimId,
    });
  }

  const now = new Date(yield* Clock.currentTimeMillis);
  const before = {
    attempts: claim.attempts,
    generation: claim.generation,
    refundId: claim.refundId,
    status: claim.status,
    stripeRefundStatus: claim.stripeRefundStatus,
  } satisfies RegistrationRefundRequeueState;
  const terminalHistory =
    eligibility === 'newGeneration' &&
    claim.refundId &&
    (claim.stripeRefundStatus === 'canceled' ||
      claim.stripeRefundStatus === 'failed')
      ? [
          {
            closedAt: now.toISOString(),
            generation: claim.generation,
            reason,
            refundId: claim.refundId,
            status: claim.stripeRefundStatus,
          },
        ]
      : undefined;
  if (eligibility === 'newGeneration' && !terminalHistory) {
    return yield* new RegistrationRefundRequeueError({
      message: 'Terminal refund history is incomplete and cannot be requeued',
      refundClaimId: input.refundClaimId,
    });
  }

  const requeuedRows = yield* database
    .update(transactions)
    .set({
      stripeRefundAttempts: 0,
      stripeRefundClaimLeaseExpiresAt: null,
      stripeRefundClaimLeaseId: null,
      ...(terminalHistory && {
        stripeRefundGeneration: sql`${transactions.stripeRefundGeneration} + 1`,
        stripeRefundHistory: sql`${transactions.stripeRefundHistory} || ${JSON.stringify(terminalHistory)}::jsonb`,
        stripeRefundId: null,
        stripeRefundStatus: null,
      }),
      stripeRefundLastError: null,
      stripeRefundLastRequeueReason: reason,
      stripeRefundNextAttemptAt: now,
      stripeRefundRequeuedAt: now,
    })
    .where(
      and(
        eq(transactions.id, input.refundClaimId),
        eq(transactions.stripeRefundAttempts, claim.attempts),
        eq(transactions.stripeRefundGeneration, claim.generation),
        claim.refundId
          ? eq(transactions.stripeRefundId, claim.refundId)
          : isNull(transactions.stripeRefundId),
        claim.stripeRefundStatus
          ? eq(transactions.stripeRefundStatus, claim.stripeRefundStatus)
          : isNull(transactions.stripeRefundStatus),
        isNull(transactions.stripeRefundClaimLeaseExpiresAt),
        isNull(transactions.stripeRefundClaimLeaseId),
        isNull(transactions.stripeRefundNextAttemptAt),
        eq(transactions.status, 'pending'),
        eq(transactions.tenantId, input.tenantId),
        eq(transactions.type, 'refund'),
      ),
    )
    .returning({
      attempts: transactions.stripeRefundAttempts,
      generation: transactions.stripeRefundGeneration,
      refundId: transactions.stripeRefundId,
      status: transactions.status,
      stripeRefundStatus: transactions.stripeRefundStatus,
    });
  const after = requeuedRows[0];
  if (!after) {
    return yield* new RegistrationRefundRequeueError({
      message: 'Refund claim changed before requeue could be persisted',
      refundClaimId: input.refundClaimId,
    });
  }

  return {
    after: after satisfies RegistrationRefundRequeueState,
    before,
    mode: eligibility,
    reason,
    refundClaimId: input.refundClaimId,
  };
});

const stripeReferenceId = (
  reference: null | string | { readonly id: string },
): string | undefined =>
  typeof reference === 'string' ? reference : reference?.id;

export const registrationRefundMatchesPersistedClaim = (
  refund: Stripe.Refund,
  expected: {
    readonly amount: number;
    readonly currency: string;
    readonly refundClaimId: string;
    readonly refundGeneration: number;
    readonly registrationId: string;
    readonly sourceTransactionId: string;
    readonly stripeReference:
      { readonly charge: string } | { readonly paymentIntent: string };
    readonly tenantId: string;
  },
): boolean => {
  const metadata = refund.metadata ?? {};
  const referenceMatches =
    'charge' in expected.stripeReference
      ? stripeReferenceId(refund.charge) === expected.stripeReference.charge
      : stripeReferenceId(refund.payment_intent) ===
        expected.stripeReference.paymentIntent;

  return (
    refund.amount === expected.amount &&
    refund.currency.toUpperCase() === expected.currency.toUpperCase() &&
    metadata['refundClaimId'] === expected.refundClaimId &&
    metadata['refundGeneration'] === String(expected.refundGeneration) &&
    metadata['registrationId'] === expected.registrationId &&
    metadata['sourceTransactionId'] === expected.sourceTransactionId &&
    metadata['tenantId'] === expected.tenantId &&
    referenceMatches
  );
};

export const persistedRegistrationRefundStatus = (
  status: null | string,
): PersistedStripeRefundStatus => {
  switch (status) {
    case 'canceled':
    case 'failed':
    case 'pending':
    case 'requires_action':
    case 'succeeded': {
      return status;
    }
    default: {
      return 'pending';
    }
  }
};

export const registrationRefundStatusCanAdvance = (
  current: null | PersistedStripeRefundStatus,
  incoming: PersistedStripeRefundStatus,
): boolean =>
  current === null ||
  current === 'pending' ||
  current === 'requires_action' ||
  current === incoming;

const refundStatusUpdate = (
  refund: Stripe.Refund,
  now: Date,
): Partial<typeof transactions.$inferInsert> => {
  const status = persistedRegistrationRefundStatus(refund.status);
  const terminal =
    status === 'canceled' || status === 'failed' || status === 'succeeded';
  return {
    status: status === 'succeeded' ? 'successful' : 'pending',
    stripeRefundClaimLeaseExpiresAt: null,
    stripeRefundClaimLeaseId: null,
    stripeRefundId: refund.id,
    stripeRefundLastError:
      status === 'failed' || status === 'canceled'
        ? `Stripe refund reached terminal status ${status}`
        : null,
    stripeRefundNextAttemptAt: terminal
      ? null
      : new Date(now.getTime() + 60_000),
    stripeRefundStatus: status,
  };
};

export const registrationRefundClaimablePredicate = (now: Date) =>
  and(
    eq(transactions.method, 'stripe'),
    eq(transactions.status, 'pending'),
    eq(transactions.type, 'refund'),
    or(
      and(
        isNull(transactions.stripeRefundClaimLeaseId),
        isNotNull(transactions.stripeRefundNextAttemptAt),
        lt(
          transactions.stripeRefundAttempts,
          transactions.stripeRefundMaxAttempts,
        ),
        lte(transactions.stripeRefundNextAttemptAt, now),
      ),
      and(
        isNotNull(transactions.stripeRefundClaimLeaseId),
        isNotNull(transactions.stripeRefundClaimLeaseExpiresAt),
        lte(transactions.stripeRefundClaimLeaseExpiresAt, now),
      ),
    ),
  );

export const registrationRefundClaimAttempts = () => sql<number>`case
  when ${transactions.stripeRefundClaimLeaseId} is null
    then ${transactions.stripeRefundAttempts} + 1
  else ${transactions.stripeRefundAttempts}
end`;

const claimRegistrationRefund = Effect.fn('claimRegistrationRefund')(function* (
  refundClaimId: string,
  now: Date,
) {
  const leaseId = createId();
  const leaseExpiresAt = new Date(now.getTime() + refundClaimLeaseMs);
  return yield* Database.use((database) =>
    database.transaction((tx) =>
      Effect.gen(function* () {
        const claimedRows = yield* tx
          .update(transactions)
          .set({
            // An expired lease is the unfinished prior attempt. Reclaim it
            // without consuming a second retry: the Stripe create may have
            // succeeded just before that process stopped.
            stripeRefundAttempts: registrationRefundClaimAttempts(),
            stripeRefundClaimLeaseExpiresAt: leaseExpiresAt,
            stripeRefundClaimLeaseId: leaseId,
            stripeRefundLastError: null,
          })
          .where(
            and(
              eq(transactions.id, refundClaimId),
              registrationRefundClaimablePredicate(now),
            ),
          )
          .returning({
            amount: transactions.amount,
            currency: transactions.currency,
            eventRegistrationId: transactions.eventRegistrationId,
            id: transactions.id,
            sourceTransactionId: transactions.sourceTransactionId,
            stripeAccountId: transactions.stripeAccountId,
            stripeRefundApplicationFee: transactions.stripeRefundApplicationFee,
            stripeRefundAttempts: transactions.stripeRefundAttempts,
            stripeRefundGeneration: transactions.stripeRefundGeneration,
            stripeRefundId: transactions.stripeRefundId,
            stripeRefundMaxAttempts: transactions.stripeRefundMaxAttempts,
            tenantId: transactions.tenantId,
          });
        const claim = claimedRows[0];
        if (!claim) return { status: 'skipped' as const };

        const eventRegistrationId = claim.eventRegistrationId;
        const sourceTransactionId = claim.sourceTransactionId;
        const stripeAccountId = claim.stripeAccountId;
        const stripeRefundApplicationFee = claim.stripeRefundApplicationFee;
        if (
          claim.amount >= 0 ||
          !eventRegistrationId ||
          !sourceTransactionId ||
          !stripeAccountId ||
          stripeRefundApplicationFee === null
        ) {
          yield* tx
            .update(transactions)
            .set({
              stripeRefundAttempts: claim.stripeRefundMaxAttempts,
              stripeRefundClaimLeaseExpiresAt: null,
              stripeRefundClaimLeaseId: null,
              stripeRefundLastError:
                'Refund claim is missing required persisted invariants',
              stripeRefundNextAttemptAt: null,
            })
            .where(
              and(
                eq(transactions.id, claim.id),
                eq(transactions.stripeRefundClaimLeaseId, leaseId),
              ),
            );
          return { status: 'invalid' as const };
        }

        const sourceRows = yield* tx
          .select({
            eventRegistrationId: transactions.eventRegistrationId,
            id: transactions.id,
            stripeAccountId: transactions.stripeAccountId,
            stripeChargeId: transactions.stripeChargeId,
            stripePaymentIntentId: transactions.stripePaymentIntentId,
          })
          .from(transactions)
          .where(
            registrationRefundSourcePaymentPredicate({
              eventRegistrationId,
              sourceTransactionId,
              stripeAccountId,
              tenantId: claim.tenantId,
            }),
          );
        const source = sourceRows[0];
        const stripeReference = source?.stripeChargeId
          ? ({ charge: source.stripeChargeId } as const)
          : source?.stripePaymentIntentId
            ? ({ paymentIntent: source.stripePaymentIntentId } as const)
            : undefined;
        if (
          !source ||
          source.stripeAccountId !== stripeAccountId ||
          !stripeReference
        ) {
          yield* tx
            .update(transactions)
            .set({
              stripeRefundAttempts: claim.stripeRefundMaxAttempts,
              stripeRefundClaimLeaseExpiresAt: null,
              stripeRefundClaimLeaseId: null,
              stripeRefundLastError:
                'Refund source is not a successful Stripe registration or add-on payment',
              stripeRefundNextAttemptAt: null,
            })
            .where(
              and(
                eq(transactions.id, claim.id),
                eq(transactions.stripeRefundClaimLeaseId, leaseId),
              ),
            );
          return { status: 'invalid' as const };
        }

        return {
          claim: {
            ...claim,
            eventRegistrationId,
            sourceTransactionId,
            stripeAccountId,
            stripeRefundApplicationFee,
          },
          leaseId,
          source: { id: source.id, stripeReference },
          status: 'claimed' as const,
        };
      }),
    ),
  );
});

const releaseRefundClaimAfterFailure = Effect.fn(
  'releaseRefundClaimAfterFailure',
)(function* (
  input: {
    attempts: number;
    error: unknown;
    leaseId: string;
    maxAttempts: number;
    refundClaimId: string;
  },
  now: Date,
) {
  const exhausted = input.attempts >= input.maxAttempts;
  const errorMessage =
    input.error instanceof Error ? input.error.message : String(input.error);
  yield* Database.use((database) =>
    database
      .update(transactions)
      .set({
        stripeRefundClaimLeaseExpiresAt: null,
        stripeRefundClaimLeaseId: null,
        stripeRefundLastError: errorMessage,
        stripeRefundNextAttemptAt: exhausted
          ? null
          : new Date(
              now.getTime() + registrationRefundRetryDelayMs(input.attempts),
            ),
      })
      .where(
        and(
          eq(transactions.id, input.refundClaimId),
          eq(transactions.stripeRefundClaimLeaseId, input.leaseId),
        ),
      ),
  );
  return exhausted ? ('exhausted' as const) : ('retryScheduled' as const);
});

export const processRegistrationRefundClaim = Effect.fn(
  'processRegistrationRefundClaim',
)(function* (refundClaimId: string) {
  const now = new Date(yield* Clock.currentTimeMillis);
  const claimResult = yield* claimRegistrationRefund(refundClaimId, now);
  if (claimResult.status === 'skipped') {
    return { status: 'skipped' as const };
  }
  if (claimResult.status === 'invalid') {
    return { status: 'exhausted' as const };
  }

  const { claim, leaseId, source } = claimResult;
  const stripe = yield* StripeClient;
  const stripeRefundId = claim.stripeRefundId;
  const stripeEffect = stripeRefundId
    ? Effect.tryPromise({
        catch: (cause) => cause,
        try: () =>
          stripe.refunds.retrieve(stripeRefundId, undefined, {
            stripeAccount: claim.stripeAccountId,
          }),
      })
    : Effect.tryPromise({
        catch: (cause) => cause,
        try: () =>
          stripe.refunds.create(
            {
              amount: Math.abs(claim.amount),
              ...('charge' in source.stripeReference
                ? { charge: source.stripeReference.charge }
                : { payment_intent: source.stripeReference.paymentIntent }),
              metadata: {
                refundClaimId: claim.id,
                refundGeneration: String(claim.stripeRefundGeneration),
                registrationId: claim.eventRegistrationId,
                sourceTransactionId: source.id,
                tenantId: claim.tenantId,
              },
              refund_application_fee: claim.stripeRefundApplicationFee,
            },
            {
              idempotencyKey: registrationRefundIdempotencyKey(
                claim.id,
                claim.stripeRefundGeneration,
              ),
              stripeAccount: claim.stripeAccountId,
            },
          ),
      });
  const result = yield* Effect.result(stripeEffect);
  if (Result.isFailure(result)) {
    const status = yield* releaseRefundClaimAfterFailure(
      {
        attempts: claim.stripeRefundAttempts,
        error: result.failure,
        leaseId,
        maxAttempts: claim.stripeRefundMaxAttempts,
        refundClaimId: claim.id,
      },
      now,
    );
    return { status };
  }

  const refund = result.success;
  if (
    !registrationRefundMatchesPersistedClaim(refund, {
      amount: Math.abs(claim.amount),
      currency: claim.currency,
      refundClaimId: claim.id,
      refundGeneration: claim.stripeRefundGeneration,
      registrationId: claim.eventRegistrationId,
      sourceTransactionId: source.id,
      stripeReference: source.stripeReference,
      tenantId: claim.tenantId,
    })
  ) {
    yield* releaseRefundClaimAfterFailure(
      {
        attempts: claim.stripeRefundMaxAttempts,
        error: new Error(
          'Stripe refund response does not match the persisted refund claim',
        ),
        leaseId,
        maxAttempts: claim.stripeRefundMaxAttempts,
        refundClaimId: claim.id,
      },
      now,
    );
    return { status: 'exhausted' as const };
  }
  const persistedStatus = persistedRegistrationRefundStatus(refund.status);
  yield* Database.use((database) =>
    database.transaction((tx) =>
      Effect.gen(function* () {
        const updatedClaims = yield* tx
          .update(transactions)
          .set(refundStatusUpdate(refund, now))
          .where(
            and(
              eq(transactions.id, claim.id),
              eq(transactions.stripeRefundClaimLeaseId, leaseId),
            ),
          )
          .returning({ id: transactions.id });
        if (updatedClaims.length !== 1) return;
        yield* reconcileRegistrationTransferRefund(tx, {
          refundTransactionId: claim.id,
          stripeRefundStatus: persistedStatus,
        });
      }),
    ),
  );
  return {
    refundId: refund.id,
    status: persistedStatus === 'succeeded' ? 'processed' : 'pending',
  };
});

export const reconcileRegistrationRefundWebhook = Effect.fn(
  'reconcileRegistrationRefundWebhook',
)(function* (refund: Stripe.Refund, eventAccount: null | string | undefined) {
  const now = new Date(yield* Clock.currentTimeMillis);
  const metadata = refund.metadata ?? {};
  const refundClaimId = metadata['refundClaimId'];
  const refundGeneration = metadata['refundGeneration'];
  const registrationId = metadata['registrationId'];
  const sourceTransactionId = metadata['sourceTransactionId'];
  const tenantId = metadata['tenantId'];
  if (
    !eventAccount ||
    !refundClaimId ||
    !refundGeneration ||
    !registrationId ||
    !sourceTransactionId ||
    !tenantId
  ) {
    return { status: 'rejected' as const };
  }

  return yield* Database.use((database) =>
    database.transaction((tx) =>
      Effect.gen(function* () {
        const claimRows = yield* tx
          .select({
            amount: transactions.amount,
            currency: transactions.currency,
            eventRegistrationId: transactions.eventRegistrationId,
            id: transactions.id,
            sourceTransactionId: transactions.sourceTransactionId,
            stripeAccountId: transactions.stripeAccountId,
            stripeRefundGeneration: transactions.stripeRefundGeneration,
            stripeRefundId: transactions.stripeRefundId,
            stripeRefundStatus: transactions.stripeRefundStatus,
            tenantId: transactions.tenantId,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.id, refundClaimId),
              eq(transactions.method, 'stripe'),
              eq(transactions.type, 'refund'),
            ),
          )
          .for('update');
        const claim = claimRows[0];
        if (
          !claim ||
          claim.tenantId !== tenantId ||
          claim.eventRegistrationId !== registrationId ||
          claim.sourceTransactionId !== sourceTransactionId ||
          claim.stripeAccountId !== eventAccount ||
          String(claim.stripeRefundGeneration) !== refundGeneration ||
          (claim.stripeRefundId && claim.stripeRefundId !== refund.id) ||
          Math.abs(claim.amount) !== refund.amount
        ) {
          return { status: 'rejected' as const };
        }

        const sourceRows = yield* tx
          .select({
            eventRegistrationId: transactions.eventRegistrationId,
            stripeAccountId: transactions.stripeAccountId,
            stripeChargeId: transactions.stripeChargeId,
            stripePaymentIntentId: transactions.stripePaymentIntentId,
          })
          .from(transactions)
          .where(
            registrationRefundSourcePaymentPredicate({
              eventRegistrationId: registrationId,
              sourceTransactionId,
              stripeAccountId: eventAccount,
              tenantId,
            }),
          );
        const source = sourceRows[0];
        const stripeReference = source?.stripeChargeId
          ? ({ charge: source.stripeChargeId } as const)
          : source?.stripePaymentIntentId
            ? ({ paymentIntent: source.stripePaymentIntentId } as const)
            : undefined;
        if (
          !source ||
          source.eventRegistrationId !== registrationId ||
          source.stripeAccountId !== eventAccount ||
          !stripeReference ||
          !registrationRefundMatchesPersistedClaim(refund, {
            amount: Math.abs(claim.amount),
            currency: claim.currency,
            refundClaimId,
            refundGeneration: claim.stripeRefundGeneration,
            registrationId,
            sourceTransactionId,
            stripeReference,
            tenantId,
          })
        ) {
          return { status: 'rejected' as const };
        }

        const incomingStatus = persistedRegistrationRefundStatus(refund.status);
        const statusCanAdvance = registrationRefundStatusCanAdvance(
          claim.stripeRefundStatus,
          incomingStatus,
        );
        const reconciledStatus = statusCanAdvance
          ? incomingStatus
          : (claim.stripeRefundStatus ?? incomingStatus);
        if (statusCanAdvance) {
          yield* tx
            .update(transactions)
            .set(refundStatusUpdate(refund, now))
            .where(eq(transactions.id, refundClaimId));
        }

        yield* reconcileRegistrationTransferRefund(tx, {
          refundTransactionId: refundClaimId,
          stripeRefundStatus: reconciledStatus,
        });
        return { status: 'reconciled' as const };
      }),
    ),
  );
});

export const processDueRegistrationRefundClaims = Effect.fn(
  'processDueRegistrationRefundClaims',
)(function* (batchSize = defaultRefundBatchSize) {
  const now = new Date(yield* Clock.currentTimeMillis);
  const claimIds = yield* Database.use((database) =>
    database
      .select({ id: transactions.id })
      .from(transactions)
      .where(registrationRefundClaimablePredicate(now))
      .orderBy(
        asc(transactions.stripeRefundNextAttemptAt),
        asc(transactions.id),
      )
      .limit(normalizeRegistrationRefundBatchSize(batchSize)),
  );

  let exhausted = 0;
  let failed = 0;
  let processed = 0;
  let skipped = 0;
  for (const claim of claimIds) {
    const result = yield* Effect.result(
      processRegistrationRefundClaim(claim.id),
    );
    if (Result.isFailure(result)) {
      failed += 1;
      yield* Effect.logError('Registration refund worker failed').pipe(
        Effect.annotateLogs({ error: result.failure, refundClaimId: claim.id }),
      );
      continue;
    }
    switch (result.success.status) {
      case 'exhausted': {
        exhausted += 1;
        break;
      }
      case 'pending':
      case 'retryScheduled': {
        break;
      }
      case 'processed': {
        processed += 1;
        break;
      }
      case 'skipped': {
        skipped += 1;
        break;
      }
    }
  }

  return {
    exhausted,
    failed,
    processed,
    scanned: claimIds.length,
    skipped,
  } satisfies RegistrationRefundWorkerSummary;
});

export const runRegistrationRefundWorker =
  processDueRegistrationRefundClaims().pipe(
    Effect.tap((summary) =>
      summary.scanned > 0
        ? Effect.logInfo('Processed registration refund claims').pipe(
            Effect.annotateLogs(summary),
          )
        : Effect.void,
    ),
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.logError('Registration refund worker iteration failed').pipe(
            Effect.annotateLogs({ cause: String(cause) }),
          ),
    ),
    Effect.repeat(refundWorkerInterval),
  );
