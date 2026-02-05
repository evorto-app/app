import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { PROVIDERS, ProviderType } from '../../discounts/providers';
import { authenticatedProcedure, router } from '../trpc-server';

interface DiscountProviderConfig {
  config: unknown;
  status: 'disabled' | 'enabled';
}

interface DiscountProviders {
  esnCard?: DiscountProviderConfig;
}

export const discountsRouter = router({
  deleteMyCard: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({ type: Schema.Literal('esnCard') }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      await database
        .delete(schema.userDiscountCards)
        .where(
          and(
            eq(schema.userDiscountCards.tenantId, ctx.tenant.id),
            eq(schema.userDiscountCards.userId, ctx.user.id),
            eq(schema.userDiscountCards.type, input.type),
          ),
        );
    }),

  getMyCards: authenticatedProcedure.query(async ({ ctx }) => {
    return database.query.userDiscountCards.findMany({
      where: { tenantId: ctx.tenant.id, userId: ctx.user.id },
    });
  }),

  getTenantProviders: authenticatedProcedure.query(async ({ ctx }) => {
    const tenant = await database.query.tenants.findFirst({
      where: { id: ctx.tenant.id },
    });
    const config: DiscountProviders = tenant?.discountProviders ?? {};
    // Normalize to full providers list
    return (Object.keys(PROVIDERS) as ProviderType[]).map((type) => ({
      config: config[type]?.config ?? {},
      status: config[type]?.status ?? 'disabled',
      type,
    }));
  }),

  refreshMyCard: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({ type: Schema.Literal('esnCard') }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const tenant = await database.query.tenants.findFirst({
        where: { id: ctx.tenant.id },
      });
      const providers: DiscountProviders = tenant?.discountProviders ?? {};
      const provider = providers?.[input.type];
      if (!provider || provider.status !== 'enabled') {
        throw new Error('Provider not enabled for this tenant');
      }
      const card = await database.query.userDiscountCards.findFirst({
        where: {
          tenantId: ctx.tenant.id,
          type: input.type,
          userId: ctx.user.id,
        },
      });
      if (!card) throw new Error('No card on file');
      const { Adapters } = await import('../../discounts/providers');
      const adapter = Adapters[input.type];
      if (!adapter) return card;
      const result = await adapter.validate({
        config: provider.config,
        identifier: card.identifier,
      });
      const [updatedCard] = await database
        .update(schema.userDiscountCards)
        .set({
          lastCheckedAt: new Date(),
          metadata: result.metadata,
          status: result.status,
          validFrom: result.validFrom ?? undefined,
          validTo: result.validTo ?? undefined,
        })
        .where(eq(schema.userDiscountCards.id, card.id))
        .returning();
      return updatedCard;
    }),

  setTenantProviders: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:changeSettings'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          providers: Schema.Array(
            Schema.Struct({
              config: Schema.Unknown,
              status: Schema.Literal('enabled', 'disabled'),
              type: Schema.Literal(
                ...(Object.keys(PROVIDERS) as ProviderType[]),
              ),
            }),
          ),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const tenant = await database.query.tenants.findFirst({
        where: { id: ctx.tenant.id },
      });
      const current: DiscountProviders = tenant?.discountProviders ?? {};
      const updated = { ...current };
      for (const p of input.providers) {
        updated[p.type] = { config: p.config, status: p.status };
      }
      await database
        .update(schema.tenants)
        .set({ discountProviders: updated })
        .where(eq(schema.tenants.id, ctx.tenant.id));
    }),
  upsertMyCard: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          identifier: Schema.NonEmptyString,
          type: Schema.Literal('esnCard'),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      // Ensure provider enabled for tenant
      const tenant = await database.query.tenants.findFirst({
        where: { id: ctx.tenant.id },
      });
      const providers: DiscountProviders = tenant?.discountProviders ?? {};
      const provider = providers?.[input.type];
      if (!provider || provider.status !== 'enabled') {
        throw new Error('Provider not enabled for this tenant');
      }

      // Uniqueness check across all users
      const existingNumber = await database.query.userDiscountCards.findFirst({
        where: { identifier: input.identifier, type: input.type },
      });
      if (existingNumber && existingNumber.userId !== ctx.user.id) {
        throw new Error('Card is already in use by another user');
      }

      const existing = await database.query.userDiscountCards.findFirst({
        where: {
          tenantId: ctx.tenant.id,
          type: input.type,
          userId: ctx.user.id,
        },
      });
      // Upsert first
      let upserted: typeof schema.userDiscountCards.$inferSelect;
      if (existing) {
        const [updated] = await database
          .update(schema.userDiscountCards)
          .set({ identifier: input.identifier })
          .where(eq(schema.userDiscountCards.id, existing.id))
          .returning();
        upserted = updated;
      } else {
        const [inserted] = await database
          .insert(schema.userDiscountCards)
          .values({
            identifier: input.identifier,
            tenantId: ctx.tenant.id,
            type: input.type,
            userId: ctx.user.id,
          })
          .returning();
        upserted = inserted;
      }

      // Validate immediately via provider adapter
      const { Adapters } = await import('../../discounts/providers');
      const adapter = Adapters[input.type];
      if (!adapter) {
        return upserted;
      }
      const result = await adapter.validate({
        config: provider.config,
        identifier: input.identifier,
      });
      const [updated] = await database
        .update(schema.userDiscountCards)
        .set({
          lastCheckedAt: new Date(),
          metadata: result.metadata,
          status: result.status,
          validFrom: result.validFrom ?? undefined,
          validTo: result.validTo ?? undefined,
        })
        .where(eq(schema.userDiscountCards.id, upserted.id))
        .returning();
      if (updated.status !== 'verified') {
        throw new Error(
          'Card is not active. It is either expired or was not activated on esncard.org',
        );
      }
      return updated;
    }),
});
