import { maximumFinanceReceiptMinorUnits } from './receipt-values';

export const maximumFinanceReimbursementReceiptCount = 100;

export type FinanceReimbursementBatchResult =
  | {
      readonly currency: FinanceReimbursementCurrency;
      readonly error: null;
      readonly targetUserId: string;
      readonly totalAmount: number;
    }
  | {
      readonly currency: null;
      readonly error: {
        readonly message: string;
        readonly reason: string;
      };
      readonly targetUserId: null;
      readonly totalAmount: null;
    };
export type FinanceReimbursementCurrency = 'AUD' | 'CZK' | 'EUR';

export type FinanceReimbursementPayoutType = 'iban' | 'paypal';

export const resolveFinanceReimbursementBatch = (
  receipts: readonly {
    readonly currency: FinanceReimbursementCurrency;
    readonly submittedByUserId: string;
    readonly totalAmount: number;
  }[],
): FinanceReimbursementBatchResult => {
  const firstReceipt = receipts[0];
  if (!firstReceipt) {
    return {
      currency: null,
      error: {
        message: 'Choose at least one receipt to reimburse.',
        reason: 'missingTargetUser',
      },
      targetUserId: null,
      totalAmount: null,
    };
  }
  if (
    receipts.some(
      (receipt) => receipt.submittedByUserId !== firstReceipt.submittedByUserId,
    )
  ) {
    return {
      currency: null,
      error: {
        message: 'All selected receipts must belong to the same person.',
        reason: 'mismatchedSubmitter',
      },
      targetUserId: null,
      totalAmount: null,
    };
  }
  if (receipts.some((receipt) => receipt.currency !== firstReceipt.currency)) {
    return {
      currency: null,
      error: {
        message: 'All selected receipts must use the same currency.',
        reason: 'mismatchedReceiptCurrency',
      },
      targetUserId: null,
      totalAmount: null,
    };
  }

  const totalAmount = receipts.reduce(
    (sum, receipt) => sum + receipt.totalAmount,
    0,
  );
  if (
    !Number.isSafeInteger(totalAmount) ||
    totalAmount <= 0 ||
    totalAmount > maximumFinanceReceiptMinorUnits
  ) {
    return {
      currency: null,
      error: {
        message: 'The reimbursement total is not valid. Review the receipts.',
        reason: 'invalidReimbursementTotal',
      },
      targetUserId: null,
      totalAmount: null,
    };
  }

  return {
    currency: firstReceipt.currency,
    error: null,
    targetUserId: firstReceipt.submittedByUserId,
    totalAmount,
  };
};

export const maskFinancePayoutDestination = (
  payoutType: FinanceReimbursementPayoutType,
  payoutReference: string,
): string => {
  if (payoutType === 'iban') {
    if (payoutReference.length < 4) {
      throw new Error('Cannot mask an invalid IBAN payout destination');
    }
    return `•••• ${payoutReference.slice(-4)}`;
  }

  const separatorIndex = payoutReference.lastIndexOf('@');
  if (separatorIndex <= 0 || separatorIndex === payoutReference.length - 1) {
    throw new Error('Cannot mask an invalid PayPal payout destination');
  }
  const localPart = payoutReference.slice(0, separatorIndex);
  const domain = payoutReference.slice(separatorIndex + 1);
  const domainParts = domain.split('.');
  const domainName = domainParts[0];
  const topLevelDomain = domainParts.slice(1).join('.');
  if (!domainName || !topLevelDomain) {
    throw new Error('Cannot mask an invalid PayPal payout destination');
  }
  return `${localPart[0]}•••@${domainName[0]}•••.${topLevelDomain}`;
};
