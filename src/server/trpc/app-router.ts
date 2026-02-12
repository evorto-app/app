import { discountsRouter } from './discounts/discounts.router';
import { editorMediaRouter } from './editor-media/editor-media.router';
import { eventRouter } from './events/events.router';
import { financeRouter } from './finance/finance.router';
import { globalAdminRouter } from './global-admin/global-admin.router';
import { taxRatesRouter } from './tax-rates/tax-rates.router';
import { templateRouter } from './templates/template.router';
import { router } from './trpc-server';
import { userRouter } from './users/users.router';

export const appRouter = router({
  discounts: discountsRouter,
  editorMedia: editorMediaRouter,
  events: eventRouter,
  finance: financeRouter,
  globalAdmin: globalAdminRouter,
  taxRates: taxRatesRouter,
  templates: templateRouter,
  users: userRouter,
});
export type AppRouter = typeof appRouter;
