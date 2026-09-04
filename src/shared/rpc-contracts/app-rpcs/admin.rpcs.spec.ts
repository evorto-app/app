import {
  AdminTenantSettingsSnapshot,
  adminTenantSettingsSnapshot,
  TenantSettingsConflictError,
} from '@shared/tenant-settings-snapshot';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { Tenant } from '../../../types/custom/tenant';
import { AdminRoleWriteRpcError, AdminTenantRpcError } from './admin.errors';
import {
  AdminRolesCreateInput,
  AdminRolesUpdateInput,
  AdminTenantBrandAssetKind,
  AdminTenantUpdateSettingsInput,
} from './admin.rpcs';

const currentRoleInput = {
  defaultOrganizerRole: false,
  defaultUserRole: true,
  description: 'Default tenant member',
  displayInHub: true,
  name: 'Member',
  permissions: ['events:viewPublic', 'events:*'],
};

describe('admin role input schemas', () => {
  it('accepts tenant-scoped role permissions for create and update', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminRolesCreateInput)(currentRoleInput),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdminRolesUpdateInput)({
        ...currentRoleInput,
        id: 'role-1',
      }),
    ).not.toThrow();
  });

  it('keeps known permissions structural so the server can return a typed validation error', () => {
    for (const permission of ['globalAdmin:*', 'globalAdmin:manageTenants']) {
      expect(() =>
        Schema.decodeUnknownSync(AdminRolesCreateInput)({
          ...currentRoleInput,
          defaultUserRole: true,
          permissions: [permission],
        }),
      ).not.toThrow();
      expect(() =>
        Schema.decodeUnknownSync(AdminRolesUpdateInput)({
          ...currentRoleInput,
          id: 'role-1',
          permissions: [permission],
        }),
      ).not.toThrow();
    }
  });

  it('declares validation and duplicate-name errors on the role RPC channel', () => {
    expect(
      Schema.decodeUnknownSync(AdminRoleWriteRpcError)({
        _tag: 'RoleWriteValidationError',
        field: 'name',
        message: 'Role name is required',
      })._tag,
    ).toBe('RoleWriteValidationError');
    expect(
      Schema.decodeUnknownSync(AdminRoleWriteRpcError)({
        _tag: 'RoleNameAlreadyExistsError',
        message: 'A role named Member already exists',
        name: 'Member',
      })._tag,
    ).toBe('RoleNameAlreadyExistsError');
  });
});

const currentTenantSettingsInput = {
  allowOther: true,
  buyEsnCardUrl: 'https://esncard.org/',
  cancellationDeadlineHoursBeforeStart: 120,
  currency: 'EUR' as const,
  defaultLocation: null,
  emailSenderEmail: 'events@section.example.org',
  emailSenderName: 'Example Section',
  esnCardEnabled: true,
  expectedSettings: adminTenantSettingsSnapshot(
    Schema.decodeUnknownSync(Tenant)({
      cancellationDeadlineHoursBeforeStart: 120,
      currency: 'EUR',
      discountProviders: { esnCard: { config: {}, status: 'disabled' } },
      domain: 'example.org',
      id: 'tenant-1',
      maxActiveRegistrationsPerUser: 0,
      name: 'Tenant',
      receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
      refundFeesOnCancellation: true,
      stripeAccountId: 'acct_private_snapshot',
      theme: 'evorto',
      timezone: 'Europe/Berlin',
      transferDeadlineHoursBeforeStart: 0,
    }),
  ),
  faviconUrl: 'https://cdn.example.org/favicon.ico',
  legalNoticeText: 'Tenant imprint text',
  legalNoticeUrl: 'https://section.example.org/imprint',
  logoUrl: 'https://cdn.example.org/logo.svg',
  maxActiveRegistrationsPerUser: 4,
  receiptCountries: ['DE', 'NL'],
  refundFeesOnCancellation: true,
  seoDescription: 'Public tenant description',
  seoTitle: 'Public tenant title',
  termsText: 'Tenant terms text',
  termsUrl: 'https://section.example.org/terms',
  theme: 'esn' as const,
  timezone: 'Europe/Berlin' as const,
  transferDeadlineHoursBeforeStart: 0,
};

describe('AdminTenantUpdateSettingsInput', () => {
  it('rejects payment account edits and unknown fields before a settings write', () => {
    for (const extra of [
      { stripeAccountId: 'acct_private' },
      { unexpected: true },
      {
        expectedSettings: {
          ...currentTenantSettingsInput.expectedSettings,
          stripeAccountId: 'acct_private',
        },
      },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
          ...currentTenantSettingsInput,
          ...extra,
        }),
      ).toThrow();
    }
  });

  it('round-trips optional settings and location fields through the RPC codec', () => {
    const defaultLocation = {
      address: undefined,
      coordinates: { lat: 52, lng: 13 },
      name: 'Meeting point',
      placeId: 'place-1',
      type: 'google' as const,
    };
    const input = {
      ...currentTenantSettingsInput,
      buyEsnCardUrl: undefined,
      defaultLocation,
      expectedSettings: {
        ...currentTenantSettingsInput.expectedSettings,
        defaultLocation,
      },
    };
    const encoded = Schema.encodeUnknownSync(AdminTenantUpdateSettingsInput)(
      input,
    );
    expect(encoded).not.toHaveProperty('stripeAccountId');
    expect(encoded).not.toHaveProperty('expectedSettings.stripeAccountId');
    expect(JSON.stringify(encoded)).not.toContain('acct_private_snapshot');
    expect(encoded).toMatchObject({ buyEsnCardUrl: null });
    const decoded = Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)(
      encoded,
    );
    expect(
      Schema.toEquivalence(AdminTenantSettingsSnapshot)(
        decoded.expectedSettings,
        input.expectedSettings,
      ),
    ).toBe(true);
    expect(decoded.buyEsnCardUrl).toBeUndefined();
    expect(decoded.defaultLocation?.address).toBeUndefined();
    expect(decoded).toMatchObject({
      defaultLocation: {
        coordinates: { lat: 52, lng: 13 },
        name: 'Meeting point',
      },
    });
  });

  it('requires the original editable snapshot and preserves typed conflicts', () => {
    const { expectedSettings: _snapshot, ...missingSnapshot } =
      currentTenantSettingsInput;
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)(missingSnapshot),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(AdminTenantRpcError)(
        new TenantSettingsConflictError({ message: 'Reload settings' }),
      ),
    ).toMatchObject({ _tag: 'TenantSettingsConflictError' });
  });
  it('compares nested settings structurally, independently of JSON property order', () => {
    const snapshot = currentTenantSettingsInput.expectedSettings;
    const equivalent = {
      ...snapshot,
      receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
    };
    const equal = Schema.toEquivalence(AdminTenantSettingsSnapshot);
    expect(equal(snapshot, equivalent)).toBe(true);
    expect(
      equal(snapshot, {
        ...equivalent,
        receiptSettings: { ...equivalent.receiptSettings, allowOther: true },
      }),
    ).toBe(false);
  });
  it('accepts the Classic theme and rejects fractional or out-of-range policy counts', () => {
    expect(
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        theme: 'classic',
      }).theme,
    ).toBe('classic');
    for (const field of [
      'cancellationDeadlineHoursBeforeStart',
      'maxActiveRegistrationsPerUser',
      'transferDeadlineHoursBeforeStart',
    ]) {
      for (const value of [-1, 1.5, 2_147_483_648])
        expect(() =>
          Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
            ...currentTenantSettingsInput,
            [field]: value,
          }),
        ).toThrow();
    }
  });
  it('rejects empty, duplicate and unsupported receipt countries', () => {
    for (const receiptCountries of [[], ['DE', 'DE'], ['de'], ['invalid']])
      expect(() =>
        Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
          ...currentTenantSettingsInput,
          receiptCountries,
        }),
      ).toThrow();
  });

  it('accepts the current tenant general-settings surface', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)(
        currentTenantSettingsInput,
      ),
    ).not.toThrow();
  });

  it('accepts a canonical Google default location', () => {
    const defaultLocation = {
      address: 'Alexanderplatz, Berlin, Germany',
      coordinates: {
        lat: 52.5219,
        lng: 13.4132,
      },
      name: 'Alexanderplatz',
      placeId: 'place-alexanderplatz',
      type: 'google' as const,
    };

    const decoded = Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
      ...currentTenantSettingsInput,
      defaultLocation,
    });

    expect(decoded.defaultLocation).toEqual(defaultLocation);
  });

  it('rejects malformed Google default locations at the RPC boundary', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        defaultLocation: {
          coordinates: {
            lat: '52.5219',
            lng: 13.4132,
          },
          name: 'Alexanderplatz',
          placeId: 'place-alexanderplatz',
          type: 'google',
        },
      }),
    ).toThrow();
  });

  it('rejects unsupported themes', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        theme: 'custom',
      }),
    ).toThrow();
  });

  it('accepts supported currency and IANA timezone settings', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        currency: 'AUD',
        timezone: 'America/New_York',
      }),
    ).not.toThrow();

    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        currency: 'USD',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        timezone: 'not/a-timezone',
      }),
    ).toThrow();
  });

  it('keeps locale outside tenant-admin writes', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        locale: 'en-US',
      }),
    ).toThrow();
  });

  it('rejects invalid sender email settings', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        emailSenderEmail: 'not-an-email-address',
      }),
    ).toThrow();
  });

  it('rejects negative active-registration limits', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        maxActiveRegistrationsPerUser: -1,
      }),
    ).toThrow();
  });

  it('rejects negative registration transfer and cancellation deadlines', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        transferDeadlineHoursBeforeStart: -1,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        cancellationDeadlineHoursBeforeStart: -1,
      }),
    ).toThrow();
  });

  it('keeps deferred custom-domain fields outside the current update payload', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        customDomain: 'section.example.org',
      }),
    ).toThrow();
  });

  it('accepts uploaded tenant brand asset paths', () => {
    const decoded = Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
      ...currentTenantSettingsInput,
      faviconUrl: '/tenant-assets/tenant-1/favicon/favicon.ico',
      logoUrl: '/tenant-assets/tenant-1/logo/logo.svg',
    });

    expect(decoded.faviconUrl).toBe(
      '/tenant-assets/tenant-1/favicon/favicon.ico',
    );
    expect(decoded.logoUrl).toBe('/tenant-assets/tenant-1/logo/logo.svg');
  });

  it('keeps non-brand tenant URLs absolute', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
        ...currentTenantSettingsInput,
        termsUrl: '/tenant-assets/tenant-1/terms.pdf',
      }),
    ).toThrow();
  });
});

describe('AdminTenantBrandAssetKind', () => {
  it('accepts the supported tenant branding upload targets', () => {
    expect(Schema.decodeUnknownSync(AdminTenantBrandAssetKind)('logo')).toBe(
      'logo',
    );
    expect(Schema.decodeUnknownSync(AdminTenantBrandAssetKind)('favicon')).toBe(
      'favicon',
    );
  });

  it('rejects unsupported tenant branding upload targets', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantBrandAssetKind)('hero'),
    ).toThrow();
  });
});
