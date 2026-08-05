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
import {
  Adapters,
  PROVIDER_TYPES,
  type ProviderAdapter,
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
  failureMessage,
  identifier,
}: {
  adapter: ProviderAdapter;
  failureMessage: string;
  identifier: string;
}): Effect.Effect<
  ValidationResult,
  RpcBadRequestError | RpcInternalServerError
> =>
  Effect.tryPromise<ValidationResult, unknown>({
    catch: (cause) => cause,
    try: (): Promise<ValidationResult> =>
      adapter.validate({
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
              message: failureMessage,
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
                message: failureMessage,
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

      return PROVIDER_TYPES.map((type: ProviderType) => ({
        config: config[type].config,
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
      if (provider.status !== 'enabled') {
        return yield* Effect.fail(
          new RpcForbiddenError({
            message:
              'ESNcard discounts are not available for this organization.',
          }),
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
          new DiscountCardNotFoundError({
            message:
              'This ESNcard is no longer saved. No card was changed. Add it again if you still use it.',
          }),
        );
      }

      const adapter = Adapters[input.type];
      const result = yield* validateDiscountCard({
        adapter,
        failureMessage:
          'We could not check this ESNcard, so it was not changed. Select Check again to try once more.',
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
      if (provider.status !== 'enabled') {
        return yield* Effect.fail(
          new RpcForbiddenError({
            message:
              'ESNcard discounts are not available for this organization.',
          }),
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
            message:
              'This ESNcard is already linked to another account in this organization.',
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
      const validationResult = yield* validateDiscountCard({
        adapter,
        failureMessage:
          'We could not check this ESNcard, so it was not saved or changed. Select Save ESNcard to try once more.',
        identifier: input.identifier,
      });
      const validatedCardFields = {
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
