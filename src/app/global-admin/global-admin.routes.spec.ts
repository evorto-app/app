import { describe, expect, it } from 'vitest';

import { permissionGuard } from '../core/guards/permission.guard';
import { GLOBAL_ADMIN_ROUTES } from './global-admin.routes';

describe('GLOBAL_ADMIN_ROUTES', () => {
  it('requires global tenant-management permission at the route level', () => {
    const shellRoute = GLOBAL_ADMIN_ROUTES.find((route) => route.path === '');

    expect(shellRoute?.canActivate).toContain(permissionGuard);
    expect(shellRoute?.data).toEqual({
      permissions: ['globalAdmin:manageTenants'],
    });
  });

  it('keeps global-admin child routes under the guarded shell', () => {
    const shellRoute = GLOBAL_ADMIN_ROUTES.find((route) => route.path === '');

    expect(shellRoute?.children?.map((route) => route.path)).toEqual([
      'tenants/create',
      'tenants/:tenantId/edit',
      'tenants/:tenantId',
      'email-outbox',
      'tenants',
    ]);
  });
});
