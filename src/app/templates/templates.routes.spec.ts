import { describe, expect, it } from 'vitest';

import { permissionGuard } from '../core/guards/permission.guard';
import { TEMPLATE_ROUTES } from './templates.routes';

describe('TEMPLATE_ROUTES', () => {
  const shellRoute = TEMPLATE_ROUTES.find((route) => route.path === '');

  it('guards the template shell with template view access', () => {
    expect(shellRoute?.canActivate).toContain(permissionGuard);
    expect(shellRoute?.loadComponent).toBeDefined();
    expect(shellRoute?.data).toEqual({ permissions: ['templates:view'] });
  });

  it.each([
    {
      path: 'create',
      permissions: ['templates:create', 'templates:view'],
    },
    {
      path: 'create/:categoryId',
      permissions: ['templates:create', 'templates:view'],
    },
    {
      path: ':templateId/edit',
      permissions: ['templates:editAll', 'templates:view'],
    },
    {
      path: ':templateId/create-event',
      permissions: ['events:create'],
    },
  ])(
    'guards $path with its write-route permission',
    ({ path, permissions }) => {
      const childRoute = shellRoute?.children?.find(
        (route) => route.path === path,
      );

      expect(childRoute?.canActivate).toContain(permissionGuard);
      expect(childRoute?.data).toEqual({ permissions });
    },
  );

  it.each(['categories', ':templateId'])(
    'leaves read route %s available to authenticated template users',
    (path) => {
      const childRoute = shellRoute?.children?.find(
        (route) => route.path === path,
      );

      expect(childRoute?.canActivate).toBeUndefined();
      expect(childRoute?.data).toBeUndefined();
    },
  );
});
