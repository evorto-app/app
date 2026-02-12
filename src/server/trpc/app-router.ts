import { eventRouter } from './events/events.router';
import { financeRouter } from './finance/finance.router';
import { globalAdminRouter } from './global-admin/global-admin.router';
import { templateRouter } from './templates/template.router';
import { router } from './trpc-server';
import { userRouter } from './users/users.router';

export const appRouter = router({
  events: eventRouter,
  finance: financeRouter,
  globalAdmin: globalAdminRouter,
  templates: templateRouter,
  users: userRouter,
});
export type AppRouter = typeof appRouter;
