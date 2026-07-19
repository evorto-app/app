import type Stripe from 'stripe';

import { createId } from '@db/create-id';
import { Database, type DatabaseClient } from '@db/index';
import { transactions } from '@db/schema';
import {
  and,
  asc,
  eq,
  gt,
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
import { createHash } from 'node:crypto';

import type { RegistrationRefundWorkerRuntimeMode } from '../config/registration-refund-worker-config';

import { reconcileRegistrationTransferRefund } from '../registrations/registration-transfer-refund-reconciliation';
import { StripeClient } from '../stripe-client';

const refundClaimLeaseMs = 10 * 60 * 1000;
// Stripe can evict an idempotency result after 24 hours. Lease expiry follows
// acquisition by 10 minutes and retry scheduling by at most 30 minutes, so this
// cutoff preserves at least 1.5 hours for those offsets and clock differences.
const idlessRefundRecoveryWindowMs = 22 * 60 * 60 * 1000;
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
  if (claim.status !== 'pending') {
    return 'ambiguous';
  }
  if ((claim.leaseId === null) !== (claim.leaseExpiresAt === null)) {
    return 'ambiguous';
  }
  if (claim.leaseId !== null) {
    return 'active';
  }
  if (
    claim.stripeRefundStatus === 'failed' ||
    claim.stripeRefundStatus === 'canceled'
  ) {
    return claim.refundId ? 'newGeneration' : 'ambiguous';
  }
  if (claim.nextAttemptAt !== null && claim.attempts < claim.maxAttempts) {
    return 'active';
  }
  if (claim.refundId !== null) {
    // A persisted provider ID makes resuming safe even after a long pause:
    // the worker retrieves that exact refund instead of creating another one.
    return 'resumeGeneration';
  }
  if (
    claim.attempts === 0 &&
    claim.nextAttemptAt === null &&
    claim.stripeRefundStatus === null
  ) {
    // Claim acquisition increments attempts before contacting Stripe, so an
    // untouched orphan cannot hide an earlier provider request.
    return 'resumeGeneration';
  }
  // Reusing an old idempotency key cannot prove safety after Stripe's retention
  // window. Without a persisted refund ID, prior provider execution is
  // ambiguous and an operator must not be offered a duplicate-producing retry.
  return 'ambiguous';
};

export const registrationRefundIdempotencyKey = (
  refundClaimId: string,
  generation = 0,
) =>
  generation === 0
    ? `registration-refund:${refundClaimId}`
    : `registration-refund:${refundClaimId}:generation:${generation}`;

export const registrationProviderRefundOperationKey = (
  stripeRefundId: string,
): string =>
  `stripe-provider-refund:${createHash('sha256').update(stripeRefundId).digest('hex')}`;

const registrationProviderRefundOperationKeyPrefix = 'stripe-provider-refund:';
const registrationProviderRefundHoldReasonPrefix =
  'Waiting for Stripe provider refund ';

const registrationProviderRefundHoldReason = (stripeRefundId: string): string =>
  `${registrationProviderRefundHoldReasonPrefix}${stripeRefundId} to reach a terminal state`;

const isRegistrationProviderRefundOperationKey = (
  operationKey: null | string,
): boolean =>
  operationKey?.startsWith(registrationProviderRefundOperationKeyPrefix) ??
  false;

const registrationProviderRefundIdentityIsValid = (input: {
  readonly operationKey: null | string;
  readonly stripeRefundId: null | string;
}): boolean =>
  !isRegistrationProviderRefundOperationKey(input.operationKey) ||
  (input.stripeRefundId !== null &&
    input.operationKey ===
      registrationProviderRefundOperationKey(input.stripeRefundId));

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
        claim.nextAttemptAt
          ? eq(transactions.stripeRefundNextAttemptAt, claim.nextAttemptAt)
          : isNull(transactions.stripeRefundNextAttemptAt),
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

  return (
    registrationRefundMatchesPersistedProviderIdentity(refund, expected) &&
    metadata['refundClaimId'] === expected.refundClaimId &&
    metadata['refundGeneration'] === String(expected.refundGeneration) &&
    metadata['registrationId'] === expected.registrationId &&
    metadata['sourceTransactionId'] === expected.sourceTransactionId &&
    metadata['tenantId'] === expected.tenantId
  );
};

const registrationRefundMatchesPersistedProviderIdentity = (
  refund: Stripe.Refund,
  expected: {
    readonly amount: number;
    readonly currency: string;
    readonly stripeReference:
      { readonly charge: string } | { readonly paymentIntent: string };
  },
): boolean => {
  const referenceMatches =
    'charge' in expected.stripeReference
      ? stripeReferenceId(refund.charge) === expected.stripeReference.charge
      : stripeReferenceId(refund.payment_intent) ===
        expected.stripeReference.paymentIntent;
  return (
    refund.amount === expected.amount &&
    refund.currency.toUpperCase() === expected.currency.toUpperCase() &&
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

interface RegistrationProviderRefundSource {
  readonly amount: number;
  readonly currency: typeof transactions.$inferSelect.currency;
  readonly eventId: string;
  readonly eventRegistrationId: string;
  readonly id: string;
  readonly stripeAccountId: string;
  readonly targetUserId: string;
  readonly tenantId: string;
}

const registrationProviderRefundStatusUpdate = (
  refund: Pick<Stripe.Refund, 'id' | 'status'>,
): Partial<typeof transactions.$inferInsert> &
  Pick<typeof transactions.$inferInsert, 'status'> => {
  const stripeRefundStatus = persistedRegistrationRefundStatus(refund.status);
  const terminalWithoutRefund =
    stripeRefundStatus === 'canceled' || stripeRefundStatus === 'failed';
  return {
    status:
      stripeRefundStatus === 'succeeded'
        ? 'successful'
        : terminalWithoutRefund
          ? 'cancelled'
          : 'pending',
    stripeRefundClaimLeaseExpiresAt: null,
    stripeRefundClaimLeaseId: null,
    stripeRefundId: refund.id,
    stripeRefundLastError: terminalWithoutRefund
      ? `Stripe provider-side refund reached terminal status ${stripeRefundStatus}`
      : null,
    // Provider-observed refunds are retrieved only on an explicit operator
    // recovery. Never turn a dashboard-created failure into a new refund.
    stripeRefundNextAttemptAt: null,
    stripeRefundStatus,
  };
};

export const registrationProviderRefundPersistence = (
  refund: Pick<Stripe.Refund, 'amount' | 'id' | 'status'>,
  source: RegistrationProviderRefundSource,
  transactionId: string,
): typeof transactions.$inferInsert => {
  return {
    amount: -refund.amount,
    comment: 'Refund recorded by Stripe',
    currency: source.currency,
    eventId: source.eventId,
    eventRegistrationId: source.eventRegistrationId,
    executiveUserId: null,
    id: transactionId,
    manuallyCreated: false,
    method: 'stripe',
    refundOperationKey: registrationProviderRefundOperationKey(refund.id),
    sourceTransactionId: source.id,
    stripeAccountId: source.stripeAccountId,
    stripeRefundApplicationFee: false,
    ...registrationProviderRefundStatusUpdate(refund),
    targetUserId: source.targetUserId,
    tenantId: source.tenantId,
    type: 'refund',
  };
};

export const registrationRefundStatusCanAdvance = (
  current: null | PersistedStripeRefundStatus,
  incoming: PersistedStripeRefundStatus,
): boolean =>
  current === null ||
  current === 'pending' ||
  current === 'requires_action' ||
  current === incoming;

export const registrationRefundStatusUpdate = (
  refund: Pick<Stripe.Refund, 'id' | 'status'>,
  now: Date,
  attempts: number,
  maxAttempts: number,
): Partial<typeof transactions.$inferInsert> => {
  const status = persistedRegistrationRefundStatus(refund.status);
  const terminal =
    status === 'canceled' || status === 'failed' || status === 'succeeded';
  const processingStopped = !terminal && attempts >= maxAttempts;
  return {
    status: status === 'succeeded' ? 'successful' : 'pending',
    stripeRefundClaimLeaseExpiresAt: null,
    stripeRefundClaimLeaseId: null,
    stripeRefundId: refund.id,
    stripeRefundLastError:
      status === 'failed' || status === 'canceled'
        ? `Stripe refund reached terminal status ${status}`
        : processingStopped
          ? `Stripe refund remained ${status} after maximum processing attempts`
          : null,
    stripeRefundNextAttemptAt:
      terminal || processingStopped ? null : new Date(now.getTime() + 60_000),
    stripeRefundStatus: status,
  };
};

const idlessRefundRecoveryCutoff = (now: Date): Date =>
  new Date(now.getTime() - idlessRefundRecoveryWindowMs);

const registrationRefundGenerationStartedAt = () =>
  sql<Date>`coalesce(${transactions.stripeRefundRequeuedAt}, ${transactions.createdAt})`;

const idlessRefundScheduledRetryIsRecent = (cutoff: Date) =>
  or(
    and(
      eq(transactions.stripeRefundAttempts, 1),
      gt(transactions.stripeRefundNextAttemptAt, cutoff),
    ),
    and(
      gt(transactions.stripeRefundAttempts, 1),
      gt(transactions.stripeRefundNextAttemptAt, cutoff),
      // The latest retry timestamp alone is insufficient after repeated
      // outages because every retry reuses the generation's original key.
      gt(registrationRefundGenerationStartedAt(), cutoff),
    ),
  );

const idlessRefundScheduledRetryIsAmbiguous = (cutoff: Date) =>
  or(
    and(
      eq(transactions.stripeRefundAttempts, 1),
      lte(transactions.stripeRefundNextAttemptAt, cutoff),
    ),
    and(
      gt(transactions.stripeRefundAttempts, 1),
      or(
        lte(transactions.stripeRefundNextAttemptAt, cutoff),
        lte(registrationRefundGenerationStartedAt(), cutoff),
      ),
    ),
  );

export const registrationRefundAmbiguousRecoveryPredicate = (now: Date) =>
  and(
    eq(transactions.method, 'stripe'),
    eq(transactions.status, 'pending'),
    eq(transactions.type, 'refund'),
    isNull(transactions.stripeRefundId),
    or(
      and(
        isNotNull(transactions.stripeRefundClaimLeaseId),
        isNotNull(transactions.stripeRefundClaimLeaseExpiresAt),
        lte(
          transactions.stripeRefundClaimLeaseExpiresAt,
          idlessRefundRecoveryCutoff(now),
        ),
      ),
      and(
        isNull(transactions.stripeRefundClaimLeaseId),
        isNull(transactions.stripeRefundClaimLeaseExpiresAt),
        isNotNull(transactions.stripeRefundNextAttemptAt),
        idlessRefundScheduledRetryIsAmbiguous(idlessRefundRecoveryCutoff(now)),
      ),
    ),
  );

export const registrationRefundAmbiguousRecoveryUpdate = () =>
  ({
    stripeRefundClaimLeaseExpiresAt: null,
    stripeRefundClaimLeaseId: null,
    stripeRefundLastError:
      'Automatic recovery stopped because the prior Stripe refund attempt is too old to retry safely without a persisted refund ID; reconcile the claim with Stripe manually',
    stripeRefundNextAttemptAt: null,
  }) satisfies Partial<typeof transactions.$inferInsert>;

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
        or(
          isNotNull(transactions.stripeRefundId),
          eq(transactions.stripeRefundAttempts, 0),
          idlessRefundScheduledRetryIsRecent(idlessRefundRecoveryCutoff(now)),
        ),
      ),
      and(
        isNotNull(transactions.stripeRefundClaimLeaseId),
        isNotNull(transactions.stripeRefundClaimLeaseExpiresAt),
        lte(transactions.stripeRefundClaimLeaseExpiresAt, now),
        or(
          isNotNull(transactions.stripeRefundId),
          and(
            isNull(transactions.stripeRefundId),
            gt(
              transactions.stripeRefundClaimLeaseExpiresAt,
              idlessRefundRecoveryCutoff(now),
            ),
          ),
        ),
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
            refundOperationKey: transactions.refundOperationKey,
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
          stripeRefundApplicationFee === null ||
          !registrationProviderRefundIdentityIsValid({
            operationKey: claim.refundOperationKey,
            stripeRefundId: claim.stripeRefundId,
          })
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
  const isProviderRefund = isRegistrationProviderRefundOperationKey(
    claim.refundOperationKey,
  );
  const refundMatchesClaim = isProviderRefund
    ? claim.stripeRefundId === refund.id &&
      registrationRefundMatchesPersistedProviderIdentity(refund, {
        amount: Math.abs(claim.amount),
        currency: claim.currency,
        stripeReference: source.stripeReference,
      })
    : registrationRefundMatchesPersistedClaim(refund, {
        amount: Math.abs(claim.amount),
        currency: claim.currency,
        refundClaimId: claim.id,
        refundGeneration: claim.stripeRefundGeneration,
        registrationId: claim.eventRegistrationId,
        sourceTransactionId: source.id,
        stripeReference: source.stripeReference,
        tenantId: claim.tenantId,
      });
  if (!refundMatchesClaim) {
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
          .set(
            isProviderRefund
              ? registrationProviderRefundStatusUpdate(refund)
              : registrationRefundStatusUpdate(
                  refund,
                  now,
                  claim.stripeRefundAttempts,
                  claim.stripeRefundMaxAttempts,
                ),
          )
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

/**
 * Persists refunds created directly in Stripe against the exact connected
 * account and payment reference. This keeps provider-side refunds in the same
 * source-payment ledger used by cancellation and transfer refund guards.
 */
export const reconcileProviderRegistrationRefundWebhook = Effect.fn(
  'reconcileProviderRegistrationRefundWebhook',
)(function* (refund: Stripe.Refund, eventAccount: null | string | undefined) {
  const now = new Date(yield* Clock.currentTimeMillis);
  const stripeChargeId = stripeReferenceId(refund.charge);
  const stripePaymentIntentId = stripeReferenceId(refund.payment_intent);
  if (
    !eventAccount ||
    (!stripeChargeId && !stripePaymentIntentId) ||
    !Number.isSafeInteger(refund.amount) ||
    refund.amount <= 0
  ) {
    return { status: 'ignored' as const };
  }

  return yield* Database.use((database) =>
    database.transaction((tx) =>
      Effect.gen(function* () {
        const stripeReferencePredicate = stripeChargeId
          ? stripePaymentIntentId
            ? or(
                eq(transactions.stripeChargeId, stripeChargeId),
                eq(transactions.stripePaymentIntentId, stripePaymentIntentId),
              )
            : eq(transactions.stripeChargeId, stripeChargeId)
          : stripePaymentIntentId
            ? eq(transactions.stripePaymentIntentId, stripePaymentIntentId)
            : undefined;
        if (!stripeReferencePredicate) {
          return { status: 'ignored' as const };
        }
        const sourceRows = yield* tx
          .select({
            amount: transactions.amount,
            currency: transactions.currency,
            eventId: transactions.eventId,
            eventRegistrationId: transactions.eventRegistrationId,
            id: transactions.id,
            status: transactions.status,
            stripeAccountId: transactions.stripeAccountId,
            stripeChargeId: transactions.stripeChargeId,
            stripePaymentIntentId: transactions.stripePaymentIntentId,
            targetUserId: transactions.targetUserId,
            tenantId: transactions.tenantId,
          })
          .from(transactions)
          .where(
            and(
              stripeReferencePredicate,
              eq(transactions.method, 'stripe'),
              inArray(transactions.type, ['registration', 'addon']),
            ),
          )
          .orderBy(transactions.id)
          .for('update');
        if (sourceRows.length === 0) {
          return { status: 'ignored' as const };
        }
        const source = sourceRows[0];
        if (
          sourceRows.length !== 1 ||
          !source ||
          source.amount <= 0 ||
          refund.amount > source.amount ||
          refund.currency.toUpperCase() !== source.currency.toUpperCase() ||
          !source.eventId ||
          !source.eventRegistrationId ||
          !source.stripeAccountId ||
          source.stripeAccountId !== eventAccount ||
          !source.targetUserId ||
          (stripeChargeId &&
            source.stripeChargeId &&
            source.stripeChargeId !== stripeChargeId) ||
          (stripePaymentIntentId &&
            source.stripePaymentIntentId &&
            source.stripePaymentIntentId !== stripePaymentIntentId) ||
          !(
            (stripeChargeId && source.stripeChargeId === stripeChargeId) ||
            (stripePaymentIntentId &&
              source.stripePaymentIntentId === stripePaymentIntentId)
          )
        ) {
          return { status: 'rejected' as const };
        }
        if (source.status === 'pending') {
          return { status: 'deferred' as const };
        }
        if (source.status !== 'successful') {
          return { status: 'ignored' as const };
        }

        const providerSource = {
          amount: source.amount,
          currency: source.currency,
          eventId: source.eventId,
          eventRegistrationId: source.eventRegistrationId,
          id: source.id,
          stripeAccountId: source.stripeAccountId,
          targetUserId: source.targetUserId,
          tenantId: source.tenantId,
        } satisfies RegistrationProviderRefundSource;
        const operationKey = registrationProviderRefundOperationKey(refund.id);
        const refundRows = yield* tx
          .select({
            amount: transactions.amount,
            currency: transactions.currency,
            eventId: transactions.eventId,
            eventRegistrationId: transactions.eventRegistrationId,
            id: transactions.id,
            manuallyCreated: transactions.manuallyCreated,
            method: transactions.method,
            refundOperationKey: transactions.refundOperationKey,
            sourceTransactionId: transactions.sourceTransactionId,
            status: transactions.status,
            stripeAccountId: transactions.stripeAccountId,
            stripeRefundAttempts: transactions.stripeRefundAttempts,
            stripeRefundClaimLeaseExpiresAt:
              transactions.stripeRefundClaimLeaseExpiresAt,
            stripeRefundClaimLeaseId: transactions.stripeRefundClaimLeaseId,
            stripeRefundGeneration: transactions.stripeRefundGeneration,
            stripeRefundHistory: transactions.stripeRefundHistory,
            stripeRefundId: transactions.stripeRefundId,
            stripeRefundLastError: transactions.stripeRefundLastError,
            stripeRefundMaxAttempts: transactions.stripeRefundMaxAttempts,
            stripeRefundNextAttemptAt: transactions.stripeRefundNextAttemptAt,
            stripeRefundStatus: transactions.stripeRefundStatus,
            targetUserId: transactions.targetUserId,
            tenantId: transactions.tenantId,
            type: transactions.type,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.sourceTransactionId, source.id),
              eq(transactions.tenantId, source.tenantId),
              eq(transactions.type, 'refund'),
            ),
          )
          .orderBy(transactions.id)
          .for('update');
        const existingRows = refundRows.filter(
          (candidate) => candidate.stripeRefundId === refund.id,
        );
        const existing = existingRows[0];
        if (
          existing &&
          (existingRows.length !== 1 ||
            existing.amount !== -refund.amount ||
            existing.currency !== source.currency ||
            existing.eventId !== source.eventId ||
            existing.eventRegistrationId !== source.eventRegistrationId ||
            existing.manuallyCreated !== false ||
            existing.method !== 'stripe' ||
            existing.refundOperationKey !== operationKey ||
            existing.sourceTransactionId !== source.id ||
            existing.stripeAccountId !== source.stripeAccountId ||
            existing.targetUserId !== source.targetUserId ||
            existing.tenantId !== source.tenantId ||
            existing.type !== 'refund')
        ) {
          return { status: 'rejected' as const };
        }

        const persistence = registrationProviderRefundPersistence(
          refund,
          providerSource,
          existing?.id ?? createId(),
        );
        const incomingStatus = persistence.stripeRefundStatus ?? 'pending';
        const canAdvanceExisting = existing
          ? registrationRefundStatusCanAdvance(
              existing.stripeRefundStatus,
              incomingStatus,
            )
          : true;
        const effectiveStatus =
          existing && !canAdvanceExisting
            ? (existing.stripeRefundStatus ?? incomingStatus)
            : incomingStatus;
        const activeInternalClaims = refundRows.filter(
          (candidate) =>
            candidate.manuallyCreated === false &&
            candidate.method === 'stripe' &&
            candidate.refundOperationKey !== null &&
            !isRegistrationProviderRefundOperationKey(
              candidate.refundOperationKey,
            ) &&
            candidate.status === 'pending',
        );
        const activeClaim = activeInternalClaims[0];
        const providerConsumesCapacity =
          effectiveStatus !== 'canceled' && effectiveStatus !== 'failed';
        if (activeInternalClaims.length > 1 && providerConsumesCapacity) {
          return { status: 'deferred' as const };
        }

        let otherCommittedAmount = 0;
        for (const candidate of refundRows) {
          if (
            candidate.id === activeClaim?.id ||
            candidate.id === existing?.id ||
            candidate.status === 'cancelled'
          ) {
            continue;
          }
          otherCommittedAmount += Math.abs(candidate.amount);
        }
        const currentClaimAmount = activeClaim
          ? Math.abs(activeClaim.amount)
          : 0;
        const nextClaimAmount = activeClaim
          ? Math.min(
              currentClaimAmount,
              Math.max(
                0,
                source.amount -
                  otherCommittedAmount -
                  (providerConsumesCapacity ? refund.amount : 0),
              ),
            )
          : 0;
        const overlapsActiveClaim =
          activeClaim !== undefined && nextClaimAmount < currentClaimAmount;
        const holdReason = registrationProviderRefundHoldReason(refund.id);
        const heldForAnotherProviderRefund =
          activeClaim?.stripeRefundLastError?.startsWith(
            registrationProviderRefundHoldReasonPrefix,
          ) === true && activeClaim.stripeRefundLastError !== holdReason;
        const claimHasLease =
          activeClaim !== undefined &&
          (activeClaim.stripeRefundClaimLeaseId !== null ||
            activeClaim.stripeRefundClaimLeaseExpiresAt !== null);
        const claimHasUnresolvedRefund =
          activeClaim?.stripeRefundId !== null &&
          activeClaim?.stripeRefundId !== undefined &&
          activeClaim.stripeRefundStatus !== 'canceled' &&
          activeClaim.stripeRefundStatus !== 'failed';

        if (
          overlapsActiveClaim &&
          (effectiveStatus === 'pending' ||
            effectiveStatus === 'requires_action')
        ) {
          if (
            claimHasLease ||
            claimHasUnresolvedRefund ||
            heldForAnotherProviderRefund ||
            (activeClaim.stripeRefundNextAttemptAt === null &&
              activeClaim.stripeRefundLastError !== holdReason)
          ) {
            return { status: 'deferred' as const };
          }
          const heldClaims = yield* tx
            .update(transactions)
            .set({
              stripeRefundLastError: holdReason,
              stripeRefundNextAttemptAt: null,
            })
            .where(
              and(
                eq(transactions.id, activeClaim.id),
                eq(transactions.status, 'pending'),
                isNull(transactions.stripeRefundClaimLeaseExpiresAt),
                isNull(transactions.stripeRefundClaimLeaseId),
              ),
            )
            .returning({ id: transactions.id });
          return heldClaims.length === 1
            ? { status: 'deferred' as const }
            : { status: 'rejected' as const };
        }

        if (
          overlapsActiveClaim &&
          effectiveStatus === 'succeeded' &&
          (claimHasLease ||
            claimHasUnresolvedRefund ||
            heldForAnotherProviderRefund)
        ) {
          return { status: 'deferred' as const };
        }

        if (
          activeClaim &&
          overlapsActiveClaim &&
          effectiveStatus === 'succeeded' &&
          nextClaimAmount === 0 &&
          refund.amount === currentClaimAmount &&
          !existing
        ) {
          const terminalHistory =
            activeClaim.stripeRefundId &&
            (activeClaim.stripeRefundStatus === 'canceled' ||
              activeClaim.stripeRefundStatus === 'failed')
              ? [
                  ...activeClaim.stripeRefundHistory,
                  {
                    closedAt: now.toISOString(),
                    generation: activeClaim.stripeRefundGeneration,
                    reason:
                      'Provider-side refund superseded the internal refund generation',
                    refundId: activeClaim.stripeRefundId,
                    status: activeClaim.stripeRefundStatus,
                  },
                ]
              : activeClaim.stripeRefundHistory;
          const advancesGeneration =
            activeClaim.stripeRefundAttempts > 0 ||
            activeClaim.stripeRefundId !== null;
          const adoptedClaims = yield* tx
            .update(transactions)
            .set({
              ...registrationRefundStatusUpdate(
                refund,
                now,
                activeClaim.stripeRefundAttempts,
                activeClaim.stripeRefundMaxAttempts,
              ),
              stripeRefundApplicationFee: false,
              ...(advancesGeneration && {
                stripeRefundGeneration: activeClaim.stripeRefundGeneration + 1,
                stripeRefundLastRequeueReason:
                  'Provider-side refund superseded the internal refund generation',
                stripeRefundRequeuedAt: now,
              }),
              stripeRefundHistory: terminalHistory,
            })
            .where(
              and(
                eq(transactions.id, activeClaim.id),
                eq(transactions.status, 'pending'),
                isNull(transactions.stripeRefundClaimLeaseExpiresAt),
                isNull(transactions.stripeRefundClaimLeaseId),
              ),
            )
            .returning({ id: transactions.id });
          if (adoptedClaims.length !== 1) {
            return { status: 'rejected' as const };
          }
          yield* reconcileRegistrationTransferRefund(tx, {
            refundTransactionId: activeClaim.id,
            stripeRefundStatus: 'succeeded',
          });
          return { status: 'reconciled' as const };
        }

        const persistProviderRefund = Effect.gen(function* () {
          if (existing) {
            if (!canAdvanceExisting) return existing.id;
            const updated = yield* tx
              .update(transactions)
              .set(registrationProviderRefundStatusUpdate(refund))
              .where(
                and(
                  eq(transactions.id, existing.id),
                  eq(transactions.stripeRefundId, refund.id),
                ),
              )
              .returning({ id: transactions.id });
            return updated[0]?.id;
          }
          const inserted = yield* tx
            .insert(transactions)
            .values(persistence)
            .onConflictDoNothing()
            .returning({ id: transactions.id });
          return inserted[0]?.id;
        });
        const providerRefundTransactionId = yield* persistProviderRefund;
        if (!providerRefundTransactionId) {
          return { status: 'rejected' as const };
        }

        if (
          activeClaim &&
          overlapsActiveClaim &&
          effectiveStatus === 'succeeded' &&
          nextClaimAmount > 0
        ) {
          const terminalHistory =
            activeClaim.stripeRefundId &&
            (activeClaim.stripeRefundStatus === 'canceled' ||
              activeClaim.stripeRefundStatus === 'failed')
              ? [
                  ...activeClaim.stripeRefundHistory,
                  {
                    closedAt: now.toISOString(),
                    generation: activeClaim.stripeRefundGeneration,
                    reason:
                      'Provider-side refund reduced the remaining internal refund',
                    refundId: activeClaim.stripeRefundId,
                    status: activeClaim.stripeRefundStatus,
                  },
                ]
              : activeClaim.stripeRefundHistory;
          const advancesGeneration =
            activeClaim.stripeRefundAttempts > 0 ||
            activeClaim.stripeRefundId !== null;
          const reducedClaims = yield* tx
            .update(transactions)
            .set({
              amount: -nextClaimAmount,
              status: 'pending',
              stripeRefundAttempts: 0,
              stripeRefundClaimLeaseExpiresAt: null,
              stripeRefundClaimLeaseId: null,
              stripeRefundGeneration:
                activeClaim.stripeRefundGeneration +
                (advancesGeneration ? 1 : 0),
              stripeRefundHistory: terminalHistory,
              stripeRefundId: null,
              stripeRefundLastError: null,
              stripeRefundNextAttemptAt: now,
              stripeRefundStatus: null,
              ...(advancesGeneration && {
                stripeRefundLastRequeueReason:
                  'Provider-side refund reduced the remaining internal refund',
                stripeRefundRequeuedAt: now,
              }),
            })
            .where(
              and(
                eq(transactions.id, activeClaim.id),
                eq(transactions.status, 'pending'),
                isNull(transactions.stripeRefundClaimLeaseExpiresAt),
                isNull(transactions.stripeRefundClaimLeaseId),
              ),
            )
            .returning({ id: transactions.id });
          return reducedClaims.length === 1
            ? { status: 'reconciled' as const }
            : { status: 'rejected' as const };
        }

        if (
          activeClaim &&
          activeClaim.stripeRefundLastError === holdReason &&
          (effectiveStatus === 'canceled' || effectiveStatus === 'failed')
        ) {
          yield* tx
            .update(transactions)
            .set({
              stripeRefundLastError: null,
              stripeRefundNextAttemptAt: now,
            })
            .where(
              and(
                eq(transactions.id, activeClaim.id),
                eq(transactions.status, 'pending'),
                isNull(transactions.stripeRefundClaimLeaseExpiresAt),
                isNull(transactions.stripeRefundClaimLeaseId),
              ),
            );
        }
        return { status: 'reconciled' as const };
      }),
    ),
  );
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
  if (!eventAccount) {
    return { status: 'rejected' as const };
  }

  return yield* Database.use((database) =>
    database.transaction((tx) =>
      Effect.gen(function* () {
        const claimPredicate = refundClaimId
          ? or(
              eq(transactions.id, refundClaimId),
              eq(transactions.stripeRefundId, refund.id),
            )
          : eq(transactions.stripeRefundId, refund.id);
        const claimRows = yield* tx
          .select({
            amount: transactions.amount,
            currency: transactions.currency,
            eventRegistrationId: transactions.eventRegistrationId,
            id: transactions.id,
            refundOperationKey: transactions.refundOperationKey,
            sourceTransactionId: transactions.sourceTransactionId,
            stripeAccountId: transactions.stripeAccountId,
            stripeRefundAttempts: transactions.stripeRefundAttempts,
            stripeRefundGeneration: transactions.stripeRefundGeneration,
            stripeRefundHistory: transactions.stripeRefundHistory,
            stripeRefundId: transactions.stripeRefundId,
            stripeRefundMaxAttempts: transactions.stripeRefundMaxAttempts,
            stripeRefundStatus: transactions.stripeRefundStatus,
            tenantId: transactions.tenantId,
          })
          .from(transactions)
          .where(
            and(
              claimPredicate,
              eq(transactions.method, 'stripe'),
              eq(transactions.type, 'refund'),
            ),
          )
          .for('update');
        if (claimRows.length === 0) {
          return { status: 'notClaim' as const };
        }
        const persistedRefundClaims = claimRows.filter(
          (candidate) => candidate.stripeRefundId === refund.id,
        );
        const metadataClaims = refundClaimId
          ? claimRows.filter((candidate) => candidate.id === refundClaimId)
          : [];
        if (persistedRefundClaims.length > 1 || metadataClaims.length > 1) {
          return { status: 'rejected' as const };
        }
        const claim = persistedRefundClaims[0] ?? metadataClaims[0];
        if (!claim) {
          return { status: 'notClaim' as const };
        }
        if (
          claim.refundOperationKey ===
          registrationProviderRefundOperationKey(refund.id)
        ) {
          return { status: 'notClaim' as const };
        }
        const persistedRefundIdMatches = claim.stripeRefundId === refund.id;
        const metadataIdentityMatches =
          refundClaimId === claim.id &&
          refundGeneration === String(claim.stripeRefundGeneration) &&
          registrationId === claim.eventRegistrationId &&
          sourceTransactionId === claim.sourceTransactionId &&
          tenantId === claim.tenantId &&
          (claim.stripeRefundId === null || persistedRefundIdMatches);
        if (!persistedRefundIdMatches && !metadataIdentityMatches) {
          return claim.stripeRefundHistory.some(
            (attempt) => attempt.refundId === refund.id,
          )
            ? { status: 'rejected' as const }
            : { status: 'notClaim' as const };
        }
        if (
          !claim.eventRegistrationId ||
          !claim.sourceTransactionId ||
          !claim.tenantId ||
          claim.stripeAccountId !== eventAccount ||
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
              eventRegistrationId: claim.eventRegistrationId,
              sourceTransactionId: claim.sourceTransactionId,
              stripeAccountId: eventAccount,
              tenantId: claim.tenantId,
            }),
          );
        const source = sourceRows[0];
        const stripeReference:
          | undefined
          | { readonly charge: string }
          | { readonly paymentIntent: string } = source?.stripeChargeId
          ? { charge: source.stripeChargeId }
          : source?.stripePaymentIntentId
            ? { paymentIntent: source.stripePaymentIntentId }
            : undefined;
        if (
          !source ||
          source.eventRegistrationId !== claim.eventRegistrationId ||
          source.stripeAccountId !== eventAccount ||
          !stripeReference ||
          !registrationRefundMatchesPersistedProviderIdentity(refund, {
            amount: Math.abs(claim.amount),
            currency: claim.currency,
            stripeReference,
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
            .set(
              registrationRefundStatusUpdate(
                refund,
                now,
                claim.stripeRefundAttempts,
                claim.stripeRefundMaxAttempts,
              ),
            )
            .where(eq(transactions.id, claim.id));
        }

        yield* reconcileRegistrationTransferRefund(tx, {
          refundTransactionId: claim.id,
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
  const ambiguousClaimIds = yield* Database.use((database) =>
    database
      .update(transactions)
      .set(registrationRefundAmbiguousRecoveryUpdate())
      .where(registrationRefundAmbiguousRecoveryPredicate(now))
      .returning({ id: transactions.id }),
  );
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

  let exhausted = ambiguousClaimIds.length;
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
    scanned: ambiguousClaimIds.length + claimIds.length,
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

export type RegistrationRefundWorkerStartupResult =
  'disabledForPlaywright' | 'started';

const registrationRefundWorkerStarted: RegistrationRefundWorkerStartupResult =
  'started';
const registrationRefundWorkerDisabled: RegistrationRefundWorkerStartupResult =
  'disabledForPlaywright';

export const launchRegistrationRefundWorker = <A, E, R>(
  mode: RegistrationRefundWorkerRuntimeMode,
  worker: Effect.Effect<A, E, R>,
) =>
  mode === 'enabled'
    ? worker.pipe(
        Effect.forkScoped,
        Effect.tap(() =>
          Effect.logInfo('Registration refund worker started').pipe(
            Effect.annotateLogs({ mode }),
          ),
        ),
        Effect.as(registrationRefundWorkerStarted),
      )
    : Effect.logWarning(
        'Registration refund worker disabled for validated Playwright runtime',
      ).pipe(
        Effect.annotateLogs({ mode }),
        Effect.as(registrationRefundWorkerDisabled),
      );
