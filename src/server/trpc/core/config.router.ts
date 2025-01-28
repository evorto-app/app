import { publicProcedure, router } from '../trpc-server';

export const configRouter = router({
  isAuthenticated: publicProcedure.query(
    ({ ctx }) => ctx.authentication.isAuthenticated,
  ),
  permissions: publicProcedure.query(({ ctx }) => ctx.user?.permissions ?? []),
  tenant: publicProcedure.query(({ ctx }) => ctx.tenant),
});
