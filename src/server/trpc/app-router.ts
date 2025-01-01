import { tenantRouter } from './tenants/tenant.router';
import { router } from './trpc-server';

export const appRouter = router({
  tenants: tenantRouter,
});
export type AppRouter = typeof appRouter;
