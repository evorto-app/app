import { financeRouter } from './finance/finance.router';
import { globalAdminRouter } from './global-admin/global-admin.router';
import { router } from './trpc-server';
import { userRouter } from './users/users.router';

export const appRouter = router({
  finance: financeRouter,
  globalAdmin: globalAdminRouter,
  users: userRouter,
});
export type AppRouter = typeof appRouter;
