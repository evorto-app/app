import { adminRouter } from './admin/admin.router';
import { configRouter } from './core/config.router';
import { registrationOptionRouter } from './core/registration-option.router';
import { discountsRouter } from './discounts/discounts.router';
import { eventRouter } from './events/events.router';
import { financeRouter } from './finance/finance.router';
import { globalAdminRouter } from './global-admin/global-admin.router';
import { iconRouter } from './icons/icons.router';
import { taxRatesRouter } from './tax-rates/tax-rates.router';
import { templateCategoryRouter } from './templates/template-category.router';
import { templateRouter } from './templates/template.router';
import { router } from './trpc-server';
import { userRouter } from './users/users.router';

export const appRouter = router({
  admin: adminRouter,
  config: configRouter,
  discounts: discountsRouter,
  events: eventRouter,
  finance: financeRouter,
  globalAdmin: globalAdminRouter,
  icons: iconRouter,
  registrationOptions: registrationOptionRouter,
  taxRates: taxRatesRouter,
  templateCategories: templateCategoryRouter,
  templates: templateRouter,
  users: userRouter,
});
export type AppRouter = typeof appRouter;
