import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  DiscountCardChangedError,
  DiscountCardConflictError,
  DiscountCardNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/discounts.errors';
import { resolveTenantDiscountProviders } from '@shared/tenant-config';
import { and, eq } from 'drizzle-orm';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Cause, Effect } from 'effect';
import { isSqlError } from 'effect/unstable/sql/SqlError';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import {
  userDiscountCardIdentifierUniqueConstraintName,
  userDiscountCards,
  userDiscountCardUserTypeUniqueConstraintName,
} from '../../../../db/schema';
import {
  Adapters,
  PROVIDER_TYPES,
  type ProviderAdapter,
  type ProviderType,
  ProviderValidationUnavailableError,
  type ValidationResult,
} from '../../../discounts/providers';
import { lockUserDiscountCards } from '../../../discounts/user-discount-card-lock';
import { safeServerErrorSummary } from '../../../utils/safe-server-error-summary';
import { RpcAccess } from './shared/rpc-access.service';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const cardSaveConflict = (error: unknown) => {
  if (
    !(error instanceof EffectDrizzleQueryError) ||
    !Cause.isCause(error.cause) ||
    error.cause.reasons.length !== 1
  )
    return;
  const failure = error.cause.reasons[0];
  if (
    !failure ||
    !Cause.isFailReason(failure) ||
    !isSqlError(failure.error) ||
    failure.error.reason._tag !== 'UniqueViolation'
  )
    return;
  switch (failure.error.reason.constraint) {
    case userDiscountCardIdentifierUniqueConstraintName: {
      return new DiscountCardConflictError({
        message: 'This ESNcard is already linked to another account.',
      });
    }
    case userDiscountCardUserTypeUniqueConstraintName: {
      return new DiscountCardChangedError({
        message:
          'Your saved ESNcard changed or was removed while it was being checked. Review your current card and try again.',
      });
    }
    default: {
      return;
    }
  }
};

const withDiscountCardOwnerLock = <A>(
  database: Pick<DatabaseClient, 'transaction'>,
  userId: string,
  operation: (
    transaction: Pick<DatabaseClient, 'delete' | 'insert' | 'update'>,
  ) => Effect.Effect<A, unknown, never>,
) =>
  database.transaction((transaction) =>
    Effect.gen(function* () {
      yield* lockUserDiscountCards(transaction, userId, 'exclusive');
      return yield* operation(transaction);
    }),
  );

const databaseCardSaveEffect = <A>(
  card: Pick<
    typeof userDiscountCards.$inferSelect,
    'identifier' | 'type' | 'userId'
  >,
  operation: (
    database: Pick<DatabaseClient, 'delete' | 'insert' | 'update'>,
  ) => Effect.Effect<A, unknown, never>,
): Effect.Effect<
  A,
  DiscountCardChangedError | DiscountCardConflictError,
  Database
> =>
  Database.use((database) =>
    withDiscountCardOwnerLock(database, card.userId, operation).pipe(
      Effect.catch((error) => {
        const conflict = cardSaveConflict(error);
        if (!conflict) return Effect.die(error);
        if (!(conflict instanceof DiscountCardConflictError))
          return Effect.fail(conflict);
        // PostgreSQL may choose either unique index when simultaneous initial
        // saves use the same user and identifier. Check the current owner before
        // telling a member that the card belongs to somebody else.
        return database.query.userDiscountCards
          .findFirst({
            columns: { userId: true },
            where: {
              identifier: card.identifier,
              type: card.type,
            },
          })
          .pipe(
            Effect.orDie,
            Effect.flatMap((owner) =>
              Effect.fail(
                owner && owner.userId !== card.userId
                  ? conflict
                  : new DiscountCardChangedError({
                      message:
                        'Your saved ESNcard changed or was removed while it was being checked. Review your current card and try again.',
                    }),
              ),
            ),
          );
      }),
    ),
  );

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
      const user = yield* RpcAccess.requireUser();

      yield* databaseEffect((database) =>
        withDiscountCardOwnerLock(database, user.id, (transaction) =>
          transaction
            .delete(userDiscountCards)
            .where(
              and(
                eq(userDiscountCards.userId, user.id),
                eq(userDiscountCards.type, input.type),
              ),
            ),
        ),
      );
    }),
  'discounts.getMyCards': (_payload, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
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
      if (!resolvedTenant) {
        return yield* Effect.fail(
          new RpcUnauthorizedError({
            message: 'Organization context is no longer available',
          }),
        );
      }
      const config = resolveTenantDiscountProviders(
        resolvedTenant.discountProviders,
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
      if (!tenantRecord) {
        return yield* Effect.fail(
          new RpcUnauthorizedError({
            message: 'Organization context is no longer available',
          }),
        );
      }
      const providers = resolveTenantDiscountProviders(
        tenantRecord.discountProviders,
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
        withDiscountCardOwnerLock(database, user.id, (transaction) =>
          transaction
            .update(userDiscountCards)
            .set({
              lastCheckedAt: new Date(),
              metadata: result.metadata ?? null,
              status: result.status,
              validFrom: result.validFrom ?? null,
              validTo: result.validTo ?? null,
            })
            .where(
              and(
                eq(userDiscountCards.id, card.id),
                eq(userDiscountCards.userId, user.id),
                eq(userDiscountCards.type, input.type),
                eq(userDiscountCards.identifier, card.identifier),
              ),
            )
            .returning({
              id: userDiscountCards.id,
              identifier: userDiscountCards.identifier,
              status: userDiscountCards.status,
              type: userDiscountCards.type,
              validTo: userDiscountCards.validTo,
            }),
        ),
      );
      const updatedCard = updatedCards[0];
      if (!updatedCard) {
        return yield* Effect.fail(
          new DiscountCardChangedError({
            message:
              'Your saved ESNcard changed or was removed while it was being checked. Review your current card and try again.',
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
      if (!tenantRecord) {
        return yield* Effect.fail(
          new RpcUnauthorizedError({
            message: 'Organization context is no longer available',
          }),
        );
      }
      const providers = resolveTenantDiscountProviders(
        tenantRecord.discountProviders,
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
            type: input.type,
          },
        }),
      );
      if (existingIdentifier && existingIdentifier.userId !== user.id) {
        return yield* Effect.fail(
          new DiscountCardConflictError({
            message: 'This ESNcard is already linked to another account.',
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
        metadata: validationResult.metadata ?? null,
        status: validationResult.status,
        validFrom: validationResult.validFrom ?? null,
        validTo: validationResult.validTo ?? null,
      };
      const upsertedCards = existingCard
        ? yield* databaseCardSaveEffect(
            {
              identifier: input.identifier,
              type: input.type,
              userId: user.id,
            },
            (database) =>
              database
                .update(userDiscountCards)
                .set({
                  ...validatedCardFields,
                  identifier: input.identifier,
                })
                .where(
                  and(
                    eq(userDiscountCards.id, existingCard.id),
                    eq(userDiscountCards.userId, user.id),
                    eq(userDiscountCards.type, input.type),
                    eq(userDiscountCards.identifier, existingCard.identifier),
                  ),
                )
                .returning({
                  id: userDiscountCards.id,
                  identifier: userDiscountCards.identifier,
                  status: userDiscountCards.status,
                  type: userDiscountCards.type,
                  validTo: userDiscountCards.validTo,
                }),
          )
        : yield* databaseCardSaveEffect(
            {
              identifier: input.identifier,
              type: input.type,
              userId: user.id,
            },
            (database) =>
              database
                .insert(userDiscountCards)
                .values({
                  ...validatedCardFields,
                  identifier: input.identifier,
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
        if (existingCard) {
          return yield* Effect.fail(
            new DiscountCardChangedError({
              message:
                'Your saved ESNcard changed or was removed while it was being checked. Review your current card and try again.',
            }),
          );
        }
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
