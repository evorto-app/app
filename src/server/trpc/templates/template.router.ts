import { eq } from 'drizzle-orm';

import { database } from '../../../db';
import { eventTemplates } from '../../../db/schema';
import { publicProcedure, router } from '../trpc-server';

export const templateRouter = router({
  findMany: publicProcedure.query(async ({ ctx }) => {
    return await database.query.eventTemplates.findMany({
      where: eq(eventTemplates.tenantId, ctx.tenant.id),
    });
  }),
  groupedByCategory: publicProcedure.query(async ({ ctx }) => {
    return await database.query.eventTemplateCategories.findMany({
      where: eq(eventTemplates.tenantId, ctx.tenant.id),
      with: {
        templates: true,
      },
    });
  }),
});
