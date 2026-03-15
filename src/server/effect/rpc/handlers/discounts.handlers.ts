import type { Headers } from '@effect/platform';

import {
  RpcBadRequestError,
  RpcConflictError,
  RpcForbiddenError,
  RpcNotFoundError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  resolveTenantDiscountProviders,
} from '@shared/tenant-config';
import {
  and,
  eq,
} from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import {
  userDiscountCards,
} from '../../../../db/schema';
import { Tenant } from '../../../../types/custom/tenant';
import { User } from '../../../../types/custom/user';
import { normalizeEsnCardConfig } from '../../../discounts/discount-provider-config';
import {
  Adapters,
  PROVIDERS,
  type ProviderType,
} from '../../../discounts/providers';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.pipe(Effect.flatMap((database) => operation(database).pipe(Effect.orDie)));

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const normalizeUserDiscountCardRecord = (
  card: Pick<
    typeof userDiscountCards.$inferSelect,
    'id' | 'identifier' | 'status' | 'type' | 'validTo'
  >,
) => ({
  id: card.id,
  identifier: card.identifier,
  status: card.status,
  type: card.type,
  validTo: card.validTo?.toISOString() ?? null,
});

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, RpcUnauthorizedError> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail(RpcUnauthorizedError.make({ message: 'Authentication required' }));

const decodeUserHeader = (headers: Headers.Headers) =>
  Effect.sync(() =>
    decodeHeaderJson(headers[RPC_CONTEXT_HEADERS.USER], Schema.NullOr(User)),
  );

const requireUserHeader = (
  headers: Headers.Headers,
): Effect.Effect<User, RpcUnauthorizedError> =>
  Effect.gen(function* () {
    const user = yield* decodeUserHeader(headers);
    if (!user) {
      return yield* Effect.fail(RpcUnauthorizedError.make({ message: 'Authentication required' }));
    }
    return user;
  });

export const discountHandlers = {
    'discounts.deleteMyCard': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        yield* databaseEffect((database) =>
          database
            .delete(userDiscountCards)
            .where(
              and(
                eq(userDiscountCards.tenantId, tenant.id),
                eq(userDiscountCards.userId, user.id),
                eq(userDiscountCards.type, input.type),
              ),
            ),
        );
      }),
    'discounts.getMyCards': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);
        const cards = yield* databaseEffect((database) =>
          database.query.userDiscountCards.findMany({
            columns: {
              id: true,
              identifier: true,
              status: true,
              type: true,
              validTo: true,
            },
            where: {
              tenantId: tenant.id,
              userId: user.id,
            },
          }),
        );

        return cards.map((card) => normalizeUserDiscountCardRecord(card));
      }),
    'discounts.getTenantProviders': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const resolvedTenant = yield* databaseEffect((database) =>
          database.query.tenants.findFirst({
            columns: {
              discountProviders: true,
            },
            where: { id: tenant.id },
          }),
        );
        const config = resolveTenantDiscountProviders(
          resolvedTenant?.discountProviders,
        );

        return (Object.keys(PROVIDERS) as ProviderType[]).map((type) => ({
          config: normalizeEsnCardConfig(config[type].config),
          status: config[type].status,
          type,
        }));
      }),
    'discounts.refreshMyCard': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const tenantRecord = yield* databaseEffect((database) =>
          database.query.tenants.findFirst({
            columns: {
              discountProviders: true,
            },
            where: {
              id: tenant.id,
            },
          }),
        );
        const providers = resolveTenantDiscountProviders(
          tenantRecord?.discountProviders,
        );
        const provider = providers[input.type];
        if (!provider || provider.status !== 'enabled') {
          return yield* Effect.fail(RpcForbiddenError.make({ message: 'Forbidden' }));
        }

        const card = yield* databaseEffect((database) =>
          database.query.userDiscountCards.findFirst({
            columns: {
              id: true,
              identifier: true,
              status: true,
              type: true,
              validTo: true,
            },
            where: {
              tenantId: tenant.id,
              type: input.type,
              userId: user.id,
            },
          }),
        );
        if (!card) {
          return yield* Effect.fail(RpcNotFoundError.make({ message: 'Resource not found' }));
        }

        const adapter = Adapters[input.type];
        if (!adapter) {
          return normalizeUserDiscountCardRecord(card);
        }

        const result = yield* Effect.promise(() =>
          adapter.validate({
            config: provider.config,
            identifier: card.identifier,
          }),
        );
        const updatedCards = yield* databaseEffect((database) =>
          database
            .update(userDiscountCards)
            .set({
              lastCheckedAt: new Date(),
              metadata: result.metadata,
              status: result.status,
              validFrom: result.validFrom ?? undefined,
              validTo: result.validTo ?? undefined,
            })
            .where(eq(userDiscountCards.id, card.id))
            .returning({
              id: userDiscountCards.id,
              identifier: userDiscountCards.identifier,
              status: userDiscountCards.status,
              type: userDiscountCards.type,
              validTo: userDiscountCards.validTo,
            }),
        );
        const updatedCard = updatedCards[0];
        if (!updatedCard) {
          return yield* Effect.fail(RpcNotFoundError.make({ message: 'Resource not found' }));
        }

        return normalizeUserDiscountCardRecord(updatedCard);
      }),
    'discounts.upsertMyCard': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const tenantRecord = yield* databaseEffect((database) =>
          database.query.tenants.findFirst({
            columns: {
              discountProviders: true,
            },
            where: {
              id: tenant.id,
            },
          }),
        );
        const providers = resolveTenantDiscountProviders(
          tenantRecord?.discountProviders,
        );
        const provider = providers[input.type];
        if (!provider || provider.status !== 'enabled') {
          return yield* Effect.fail(RpcForbiddenError.make({ message: 'Forbidden' }));
        }

        const existingIdentifier = yield* databaseEffect((database) =>
          database.query.userDiscountCards.findFirst({
            columns: {
              userId: true,
            },
            where: {
              identifier: input.identifier,
              type: input.type,
            },
          }),
        );
        if (existingIdentifier && existingIdentifier.userId !== user.id) {
          return yield* Effect.fail(RpcConflictError.make({ message: 'Conflict' }));
        }

        const existingCard = yield* databaseEffect((database) =>
          database.query.userDiscountCards.findFirst({
            columns: {
              id: true,
              identifier: true,
              status: true,
              type: true,
              validTo: true,
            },
            where: {
              tenantId: tenant.id,
              type: input.type,
              userId: user.id,
            },
          }),
        );

        const upsertedCards = existingCard
          ? yield* databaseEffect((database) =>
          database
                .update(userDiscountCards)
                .set({
                  identifier: input.identifier,
                })
                .where(eq(userDiscountCards.id, existingCard.id))
                .returning({
                  id: userDiscountCards.id,
                  identifier: userDiscountCards.identifier,
                  status: userDiscountCards.status,
                  type: userDiscountCards.type,
                  validTo: userDiscountCards.validTo,
                }),
            )
          : yield* databaseEffect((database) =>
          database
                .insert(userDiscountCards)
                .values({
                  identifier: input.identifier,
                  tenantId: tenant.id,
                  type: input.type,
                  userId: user.id,
                })
                .returning({
                  id: userDiscountCards.id,
                  identifier: userDiscountCards.identifier,
                  status: userDiscountCards.status,
                  type: userDiscountCards.type,
                  validTo: userDiscountCards.validTo,
                }),
            );
        const upsertedCard = upsertedCards[0];
        if (!upsertedCard) {
          return yield* Effect.fail(RpcBadRequestError.make({ message: 'Bad request' }));
        }

        const adapter = Adapters[input.type];
        if (!adapter) {
          return normalizeUserDiscountCardRecord(upsertedCard);
        }

        const result = yield* Effect.promise(() =>
          adapter.validate({
            config: provider.config,
            identifier: input.identifier,
          }),
        );
        const updatedCards = yield* databaseEffect((database) =>
          database
            .update(userDiscountCards)
            .set({
              lastCheckedAt: new Date(),
              metadata: result.metadata,
              status: result.status,
              validFrom: result.validFrom ?? undefined,
              validTo: result.validTo ?? undefined,
            })
            .where(eq(userDiscountCards.id, upsertedCard.id))
            .returning({
              id: userDiscountCards.id,
              identifier: userDiscountCards.identifier,
              status: userDiscountCards.status,
              type: userDiscountCards.type,
              validTo: userDiscountCards.validTo,
            }),
        );
        const updatedCard = updatedCards[0];
        if (!updatedCard) {
          return yield* Effect.fail(RpcBadRequestError.make({ message: 'Bad request' }));
        }

        if (updatedCard.status !== 'verified') {
          return yield* Effect.fail(RpcBadRequestError.make({ message: 'Bad request' }));
        }

        return normalizeUserDiscountCardRecord(updatedCard);
      }),
} satisfies Partial<AppRpcHandlers>;
