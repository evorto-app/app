import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import type { Permission } from '../../shared/permissions/permissions';

import { ConfigService } from './config.service';
import { PermissionsService } from './permissions.service';

describe('PermissionsService', () => {
  it('reads current config permissions instead of a stale constructor snapshot', () => {
    const permissions = signal<Permission[]>([]);

    TestBed.configureTestingModule({
      providers: [
        PermissionsService,
        {
          provide: ConfigService,
          useValue: {
            get permissions() {
              return permissions();
            },
            permissionsSignal: permissions,
          } satisfies Pick<ConfigService, 'permissions' | 'permissionsSignal'>,
        },
      ],
    });

    const service = TestBed.inject(PermissionsService);

    expect(service.hasPermissionSync('globalAdmin:manageTenants')).toBe(false);

    permissions.set(['globalAdmin:manageTenants']);

    expect(service.hasPermissionSync('globalAdmin:manageTenants')).toBe(true);
    expect(service.hasPermission('globalAdmin:manageTenants')()).toBe(true);
  });
});
