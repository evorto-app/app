import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { supportedTenantThemes } from '../../../types/custom/tenant';
import { maximumPostgresInteger } from '../../schema-utilities';
import { AdminRoleWriteRpcError } from './admin.errors';
import {
  AdminRolesCreateInput,
  AdminRolesUpdateInput,
  AdminTenantBrandAssetKind,
  AdminTenantImportStripeTaxRatesInput,
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

const currentAppearanceSettingsInput = {
  faviconUrl: 'https://cdn.example.org/favicon.ico',
  logoUrl: 'https://cdn.example.org/logo.svg',
  seoDescription: 'Public tenant description',
  seoTitle: 'Public tenant title',
  theme: 'esn' as const,
};

const currentLegalSettingsInput = {
  legalNoticeText: 'Tenant imprint text',
  legalNoticeUrl: 'https://section.example.org/imprint',
  termsText: 'Tenant terms text',
  termsUrl: 'https://section.example.org/terms',
};

const currentOrganizationSettingsInput = {
  defaultLocation: null,
  emailSenderEmail: 'events@section.example.org',
  emailSenderName: 'Example Section',
  timezone: 'Europe/Berlin' as const,
};

const currentPaymentProviderSettingsInput = {
  allowOther: true,
  buyEsnCardUrl: 'https://esncard.org/',
  currency: 'EUR' as const,
  esnCardEnabled: true,
  receiptCountries: ['DE', 'NL'],
  refundFeesOnCancellation: true,
};

const currentRegistrationSettingsInput = {
  cancellationDeadlineHoursBeforeStart: 120,
  maxActiveRegistrationsPerUser: 4,
  transferDeadlineHoursBeforeStart: 0,
};

describe('tenant settings input schemas', () => {
  it('accepts the default, classic Evorto, and ESN themes', () => {
    for (const theme of supportedTenantThemes) {
      expect(() =>
        Schema.decodeUnknownSync(AdminTenantUpdateAppearanceSettingsInput)({
          ...currentAppearanceSettingsInput,
          theme,
        }),
      ).not.toThrow();
    }
  });

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

    const decoded = Schema.decodeUnknownSync(
      AdminTenantUpdateOrganizationSettingsInput,
    )({
      ...currentOrganizationSettingsInput,
      defaultLocation,
    });

    expect(decoded.defaultLocation).toEqual(defaultLocation);
  });

  it('rejects malformed Google default locations at the RPC boundary', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateOrganizationSettingsInput)({
        ...currentOrganizationSettingsInput,
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

  it('requires canonical supported receipt country codes', () => {
    for (const receiptCountries of [['de'], ['US', 'XX']]) {
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

  it('rejects invalid sender email settings', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateOrganizationSettingsInput)({
        ...currentOrganizationSettingsInput,
        emailSenderEmail: 'not-an-email-address',
      }),
    ).toThrow();
  });

  it('rejects negative active-registration limits', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateRegistrationSettingsInput)({
        ...currentRegistrationSettingsInput,
        maxActiveRegistrationsPerUser: -1,
      }),
    ).toThrow();
  });

  it('rejects fractional and out-of-range registration-policy limits', () => {
    for (const field of [
      'cancellationDeadlineHoursBeforeStart',
      'maxActiveRegistrationsPerUser',
      'transferDeadlineHoursBeforeStart',
    ] as const) {
      expect(() =>
        Schema.decodeUnknownSync(AdminTenantUpdateRegistrationSettingsInput)({
          ...currentRegistrationSettingsInput,
          [field]: 1.5,
        }),
      ).toThrow();
      expect(() =>
        Schema.decodeUnknownSync(AdminTenantUpdateRegistrationSettingsInput)({
          ...currentRegistrationSettingsInput,
          [field]: maximumPostgresInteger + 1,
        }),
      ).toThrow();
    }
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

  it('keeps deferred custom-domain fields outside the current update payload', () => {
    const decoded = Schema.decodeUnknownSync(
      AdminTenantUpdateOrganizationSettingsInput,
    )({
      ...currentOrganizationSettingsInput,
      customDomain: 'section.example.org',
    });

    expect(decoded).toEqual(currentOrganizationSettingsInput);
  });

  it('accepts uploaded tenant brand asset paths', () => {
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

  it('keeps non-brand tenant URLs absolute', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantUpdateLegalSettingsInput)({
        ...currentLegalSettingsInput,
        termsUrl: '/tenant-assets/tenant-1/terms.pdf',
      }),
    ).toThrow();
  });
});

describe('AdminTenantImportStripeTaxRatesInput', () => {
  it('requires between one and one hundred tax-rate IDs', () => {
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantImportStripeTaxRatesInput)({
        ids: [],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdminTenantImportStripeTaxRatesInput)({
        ids: Array.from({ length: 101 }, (_, index) => `txr_${index}`),
      }),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(AdminTenantImportStripeTaxRatesInput)({
        ids: ['txr_1'],
      }),
    ).toEqual({ ids: ['txr_1'] });
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
