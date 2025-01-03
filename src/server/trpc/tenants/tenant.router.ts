import { database } from '../../../db';
import { publicProcedure, router } from '../trpc-server';

export const tenantRouter = router({
  findMany: publicProcedure.query(async () => {
    return await database.query.tenants.findMany();
  }),
});
