 

import type { Headers } from '@effect/platform';

import {
  resolveTenantDiscountProviders,
} from '@shared/tenant-config';
import {
  and,
  eq,
} from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  userDiscountCards,
} from '../../../../../db/schema';
import { Tenant } from '../../../../../types/custom/tenant';
import { User } from '../../../../../types/custom/user';
import { normalizeEsnCardConfig } from '../../../../discounts/discount-provider-config';
import {
  Adapters,
  PROVIDERS,
  type ProviderType,
} from '../../../../discounts/providers';
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
): Effect.Effect<void, 'UNAUTHORIZED'> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail('UNAUTHORIZED' as const);

const decodeUserHeader = (headers: Headers.Headers) =>
  Effect.sync(() =>
    decodeHeaderJson(headers[RPC_CONTEXT_HEADERS.USER], Schema.NullOr(User)),
  );

const requireUserHeader = (
  headers: Headers.Headers,
): Effect.Effect<User, 'UNAUTHORIZED'> =>
  Effect.gen(function* () {
    const user = yield* decodeUserHeader(headers);
    if (!user) {
      return yield* Effect.fail('UNAUTHORIZED' as const);
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
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        const card = yield* databaseEffect((database) =>
          database.query.userDiscountCards.findFirst({
            where: {
              tenantId: tenant.id,
              type: input.type,
              userId: user.id,
            },
          }),
        );
        if (!card) {
          return yield* Effect.fail('NOT_FOUND' as const);
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
            .returning(),
        );
        const updatedCard = updatedCards[0];
        if (!updatedCard) {
          return yield* Effect.fail('NOT_FOUND' as const);
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
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        const existingIdentifier = yield* databaseEffect((database) =>
          database.query.userDiscountCards.findFirst({
            where: {
              identifier: input.identifier,
              type: input.type,
            },
          }),
        );
        if (existingIdentifier && existingIdentifier.userId !== user.id) {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const existingCard = yield* databaseEffect((database) =>
          database.query.userDiscountCards.findFirst({
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
                .returning(),
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
                .returning(),
            );
        const upsertedCard = upsertedCards[0];
        if (!upsertedCard) {
          return yield* Effect.fail('BAD_REQUEST' as const);
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
            .returning(),
        );
        const updatedCard = updatedCards[0];
        if (!updatedCard) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        if (updatedCard.status !== 'verified') {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        return normalizeUserDiscountCardRecord(updatedCard);
      }),
} satisfies Partial<AppRpcHandlers>;
