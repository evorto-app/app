import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { describe, expect, it } from 'vitest';

import { PermissionsService } from '../permissions.service';
import { permissionGuard } from './permission.guard';

const routeWithData = (
  data: ActivatedRouteSnapshot['data'],
): ActivatedRouteSnapshot => ({ data }) as ActivatedRouteSnapshot;

const routerState = (url: string): RouterStateSnapshot =>
  ({ url }) as RouterStateSnapshot;

describe('permissionGuard', () => {
  it('redirects denied child routes to the root not-allowed page', () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: PermissionsService,
          useValue: {
            hasPermissionSync: () => false,
          } satisfies Pick<PermissionsService, 'hasPermissionSync'>,
        },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      permissionGuard(
        routeWithData({ permissions: ['admin:manageRoles'] }),
        routerState('/admin/roles'),
      ),
    );

    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      '/403?originalPath=%2Fadmin%2Froles',
    );
  });

  it('allows routes when every required permission is available', () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: PermissionsService,
          useValue: {
            hasPermissionSync: () => true,
          } satisfies Pick<PermissionsService, 'hasPermissionSync'>,
        },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      permissionGuard(
        routeWithData({ permissions: ['admin:manageRoles'] }),
        routerState('/admin/roles'),
      ),
    );

    expect(result).toBe(true);
  });
});
