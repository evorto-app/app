import { router } from '../trpc-server';
import { tenantRouter } from './tenant.router';

export const adminRouter = router({
  tenant: tenantRouter,
});
