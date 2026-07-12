import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import {
  literalUnion,
  nonNegativeNumber,
  positiveNumber,
} from '@shared/schema-utilities';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { Tenant } from '../../../types/custom/tenant';
import { RegistrationTransferStatus } from '../../registration-transfer';
import {
  FinanceReceiptFieldsInput,
  FinanceReceiptStatus,
  FinanceTransactionRecord,
} from './finance.rpcs';
import {
  PlatformOperationRpcError,
  PlatformTenantMutationContext,
  PlatformTenantTarget,
} from './platform-operations.shared';

const PlatformFinancePageLimit = positiveNumber.check(
  Schema.isInt(),
  Schema.isLessThanOrEqualTo(100),
);

const PlatformFinancePageOffset = nonNegativeNumber.check(Schema.isInt());

export const PlatformFinancePayoutType = literalUnion('iban', 'paypal');
const PlatformFinanceMinorUnitAmount = nonNegativeNumber.check(Schema.isInt());

export const PlatformFinanceRefundRecoveryMode = literalUnion(
  'newGeneration',
  'resumeGeneration',
);

export const PlatformFinanceRefundClaimStatus = literalUnion(
  'canceled',
  'failed',
  'pending',
  'requires_action',
);

export const PlatformFinanceRefundLifecycleStatus = literalUnion(
  'action-required',
  'needs-attention',
  'pending',
  'retrying',
  'succeeded',
);

export class PlatformFinanceReceiptRecord extends Schema.Class<PlatformFinanceReceiptRecord>(
  'PlatformFinanceReceiptRecord',
)({
  alcoholAmount: Schema.Number,
  attachmentFileName: Schema.NonEmptyString,
  attachmentMimeType: Schema.NonEmptyString,
  createdAt: Schema.NonEmptyString,
  currency: Tenant.fields.currency,
  depositAmount: Schema.Number,
  eventId: Schema.NonEmptyString,
  hasAlcohol: Schema.Boolean,
  hasDeposit: Schema.Boolean,
  id: Schema.NonEmptyString,
  previewImageUrl: Schema.NullOr(Schema.NonEmptyString),
  purchaseCountry: Schema.NonEmptyString,
  receiptDate: Schema.NonEmptyString,
  receiptEvidenceAvailable: Schema.Boolean,
  refundedAt: Schema.NullOr(Schema.NonEmptyString),
  refundTransactionId: Schema.NullOr(Schema.NonEmptyString),
  rejectionReason: Schema.NullOr(Schema.String),
  reviewedAt: Schema.NullOr(Schema.NonEmptyString),
  status: FinanceReceiptStatus,
  submittedByUserId: Schema.NonEmptyString,
  taxAmount: Schema.Number,
  totalAmount: Schema.Number,
  updatedAt: Schema.NonEmptyString,
}) {}

export class PlatformFinanceReceiptWithSubmitterRecord extends Schema.Class<PlatformFinanceReceiptWithSubmitterRecord>(
  'PlatformFinanceReceiptWithSubmitterRecord',
)({
  ...PlatformFinanceReceiptRecord.fields,
  submittedByEmail: Schema.NonEmptyString,
  submittedByFirstName: Schema.NonEmptyString,
  submittedByLastName: Schema.NonEmptyString,
}) {}

export class PlatformFinanceReceiptApprovalDetailRecord extends Schema.Class<PlatformFinanceReceiptApprovalDetailRecord>(
  'PlatformFinanceReceiptApprovalDetailRecord',
)({
  ...PlatformFinanceReceiptWithSubmitterRecord.fields,
  eventStart: Schema.NonEmptyString,
  eventTitle: Schema.NonEmptyString,
}) {}

export class PlatformFinanceReceiptApprovalGroup extends Schema.Class<PlatformFinanceReceiptApprovalGroup>(
  'PlatformFinanceReceiptApprovalGroup',
)({
  eventId: Schema.NonEmptyString,
  eventStart: Schema.NonEmptyString,
  eventTitle: Schema.NonEmptyString,
  receipts: Schema.Array(PlatformFinanceReceiptWithSubmitterRecord),
}) {}

export class PlatformFinanceRefundLifecycleSummary extends Schema.Class<PlatformFinanceRefundLifecycleSummary>(
  'PlatformFinanceRefundLifecycleSummary',
)({
  attempts: Schema.NullOr(nonNegativeNumber),
  maxAttempts: Schema.NullOr(positiveNumber),
  recoveryMode: Schema.NullOr(PlatformFinanceRefundRecoveryMode),
  status: PlatformFinanceRefundLifecycleStatus,
}) {}

export class PlatformFinanceRefundTransferRecord extends Schema.Class<PlatformFinanceRefundTransferRecord>(
  'PlatformFinanceRefundTransferRecord',
)({
  eventId: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  recipientRegistrationId: Schema.NullOr(Schema.NonEmptyString),
  sourceRegistrationId: Schema.NonEmptyString,
  status: RegistrationTransferStatus,
}) {}

export class PlatformFinanceRefundRecoveryRecord extends Schema.Class<PlatformFinanceRefundRecoveryRecord>(
  'PlatformFinanceRefundRecoveryRecord',
)({
  amount: positiveNumber,
  createdAt: Schema.NonEmptyString,
  currency: Tenant.fields.currency,
  eventId: Schema.NullOr(Schema.NonEmptyString),
  eventRegistrationId: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  lastError: Schema.NullOr(Schema.String),
  mode: PlatformFinanceRefundRecoveryMode,
  sourceTransactionId: Schema.NonEmptyString,
  stripeRefundAttempts: nonNegativeNumber,
  stripeRefundGeneration: nonNegativeNumber,
  stripeRefundMaxAttempts: positiveNumber,
  stripeRefundStatus: Schema.NullOr(PlatformFinanceRefundClaimStatus),
  transfer: Schema.NullOr(PlatformFinanceRefundTransferRecord),
  updatedAt: Schema.NonEmptyString,
}) {}

export class PlatformFinanceReimbursementReceipt extends Schema.Class<PlatformFinanceReimbursementReceipt>(
  'PlatformFinanceReimbursementReceipt',
)({
  ...PlatformFinanceReceiptWithSubmitterRecord.fields,
  eventStart: Schema.NonEmptyString,
  eventTitle: Schema.NonEmptyString,
}) {}

export class PlatformFinanceReimbursementGroup extends Schema.Class<PlatformFinanceReimbursementGroup>(
  'PlatformFinanceReimbursementGroup',
)({
  currency: Tenant.fields.currency,
  payout: Schema.Struct({
    iban: Schema.NullOr(Schema.NonEmptyString),
    paypalEmail: Schema.NullOr(Schema.NonEmptyString),
  }),
  payoutVersions: Schema.Struct({
    iban: Schema.NullOr(Schema.NonEmptyString),
    paypal: Schema.NullOr(Schema.NonEmptyString),
  }),
  receipts: Schema.Array(PlatformFinanceReimbursementReceipt),
  submittedByEmail: Schema.NonEmptyString,
  submittedByFirstName: Schema.NonEmptyString,
  submittedByLastName: Schema.NonEmptyString,
  submittedByUserId: Schema.NonEmptyString,
  totalAmount: Schema.Number,
}) {}

export class PlatformFinanceTenantContext extends Schema.Class<PlatformFinanceTenantContext>(
  'PlatformFinanceTenantContext',
)({
  currency: Tenant.fields.currency,
  receiptCountryConfig: Schema.Struct({
    allowOther: Schema.Boolean,
    receiptCountries: Schema.Array(Schema.NonEmptyString),
  }),
  targetTenantId: Schema.NonEmptyString,
}) {}

export class PlatformFinanceTransactionRecord extends Schema.Class<PlatformFinanceTransactionRecord>(
  'PlatformFinanceTransactionRecord',
)({
  ...FinanceTransactionRecord.fields,
  refundLifecycle: Schema.NullOr(PlatformFinanceRefundLifecycleSummary),
}) {}

export const PlatformFinanceTransactionsFindManyResult = Schema.Struct({
  data: Schema.Array(PlatformFinanceTransactionRecord),
  tenantContext: PlatformFinanceTenantContext,
  total: nonNegativeNumber,
});

export const PlatformFinanceReceiptApprovalQueueResult = Schema.Struct({
  groups: Schema.Array(PlatformFinanceReceiptApprovalGroup),
  tenantContext: PlatformFinanceTenantContext,
});

export const PlatformFinanceReceiptApprovalDetailResult = Schema.Struct({
  receipt: PlatformFinanceReceiptApprovalDetailRecord,
  tenantContext: PlatformFinanceTenantContext,
});

export const PlatformFinanceReimbursementQueueResult = Schema.Struct({
  groups: Schema.Array(PlatformFinanceReimbursementGroup),
  tenantContext: PlatformFinanceTenantContext,
});

export const PlatformFinanceRefundRecoveryQueueResult = Schema.Struct({
  claims: Schema.Array(PlatformFinanceRefundRecoveryRecord),
  tenantContext: PlatformFinanceTenantContext,
});

export const PlatformFinanceTransactionsFindMany = asRpcQuery(
  Rpc.make('platform.finance.transactions.findMany', {
    error: PlatformOperationRpcError,
    payload: Schema.Struct({
      ...PlatformTenantTarget.fields,
      limit: PlatformFinancePageLimit,
      offset: PlatformFinancePageOffset,
    }),
    success: PlatformFinanceTransactionsFindManyResult,
  }),
);

export const PlatformFinanceReceiptApprovalQueue = asRpcQuery(
  Rpc.make('platform.finance.receipts.approvalQueue', {
    error: PlatformOperationRpcError,
    payload: PlatformTenantTarget,
    success: PlatformFinanceReceiptApprovalQueueResult,
  }),
);

export const PlatformFinanceReceiptApprovalDetail = asRpcQuery(
  Rpc.make('platform.finance.receipts.approvalDetail', {
    error: PlatformOperationRpcError,
    payload: Schema.Struct({
      ...PlatformTenantTarget.fields,
      id: Schema.NonEmptyString,
    }),
    success: PlatformFinanceReceiptApprovalDetailResult,
  }),
);

export const PlatformFinanceReceiptReviewInput = Schema.Struct({
  ...FinanceReceiptFieldsInput.fields,
  ...PlatformTenantMutationContext.fields,
  alcoholAmount: PlatformFinanceMinorUnitAmount,
  depositAmount: PlatformFinanceMinorUnitAmount,
  id: Schema.NonEmptyString,
  rejectionReason: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  status: literalUnion('approved', 'rejected'),
  taxAmount: PlatformFinanceMinorUnitAmount,
  totalAmount: PlatformFinanceMinorUnitAmount,
});

export type PlatformFinanceReceiptReviewInput = Schema.Schema.Type<
  typeof PlatformFinanceReceiptReviewInput
>;

export const PlatformFinanceReceiptReview = asRpcMutation(
  Rpc.make('platform.finance.receipts.review', {
    error: PlatformOperationRpcError,
    payload: PlatformFinanceReceiptReviewInput,
    success: Schema.Struct({
      id: Schema.NonEmptyString,
      status: literalUnion('approved', 'rejected'),
    }),
  }),
);

export const PlatformFinanceReimbursementQueue = asRpcQuery(
  Rpc.make('platform.finance.receipts.reimbursementQueue', {
    error: PlatformOperationRpcError,
    payload: PlatformTenantTarget,
    success: PlatformFinanceReimbursementQueueResult,
  }),
);

export const PlatformFinanceRecordReimbursementInput = Schema.Struct({
  ...PlatformTenantMutationContext.fields,
  payoutType: PlatformFinancePayoutType,
  payoutVersion: Schema.NonEmptyString,
  receiptIds: Schema.NonEmptyArray(Schema.NonEmptyString).check(
    Schema.isMaxLength(100),
  ),
});

export type PlatformFinanceRecordReimbursementInput = Schema.Schema.Type<
  typeof PlatformFinanceRecordReimbursementInput
>;

export const PlatformFinanceRecordReimbursement = asRpcMutation(
  Rpc.make('platform.finance.receipts.recordReimbursement', {
    error: PlatformOperationRpcError,
    payload: PlatformFinanceRecordReimbursementInput,
    success: Schema.Struct({
      receiptCount: positiveNumber,
      totalAmount: positiveNumber,
      transactionId: Schema.NonEmptyString,
    }),
  }),
);

export const PlatformFinanceRefundRecoveryQueue = asRpcQuery(
  Rpc.make('platform.finance.refundClaims.recoveryQueue', {
    error: PlatformOperationRpcError,
    payload: PlatformTenantTarget,
    success: PlatformFinanceRefundRecoveryQueueResult,
  }),
);

export const PlatformFinanceRequeueRefundClaimInput = Schema.Struct({
  ...PlatformTenantMutationContext.fields,
  refundClaimId: Schema.NonEmptyString,
});

export type PlatformFinanceRequeueRefundClaimInput = Schema.Schema.Type<
  typeof PlatformFinanceRequeueRefundClaimInput
>;

export const PlatformFinanceRequeueRefundClaim = asRpcMutation(
  Rpc.make('platform.finance.refundClaims.requeue', {
    error: PlatformOperationRpcError,
    payload: PlatformFinanceRequeueRefundClaimInput,
    success: Schema.Struct({
      mode: PlatformFinanceRefundRecoveryMode,
      refundClaimId: Schema.NonEmptyString,
      transferRecovery: literalUnion(
        'alreadyPending',
        'notTransfer',
        'requeued',
      ),
    }),
  }),
);

export class PlatformTenantFinanceRpcs extends RpcGroup.make(
  PlatformFinanceRefundRecoveryQueue,
  PlatformFinanceReceiptApprovalDetail,
  PlatformFinanceReceiptApprovalQueue,
  PlatformFinanceReceiptReview,
  PlatformFinanceRecordReimbursement,
  PlatformFinanceReimbursementQueue,
  PlatformFinanceRequeueRefundClaim,
  PlatformFinanceTransactionsFindMany,
) {}
