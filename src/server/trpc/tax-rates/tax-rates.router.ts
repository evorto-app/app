import { TRPCError } from '@trpc/server';

import { database } from '../../../db';
import { publicProcedure, router } from '../trpc-server';

export const taxRatesRouter = router({
  // Public endpoint to list active, inclusive imported tax rates for current tenant
  // If a user is authenticated, require they have permission to view templates
  listActive: publicProcedure
    .use(async ({ ctx, next }) => {
      const perms = ctx.user?.permissions ?? [];
      if (ctx.user && !perms.includes('templates:view')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: "Missing 'templates:view' permission",
        });
      }
      return next();
    })
    .query(async ({ ctx }) => {
      return database.query.tenantStripeTaxRates.findMany({
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
          tenantId: ctx.tenant.id,
        },
      });
    }),
});
