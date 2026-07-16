import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  AdminRolesCreateInput,
  AdminRolesUpdateInput,
  AdminTenantBrandAssetKind,
  AdminTenantUpdateSettingsInput,
} from './admin.rpcs';

const currentRoleInput = {
  collapseMembersInHup: false,
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

  it('rejects platform-global permissions on create and update', () => {
    for (const permission of ['globalAdmin:*', 'globalAdmin:manageTenants']) {
      expect(() =>
        Schema.decodeUnknownSync(AdminRolesCreateInput)({
          ...currentRoleInput,
          defaultUserRole: true,
          permissions: [permission],
        }),
      ).toThrow();
      expect(() =>
        Schema.decodeUnknownSync(AdminRolesUpdateInput)({
          ...currentRoleInput,
          id: 'role-1',
          permissions: [permission],
        }),
      ).toThrow();
    }
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
  faviconUrl: 'https://cdn.example.org/favicon.ico',
  legalNoticeText: 'Tenant imprint text',
  legalNoticeUrl: 'https://section.example.org/imprint',
  logoUrl: 'https://cdn.example.org/logo.svg',
  maxActiveRegistrationsPerUser: 4,
  receiptCountries: ['DE', 'NL'],
  refundFeesOnCancellation: true,
  seoDescription: 'Public tenant description',
  seoTitle: 'Public tenant title',
  stripeAccountId: 'acct_123',
  termsText: 'Tenant terms text',
  termsUrl: 'https://section.example.org/terms',
  theme: 'esn' as const,
  timezone: 'Europe/Berlin' as const,
  transferDeadlineHoursBeforeStart: 0,
};

describe('AdminTenantUpdateSettingsInput', () => {
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
    const decoded = Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
      ...currentTenantSettingsInput,
      locale: 'en-US',
    });

    expect(decoded).not.toHaveProperty('locale');
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
    const decoded = Schema.decodeUnknownSync(AdminTenantUpdateSettingsInput)({
      ...currentTenantSettingsInput,
      customDomain: 'section.example.org',
    });

    expect(decoded).toEqual(currentTenantSettingsInput);
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
