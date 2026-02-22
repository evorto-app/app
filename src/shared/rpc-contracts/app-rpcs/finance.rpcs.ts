import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

export const FinanceRpcError = Schema.Literal(
  'BAD_REQUEST',
  'FORBIDDEN',
  'INTERNAL_SERVER_ERROR',
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type FinanceRpcError = Schema.Schema.Type<typeof FinanceRpcError>;

export const FinanceReceiptStatus = Schema.Literal(
  'approved',
  'refunded',
  'rejected',
  'submitted',
);
export type FinanceReceiptStatus = Schema.Schema.Type<typeof FinanceReceiptStatus>;

export const FinanceReceiptAttachmentInput = Schema.Struct({
  fileName: Schema.NonEmptyString,
  mimeType: Schema.NonEmptyString,
  sizeBytes: Schema.Number.pipe(Schema.positive()),
  storageKey: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  storageUrl: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
});
export type FinanceReceiptAttachmentInput = Schema.Schema.Type<
  typeof FinanceReceiptAttachmentInput
>;

export const FinanceReceiptFieldsInput = Schema.Struct({
  alcoholAmount: Schema.Number.pipe(Schema.nonNegative()),
  depositAmount: Schema.Number.pipe(Schema.nonNegative()),
  hasAlcohol: Schema.Boolean,
  hasDeposit: Schema.Boolean,
  purchaseCountry: Schema.NonEmptyString,
  receiptDate: Schema.NonEmptyString,
  taxAmount: Schema.Number.pipe(Schema.nonNegative()),
  totalAmount: Schema.Number.pipe(Schema.nonNegative()),
});
export type FinanceReceiptFieldsInput = Schema.Schema.Type<
  typeof FinanceReceiptFieldsInput
>;

export const FinanceReceiptBaseRecord = Schema.Struct({
  alcoholAmount: Schema.Number,
  attachmentFileName: Schema.NonEmptyString,
  attachmentMimeType: Schema.NonEmptyString,
  attachmentStorageKey: Schema.NullOr(Schema.NonEmptyString),
  createdAt: Schema.NonEmptyString,
  depositAmount: Schema.Number,
  eventId: Schema.NonEmptyString,
  hasAlcohol: Schema.Boolean,
  hasDeposit: Schema.Boolean,
  id: Schema.NonEmptyString,
  previewImageUrl: Schema.NullOr(Schema.NonEmptyString),
  purchaseCountry: Schema.NonEmptyString,
  receiptDate: Schema.NonEmptyString,
  refundedAt: Schema.NullOr(Schema.NonEmptyString),
  refundTransactionId: Schema.NullOr(Schema.NonEmptyString),
  rejectionReason: Schema.NullOr(Schema.String),
  reviewedAt: Schema.NullOr(Schema.NonEmptyString),
  status: FinanceReceiptStatus,
  submittedByUserId: Schema.NonEmptyString,
  taxAmount: Schema.Number,
  totalAmount: Schema.Number,
  updatedAt: Schema.NonEmptyString,
});
export type FinanceReceiptBaseRecord = Schema.Schema.Type<
  typeof FinanceReceiptBaseRecord
>;
const FinanceReceiptIdRecord = FinanceReceiptBaseRecord.pick('id');
const FinanceReceiptReviewRecord = FinanceReceiptBaseRecord.pick('id', 'status');

export const FinanceReceiptWithSubmitterRecord = Schema.extend(
  FinanceReceiptBaseRecord,
  Schema.Struct({
    submittedByEmail: Schema.NonEmptyString,
    submittedByFirstName: Schema.NonEmptyString,
    submittedByLastName: Schema.NonEmptyString,
  }),
);
export type FinanceReceiptWithSubmitterRecord = Schema.Schema.Type<
  typeof FinanceReceiptWithSubmitterRecord
>;

export const FinanceReceiptWithEventRecord = Schema.extend(
  FinanceReceiptBaseRecord,
  Schema.Struct({
    eventStart: Schema.NonEmptyString,
    eventTitle: Schema.NonEmptyString,
  }),
);
export type FinanceReceiptWithEventRecord = Schema.Schema.Type<
  typeof FinanceReceiptWithEventRecord
>;

export const FinanceReceiptForApprovalRecord = Schema.extend(
  FinanceReceiptWithSubmitterRecord,
  Schema.Struct({
    eventStart: Schema.NonEmptyString,
    eventTitle: Schema.NonEmptyString,
  }),
);
export type FinanceReceiptForApprovalRecord = Schema.Schema.Type<
  typeof FinanceReceiptForApprovalRecord
>;

export const FinanceReceiptPendingGroupRecord = Schema.Struct({
  eventId: Schema.NonEmptyString,
  eventStart: Schema.NonEmptyString,
  eventTitle: Schema.NonEmptyString,
  receipts: Schema.Array(FinanceReceiptWithSubmitterRecord),
});
export type FinanceReceiptPendingGroupRecord = Schema.Schema.Type<
  typeof FinanceReceiptPendingGroupRecord
>;

export const FinanceReceiptRefundableRecord = Schema.extend(
  FinanceReceiptWithSubmitterRecord,
  Schema.Struct({
    eventStart: Schema.NonEmptyString,
    eventTitle: Schema.NonEmptyString,
    recipientIban: Schema.NullOr(Schema.NonEmptyString),
    recipientPaypalEmail: Schema.NullOr(Schema.NonEmptyString),
  }),
);
export type FinanceReceiptRefundableRecord = Schema.Schema.Type<
  typeof FinanceReceiptRefundableRecord
>;

export const FinanceReceiptRefundGroupRecord = Schema.Struct({
  payout: Schema.Struct({
    iban: Schema.NullOr(Schema.NonEmptyString),
    paypalEmail: Schema.NullOr(Schema.NonEmptyString),
  }),
  receipts: Schema.Array(FinanceReceiptRefundableRecord),
  submittedByEmail: Schema.NonEmptyString,
  submittedByFirstName: Schema.NonEmptyString,
  submittedByLastName: Schema.NonEmptyString,
  submittedByUserId: Schema.NonEmptyString,
  totalAmount: Schema.Number,
});
export type FinanceReceiptRefundGroupRecord = Schema.Schema.Type<
  typeof FinanceReceiptRefundGroupRecord
>;

export const FinanceReceiptsByEvent = asRpcQuery(
  Rpc.make('finance.receipts.byEvent', {
    error: FinanceRpcError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Array(FinanceReceiptWithSubmitterRecord),
  }),
);

export const FinanceReceiptsCreateRefund = asRpcMutation(
  Rpc.make('finance.receipts.createRefund', {
    error: FinanceRpcError,
    payload: Schema.Struct({
      payoutReference: Schema.NonEmptyString,
      payoutType: Schema.Literal('iban', 'paypal'),
      receiptIds: Schema.NonEmptyArray(Schema.NonEmptyString),
    }),
    success: Schema.Struct({
      receiptCount: Schema.Number,
      totalAmount: Schema.Number,
      transactionId: Schema.NonEmptyString,
    }),
  }),
);

export const FinanceReceiptsFindOneForApproval = asRpcQuery(
  Rpc.make('finance.receipts.findOneForApproval', {
    error: FinanceRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: FinanceReceiptForApprovalRecord,
  }),
);

export const FinanceReceiptsMy = asRpcQuery(
  Rpc.make('finance.receipts.my', {
    error: FinanceRpcError,
    payload: Schema.Void,
    success: Schema.Array(FinanceReceiptWithEventRecord),
  }),
);

export const FinanceReceiptsPendingApprovalGrouped = asRpcQuery(
  Rpc.make('finance.receipts.pendingApprovalGrouped', {
    error: FinanceRpcError,
    payload: Schema.Void,
    success: Schema.Array(FinanceReceiptPendingGroupRecord),
  }),
);

export const FinanceReceiptsRefundableGroupedByRecipient = asRpcQuery(
  Rpc.make('finance.receipts.refundableGroupedByRecipient', {
    error: FinanceRpcError,
    payload: Schema.Void,
    success: Schema.Array(FinanceReceiptRefundGroupRecord),
  }),
);

export const FinanceReceiptsReview = asRpcMutation(
  Rpc.make('finance.receipts.review', {
    error: FinanceRpcError,
    payload: Schema.extend(
      Schema.Struct({
        id: Schema.NonEmptyString,
        rejectionReason: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
        status: Schema.Literal('approved', 'rejected'),
      }),
      FinanceReceiptFieldsInput,
    ),
    success: FinanceReceiptReviewRecord,
  }),
);

export const FinanceReceiptsSubmit = asRpcMutation(
  Rpc.make('finance.receipts.submit', {
    error: FinanceRpcError,
    payload: Schema.Struct({
      attachment: FinanceReceiptAttachmentInput,
      eventId: Schema.NonEmptyString,
      fields: FinanceReceiptFieldsInput,
    }),
    success: FinanceReceiptIdRecord,
  }),
);

export const FinanceReceiptMediaUploadOriginal = asRpcMutation(
  Rpc.make('finance.receiptMedia.uploadOriginal', {
    error: FinanceRpcError,
    payload: Schema.Struct({
      fileBase64: Schema.NonEmptyString,
      fileName: Schema.NonEmptyString,
      fileSizeBytes: Schema.Number.pipe(Schema.positive()),
      mimeType: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      sizeBytes: Schema.Number.pipe(Schema.positive()),
      storageKey: Schema.NonEmptyString,
      storageUrl: Schema.NonEmptyString,
    }),
  }),
);

export const FinanceTransactionRecord = Schema.Struct({
  amount: Schema.Number,
  appFee: Schema.NullOr(Schema.Number),
  comment: Schema.NullOr(Schema.String),
  createdAt: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  method: Schema.Literal('cash', 'paypal', 'stripe', 'transfer'),
  status: Schema.Literal('cancelled', 'pending', 'successful'),
  stripeFee: Schema.NullOr(Schema.Number),
});
export type FinanceTransactionRecord = Schema.Schema.Type<
  typeof FinanceTransactionRecord
>;

export const FinanceTransactionsFindMany = asRpcQuery(
  Rpc.make('finance.transactions.findMany', {
    error: FinanceRpcError,
    payload: Schema.Struct({
      limit: Schema.Number,
      offset: Schema.Number,
    }),
    success: Schema.Struct({
      data: Schema.Array(FinanceTransactionRecord),
      total: Schema.Number,
    }),
  }),
);

export class FinanceRpcs extends RpcGroup.make(
  FinanceReceiptMediaUploadOriginal,
  FinanceReceiptsByEvent,
  FinanceReceiptsCreateRefund,
  FinanceReceiptsFindOneForApproval,
  FinanceReceiptsMy,
  FinanceReceiptsPendingApprovalGrouped,
  FinanceReceiptsRefundableGroupedByRecipient,
  FinanceReceiptsReview,
  FinanceReceiptsSubmit,
  FinanceTransactionsFindMany,
) {}
