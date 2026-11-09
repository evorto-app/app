import { Effect } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import { RpcAccess } from './shared/rpc-access.service';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

export const taxRateHandlers = {
  'taxRates.listActive': (_payload, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:view');

      const { tenant } = yield* RpcAccess.current();
      const stripeAccountId = tenant.stripeAccountId;
      if (!stripeAccountId) {
        return [];
      }
      const activeTaxRates = yield* databaseEffect((database) =>
        database.query.tenantStripeTaxRates.findMany({
          columns: {
            country: true,
            displayName: true,
            id: true,
            percentage: true,
            state: true,
            stripeTaxRateId: true,
          },
          orderBy: (table, { asc }) => [
            asc(table.displayName),
            asc(table.stripeTaxRateId),
          ],
          where: {
            active: true,
            inclusive: true,
            percentage: { isNotNull: true },
            stripeAccountId,
            tenantId: tenant.id,
          },
        }),
      );

      return activeTaxRates.filter((rate) => Boolean(rate.percentage?.trim()));
    }),
} satisfies Partial<AppRpcHandlers>;
