import { adminRouter } from './admin/admin.router';
import { configRouter } from './core/config.router';
import { eventRouter } from './events/events.router';
import { globalAdminRouter } from './global-admin/global-admin.router';
import { iconRouter } from './icons/icons.router';
import { templateCategoryRouter } from './templates/template-category.router';
import { templateRouter } from './templates/template.router';
import { router } from './trpc-server';
import { userRouter } from './users/users.router';

export const appRouter = router({
  admin: adminRouter,
  config: configRouter,
  events: eventRouter,
  globalAdmin: globalAdminRouter,
  icons: iconRouter,
  templateCategories: templateCategoryRouter,
  templates: templateRouter,
  users: userRouter,
});
export type AppRouter = typeof appRouter;
