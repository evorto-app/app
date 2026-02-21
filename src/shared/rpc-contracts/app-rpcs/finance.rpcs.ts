import * as RpcGroup from '@effect/rpc/RpcGroup';

import { FinanceReceiptMediaUploadOriginal, FinanceReceiptsByEvent, FinanceReceiptsCreateRefund, FinanceReceiptsFindOneForApproval, FinanceReceiptsMy, FinanceReceiptsPendingApprovalGrouped, FinanceReceiptsRefundableGroupedByRecipient, FinanceReceiptsReview, FinanceReceiptsSubmit, FinanceTransactionsFindMany } from './definitions';

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
