import { financeRouter } from './finance/finance.router';
import { router } from './trpc-server';

export const appRouter = router({
  finance: financeRouter,
});
export type AppRouter = typeof appRouter;
