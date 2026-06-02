import { describe, expect, it } from 'vitest';

import { roleHasPermission } from './role-details.component';

describe('roleHasPermission', () => {
  it('checks permissions from a loaded role without reading query state', () => {
    const role = {
      permissions: ['admin:manageRoles', 'templates:view'],
    } as const;

    expect(roleHasPermission(role, 'admin:manageRoles')).toBe(true);
    expect(roleHasPermission(role, 'events:create')).toBe(false);
  });
});
