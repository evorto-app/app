import {
  adminTenantAppearanceSettingsSnapshot,
  adminTenantLegalSettingsSnapshot,
  adminTenantOrganizationSettingsSnapshot,
  adminTenantPaymentProviderSettingsSnapshot,
  adminTenantRegistrationSettingsSnapshot,
} from '@shared/tenant-settings-snapshot';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { Tenant } from '../../../types/custom/tenant';
import { AdminRoleWriteRpcError } from './admin.errors';
import {
  AdminRolesCreateInput,
  AdminRolesUpdateInput,
  AdminTenantBrandAssetKind,
  AdminTenantUpdateAppearanceSettingsInput,
  AdminTenantUpdateLegalSettingsInput,
  AdminTenantUpdateOrganizationSettingsInput,
  AdminTenantUpdatePaymentProviderSettingsInput,
  AdminTenantUpdateRegistrationSettingsInput,
} from './admin.rpcs';

const currentRoleInput = {
  defaultOrganizerRole: false,
  defaultUserRole: true,
  description: 'Default tenant member',
  displayInHub: true,
  name: 'Member',
  permissions: ['events:create', 'events:*'],
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

const originalTenant = Schema.decodeUnknownSync(Tenant)({
  cancellationDeadlineHoursBeforeStart: 120,
  currency: 'EUR',
  discountProviders: { esnCard: { config: {}, status: 'disabled' } },
  domain: 'tenant.example.test',
  id: 'tenant-1',
  maxActiveRegistrationsPerUser: 0,
  name: 'Tenant',
  receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
  refundFeesOnCancellation: true,
  theme: 'evorto',
  timezone: 'Europe/Berlin',
  transferDeadlineHoursBeforeStart: 0,
});

const currentAppearanceSettingsInput = {
  expectedSettings: adminTenantAppearanceSettingsSnapshot(originalTenant),
  faviconUrl: 'https://cdn.example.org/favicon.ico',
  logoUrl: 'https://cdn.example.org/logo.svg',
  seoDescription: 'Public organization description',
  seoTitle: 'Public organization title',
  theme: 'esn' as const,
};

const currentLegalSettingsInput = {
  expectedSettings: adminTenantLegalSettingsSnapshot(originalTenant),
  legalNoticeText: 'Organization imprint text',
  legalNoticeUrl: 'https://section.example.org/imprint',
  termsText: 'Organization terms text',
  termsUrl: 'https://section.example.org/terms',
};

const currentOrganizationSettingsInput = {
  defaultLocation: null,
  emailSenderEmail: 'events@section.example.org',
  emailSenderName: 'Example Section',
  expectedSettings: adminTenantOrganizationSettingsSnapshot(originalTenant),
  timezone: 'Europe/Berlin' as const,
};

const currentPaymentProviderSettingsInput = {
  allowOther: true,
  buyEsnCardUrl: 'https://esncard.org/',
  currency: 'EUR' as const,
  esnCardEnabled: true,
  expectedSettings: adminTenantPaymentProviderSettingsSnapshot(originalTenant),
  receiptCountries: ['DE', 'NL'],
  refundFeesOnCancellation: true,
};

const currentRegistrationSettingsInput = {
  cancellationDeadlineHoursBeforeStart: 120,
  expectedSettings: adminTenantRegistrationSettingsSnapshot(originalTenant),
  maxActiveRegistrationsPerUser: 4,
  transferDeadlineHoursBeforeStart: 0,
};

describe('tenant settings input schemas', () => {
  it('accepts each complete focused settings section', () => {
    for (const [schema, input] of [
      [
        AdminTenantUpdateAppearanceSettingsInput,
        currentAppearanceSettingsInput,
      ],
      [AdminTenantUpdateLegalSettingsInput, currentLegalSettingsInput],
      [
        AdminTenantUpdateOrganizationSettingsInput,
        currentOrganizationSettingsInput,
      ],
      [
        AdminTenantUpdatePaymentProviderSettingsInput,
        currentPaymentProviderSettingsInput,
      ],
      [
        AdminTenantUpdateRegistrationSettingsInput,
        currentRegistrationSettingsInput,
      ],
    ] as const) {
      expect(() => Schema.decodeUnknownSync(schema)(input)).not.toThrow();
    }
  });

  it('refuses removed payment-account fields on settings updates', () => {
    for (const removedField of [
      { expectedStripeAccountId: 'acct_server_only' },
      { stripeAccountId: 'acct_server_only' },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(AdminTenantUpdatePaymentProviderSettingsInput)(
          {
            ...currentPaymentProviderSettingsInput,
            ...removedField,
          },
        ),
      ).toThrow();
    }
  });

  it('validates focused organization and registration values', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateOrganizationSettingsInput)({
        ...currentOrganizationSettingsInput,
        emailSenderEmail: 'not-an-email-address',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateRegistrationSettingsInput)({
        ...currentRegistrationSettingsInput,
        maxActiveRegistrationsPerUser: -1,
      }),
    ).toThrow();
  });

  it('accepts uploaded organization brand asset paths', () => {
    const decoded = Schema.decodeUnknownSync(
      AdminTenantUpdateAppearanceSettingsInput,
    )({
      ...currentAppearanceSettingsInput,
      faviconUrl: '/tenant-assets/tenant-1/favicon/favicon.ico',
      logoUrl: '/tenant-assets/tenant-1/logo/logo.svg',
    });

    expect(decoded.faviconUrl).toBe(
      '/tenant-assets/tenant-1/favicon/favicon.ico',
    );
    expect(decoded.logoUrl).toBe('/tenant-assets/tenant-1/logo/logo.svg');
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

describe('preserved focused settings contract boundaries', () => {
  const sections = [
    [AdminTenantUpdateAppearanceSettingsInput, currentAppearanceSettingsInput],
    [AdminTenantUpdateLegalSettingsInput, currentLegalSettingsInput],
    [
      AdminTenantUpdateOrganizationSettingsInput,
      currentOrganizationSettingsInput,
    ],
    [
      AdminTenantUpdatePaymentProviderSettingsInput,
      currentPaymentProviderSettingsInput,
    ],
    [
      AdminTenantUpdateRegistrationSettingsInput,
      currentRegistrationSettingsInput,
    ],
  ] as const;

  it('requires the original section snapshot and rejects extra snapshot fields', () => {
    for (const [schema, input] of sections) {
      const { expectedSettings: _original, ...missing } = input;
      expect(() => Schema.decodeUnknownSync(schema)(missing)).toThrow();
      for (const extra of [
        { stripeAccountId: 'acct_private' },
        { unexpected: true },
      ]) {
        expect(() =>
          Schema.decodeUnknownSync(schema)({
            ...input,
            expectedSettings: { ...input.expectedSettings, ...extra },
          }),
        ).toThrow();
      }
    }
  });

  it('rejects payment account edits and unknown fields before a settings write', () => {
    for (const [schema, input] of sections) {
      for (const extra of [
        { stripeAccountId: 'acct_private' },
        { unexpected: true },
      ]) {
        expect(() =>
          Schema.decodeUnknownSync(schema)({ ...input, ...extra }),
        ).toThrow();
        expect(() =>
          Schema.decodeUnknownSync(Schema.toCodecJson(schema))({
            ...input,
            ...extra,
          }),
        ).toThrow();
      }
    }
  });

  it('keeps locale outside tenant-admin writes', () => {
    for (const [schema, input] of sections) {
      expect(() =>
        Schema.decodeUnknownSync(schema)({ ...input, locale: 'en-US' }),
      ).toThrow();
      expect(() =>
        Schema.decodeUnknownSync(Schema.toCodecJson(schema))({
          ...input,
          locale: 'en-US',
        }),
      ).toThrow();
    }
  });

  it('keeps deferred custom-domain fields outside the current update payload', () => {
    for (const [schema, input] of sections) {
      expect(() =>
        Schema.decodeUnknownSync(schema)({
          ...input,
          customDomain: 'section.example.org',
        }),
      ).toThrow();
      expect(() =>
        Schema.decodeUnknownSync(Schema.toCodecJson(schema))({
          ...input,
          customDomain: 'section.example.org',
        }),
      ).toThrow();
    }
  });

  it('round-trips optional settings and location fields through the RPC codec', () => {
    const organizationCodec = Schema.toCodecJson(
      AdminTenantUpdateOrganizationSettingsInput,
    );
    const encodedOrganization = Schema.encodeUnknownSync(organizationCodec)({
      ...currentOrganizationSettingsInput,
      defaultLocation: {
        address: undefined,
        coordinates: { lat: 52, lng: 13 },
        name: 'Meeting point',
        placeId: 'place-1',
        type: 'google',
      },
      emailSenderEmail: undefined,
    });
    expect(encodedOrganization).not.toHaveProperty('stripeAccountId');
    const decodedOrganization =
      Schema.decodeUnknownSync(organizationCodec)(encodedOrganization);
    expect(decodedOrganization.emailSenderEmail).toBeUndefined();
    expect(decodedOrganization.defaultLocation?.address).toBeUndefined();
    expect(decodedOrganization).toMatchObject({
      defaultLocation: {
        coordinates: { lat: 52, lng: 13 },
        name: 'Meeting point',
      },
    });
    const paymentCodec = Schema.toCodecJson(
      AdminTenantUpdatePaymentProviderSettingsInput,
    );
    const encodedPayment = Schema.encodeUnknownSync(paymentCodec)({
      ...currentPaymentProviderSettingsInput,
      buyEsnCardUrl: undefined,
    });
    expect(encodedPayment).not.toHaveProperty('stripeAccountId');
    expect(encodedPayment).not.toHaveProperty('buyEsnCardUrl');
    expect(
      Schema.decodeUnknownSync(paymentCodec)(encodedPayment).buyEsnCardUrl,
    ).toBeUndefined();
  });

  it('accepts the Classic theme and rejects fractional or out-of-range policy counts', () => {
    expect(
      Schema.decodeUnknownSync(AdminTenantUpdateAppearanceSettingsInput)({
        ...currentAppearanceSettingsInput,
        theme: 'classic',
      }).theme,
    ).toBe('classic');
    for (const field of [
      'cancellationDeadlineHoursBeforeStart',
      'maxActiveRegistrationsPerUser',
      'transferDeadlineHoursBeforeStart',
    ]) {
      for (const value of [-1, 1.5, 2_147_483_648]) {
        expect(() =>
          Schema.decodeUnknownSync(AdminTenantUpdateRegistrationSettingsInput)({
            ...currentRegistrationSettingsInput,
            [field]: value,
          }),
        ).toThrow();
      }
      expect(
        Schema.decodeUnknownSync(AdminTenantUpdateRegistrationSettingsInput)({
          ...currentRegistrationSettingsInput,
          [field]: 2_147_483_647,
        }),
      ).toMatchObject({ [field]: 2_147_483_647 });
    }
  });

  it('rejects empty, duplicate and unsupported receipt countries', () => {
    for (const receiptCountries of [[], ['DE', 'DE'], ['de'], ['invalid']]) {
      expect(() =>
        Schema.decodeUnknownSync(AdminTenantUpdatePaymentProviderSettingsInput)(
          {
            ...currentPaymentProviderSettingsInput,
            receiptCountries,
          },
        ),
      ).toThrow();
    }
  });

  it('accepts a canonical Google default location', () => {
    const defaultLocation = {
      address: 'Alexanderplatz, Berlin, Germany',
      coordinates: { lat: 52.5219, lng: 13.4132 },
      name: 'Alexanderplatz',
      placeId: 'place-alexanderplatz',
      type: 'google',
    };
    expect(
      Schema.decodeUnknownSync(AdminTenantUpdateOrganizationSettingsInput)({
        ...currentOrganizationSettingsInput,
        defaultLocation,
      }).defaultLocation,
    ).toEqual(defaultLocation);
  });

  it('rejects malformed Google default locations at the RPC boundary', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateOrganizationSettingsInput)({
        ...currentOrganizationSettingsInput,
        defaultLocation: {
          coordinates: { lat: '52.5219', lng: 13.4132 },
          name: 'Alexanderplatz',
          placeId: 'place-alexanderplatz',
          type: 'google',
        },
      }),
    ).toThrow();
  });

  it('rejects unsupported themes', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateAppearanceSettingsInput)({
        ...currentAppearanceSettingsInput,
        theme: 'custom',
      }),
    ).toThrow();
  });

  it('accepts supported currency and IANA timezone settings', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdatePaymentProviderSettingsInput)({
        ...currentPaymentProviderSettingsInput,
        currency: 'AUD',
      }),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateOrganizationSettingsInput)({
        ...currentOrganizationSettingsInput,
        timezone: 'America/New_York',
      }),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdatePaymentProviderSettingsInput)({
        ...currentPaymentProviderSettingsInput,
        currency: 'USD',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateOrganizationSettingsInput)({
        ...currentOrganizationSettingsInput,
        timezone: 'not/a-timezone',
      }),
    ).toThrow();
  });

  it('rejects negative registration transfer and cancellation deadlines', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateRegistrationSettingsInput)({
        ...currentRegistrationSettingsInput,
        transferDeadlineHoursBeforeStart: -1,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateRegistrationSettingsInput)({
        ...currentRegistrationSettingsInput,
        cancellationDeadlineHoursBeforeStart: -1,
      }),
    ).toThrow();
  });

  it('keeps non-brand tenant URLs absolute', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateLegalSettingsInput)({
        ...currentLegalSettingsInput,
        termsUrl: '/tenant-assets/tenant-1/terms.pdf',
      }),
    ).toThrow();
  });
});
