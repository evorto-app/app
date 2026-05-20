import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import type { Permission } from '../../shared/permissions/permissions';

import { ConfigService } from './config.service';
import { PermissionsService } from './permissions.service';

describe('PermissionsService', () => {
  it('reads current config permissions instead of a stale constructor snapshot', () => {
    let permissions: Permission[] = [];

    TestBed.configureTestingModule({
      providers: [
        PermissionsService,
        {
          provide: ConfigService,
          useValue: {
            get permissions() {
              return permissions;
            },
          } satisfies Pick<ConfigService, 'permissions'>,
        },
      ],
    });

    const service = TestBed.inject(PermissionsService);

    expect(service.hasPermissionSync('globalAdmin:manageTenants')).toBe(false);

    permissions = ['globalAdmin:manageTenants'];

    expect(service.hasPermissionSync('globalAdmin:manageTenants')).toBe(true);
  });
});
