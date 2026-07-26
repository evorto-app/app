import { RpcForbiddenError } from '@shared/errors/rpc-errors';
import { Effect } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import { includesPermission } from '../../../../shared/permissions/permissions';
import { RpcAccess } from './shared/rpc-access.service';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

export const taxRateHandlers = {
  'taxRates.listActive': (_payload, _options) =>
    Effect.gen(function* () {
      const context = yield* RpcAccess.current();
      if (
        context.authenticated &&
        !includesPermission('templates:view', context.permissions)
      ) {
        return yield* new RpcForbiddenError({
          message: 'Forbidden',
          permission: 'templates:view',
        });
      }

      const { tenant } = context;
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
            stripeAccountId,
            tenantId: tenant.id,
          },
        }),
      );

      return activeTaxRates;
    }),
} satisfies Partial<AppRpcHandlers>;
