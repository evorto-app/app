import { RpcForbiddenError } from '@shared/errors/rpc-errors';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import { includesPermission } from '../../../../shared/permissions/permissions';
import { ConfigPermissions } from '../../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { Tenant } from '../../../../types/custom/tenant';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const decodeHeaderJson = <S extends Schema.ConstraintDecoder<unknown>>(
  value: string | undefined,
  schema: S,
): S['Type'] =>
  Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

export const taxRateHandlers = {
  'taxRates.listActive': (_payload, options) =>
    Effect.gen(function* () {
      if (options.headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true') {
        const currentPermissions = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.PERMISSIONS],
          ConfigPermissions,
        );
        if (!includesPermission('templates:view', currentPermissions)) {
          return yield* Effect.fail(
            new RpcForbiddenError({
              message: 'Forbidden',
              permission: 'templates:view',
            }),
          );
        }
      }

      const tenant = decodeHeaderJson(
        options.headers[RPC_CONTEXT_HEADERS.TENANT],
        Tenant,
      );
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
