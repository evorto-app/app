import { publicProcedure, router } from '../trpc-server';

export const configRouter = router({
  isAuthenticated: publicProcedure.query(
    ({ ctx }) => ctx.authentication.isAuthenticated,
  ),
});
