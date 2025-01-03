import { eq } from 'drizzle-orm';

import { database } from '../../../db';
import { eventTemplateCategories } from '../../../db/schema';
import { publicProcedure, router } from '../trpc-server';

export const templateCategoryRouter = router({
  findMany: publicProcedure.query(async ({ ctx }) => {
    return await database.query.eventTemplateCategories.findMany({
      where: eq(eventTemplateCategories.tenantId, ctx.tenant.id),
    });
  }),
});
