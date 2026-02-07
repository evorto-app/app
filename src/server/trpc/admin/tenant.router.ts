import {
  resolveTenantReceiptSettings,
  type TenantDiscountProviders,
} from '@shared/tenant-config';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { stripe } from '../../stripe-client';
import { normalizeEsnCardConfig } from '../discounts/discount-provider-config';
import { authenticatedProcedure, router } from '../trpc-server';

export const tenantRouter = router({
  currentSettings: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:changeSettings'] })
    .query(async ({ ctx }) => {
      const tenant = await database.query.tenants.findFirst({
        where: {
          id: ctx.tenant.id,
        },
      });

      return tenant;
    }),

  importStripeTaxRates: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:tax'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({ ids: Schema.Array(Schema.NonEmptyString) }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const stripeAccount = ctx.tenant.stripeAccountId;
      if (!stripeAccount) return;
      for (const id of input.ids) {
        const r = await stripe.taxRates.retrieve(id, undefined, {
          stripeAccount,
        });
        if (!r.inclusive) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Tax rate ${id} is not inclusive and cannot be imported`,
          });
        }
        const existing = await database.query.tenantStripeTaxRates.findFirst({
          where: {
            stripeTaxRateId: id,
            tenantId: ctx.tenant.id,
          },
        });
        const values = {
          active: !!r.active,
          country: r.country ?? undefined,
          displayName: r.display_name ?? undefined,
          inclusive: !!r.inclusive,
          percentage: String(r.percentage ?? ''),
          state: r.state ?? undefined,
          stripeTaxRateId: r.id,
          tenantId: ctx.tenant.id,
        } satisfies Omit<typeof schema.tenantStripeTaxRates.$inferInsert, 'id'>;
        await (existing
          ? database
              .update(schema.tenantStripeTaxRates)
              .set(values)
              .where(eq(schema.tenantStripeTaxRates.id, existing.id))
          : database.insert(schema.tenantStripeTaxRates).values(values));
      }
    }),

  listImportedTaxRates: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:tax'] })
    .query(async ({ ctx }) => {
      return database.query.tenantStripeTaxRates.findMany({
        where: { tenantId: ctx.tenant.id },
      });
    }),

  listStripeTaxRates: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:tax'] })
    .query(async ({ ctx }) => {
      const stripeAccount = ctx.tenant.stripeAccountId;
      if (!stripeAccount) {
        return [] as {
          active?: boolean;
          country?: string;
          displayName?: string;
          id: string;
          inclusive?: boolean;
          percentage?: number;
          state?: string;
        }[];
      }
      const [activeRates, archivedRates] = await Promise.all([
        stripe.taxRates.list({ active: true, limit: 100 }, { stripeAccount }),
        stripe.taxRates.list({ active: false, limit: 100 }, { stripeAccount }),
      ]);
      const mapRate = (r: (typeof activeRates)['data'][number]) => ({
        active: r.active ?? undefined,
        country: r.country ?? undefined,
        displayName: r.display_name ?? undefined,
        id: r.id,
        inclusive: r.inclusive ?? undefined,
        percentage: r.percentage ?? undefined,
        state: r.state ?? undefined,
      });
      return [
        ...activeRates.data.map((rate) => mapRate(rate)),
        ...archivedRates.data.map((rate) => mapRate(rate)),
      ];
    }),

  updateSettings: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:changeSettings'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          allowOther: Schema.Boolean,
          buyEsnCardUrl: Schema.optional(Schema.String),
          defaultLocation: Schema.NullOr(Schema.Any),
          esnCardEnabled: Schema.Boolean,
          receiptCountries: Schema.Array(Schema.NonEmptyString),
          theme: Schema.mutable(Schema.Literal('evorto', 'esn')),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const discountProviders: TenantDiscountProviders = {
        esnCard: {
          config: normalizeEsnCardConfig(
            { buyEsnCardUrl: input.buyEsnCardUrl },
            { rejectInvalidUrl: true },
          ),
          status: input.esnCardEnabled ? 'enabled' : 'disabled',
        },
      };

      const tenant = await database
        .update(schema.tenants)
        .set({
          defaultLocation: input.defaultLocation,
          discountProviders,
          receiptSettings: resolveTenantReceiptSettings({
            allowOther: input.allowOther,
            receiptCountries: input.receiptCountries,
          }),
          theme: input.theme,
        })
        .where(eq(schema.tenants.id, ctx.tenant.id))
        .returning()
        .then((result) => result[0]);

      return tenant;
    }),
});
