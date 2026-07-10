import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSIONS,
  includesPermission,
  partitionTenantRolePermissions,
  PERMISSION_GROUPS,
  permissionLabel,
  PermissionSchema,
  TenantRolePermissionSchema,
} from './permissions';

describe('PermissionSchema', () => {
  it('encodes permissions as their string literal values', () => {
    const encoded = Schema.encodeSync(Schema.Array(PermissionSchema))([
      'admin:manageRoles',
      'globalAdmin:manageTenants',
    ]);

    expect(encoded).toEqual(['admin:manageRoles', 'globalAdmin:manageTenants']);
  });

  it('decodes every configured permission', () => {
    expect(
      Schema.decodeUnknownSync(Schema.Array(PermissionSchema))([
        ...ALL_PERMISSIONS,
        'admin:manageTaxes',
        'globalAdmin:*',
        'globalAdmin:manageTenants',
      ]),
    ).toContain('events:viewPublic');
  });
});

describe('TenantRolePermissionSchema', () => {
  it('accepts concrete tenant permissions, tenant wildcards, and legacy tax aliases', () => {
    expect(
      Schema.decodeUnknownSync(Schema.Array(TenantRolePermissionSchema))([
        'events:viewPublic',
        'events:*',
        'admin:manageTaxes',
      ]),
    ).toEqual(['events:viewPublic', 'events:*', 'admin:manageTaxes']);
  });

  it('rejects both platform-global permissions', () => {
    for (const permission of ['globalAdmin:*', 'globalAdmin:manageTenants']) {
      expect(() =>
        Schema.decodeUnknownSync(TenantRolePermissionSchema)(permission),
      ).toThrow();
    }
  });

  it('partitions only platform-global permissions from stored tenant roles', () => {
    expect(
      partitionTenantRolePermissions([
        'events:viewPublic',
        'events:*',
        'globalAdmin:*',
        'globalAdmin:manageTenants',
      ]),
    ).toEqual({
      accepted: ['events:viewPublic', 'events:*'],
      rejected: ['globalAdmin:*', 'globalAdmin:manageTenants'],
    });
  });
});

describe('PERMISSION_GROUPS', () => {
  it('defines admin-facing labels and descriptions for every visible permission', () => {
    for (const permission of PERMISSION_GROUPS.flatMap(
      (group) => group.permissions,
    )) {
      expect(permission.label).not.toContain(':');
      expect(permission.label.trim().length).toBeGreaterThan(0);
      expect(permission.description?.trim().length).toBeGreaterThan(0);
    }
  });

  it('describes the implemented role-assignment capability explicitly', () => {
    const usersGroup = PERMISSION_GROUPS.find((group) => group.key === 'users');
    expect(usersGroup?.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: expect.stringContaining(
            'full tenant-administrator authority',
          ),
          key: 'users:assignRoles',
          label: 'Assign all user roles (tenant admin)',
        }),
      ]),
    );
  });
});

describe('permissionLabel', () => {
  it('returns admin-facing labels for dependency copy', () => {
    expect(permissionLabel('templates:view')).toBe('View templates');
    expect(permissionLabel('events:seeDrafts')).toBe('See draft events');
  });

  it('falls back to the key for technical permissions that are not role-form entries', () => {
    expect(permissionLabel('globalAdmin:manageTenants')).toBe(
      'globalAdmin:manageTenants',
    );
  });
});

describe('includesPermission', () => {
  it('allows direct permissions', () => {
    expect(includesPermission('templates:view', ['templates:view'])).toBe(true);
  });

  it('allows configured permission dependencies', () => {
    expect(includesPermission('templates:view', ['events:create'])).toBe(true);
  });

  it('allows legacy admin tax aliases', () => {
    expect(includesPermission('admin:tax', ['admin:manageTaxes'])).toBe(true);
  });

  it('allows group wildcard checks against concrete permissions', () => {
    expect(includesPermission('templates:*', ['templates:view'])).toBe(true);
  });

  it('allows concrete permission checks against granted group wildcards', () => {
    expect(
      includesPermission('globalAdmin:manageTenants', ['globalAdmin:*']),
    ).toBe(true);
  });

  it('rejects unrelated permissions', () => {
    expect(includesPermission('templates:create', ['templates:view'])).toBe(
      false,
    );
  });
});
