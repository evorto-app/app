import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ALL_PERMISSIONS, PermissionSchema } from './permissions';

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
