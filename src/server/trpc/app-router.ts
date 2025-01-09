import { configRouter } from './core/config.router';
import { eventRouter } from './events/events.router';
import { iconRouter } from './icons/icons.router';
import { templateCategoryRouter } from './templates/template-category.router';
import { templateRouter } from './templates/template.router';
import { tenantRouter } from './tenants/tenant.router';
import { router } from './trpc-server';

export const appRouter = router({
  config: configRouter,
  events: eventRouter,
  icons: iconRouter,
  templateCategories: templateCategoryRouter,
  templates: templateRouter,
  tenants: tenantRouter,
});
export type AppRouter = typeof appRouter;
