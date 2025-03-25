import { router } from '../trpc-server';
import { roleRouter } from './role.router';
import { tenantRouter } from './tenant.router';

export const adminRouter = router({
  roles: roleRouter,
  tenant: tenantRouter,
});
