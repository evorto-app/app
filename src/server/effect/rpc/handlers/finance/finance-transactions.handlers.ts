import { and, count, desc, eq, not } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { transactions } from '../../../../../db/schema';
import { RpcAccess } from '../shared/rpc-access.service';
import { databaseEffect, normalizeFinanceTransactionRecord } from './finance.shared';

export const financeTransactionsHandlers = {
'finance.transactions.findMany': ({ limit, offset }, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensureAuthenticated();
        const { tenant } = yield* RpcAccess.current();
        const transactionCountResult = yield* databaseEffect((database) =>
          database
            .select({
              count: count(),
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.tenantId, tenant.id),
                not(eq(transactions.status, 'cancelled')),
              ),
            ),
        );
        const total = transactionCountResult[0]?.count ?? 0;

        const transactionRows = yield* databaseEffect((database) =>
          database
            .select({
              amount: transactions.amount,
              appFee: transactions.appFee,
              comment: transactions.comment,
              createdAt: transactions.createdAt,
              id: transactions.id,
              method: transactions.method,
              status: transactions.status,
              stripeFee: transactions.stripeFee,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.tenantId, tenant.id),
                not(eq(transactions.status, 'cancelled')),
              ),
            )
            .limit(limit)
            .offset(offset)
            .orderBy(desc(transactions.createdAt)),
        );

        return {
          data: transactionRows.map((transaction) =>
            normalizeFinanceTransactionRecord(transaction),
          ),
          total,
        };
      }),
} satisfies Partial<AppRpcHandlers>;
