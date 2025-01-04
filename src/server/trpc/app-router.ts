import { configRouter } from './core/config.router';
import { templateCategoryRouter } from './templates/template-category.router';
import { templateRouter } from './templates/template.router';
import { tenantRouter } from './tenants/tenant.router';
import { router } from './trpc-server';

export const appRouter = router({
  config: configRouter,
  templateCategories: templateCategoryRouter,
  templates: templateRouter,
  tenants: tenantRouter,
});
export type AppRouter = typeof appRouter;
