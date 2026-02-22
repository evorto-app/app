 






import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  tenantStripeTaxRates,
} from '../../../../../db/schema';
import {
  ConfigPermissions,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { Tenant } from '../../../../../types/custom/tenant';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../../rpc-context-headers';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.pipe(Effect.flatMap((database) => operation(database).pipe(Effect.orDie)));

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const normalizeActiveTenantTaxRateRecord = (
  taxRate: Pick<
    typeof tenantStripeTaxRates.$inferSelect,
    | 'country'
    | 'displayName'
    | 'id'
    | 'percentage'
    | 'state'
    | 'stripeTaxRateId'
  >,
) => ({
  country: taxRate.country ?? null,
  displayName: taxRate.displayName ?? null,
  id: taxRate.id,
  percentage: taxRate.percentage ?? null,
  state: taxRate.state ?? null,
  stripeTaxRateId: taxRate.stripeTaxRateId,
});

export const taxRateHandlers = {
    'taxRates.listActive': (_payload, options) =>
      Effect.gen(function* () {
        if (options.headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true') {
          const currentPermissions = decodeHeaderJson(
            options.headers[RPC_CONTEXT_HEADERS.PERMISSIONS],
            ConfigPermissions,
          );
          if (!currentPermissions.includes('templates:view')) {
            return yield* Effect.fail('FORBIDDEN' as const);
          }
        }

        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
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
              tenantId: tenant.id,
            },
          }),
        );

        return activeTaxRates.map((taxRate) =>
          normalizeActiveTenantTaxRateRecord(taxRate),
        );
      }),
} satisfies Partial<AppRpcHandlers>;
