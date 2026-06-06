import { describe, expect, it } from 'vitest';

import { permissionGuard } from '../core/guards/permission.guard';
import { ADMIN_ROUTES } from './admin.routes';

describe('ADMIN_ROUTES', () => {
  const shellRoute = ADMIN_ROUTES.find((route) => route.path === '');

  it('requires at least one admin child permission at the route shell', () => {
    expect(shellRoute?.canActivate).toContain(permissionGuard);
    expect(shellRoute?.loadComponent).toBeDefined();
    expect(shellRoute?.data).toEqual({
      anyPermissions: [
        'admin:manageRoles',
        'admin:changeSettings',
        'admin:tax',
        'users:viewAll',
        'events:review',
      ],
    });
  });

  it.each([
    { path: 'roles', permissions: ['admin:manageRoles'] },
    { path: 'roles/create', permissions: ['admin:manageRoles'] },
    { path: 'roles/:roleId', permissions: ['admin:manageRoles'] },
    { path: 'roles/:roleId/edit', permissions: ['admin:manageRoles'] },
    { path: 'settings', permissions: ['admin:changeSettings'] },
    { path: 'tax-rates', permissions: ['admin:tax'] },
    { path: 'users', permissions: ['users:viewAll'] },
    { path: 'event-reviews', permissions: ['events:review'] },
  ])(
    'guards $path with its child admin permission',
    ({ path, permissions }) => {
      const childRoute = shellRoute?.children?.find(
        (route) => route.path === path,
      );

      expect(childRoute?.canActivate).toContain(permissionGuard);
      expect(childRoute?.data).toEqual({ permissions });
    },
  );
});
