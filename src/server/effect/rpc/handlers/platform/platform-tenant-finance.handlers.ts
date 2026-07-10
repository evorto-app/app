import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { resolveReceiptCountrySettings } from '@shared/finance/receipt-countries';
import { type Permission } from '@shared/permissions/permissions';
import { type PlatformAuditSnapshot } from '@shared/platform-audit';
import { RegistrationTransferStatus } from '@shared/registration-transfer';
import {
  PlatformFinancePayoutType,
  type PlatformFinanceReceiptReviewInput,
  type PlatformFinanceRecordReimbursementInput,
  PlatformFinanceRefundClaimStatus,
  PlatformFinanceRefundRecoveryMode,
  type PlatformFinanceRequeueRefundClaimInput,
  PlatformFinanceTenantContext,
  PlatformTenantFinanceRpcs,
} from '@shared/rpc-contracts/app-rpcs/platform-tenant-finance.rpcs';
import { RpcRequestContextMiddleware } from '@shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import { and, count, desc, eq, inArray, isNull, not } from 'drizzle-orm';
import { DateTime, Effect, Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';
import { createHash } from 'node:crypto';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  eventInstances,
  financeReceipts,
  registrationTransfers,
  tenants,
  transactions,
  users,
} from '../../../../../db/schema';
import { Tenant } from '../../../../../types/custom/tenant';
import { enqueueReceiptReviewedEmail } from '../../../../notifications/email-delivery';
import {
  registrationRefundRequeueEligibility,
  type RegistrationRefundRequeueState,
  requeueRegistrationRefundClaim,
} from '../../../../payments/registration-refund';
import { markRegistrationTransferRefundRequeued } from '../../../../registrations/registration-transfer-refund-reconciliation';
import {
  financeReceiptView,
  normalizeFinanceReceiptBaseRecord,
  normalizeFinanceTransactionRecord,
  validateReceiptCountryForTenant,
} from '../finance/finance.shared';
import {
  withSignedReceiptPreviewUrl,
  withSignedReceiptPreviewUrls,
} from '../finance/receipt-media.service';
import {
  providePlatformOperation,
  resolvePlatformMutation,
  resolvePlatformRead,
  writePlatformAudit,
} from '../shared/platform-operation.service';
import { RpcAccess } from '../shared/rpc-access.service';

type DatabaseTransaction = Parameters<
  Parameters<DatabaseClient['transaction']>[0]
>[0];

type FinanceReceiptRow = Parameters<
  typeof normalizeFinanceReceiptBaseRecord
>[0];

interface FinanceReceiptSubmitterRow extends FinanceReceiptRow {
  readonly submittedByCommunicationEmail: null | string;
  readonly submittedByEmail: string;
  readonly submittedByFirstName: string;
  readonly submittedByLastName: string;
}

type PlatformTenantFinanceHandlers = RpcGroup.HandlersFrom<
  Rpc.AddMiddleware<
    PlatformTenantFinanceRequest,
    typeof RpcRequestContextMiddleware
  >
>;

type PlatformTenantFinanceRequest = RpcGroup.Rpcs<
  typeof PlatformTenantFinanceRpcs
>;

interface RefundRecoveryCandidate {
  readonly amount: number;
  readonly attempts: number;
  readonly createdAt: Date;
  readonly currency: Tenant['currency'];
  readonly eventId: null | string;
  readonly eventRegistrationId: null | string;
  readonly generation: number;
  readonly lastError: null | string;
  readonly leaseExpiresAt: Date | null;
  readonly leaseId: null | string;
  readonly maxAttempts: number;
  readonly nextAttemptAt: Date | null;
  readonly refundClaimId: string;
  readonly refundId: null | string;
  readonly sourceTransactionId: null | string;
  readonly status: typeof transactions.$inferSelect.status;
  readonly stripeRefundStatus: typeof transactions.$inferSelect.stripeRefundStatus;
  readonly transferEventId: null | string;
  readonly transferId: null | string;
  readonly transferRecipientRegistrationId: null | string;
  readonly transferSourceRegistrationId: null | string;
  readonly transferStatus:
    null | typeof registrationTransfers.$inferSelect.status;
  readonly updatedAt: Date;
}

const PlatformFinanceReceiptReviewAuditState = Schema.Struct({
  alcoholAmount: Schema.Number,
  currency: Tenant.fields.currency,
  depositAmount: Schema.Number,
  hasAlcohol: Schema.Boolean,
  hasDeposit: Schema.Boolean,
  hasRejectionReason: Schema.Boolean,
  purchaseCountry: Schema.NonEmptyString,
  receiptDate: Schema.NonEmptyString,
  reviewedAt: Schema.NullOr(Schema.NonEmptyString),
  status: Schema.Literals(['approved', 'refunded', 'rejected', 'submitted']),
  taxAmount: Schema.Number,
  totalAmount: Schema.Number,
});

const PlatformFinanceReimbursementAuditState = Schema.Struct({
  currency: Tenant.fields.currency,
  payoutType: PlatformFinancePayoutType,
  receiptCount: Schema.Number,
  receiptIds: Schema.Array(Schema.NonEmptyString),
  refundedAt: Schema.NullOr(Schema.NonEmptyString),
  status: Schema.Literals(['approved', 'refunded']),
  totalAmount: Schema.Number,
  transactionId: Schema.NullOr(Schema.NonEmptyString),
});

const PlatformFinanceRefundRecoveryAuditState = Schema.Struct({
  amount: Schema.Number,
  attempts: Schema.Number,
  currency: Tenant.fields.currency,
  eventId: Schema.NullOr(Schema.NonEmptyString),
  eventRegistrationId: Schema.NonEmptyString,
  generation: Schema.Number,
  hasLastError: Schema.Boolean,
  hasRefundId: Schema.Boolean,
  maxAttempts: Schema.Number,
  mode: PlatformFinanceRefundRecoveryMode,
  sourceTransactionId: Schema.NonEmptyString,
  status: Schema.Literals(['cancelled', 'pending', 'successful']),
  stripeRefundStatus: Schema.NullOr(PlatformFinanceRefundClaimStatus),
  transferId: Schema.NullOr(Schema.NonEmptyString),
  transferStatus: Schema.NullOr(RegistrationTransferStatus),
});

const databaseEffect = <A, R>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, R>,
): Effect.Effect<A, RpcBadRequestError, Database | R> =>
  Database.use((database) =>
    operation(database).pipe(
      Effect.catch((error) =>
        error instanceof RpcBadRequestError
          ? Effect.fail(error)
          : Effect.die(error),
      ),
    ),
  );

const receiptNotFound = (receiptId: string) =>
  new RpcBadRequestError({
    message: `Receipt ${receiptId} was not found for the target tenant`,
    reason: 'receiptNotFound',
  });

const toTenantContext = (
  tenant: Pick<Tenant, 'currency' | 'id' | 'receiptSettings'>,
) =>
  PlatformFinanceTenantContext.make({
    currency: tenant.currency,
    receiptCountryConfig: resolveReceiptCountrySettings(tenant.receiptSettings),
    targetTenantId: tenant.id,
  });

const submitterEmail = (submitter: {
  readonly submittedByCommunicationEmail: null | string;
  readonly submittedByEmail: string;
}): string =>
  submitter.submittedByCommunicationEmail?.trim() || submitter.submittedByEmail;

export const payoutDetailsVersion = (
  payoutType: Schema.Schema.Type<typeof PlatformFinancePayoutType>,
  payoutReference: string,
): string =>
  createHash('sha256')
    .update(`platform-payout:v1:${payoutType}:${payoutReference.trim()}`)
    .digest('hex');

const recoveryMode = (
  claim: RefundRecoveryCandidate,
): null | Schema.Schema.Type<typeof PlatformFinanceRefundRecoveryMode> => {
  const eligibility = registrationRefundRequeueEligibility({
    attempts: claim.attempts,
    leaseExpiresAt: claim.leaseExpiresAt,
    leaseId: claim.leaseId,
    maxAttempts: claim.maxAttempts,
    nextAttemptAt: claim.nextAttemptAt,
    refundId: claim.refundId,
    status: claim.status,
    stripeRefundStatus: claim.stripeRefundStatus,
  });
  return eligibility === 'newGeneration' || eligibility === 'resumeGeneration'
    ? eligibility
    : null;
};

const toRefundRecoveryRecord = (claim: RefundRecoveryCandidate) => {
  const mode = recoveryMode(claim);
  if (
    !mode ||
    !claim.eventRegistrationId ||
    !claim.sourceTransactionId ||
    claim.stripeRefundStatus === 'succeeded'
  ) {
    return null;
  }
  let transfer = null;
  if (claim.transferId) {
    if (
      !claim.transferEventId ||
      !claim.transferSourceRegistrationId ||
      !claim.transferStatus ||
      (mode === 'newGeneration' &&
        claim.transferStatus !== 'compensation_failed' &&
        claim.transferStatus !== 'refund_failed') ||
      (mode === 'resumeGeneration' &&
        claim.transferStatus !== 'compensation_pending' &&
        claim.transferStatus !== 'refund_pending')
    ) {
      return null;
    }
    transfer = {
      eventId: claim.transferEventId,
      id: claim.transferId,
      recipientRegistrationId: claim.transferRecipientRegistrationId,
      sourceRegistrationId: claim.transferSourceRegistrationId,
      status: claim.transferStatus,
    };
  }

  return {
    amount: Math.abs(claim.amount),
    createdAt: claim.createdAt.toISOString(),
    currency: claim.currency,
    eventId: claim.eventId,
    eventRegistrationId: claim.eventRegistrationId,
    id: claim.refundClaimId,
    lastError: claim.lastError,
    mode,
    sourceTransactionId: claim.sourceTransactionId,
    stripeRefundAttempts: claim.attempts,
    stripeRefundGeneration: claim.generation,
    stripeRefundMaxAttempts: claim.maxAttempts,
    stripeRefundStatus: claim.stripeRefundStatus,
    transfer,
    updatedAt: claim.updatedAt.toISOString(),
  };
};

const toPlatformReceiptRecord = (receipt: FinanceReceiptRow) => {
  const normalized = normalizeFinanceReceiptBaseRecord(receipt);

  return {
    alcoholAmount: normalized.alcoholAmount,
    attachmentFileName: normalized.attachmentFileName,
    attachmentMimeType: normalized.attachmentMimeType,
    createdAt: normalized.createdAt,
    currency: normalized.currency,
    depositAmount: normalized.depositAmount,
    eventId: normalized.eventId,
    hasAlcohol: normalized.hasAlcohol,
    hasDeposit: normalized.hasDeposit,
    id: normalized.id,
    previewImageUrl: normalized.previewImageUrl,
    purchaseCountry: normalized.purchaseCountry,
    receiptDate: normalized.receiptDate,
    refundedAt: normalized.refundedAt,
    refundTransactionId: normalized.refundTransactionId,
    rejectionReason: normalized.rejectionReason,
    reviewedAt: normalized.reviewedAt,
    status: normalized.status,
    submittedByUserId: normalized.submittedByUserId,
    taxAmount: normalized.taxAmount,
    totalAmount: normalized.totalAmount,
    updatedAt: normalized.updatedAt,
  };
};

const toPlatformReceiptWithSubmitter = (
  receipt: FinanceReceiptSubmitterRow,
) => ({
  ...toPlatformReceiptRecord(receipt),
  submittedByEmail: submitterEmail(receipt),
  submittedByFirstName: receipt.submittedByFirstName,
  submittedByLastName: receipt.submittedByLastName,
});

const loadLockedTargetTenant = Effect.fn(
  'PlatformTenantFinance.loadLockedTargetTenant',
)(function* (database: DatabaseTransaction, targetTenantId: string) {
  const tenantRows = yield* database
    .select()
    .from(tenants)
    .where(eq(tenants.id, targetTenantId))
    .for('update')
    .pipe(Effect.orDie);
  const tenantRecord = tenantRows[0];
  if (!tenantRecord) {
    return yield* new RpcBadRequestError({
      message: 'Target tenant not found',
      reason: 'targetTenantNotFound',
    });
  }

  return yield* Schema.decodeUnknownEffect(Tenant)(tenantRecord).pipe(
    Effect.orDie,
  );
});

const reviewAuditSnapshot = (
  receipt: FinanceReceiptRow,
): PlatformAuditSnapshot => ({
  resourceId: receipt.id,
  resourceType: 'receipt',
  state: Schema.decodeUnknownSync(PlatformFinanceReceiptReviewAuditState)({
    alcoholAmount: receipt.alcoholAmount,
    currency: receipt.currency,
    depositAmount: receipt.depositAmount,
    hasAlcohol: receipt.hasAlcohol,
    hasDeposit: receipt.hasDeposit,
    hasRejectionReason: Boolean(receipt.rejectionReason),
    purchaseCountry: receipt.purchaseCountry,
    receiptDate: receipt.receiptDate.toISOString(),
    reviewedAt: receipt.reviewedAt?.toISOString() ?? null,
    status: receipt.status,
    taxAmount: receipt.taxAmount,
    totalAmount: receipt.totalAmount,
  }),
});

export const reimbursementAuditSnapshot = (input: {
  readonly currency: Tenant['currency'];
  readonly payoutType: Schema.Schema.Type<typeof PlatformFinancePayoutType>;
  readonly receiptIds: readonly string[];
  readonly refundedAt: Date | null;
  readonly status: 'approved' | 'refunded';
  readonly totalAmount: number;
  readonly transactionId: null | string;
}): PlatformAuditSnapshot => {
  const resourceId = input.receiptIds[0];
  if (!resourceId) {
    throw new Error('Reimbursement audit requires at least one receipt');
  }

  return {
    resourceId,
    resourceType: 'receipt',
    state: Schema.decodeUnknownSync(PlatformFinanceReimbursementAuditState)({
      currency: input.currency,
      payoutType: input.payoutType,
      receiptCount: input.receiptIds.length,
      receiptIds: input.receiptIds,
      refundedAt: input.refundedAt?.toISOString() ?? null,
      status: input.status,
      totalAmount: input.totalAmount,
      transactionId: input.transactionId,
    }),
  };
};

export const refundRecoveryAuditSnapshot = (input: {
  readonly amount: number;
  readonly currency: Tenant['currency'];
  readonly eventId: null | string;
  readonly eventRegistrationId: string;
  readonly hasLastError: boolean;
  readonly maxAttempts: number;
  readonly mode: Schema.Schema.Type<typeof PlatformFinanceRefundRecoveryMode>;
  readonly refundClaimId: string;
  readonly sourceTransactionId: string;
  readonly state: RegistrationRefundRequeueState;
  readonly transferId: null | string;
  readonly transferStatus:
    null | typeof registrationTransfers.$inferSelect.status;
}): PlatformAuditSnapshot => ({
  resourceId: input.refundClaimId,
  resourceType: 'refundClaim',
  state: Schema.decodeUnknownSync(PlatformFinanceRefundRecoveryAuditState)({
    amount: input.amount,
    attempts: input.state.attempts,
    currency: input.currency,
    eventId: input.eventId,
    eventRegistrationId: input.eventRegistrationId,
    generation: input.state.generation,
    hasLastError: input.hasLastError,
    hasRefundId: input.state.refundId !== null,
    maxAttempts: input.maxAttempts,
    mode: input.mode,
    sourceTransactionId: input.sourceTransactionId,
    status: input.state.status,
    stripeRefundStatus: input.state.stripeRefundStatus,
    transferId: input.transferId,
    transferStatus: input.transferStatus,
  }),
});

export const platformReceiptReviewUpdate = (input: {
  readonly alcoholAmount: number;
  readonly depositAmount: number;
  readonly hasAlcohol: boolean;
  readonly hasDeposit: boolean;
  readonly purchaseCountry: string;
  readonly receiptDate: Date;
  readonly rejectionReason: null | string;
  readonly reviewedAt: Date;
  readonly status: 'approved' | 'rejected';
  readonly taxAmount: number;
  readonly totalAmount: number;
}) => ({
  ...input,
  reviewedByUserId: null,
});

export const canPlatformReviewReceipt = (
  status: FinanceReceiptRow['status'],
): boolean => status === 'submitted';

export const resolvePlatformReimbursementCurrency = Effect.fn(
  'PlatformTenantFinance.resolveReimbursementCurrency',
)(function* (
  receipts: readonly {
    currency: Tenant['currency'];
  }[],
) {
  const receiptCurrency = receipts[0]?.currency;
  if (!receiptCurrency) {
    return yield* new RpcBadRequestError({
      message: 'Reimbursement receipt currency is missing',
      reason: 'missingReceiptCurrency',
    });
  }
  if (receipts.some((receipt) => receipt.currency !== receiptCurrency)) {
    return yield* new RpcBadRequestError({
      message: 'A reimbursement batch must use one recorded receipt currency',
      reason: 'mismatchedReceiptCurrency',
    });
  }

  return receiptCurrency;
});

export const platformReimbursementTransactionInsert = (input: {
  readonly currency: Tenant['currency'];
  readonly eventCount: number;
  readonly eventId: null | string;
  readonly payoutType: Schema.Schema.Type<typeof PlatformFinancePayoutType>;
  readonly receiptCount: number;
  readonly targetTenantId: string;
  readonly targetUserId: string;
  readonly totalAmount: number;
}): typeof transactions.$inferInsert => ({
  amount: -Math.abs(input.totalAmount),
  comment: `Platform receipt reimbursement record (${input.payoutType}) for ${input.receiptCount} receipt(s) across ${input.eventCount} event(s)`,
  currency: input.currency,
  eventId: input.eventId,
  executiveUserId: null,
  manuallyCreated: true,
  method: input.payoutType === 'paypal' ? 'paypal' : 'transfer',
  status: 'successful',
  targetUserId: input.targetUserId,
  tenantId: input.targetTenantId,
  type: 'refund',
});

export const platformReimbursementReceiptUpdate = (input: {
  readonly refundedAt: Date;
  readonly transactionId: string;
}) => ({
  refundedAt: input.refundedAt,
  refundedByUserId: null,
  refundTransactionId: input.transactionId,
  status: 'refunded' as const,
});

const runPlatformRead = <A>(
  targetTenantId: string,
  allowedPermission: Permission,
  read: (
    database: DatabaseClient,
    tenant: Tenant,
  ) => Effect.Effect<A, RpcBadRequestError>,
) =>
  Effect.gen(function* () {
    const operation = yield* resolvePlatformRead(targetTenantId);

    return yield* providePlatformOperation(
      Effect.gen(function* () {
        yield* RpcAccess.ensurePermission(allowedPermission);
        return yield* databaseEffect((database) =>
          read(database, operation.targetTenant),
        );
      }),
      operation,
      [allowedPermission],
    );
  });

const validateReceiptReviewInput = (
  input: PlatformFinanceReceiptReviewInput,
  tenant: Tenant,
) =>
  Effect.gen(function* () {
    const rejectionReason = input.rejectionReason?.trim() || null;
    if (input.status === 'rejected' && !rejectionReason) {
      return yield* new RpcBadRequestError({
        message: 'A rejection reason is required when rejecting a receipt',
        reason: 'missingRejectionReason',
      });
    }

    const depositAmount = input.hasDeposit ? input.depositAmount : 0;
    const alcoholAmount = input.hasAlcohol ? input.alcoholAmount : 0;
    if (depositAmount + alcoholAmount > input.totalAmount) {
      return yield* new RpcBadRequestError({
        message: 'Deposit and alcohol amounts exceed the total amount',
        reason: 'inconsistentAmounts',
      });
    }
    if (input.taxAmount > input.totalAmount) {
      return yield* new RpcBadRequestError({
        message: 'Tax amount exceeds the total amount',
        reason: 'taxAmountExceedsTotal',
      });
    }

    const purchaseCountry = validateReceiptCountryForTenant(
      tenant,
      input.purchaseCountry,
    );
    if (!purchaseCountry) {
      return yield* new RpcBadRequestError({
        message: 'Receipt purchase country is invalid',
        reason: 'invalidPurchaseCountry',
      });
    }

    const receiptDate = new Date(input.receiptDate);
    if (Number.isNaN(receiptDate.getTime())) {
      return yield* new RpcBadRequestError({
        message: 'Receipt date is invalid',
        reason: 'invalidReceiptDate',
      });
    }

    return {
      alcoholAmount,
      depositAmount,
      purchaseCountry,
      receiptDate,
      rejectionReason: input.status === 'rejected' ? rejectionReason : null,
    };
  });

const reviewReceipt = (input: PlatformFinanceReceiptReviewInput) =>
  Effect.gen(function* () {
    const operation = yield* resolvePlatformMutation(input);

    return yield* providePlatformOperation(
      Effect.gen(function* () {
        yield* RpcAccess.ensurePermission('finance:approveReceipts');

        return yield* databaseEffect((database) =>
          database.transaction((transaction) =>
            Effect.gen(function* () {
              const targetTenant = yield* loadLockedTargetTenant(
                transaction,
                input.targetTenantId,
              );
              const lockedReceipts = yield* transaction
                .select(financeReceiptView)
                .from(financeReceipts)
                .where(
                  and(
                    eq(financeReceipts.id, input.id),
                    eq(financeReceipts.tenantId, input.targetTenantId),
                  ),
                )
                .for('update')
                .pipe(Effect.orDie);
              const before = lockedReceipts[0];
              if (!before) {
                return yield* receiptNotFound(input.id);
              }
              if (!canPlatformReviewReceipt(before.status)) {
                return yield* new RpcBadRequestError({
                  message:
                    'This receipt has already been reviewed. Refresh the queue before taking another action.',
                  reason: 'receiptAlreadyReviewed',
                });
              }

              const normalized = yield* validateReceiptReviewInput(
                input,
                targetTenant,
              );
              const receiptOwnerRows = yield* transaction
                .select({
                  submittedByCommunicationEmail: users.communicationEmail,
                  submittedByEmail: users.email,
                })
                .from(users)
                .where(eq(users.id, before.submittedByUserId))
                .limit(1)
                .pipe(Effect.orDie);
              const receiptOwner = receiptOwnerRows[0];
              if (!receiptOwner) {
                return yield* new RpcBadRequestError({
                  message: 'Receipt submitter not found',
                  reason: 'receiptSubmitterNotFound',
                });
              }
              const eventRows = yield* transaction
                .select({ title: eventInstances.title })
                .from(eventInstances)
                .where(
                  and(
                    eq(eventInstances.id, before.eventId),
                    eq(eventInstances.tenantId, input.targetTenantId),
                  ),
                )
                .limit(1)
                .pipe(Effect.orDie);
              const event = eventRows[0];
              if (!event) {
                return yield* new RpcBadRequestError({
                  message: 'Receipt event not found for the target tenant',
                  reason: 'receiptEventNotFound',
                });
              }

              const reviewedAt = yield* DateTime.nowAsDate;
              const updatedReceipts = yield* transaction
                .update(financeReceipts)
                .set(
                  platformReceiptReviewUpdate({
                    alcoholAmount: normalized.alcoholAmount,
                    depositAmount: normalized.depositAmount,
                    hasAlcohol: input.hasAlcohol,
                    hasDeposit: input.hasDeposit,
                    purchaseCountry: normalized.purchaseCountry,
                    receiptDate: normalized.receiptDate,
                    rejectionReason: normalized.rejectionReason,
                    reviewedAt,
                    status: input.status,
                    taxAmount: input.taxAmount,
                    totalAmount: input.totalAmount,
                  }),
                )
                .where(
                  and(
                    eq(financeReceipts.id, input.id),
                    eq(financeReceipts.tenantId, input.targetTenantId),
                    eq(financeReceipts.status, 'submitted'),
                  ),
                )
                .returning(financeReceiptView)
                .pipe(Effect.orDie);
              const after = updatedReceipts[0];
              if (!after) {
                return yield* new RpcBadRequestError({
                  message: 'Receipt review preconditions changed',
                  reason: 'receiptReviewPreconditionFailed',
                });
              }

              yield* enqueueReceiptReviewedEmail(transaction, {
                eventTitle: event.title,
                receiptId: after.id,
                rejectionReason: normalized.rejectionReason,
                status: input.status,
                tenant: targetTenant,
                to: submitterEmail(receiptOwner),
              });
              yield* writePlatformAudit(transaction, {
                action: 'receipt.review',
                after: reviewAuditSnapshot(after),
                before: reviewAuditSnapshot(before),
              });

              return {
                id: after.id,
                status: input.status,
              };
            }),
          ),
        );
      }),
      operation,
      ['finance:approveReceipts'],
    );
  });

const requeueRefundClaim = (input: PlatformFinanceRequeueRefundClaimInput) =>
  Effect.gen(function* () {
    const operation = yield* resolvePlatformMutation(input);

    return yield* providePlatformOperation(
      Effect.gen(function* () {
        yield* RpcAccess.ensurePermission('finance:refundReceipts');

        return yield* databaseEffect((database) =>
          database.transaction((transaction) =>
            Effect.gen(function* () {
              const identityRows = yield* transaction
                .select({
                  amount: transactions.amount,
                  currency: transactions.currency,
                  eventId: transactions.eventId,
                  eventRegistrationId: transactions.eventRegistrationId,
                  lastError: transactions.stripeRefundLastError,
                  maxAttempts: transactions.stripeRefundMaxAttempts,
                  sourceTransactionId: transactions.sourceTransactionId,
                })
                .from(transactions)
                .where(
                  and(
                    eq(transactions.id, input.refundClaimId),
                    eq(transactions.method, 'stripe'),
                    eq(transactions.tenantId, input.targetTenantId),
                    eq(transactions.type, 'refund'),
                  ),
                )
                .for('update')
                .pipe(Effect.orDie);
              const identity = identityRows[0];
              if (
                !identity?.eventRegistrationId ||
                !identity.sourceTransactionId
              ) {
                return yield* new RpcBadRequestError({
                  message:
                    'Refund claim is missing its registration or source transaction identity',
                  reason: 'invalidRefundClaimIdentity',
                });
              }

              const recovery = yield* requeueRegistrationRefundClaim(
                transaction,
                {
                  reason: input.reason,
                  refundClaimId: input.refundClaimId,
                  tenantId: input.targetTenantId,
                },
              ).pipe(
                Effect.mapError(
                  (error) =>
                    new RpcBadRequestError({
                      message: error.message,
                      reason: 'refundRequeueNotAllowed',
                    }),
                ),
              );
              const transferBeforeRows = yield* transaction
                .select({
                  id: registrationTransfers.id,
                  status: registrationTransfers.status,
                })
                .from(registrationTransfers)
                .where(
                  and(
                    eq(
                      registrationTransfers.refundTransactionId,
                      recovery.refundClaimId,
                    ),
                    eq(registrationTransfers.tenantId, input.targetTenantId),
                  ),
                )
                .for('update')
                .pipe(Effect.orDie);
              if (transferBeforeRows.length > 1) {
                return yield* new RpcBadRequestError({
                  message:
                    'Refund claim is linked to more than one registration transfer',
                  reason: 'ambiguousRefundTransfer',
                });
              }
              const transferBefore = transferBeforeRows[0] ?? null;
              const transferRecovery =
                yield* markRegistrationTransferRefundRequeued(transaction, {
                  reason: recovery.reason,
                  refundTransactionId: recovery.refundClaimId,
                  tenantId: input.targetTenantId,
                });
              const transferRows = yield* transaction
                .select({
                  id: registrationTransfers.id,
                  status: registrationTransfers.status,
                })
                .from(registrationTransfers)
                .where(
                  and(
                    eq(
                      registrationTransfers.refundTransactionId,
                      recovery.refundClaimId,
                    ),
                    eq(registrationTransfers.tenantId, input.targetTenantId),
                  ),
                )
                .for('share')
                .pipe(Effect.orDie);
              if (transferRows.length > 1) {
                return yield* new RpcBadRequestError({
                  message:
                    'Refund claim is linked to more than one registration transfer',
                  reason: 'ambiguousRefundTransfer',
                });
              }
              const transfer = transferRows[0] ?? null;
              if (
                transferBefore?.id !== transfer?.id ||
                (transfer && transferRecovery === 'notTransfer') ||
                (!transfer && transferRecovery !== 'notTransfer')
              ) {
                return yield* new RpcBadRequestError({
                  message:
                    'Registration transfer recovery state changed before the refund could be requeued',
                  reason: 'refundTransferRecoveryPreconditionFailed',
                });
              }
              const transferStatusAfter = transfer?.status ?? null;

              yield* writePlatformAudit(transaction, {
                action: 'refundClaim.requeue',
                after: refundRecoveryAuditSnapshot({
                  amount: Math.abs(identity.amount),
                  currency: identity.currency,
                  eventId: identity.eventId,
                  eventRegistrationId: identity.eventRegistrationId,
                  hasLastError: false,
                  maxAttempts: identity.maxAttempts,
                  mode: recovery.mode,
                  refundClaimId: recovery.refundClaimId,
                  sourceTransactionId: identity.sourceTransactionId,
                  state: recovery.after,
                  transferId: transfer?.id ?? null,
                  transferStatus: transferStatusAfter,
                }),
                before: refundRecoveryAuditSnapshot({
                  amount: Math.abs(identity.amount),
                  currency: identity.currency,
                  eventId: identity.eventId,
                  eventRegistrationId: identity.eventRegistrationId,
                  hasLastError: identity.lastError !== null,
                  maxAttempts: identity.maxAttempts,
                  mode: recovery.mode,
                  refundClaimId: recovery.refundClaimId,
                  sourceTransactionId: identity.sourceTransactionId,
                  state: recovery.before,
                  transferId: transferBefore?.id ?? null,
                  transferStatus: transferBefore?.status ?? null,
                }),
              });

              return {
                mode: recovery.mode,
                refundClaimId: recovery.refundClaimId,
                transferRecovery,
              };
            }),
          ),
        );
      }),
      operation,
      ['finance:refundReceipts'],
    );
  });

const recordReimbursement = (input: PlatformFinanceRecordReimbursementInput) =>
  Effect.gen(function* () {
    const operation = yield* resolvePlatformMutation(input);

    return yield* providePlatformOperation(
      Effect.gen(function* () {
        yield* RpcAccess.ensurePermission('finance:refundReceipts');

        return yield* databaseEffect((database) =>
          database.transaction((transaction) =>
            Effect.gen(function* () {
              yield* loadLockedTargetTenant(transaction, input.targetTenantId);
              const receiptIds = [...new Set(input.receiptIds)];
              if (receiptIds.length !== input.receiptIds.length) {
                return yield* new RpcBadRequestError({
                  message: 'Duplicate receipt ids are not allowed',
                  reason: 'duplicateReceiptIds',
                });
              }

              const lockedReceipts = yield* transaction
                .select({
                  currency: financeReceipts.currency,
                  eventId: financeReceipts.eventId,
                  id: financeReceipts.id,
                  submittedByUserId: financeReceipts.submittedByUserId,
                  totalAmount: financeReceipts.totalAmount,
                })
                .from(financeReceipts)
                .where(
                  and(
                    eq(financeReceipts.tenantId, input.targetTenantId),
                    inArray(financeReceipts.id, receiptIds),
                    eq(financeReceipts.status, 'approved'),
                  ),
                )
                .orderBy(financeReceipts.id)
                .for('update')
                .pipe(Effect.orDie);
              if (lockedReceipts.length !== receiptIds.length) {
                return yield* new RpcBadRequestError({
                  message: 'Some receipts are missing or not reimbursable',
                  reason: 'receiptCountMismatch',
                });
              }

              const targetUserId = lockedReceipts[0]?.submittedByUserId;
              if (!targetUserId) {
                return yield* new RpcBadRequestError({
                  message: 'Reimbursement recipient is missing',
                  reason: 'missingTargetUser',
                });
              }
              if (
                lockedReceipts.some(
                  (receipt) => receipt.submittedByUserId !== targetUserId,
                )
              ) {
                return yield* new RpcBadRequestError({
                  message: 'Receipts must belong to the same submitter',
                  reason: 'mismatchedSubmitter',
                });
              }

              const receiptCurrency =
                yield* resolvePlatformReimbursementCurrency(lockedReceipts);

              const payoutUsers = yield* transaction
                .select({
                  iban: users.iban,
                  id: users.id,
                  paypalEmail: users.paypalEmail,
                })
                .from(users)
                .where(eq(users.id, targetUserId))
                .for('share')
                .pipe(Effect.orDie);
              const payoutUser = payoutUsers[0];
              if (!payoutUser) {
                return yield* new RpcBadRequestError({
                  message: 'Reimbursement recipient not found',
                  reason: 'payoutUserNotFound',
                });
              }
              const payoutReference =
                input.payoutType === 'paypal'
                  ? payoutUser.paypalEmail
                  : payoutUser.iban;
              if (!payoutReference?.trim()) {
                return yield* new RpcBadRequestError({
                  message:
                    input.payoutType === 'paypal'
                      ? 'Reimbursement recipient is missing a PayPal address'
                      : 'Reimbursement recipient is missing an IBAN',
                  reason:
                    input.payoutType === 'paypal'
                      ? 'missingPaypal'
                      : 'missingIban',
                });
              }
              if (
                payoutDetailsVersion(input.payoutType, payoutReference) !==
                input.payoutVersion
              ) {
                return yield* new RpcBadRequestError({
                  message:
                    'The recipient payout details changed. Refresh the queue and verify the current destination before recording the reimbursement.',
                  reason: 'payoutDetailsChanged',
                });
              }

              const totalAmount = lockedReceipts.reduce(
                (sum, receipt) => sum + receipt.totalAmount,
                0,
              );
              if (totalAmount <= 0) {
                return yield* new RpcBadRequestError({
                  message: 'Reimbursement total must be positive',
                  reason: 'invalidReimbursementTotal',
                });
              }
              const eventIds = [
                ...new Set(lockedReceipts.map((receipt) => receipt.eventId)),
              ];
              const eventId = eventIds.length === 1 ? eventIds[0] : null;
              const refundedAt = yield* DateTime.nowAsDate;
              const insertedTransactions = yield* transaction
                .insert(transactions)
                .values(
                  platformReimbursementTransactionInsert({
                    currency: receiptCurrency,
                    eventCount: eventIds.length,
                    eventId,
                    payoutType: input.payoutType,
                    receiptCount: receiptIds.length,
                    targetTenantId: input.targetTenantId,
                    targetUserId,
                    totalAmount,
                  }),
                )
                .returning({ id: transactions.id })
                .pipe(Effect.orDie);
              const createdTransaction = insertedTransactions[0];
              if (!createdTransaction) {
                return yield* Effect.die(
                  new Error('Reimbursement transaction insert returned no row'),
                );
              }

              const updatedReceipts = yield* transaction
                .update(financeReceipts)
                .set(
                  platformReimbursementReceiptUpdate({
                    refundedAt,
                    transactionId: createdTransaction.id,
                  }),
                )
                .where(
                  and(
                    eq(financeReceipts.tenantId, input.targetTenantId),
                    inArray(financeReceipts.id, receiptIds),
                    eq(financeReceipts.status, 'approved'),
                    eq(financeReceipts.submittedByUserId, targetUserId),
                  ),
                )
                .returning({ id: financeReceipts.id })
                .pipe(Effect.orDie);
              if (updatedReceipts.length !== receiptIds.length) {
                return yield* new RpcBadRequestError({
                  message: 'Receipt reimbursement preconditions changed',
                  reason: 'receiptReimbursementPreconditionFailed',
                });
              }

              yield* writePlatformAudit(transaction, {
                action: 'receipt.reimburse',
                after: reimbursementAuditSnapshot({
                  currency: receiptCurrency,
                  payoutType: input.payoutType,
                  receiptIds,
                  refundedAt,
                  status: 'refunded',
                  totalAmount,
                  transactionId: createdTransaction.id,
                }),
                before: reimbursementAuditSnapshot({
                  currency: receiptCurrency,
                  payoutType: input.payoutType,
                  receiptIds,
                  refundedAt: null,
                  status: 'approved',
                  totalAmount,
                  transactionId: null,
                }),
              });

              return {
                receiptCount: receiptIds.length,
                totalAmount,
                transactionId: createdTransaction.id,
              };
            }),
          ),
        );
      }),
      operation,
      ['finance:refundReceipts'],
    );
  });

export const platformTenantFinanceHandlers = {
  'platform.finance.receipts.approvalDetail': (input, _options) =>
    runPlatformRead(
      input.targetTenantId,
      'finance:approveReceipts',
      (database, tenant) =>
        Effect.gen(function* () {
          const receiptRows = yield* database
            .select({
              ...financeReceiptView,
              eventStart: eventInstances.start,
              eventTitle: eventInstances.title,
              submittedByCommunicationEmail: users.communicationEmail,
              submittedByEmail: users.email,
              submittedByFirstName: users.firstName,
              submittedByLastName: users.lastName,
            })
            .from(financeReceipts)
            .innerJoin(
              eventInstances,
              and(
                eq(eventInstances.id, financeReceipts.eventId),
                eq(eventInstances.tenantId, input.targetTenantId),
              ),
            )
            .innerJoin(users, eq(users.id, financeReceipts.submittedByUserId))
            .where(
              and(
                eq(financeReceipts.id, input.id),
                eq(financeReceipts.tenantId, input.targetTenantId),
              ),
            )
            .limit(1)
            .pipe(Effect.orDie);
          const receipt = receiptRows[0];
          if (!receipt) {
            return yield* receiptNotFound(input.id);
          }
          const signedReceipt = yield* withSignedReceiptPreviewUrl(receipt);

          return {
            receipt: {
              ...toPlatformReceiptWithSubmitter(signedReceipt),
              eventStart: signedReceipt.eventStart.toISOString(),
              eventTitle: signedReceipt.eventTitle,
            },
            tenantContext: toTenantContext(tenant),
          };
        }),
    ),
  'platform.finance.receipts.approvalQueue': (input, _options) =>
    runPlatformRead(
      input.targetTenantId,
      'finance:approveReceipts',
      (database, tenant) =>
        Effect.gen(function* () {
          const receiptRows = yield* database
            .select({
              ...financeReceiptView,
              eventStart: eventInstances.start,
              eventTitle: eventInstances.title,
              submittedByCommunicationEmail: users.communicationEmail,
              submittedByEmail: users.email,
              submittedByFirstName: users.firstName,
              submittedByLastName: users.lastName,
            })
            .from(financeReceipts)
            .innerJoin(
              eventInstances,
              and(
                eq(eventInstances.id, financeReceipts.eventId),
                eq(eventInstances.tenantId, input.targetTenantId),
              ),
            )
            .innerJoin(users, eq(users.id, financeReceipts.submittedByUserId))
            .where(
              and(
                eq(financeReceipts.tenantId, input.targetTenantId),
                eq(financeReceipts.status, 'submitted'),
              ),
            )
            .orderBy(
              desc(eventInstances.start),
              desc(financeReceipts.createdAt),
            )
            .pipe(Effect.orDie);
          const signedReceipts =
            yield* withSignedReceiptPreviewUrls(receiptRows);
          const grouped = new Map<
            string,
            {
              eventId: string;
              eventStart: string;
              eventTitle: string;
              receipts: ReturnType<typeof toPlatformReceiptWithSubmitter>[];
            }
          >();
          for (const receipt of signedReceipts) {
            const normalized = toPlatformReceiptWithSubmitter(receipt);
            const existing = grouped.get(receipt.eventId);
            if (existing) {
              existing.receipts.push(normalized);
              continue;
            }
            grouped.set(receipt.eventId, {
              eventId: receipt.eventId,
              eventStart: receipt.eventStart.toISOString(),
              eventTitle: receipt.eventTitle,
              receipts: [normalized],
            });
          }

          return {
            groups: [...grouped.values()],
            tenantContext: toTenantContext(tenant),
          };
        }),
    ),
  'platform.finance.receipts.recordReimbursement': (input, _options) =>
    recordReimbursement(input),
  'platform.finance.receipts.reimbursementQueue': (input, _options) =>
    runPlatformRead(
      input.targetTenantId,
      'finance:refundReceipts',
      (database, tenant) =>
        Effect.gen(function* () {
          const receiptRows = yield* database
            .select({
              ...financeReceiptView,
              eventStart: eventInstances.start,
              eventTitle: eventInstances.title,
              recipientIban: users.iban,
              recipientPaypalEmail: users.paypalEmail,
              submittedByCommunicationEmail: users.communicationEmail,
              submittedByEmail: users.email,
              submittedByFirstName: users.firstName,
              submittedByLastName: users.lastName,
            })
            .from(financeReceipts)
            .innerJoin(
              eventInstances,
              and(
                eq(eventInstances.id, financeReceipts.eventId),
                eq(eventInstances.tenantId, input.targetTenantId),
              ),
            )
            .innerJoin(users, eq(users.id, financeReceipts.submittedByUserId))
            .where(
              and(
                eq(financeReceipts.tenantId, input.targetTenantId),
                eq(financeReceipts.status, 'approved'),
              ),
            )
            .orderBy(
              users.lastName,
              users.firstName,
              desc(financeReceipts.createdAt),
            )
            .pipe(Effect.orDie);
          const signedReceipts =
            yield* withSignedReceiptPreviewUrls(receiptRows);
          const grouped = new Map<
            string,
            {
              currency: Tenant['currency'];
              payout: { iban: null | string; paypalEmail: null | string };
              payoutVersions: {
                iban: null | string;
                paypal: null | string;
              };
              receipts: (ReturnType<typeof toPlatformReceiptWithSubmitter> & {
                eventStart: string;
                eventTitle: string;
              })[];
              submittedByEmail: string;
              submittedByFirstName: string;
              submittedByLastName: string;
              submittedByUserId: string;
              totalAmount: number;
            }
          >();
          for (const receipt of signedReceipts) {
            const normalized = {
              ...toPlatformReceiptWithSubmitter(receipt),
              eventStart: receipt.eventStart.toISOString(),
              eventTitle: receipt.eventTitle,
            };
            const groupKey = `${receipt.submittedByUserId}\u{0}${receipt.currency}`;
            const existing = grouped.get(groupKey);
            if (existing) {
              existing.receipts.push(normalized);
              existing.totalAmount += receipt.totalAmount;
              continue;
            }
            grouped.set(groupKey, {
              currency: receipt.currency,
              payout: {
                iban: receipt.recipientIban ?? null,
                paypalEmail: receipt.recipientPaypalEmail ?? null,
              },
              payoutVersions: {
                iban: receipt.recipientIban
                  ? payoutDetailsVersion('iban', receipt.recipientIban)
                  : null,
                paypal: receipt.recipientPaypalEmail
                  ? payoutDetailsVersion('paypal', receipt.recipientPaypalEmail)
                  : null,
              },
              receipts: [normalized],
              submittedByEmail: submitterEmail(receipt),
              submittedByFirstName: receipt.submittedByFirstName,
              submittedByLastName: receipt.submittedByLastName,
              submittedByUserId: receipt.submittedByUserId,
              totalAmount: receipt.totalAmount,
            });
          }

          return {
            groups: [...grouped.values()],
            tenantContext: toTenantContext(tenant),
          };
        }),
    ),
  'platform.finance.receipts.review': (input, _options) => reviewReceipt(input),
  'platform.finance.refundClaims.recoveryQueue': (input, _options) =>
    runPlatformRead(
      input.targetTenantId,
      'finance:refundReceipts',
      (database, tenant) =>
        Effect.gen(function* () {
          const claimRows: RefundRecoveryCandidate[] = yield* database
            .select({
              amount: transactions.amount,
              attempts: transactions.stripeRefundAttempts,
              createdAt: transactions.createdAt,
              currency: transactions.currency,
              eventId: transactions.eventId,
              eventRegistrationId: transactions.eventRegistrationId,
              generation: transactions.stripeRefundGeneration,
              lastError: transactions.stripeRefundLastError,
              leaseExpiresAt: transactions.stripeRefundClaimLeaseExpiresAt,
              leaseId: transactions.stripeRefundClaimLeaseId,
              maxAttempts: transactions.stripeRefundMaxAttempts,
              nextAttemptAt: transactions.stripeRefundNextAttemptAt,
              refundClaimId: transactions.id,
              refundId: transactions.stripeRefundId,
              sourceTransactionId: transactions.sourceTransactionId,
              status: transactions.status,
              stripeRefundStatus: transactions.stripeRefundStatus,
              transferEventId: registrationTransfers.eventId,
              transferId: registrationTransfers.id,
              transferRecipientRegistrationId:
                registrationTransfers.recipientRegistrationId,
              transferSourceRegistrationId:
                registrationTransfers.sourceRegistrationId,
              transferStatus: registrationTransfers.status,
              updatedAt: transactions.updatedAt,
            })
            .from(transactions)
            .leftJoin(
              registrationTransfers,
              and(
                eq(registrationTransfers.refundTransactionId, transactions.id),
                eq(registrationTransfers.tenantId, input.targetTenantId),
              ),
            )
            .where(
              and(
                eq(transactions.method, 'stripe'),
                eq(transactions.status, 'pending'),
                eq(transactions.tenantId, input.targetTenantId),
                eq(transactions.type, 'refund'),
                isNull(transactions.stripeRefundClaimLeaseExpiresAt),
                isNull(transactions.stripeRefundClaimLeaseId),
                isNull(transactions.stripeRefundNextAttemptAt),
              ),
            )
            .orderBy(desc(transactions.updatedAt))
            .pipe(Effect.orDie);
          const rowCounts = new Map<string, number>();
          for (const claim of claimRows) {
            rowCounts.set(
              claim.refundClaimId,
              (rowCounts.get(claim.refundClaimId) ?? 0) + 1,
            );
          }
          const claims = claimRows
            .filter((claim) => rowCounts.get(claim.refundClaimId) === 1)
            .map((claim) => toRefundRecoveryRecord(claim))
            .filter((claim) => claim !== null);

          return {
            claims,
            tenantContext: toTenantContext(tenant),
          };
        }),
    ),
  'platform.finance.refundClaims.requeue': (input, _options) =>
    requeueRefundClaim(input),
  'platform.finance.transactions.findMany': (input, _options) =>
    runPlatformRead(
      input.targetTenantId,
      'finance:viewTransactions',
      (database, tenant) =>
        Effect.gen(function* () {
          const [transactionCountRows, transactionRows] = yield* Effect.all([
            database
              .select({ total: count() })
              .from(transactions)
              .where(
                and(
                  eq(transactions.tenantId, input.targetTenantId),
                  not(eq(transactions.status, 'cancelled')),
                ),
              ),
            database
              .select({
                amount: transactions.amount,
                appFee: transactions.appFee,
                comment: transactions.comment,
                createdAt: transactions.createdAt,
                currency: transactions.currency,
                id: transactions.id,
                method: transactions.method,
                status: transactions.status,
                stripeFee: transactions.stripeFee,
              })
              .from(transactions)
              .where(
                and(
                  eq(transactions.tenantId, input.targetTenantId),
                  not(eq(transactions.status, 'cancelled')),
                ),
              )
              .limit(input.limit)
              .offset(input.offset)
              .orderBy(desc(transactions.createdAt)),
          ]).pipe(Effect.orDie);

          return {
            data: transactionRows.map((transaction) =>
              normalizeFinanceTransactionRecord(transaction),
            ),
            tenantContext: toTenantContext(tenant),
            total: transactionCountRows[0]?.total ?? 0,
          };
        }),
    ),
} satisfies PlatformTenantFinanceHandlers;
