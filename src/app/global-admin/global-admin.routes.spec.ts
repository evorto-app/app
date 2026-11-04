import { describe, expect, it } from 'vitest';

import { platformAuthorityGuard } from '../core/guards/platform-authority.guard';
import { GLOBAL_ADMIN_ROUTES } from './global-admin.routes';

describe('GLOBAL_ADMIN_ROUTES', () => {
  it('requires explicit platform authority at the route level', () => {
    const shellRoute = GLOBAL_ADMIN_ROUTES.find((route) => route.path === '');

    expect(shellRoute?.canActivate).toEqual([platformAuthorityGuard]);
  });

  it('keeps global-admin child routes under the guarded shell', () => {
    const shellRoute = GLOBAL_ADMIN_ROUTES.find((route) => route.path === '');

    expect(shellRoute?.children?.map((route) => route.path)).toEqual([
      'audit',
      'tenants/create',
      'tenants/:tenantId/edit',
      'tenants/:tenantId/payment-support',
      'tenants/:tenantId',
      'email-outbox',
      'tenants',
    ]);
  });
});
