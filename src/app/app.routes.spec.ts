import { describe, expect, it } from 'vitest';

import { routes } from './app.routes';
import { authGuard } from './core/guards/auth.guard';
import { userAccountGuard } from './core/guards/user-account.guard';

describe('app routes', () => {
  const routeFor = (path: string) =>
    routes.find((route) => route.path === path);

  it('keeps public event browsing available while still checking assigned accounts for authenticated users', () => {
    expect(routeFor('events')?.canActivate).toEqual([userAccountGuard]);
  });

  it.each(['templates', 'internal', 'profile', 'admin', 'finance', 'scan'])(
    'requires an assigned authenticated account before loading /%s',
    (path) => {
      expect(routeFor(path)?.canActivate).toEqual([
        userAccountGuard,
        authGuard,
      ]);
    },
  );

  it('keeps create-account reachable for authenticated users without a tenant assignment', () => {
    expect(routeFor('create-account')?.canActivate).toEqual([authGuard]);
  });

  it('keeps global-admin available to authenticated global admins before tenant assignment checks', () => {
    expect(routeFor('global-admin')?.canActivate).toEqual([authGuard]);
  });

  it.each(['legal/imprint', 'legal/privacy', 'legal/terms'])(
    'keeps /%s publicly reachable for tenant-hosted legal pages',
    (path) => {
      expect(routeFor(path)?.canActivate).toBeUndefined();
    },
  );
});
