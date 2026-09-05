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

describe('event discovery permissions', () => {
  it('rejects retired listing permissions at both permission boundaries', () => {
    for (const permission of [
      'events:changeListing',
      'events:seeUnlisted',
      'events:viewPublic',
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(PermissionSchema)(permission),
      ).toThrow();
      expect(() =>
        Schema.decodeUnknownSync(TenantRolePermissionSchema)(permission),
      ).toThrow();
    }
  });

  it('exposes announcement discovery as an explicit tenant capability', () => {
    const permission = 'events:changeAnnouncementDiscovery';
    expect(Schema.decodeUnknownSync(PermissionSchema)(permission)).toBe(
      permission,
    );
    expect(
      Schema.decodeUnknownSync(TenantRolePermissionSchema)(permission),
    ).toBe(permission);
    expect(permissionLabel(permission)).toBe(
      'Change who can find announcements',
    );
  });

  it('keeps announcement discovery separate from review and editing', () => {
    expect(
      includesPermission('events:changeAnnouncementDiscovery', [
        'events:changeAnnouncementDiscovery',
      ]),
    ).toBe(true);
    for (const permission of ['events:review', 'events:editAll'] as const) {
      expect(
        includesPermission(permission, ['events:changeAnnouncementDiscovery']),
      ).toBe(false);
    }
    expect(includesPermission('events:seeDrafts', ['events:review'])).toBe(
      true,
    );
  });
});

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
    ).toContain('events:create');
  });
});

describe('TenantRolePermissionSchema', () => {
  it('accepts concrete tenant permissions, tenant wildcards, and legacy tax aliases', () => {
    expect(
      Schema.decodeUnknownSync(Schema.Array(TenantRolePermissionSchema))([
        'events:create',
        'events:*',
        'admin:manageTaxes',
      ]),
    ).toEqual(['events:create', 'events:*', 'admin:manageTaxes']);
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
        'events:create',
        'events:*',
        'globalAdmin:*',
        'globalAdmin:manageTenants',
      ]),
    ).toEqual({
      accepted: ['events:create', 'events:*'],
      rejected: ['globalAdmin:*', 'globalAdmin:manageTenants'],
    });
  });
});

describe('PERMISSION_GROUPS', () => {
  it('describes payment permissions in product language', () => {
    const adminGroup = PERMISSION_GROUPS.find((group) => group.key === 'admin');

    expect(adminGroup?.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'admin:changeSettings',
          label: 'Change organization settings',
        }),
        expect.objectContaining({
          description:
            'View whether paid sign-ups are ready, and manage currency, accepted receipt countries, cancellation refund fees, and ESNcard discounts.',
          key: 'admin:managePayments',
          label: 'Manage payments',
        }),
        expect.objectContaining({
          key: 'admin:tax',
          label: 'Manage tax rates',
        }),
      ]),
    );
  });

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
            'full organization-administrator access',
          ),
          key: 'users:assignRoles',
          label: 'Assign all member roles (organization admin)',
        }),
      ]),
    );
  });

  it('describes Members Hub access in product language', () => {
    const membersHubGroup = PERMISSION_GROUPS.find(
      (group) => group.key === 'internal',
    );

    expect(membersHubGroup).toMatchObject({
      label: 'Members Hub',
      permissions: [
        {
          description:
            'Open Members Hub to see organization roles and members that are marked for display there.',
          key: 'internal:viewInternalPages',
          label: 'View Members Hub',
        },
      ],
    });
  });
});

describe('permissionLabel', () => {
  it('returns admin-facing labels for dependency copy', () => {
    expect(permissionLabel('templates:view')).toBe('View templates');
    expect(permissionLabel('events:seeDrafts')).toBe('See draft events');
    expect(permissionLabel('internal:viewInternalPages')).toBe(
      'View Members Hub',
    );
  });

  it('falls back to the key for technical permissions that are not role-form entries', () => {
    expect(permissionLabel('globalAdmin:manageTenants')).toBe(
      'globalAdmin:manageTenants',
    );
  });
});

describe('includesPermission', () => {
  it('grants payment management without organization settings or tax authority', () => {
    const permission = 'admin:managePayments';
    expect(Schema.decodeUnknownSync(PermissionSchema)(permission)).toBe(
      permission,
    );
    expect(
      Schema.decodeUnknownSync(TenantRolePermissionSchema)(permission),
    ).toBe(permission);
    expect(includesPermission(permission, [permission])).toBe(true);
    expect(includesPermission(permission, ['admin:*'])).toBe(true);
    expect(includesPermission(permission, ['admin:changeSettings'])).toBe(
      false,
    );
    expect(includesPermission('admin:changeSettings', [permission])).toBe(
      false,
    );
    expect(includesPermission('admin:tax', [permission])).toBe(false);
  });

  it('allows direct permissions', () => {
    expect(includesPermission('templates:view', ['templates:view'])).toBe(true);
  });

  it('allows configured permission dependencies', () => {
    expect(includesPermission('templates:view', ['events:create'])).toBe(true);
  });

  it('allows legacy admin tax aliases', () => {
    expect(includesPermission('admin:tax', ['admin:manageTaxes'])).toBe(true);
    expect(includesPermission('admin:*', ['admin:manageTaxes'])).toBe(true);
    expect(includesPermission('admin:manageRoles', ['admin:manageTaxes'])).toBe(
      false,
    );
  });

  it('preserves legacy tax checks when the admin wildcard is granted', () => {
    expect(includesPermission('admin:manageTaxes', ['admin:*'])).toBe(true);
    expect(includesPermission('admin:tax', ['admin:*'])).toBe(true);
    expect(includesPermission('admin:manageTaxes', ['globalAdmin:*'])).toBe(
      false,
    );
  });

  it('keeps implied template access visible through group checks', () => {
    expect(includesPermission('templates:*', ['events:create'])).toBe(true);
    expect(includesPermission('templates:create', ['events:create'])).toBe(
      false,
    );
  });

  it('resolves dependencies of concrete permissions granted by a wildcard', () => {
    expect(includesPermission('templates:view', ['events:*'])).toBe(true);
    expect(includesPermission('templates:*', ['events:*'])).toBe(true);
    expect(includesPermission('templates:create', ['events:*'])).toBe(false);
  });

  it('keeps platform authority separate from tenant permissions', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(includesPermission(permission, ['globalAdmin:*'])).toBe(false);
      expect(
        includesPermission(permission, ['globalAdmin:manageTenants']),
      ).toBe(false);
    }
    expect(
      includesPermission('globalAdmin:manageTenants', ALL_PERMISSIONS),
    ).toBe(false);
    expect(includesPermission('globalAdmin:*', ALL_PERMISSIONS)).toBe(false);
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
