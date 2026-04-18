import type { AppRpcHandlers } from '../shared/handler-types';

import { financeMediaHandlers } from './finance-media.handlers';
import { financeReceiptsHandlers } from './finance-receipts.handlers';
import { financeTransactionsHandlers } from './finance-transactions.handlers';

export const financeHandlers = {
  ...financeMediaHandlers,
  ...financeReceiptsHandlers,
  ...financeTransactionsHandlers,
} satisfies Partial<AppRpcHandlers>;
