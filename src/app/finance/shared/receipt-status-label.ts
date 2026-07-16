import type { FinanceReceiptStatus } from '@shared/rpc-contracts/app-rpcs/finance.rpcs';

export const receiptStatusLabel = (status: FinanceReceiptStatus): string => {
  switch (status) {
    case 'approved': {
      return 'Approved';
    }
    case 'refunded': {
      return 'Reimbursed';
    }
    case 'rejected': {
      return 'Rejected';
    }
    case 'submitted': {
      return 'Submitted';
    }
  }
};
