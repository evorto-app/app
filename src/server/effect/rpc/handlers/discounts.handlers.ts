import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import {
  DiscountCardConflictError,
  DiscountCardNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/discounts.errors';
import { resolveTenantDiscountProviders } from '@shared/tenant-config';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import { userDiscountCards } from '../../../../db/schema';
import { normalizeEsnCardConfig } from '../../../discounts/discount-provider-config';
import {
  Adapters,
  type ProviderAdapter,
  PROVIDERS,
  type ProviderType,
  ProviderValidationUnavailableError,
  type ValidationResult,
} from '../../../discounts/providers';
import { safeServerErrorSummary } from '../../../utils/safe-server-error-summary';
import { RpcAccess } from './shared/rpc-access.service';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

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

const validateDiscountCard = ({
  adapter,
  config,
  identifier,
}: {
  adapter: ProviderAdapter<unknown>;
  config: unknown;
  identifier: string;
}): Effect.Effect<
  ValidationResult,
  RpcBadRequestError | RpcInternalServerError
> =>
  Effect.tryPromise<ValidationResult, unknown>({
    catch: (cause) => cause,
    try: (): Promise<ValidationResult> =>
      adapter.validate({
        config,
        identifier,
      }),
  }).pipe(
    Effect.catch(
      (
        error,
      ): Effect.Effect<never, RpcBadRequestError | RpcInternalServerError> => {
        if (error instanceof ProviderValidationUnavailableError) {
          return Effect.fail(
            new RpcBadRequestError({
              message:
                'Could not validate ESN card right now. Try again later.',
              reason: `provider-${error.reason}`,
            }),
          );
        }

        return Effect.logError(
          'Discount card validation failed unexpectedly',
        ).pipe(
          Effect.annotateLogs(
            safeServerErrorSummary('discountCard.validate', error),
          ),
          Effect.andThen(
            Effect.fail(
              new RpcInternalServerError({
                message: 'Discount card validation failed unexpectedly',
              }),
            ),
          ),
        );
      },
    ),
  );

export const discountHandlers = {
  'discounts.deleteMyCard': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

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
  'discounts.getMyCards': (_payload, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
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
  'discounts.getTenantProviders': (_payload, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
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
  'discounts.refreshMyCard': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

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
        return yield* Effect.fail(
          new RpcForbiddenError({ message: 'Forbidden' }),
        );
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
        return yield* Effect.fail(
          new DiscountCardNotFoundError({ message: 'Discount card not found' }),
        );
      }

      const adapter = Adapters[input.type];
      if (!adapter) {
        return normalizeUserDiscountCardRecord(card);
      }

      const result = yield* validateDiscountCard({
        adapter,
        config: provider.config,
        identifier: card.identifier,
      });
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
        return yield* Effect.fail(
          new RpcInternalServerError({
            message: 'Discount card update returned no rows',
          }),
        );
      }

      return normalizeUserDiscountCardRecord(updatedCard);
    }),
  'discounts.upsertMyCard': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

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
        return yield* Effect.fail(
          new RpcForbiddenError({ message: 'Forbidden' }),
        );
      }

      const existingIdentifier = yield* databaseEffect((database) =>
        database.query.userDiscountCards.findFirst({
          columns: {
            userId: true,
          },
          where: {
            identifier: input.identifier,
            tenantId: tenant.id,
            type: input.type,
          },
        }),
      );
      if (existingIdentifier && existingIdentifier.userId !== user.id) {
        return yield* Effect.fail(
          new DiscountCardConflictError({
            message: 'Discount card identifier already exists',
          }),
        );
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

      const adapter = Adapters[input.type];
      const validationResult = adapter
        ? yield* validateDiscountCard({
            adapter,
            config: provider.config,
            identifier: input.identifier,
          })
        : null;
      const validatedCardFields =
        validationResult === null
          ? {}
          : {
              lastCheckedAt: new Date(),
              metadata: validationResult.metadata,
              status: validationResult.status,
              validFrom: validationResult.validFrom ?? undefined,
              validTo: validationResult.validTo ?? undefined,
            };
      const upsertedCards = existingCard
        ? yield* databaseEffect((database) =>
            database
              .update(userDiscountCards)
              .set({
                ...validatedCardFields,
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
                ...validatedCardFields,
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
        yield* Effect.logError('Discount card upsert returned no rows').pipe(
          Effect.annotateLogs({
            discountType: input.type,
            userId: user.id,
          }),
        );
        return yield* Effect.fail(
          new RpcInternalServerError({
            message: 'Discount card upsert returned no rows',
          }),
        );
      }

      return normalizeUserDiscountCardRecord(upsertedCard);
    }),
} satisfies Partial<AppRpcHandlers>;
