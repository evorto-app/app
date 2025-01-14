import { router } from '../trpc-server';
import { tenantRouter } from './tenant.router';

export const globalAdminRouter = router({
  tenants: tenantRouter,
});
