import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { PROVIDERS } from '../../discounts/providers';
import { authenticatedProcedure, router } from '../trpc-server';

export const discountsRouter = router({
  deleteMyCard: authenticatedProcedure
    .input(Schema.standardSchemaV1(Schema.Struct({ type: Schema.Literal('esnCard') })))
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
    const config = (tenant as any)?.discountProviders ?? {};
    // Normalize to full providers list
    return (Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]).map(
      (type) => {
        const entry = (config?.[type] ?? {}) as any;
        // Backwards compatibility: map legacy { status } to new { enabled }
        const enabled = typeof entry.enabled === 'boolean' ? entry.enabled : entry.status === 'enabled';
        return {
          config: entry?.config ?? {},
          enabled,
          type,
        } as const;
      },
    );
  }),

  refreshMyCard: authenticatedProcedure
    .input(Schema.standardSchemaV1(Schema.Struct({ type: Schema.Literal('esnCard') })))
    .mutation(async ({ ctx, input }) => {
      const tenant = await database.query.tenants.findFirst({
        where: { id: ctx.tenant.id },
      });
      const providers = (tenant as any)?.discountProviders ?? {};
      const provider = providers?.[input.type] as any;
      if (!provider || provider.enabled !== true) {
        throw new Error('Provider not enabled for this tenant');
      }
      const card = await database.query.userDiscountCards.findFirst({
        where: { tenantId: ctx.tenant.id, type: input.type, userId: ctx.user.id },
      });
      if (!card) throw new Error('No card on file');
      const adapter = (await import('../../discounts/providers')).Adapters[input.type];
      if (!adapter) return card;
      const result = await adapter.validate({ config: provider.config, identifier: card.identifier });
      return (
        await database
          .update(schema.userDiscountCards)
          .set({
            lastCheckedAt: new Date(),
            metadata: result.metadata as any,
            status: result.status as any,
            validFrom: result.validFrom ?? null,
            validTo: result.validTo ?? null,
          })
          .where(eq(schema.userDiscountCards.id, card.id))
          .returning()
      )[0];
    }),

  setTenantProviders: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:changeSettings'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          providers: Schema.Array(
            Schema.Struct({
              config: Schema.Any,
              enabled: Schema.Boolean,
              type: Schema.Literal(...Object.keys(PROVIDERS) as any),
            }),
          ),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const tenant = await database.query.tenants.findFirst({
        where: { id: ctx.tenant.id },
      });
      const current = ((tenant as any)?.discountProviders ?? {}) as Record<
        string,
        { config: unknown; enabled: boolean } & { status?: 'disabled' | 'enabled' }
      >;
      const updated = { ...current } as Record<string, any>;
      for (const p of input.providers) {
        updated[p.type] = { config: p.config, enabled: p.enabled } as any;
      }
      await database
        .update(schema.tenants)
        .set({ discountProviders: updated as any })
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
      const providers = (tenant as any)?.discountProviders ?? {};
      const provider = providers?.[input.type] as any;
      if (!provider || provider.enabled !== true) {
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
      const upserted = existing
        ? (
            await database
              .update(schema.userDiscountCards)
              .set({ identifier: input.identifier })
              .where(eq(schema.userDiscountCards.id, existing.id))
              .returning()
          )[0]
        : (
            await database
              .insert(schema.userDiscountCards)
              .values({
                identifier: input.identifier,
                tenantId: ctx.tenant.id,
                type: input.type,
                userId: ctx.user.id,
              })
              .returning()
          )[0];

      // Validate immediately via provider adapter
      const adapter = (await import('../../discounts/providers')).Adapters[input.type];
      if (!adapter) {
        return upserted;
      }
      const result = await adapter.validate({ config: provider.config, identifier: input.identifier });
      const [updated] =
        await database
          .update(schema.userDiscountCards)
          .set({
            lastCheckedAt: new Date(),
            metadata: result.metadata as any,
            status: result.status as any,
            validFrom: result.validFrom ?? null,
            validTo: result.validTo ?? null,
          })
          .where(eq(schema.userDiscountCards.id, upserted.id))
          .returning()
      ;
      if (updated.status !== 'verified') {
        throw new Error(
          'Card is not active. It is either expired or was not activated on esncard.org',
        );
      }
      return updated;
    }),
});
