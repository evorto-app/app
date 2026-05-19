import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSIONS,
  includesPermission,
  PERMISSION_GROUPS,
  PermissionSchema,
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

  it('keeps ambiguous permissions explicit', () => {
    const usersGroup = PERMISSION_GROUPS.find((group) => group.key === 'users');
    expect(usersGroup?.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'users:assignRoles',
          label: 'Assign user roles',
        }),
      ]),
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
