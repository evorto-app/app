import { router } from '../trpc-server';
import { roleRouter } from './role.router';

export const adminRouter = router({
  roles: roleRouter,
});
