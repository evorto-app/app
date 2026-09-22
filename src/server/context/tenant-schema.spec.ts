import { describe, expect, it } from '@effect/vitest';
import { Schema } from 'effect';

import { Tenant } from '../../types/custom/tenant';

const tenantInput = {
  cancellationDeadlineHoursBeforeStart: 120,
  currency: 'EUR',
  discountProviders: {
    esnCard: {
      config: {},
      status: 'disabled',
    },
  },
  domain: 'tenant.example.com',
  id: 'tenant-1',
  maxActiveRegistrationsPerUser: 0,
  name: 'Tenant',
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['DE', 'CZ'],
  },
  refundFeesOnCancellation: true,
  stripeAccountId: null,
  theme: 'evorto',
  timezone: 'Europe/Berlin',
  transferDeadlineHoursBeforeStart: 0,
};

const omitUndefinedValues = (value: object) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );

describe('Tenant schema', () => {
  it('retains explicit tenant registration policies', () => {
    const tenant = Schema.decodeUnknownSync(Tenant)(tenantInput);

    expect(tenant).toMatchObject({
      cancellationDeadlineHoursBeforeStart: 120,
      refundFeesOnCancellation: true,
      transferDeadlineHoursBeforeStart: 0,
    });
  });

  it('requires every persisted tenant registration policy', () => {
    for (const field of [
      'cancellationDeadlineHoursBeforeStart',
      'maxActiveRegistrationsPerUser',
      'refundFeesOnCancellation',
      'transferDeadlineHoursBeforeStart',
    ] as const) {
      const { [field]: _omitted, ...incompleteTenant } = tenantInput;
      expect(() =>
        Schema.decodeUnknownSync(Tenant)(incompleteTenant),
      ).toThrow();
    }
  });

  it('requires persisted tenant policy counts to fit PostgreSQL integers', () => {
    for (const field of [
      'cancellationDeadlineHoursBeforeStart',
      'maxActiveRegistrationsPerUser',
      'transferDeadlineHoursBeforeStart',
    ] as const) {
      for (const value of [-1, 1.5, 2_147_483_648]) {
        expect(() =>
          Schema.decodeUnknownSync(Tenant)({
            ...tenantInput,
            [field]: value,
          }),
        ).toThrow();
      }
    }
  });

  it('accepts tenant context after an undefined default location is omitted from JSON', () => {
    const tenant = Schema.decodeUnknownSync(Tenant)({
      ...tenantInput,
      defaultLocation: null,
    });

    const encodedHeaderPayload = omitUndefinedValues(tenant);

    expect(encodedHeaderPayload).not.toHaveProperty('defaultLocation');
    expect(
      Schema.decodeUnknownSync(Tenant)(encodedHeaderPayload),
    ).toMatchObject({
      defaultLocation: undefined,
      domain: 'tenant.example.com',
      id: 'tenant-1',
    });
  });

  it('encodes a missing default location as null for RPC responses', () => {
    const tenant = Schema.decodeUnknownSync(Tenant)(tenantInput);

    expect(Schema.encodeSync(Tenant)(tenant)).toMatchObject({
      defaultLocation: null,
    });
  });

  it('accepts tenant SEO defaults when present', () => {
    const tenant = Schema.decodeUnknownSync(Tenant)({
      ...tenantInput,
      seoDescription: 'Public tenant description',
      seoTitle: 'Public tenant title',
    });

    expect(Schema.encodeSync(Tenant)(tenant)).toMatchObject({
      seoDescription: 'Public tenant description',
      seoTitle: 'Public tenant title',
    });
  });

  it('accepts tenant legal links when present', () => {
    const tenant = Schema.decodeUnknownSync(Tenant)({
      ...tenantInput,
      legalNoticeText: 'Imprint text',
      legalNoticeUrl: 'https://tenant.example.com/imprint',
      privacyPolicyText: 'Privacy policy text',
      privacyPolicyUrl: 'https://tenant.example.com/privacy',
      termsText: 'Terms text',
      termsUrl: 'https://tenant.example.com/terms',
    });

    expect(Schema.encodeSync(Tenant)(tenant)).toMatchObject({
      legalNoticeText: 'Imprint text',
      legalNoticeUrl: 'https://tenant.example.com/imprint',
      privacyPolicyText: 'Privacy policy text',
      privacyPolicyUrl: 'https://tenant.example.com/privacy',
      termsText: 'Terms text',
      termsUrl: 'https://tenant.example.com/terms',
    });
  });

  it('accepts tenant brand asset URLs when present', () => {
    const tenant = Schema.decodeUnknownSync(Tenant)({
      ...tenantInput,
      faviconUrl: 'https://tenant.example.com/favicon.ico',
      logoUrl: 'https://tenant.example.com/logo.svg',
    });

    expect(Schema.encodeSync(Tenant)(tenant)).toMatchObject({
      faviconUrl: 'https://tenant.example.com/favicon.ico',
      logoUrl: 'https://tenant.example.com/logo.svg',
    });
  });

  it('accepts IANA tenant timezones and rejects invalid timezone names', () => {
    expect(
      Schema.decodeUnknownSync(Tenant)({
        ...tenantInput,
        timezone: 'America/New_York',
      }).timezone,
    ).toBe('America/New_York');

    expect(() =>
      Schema.decodeUnknownSync(Tenant)({
        ...tenantInput,
        timezone: 'not/a-timezone',
      }),
    ).toThrow();
  });

  it('rejects currencies outside the relaunch tenant policy', () => {
    expect(() =>
      Schema.decodeUnknownSync(Tenant)({
        ...tenantInput,
        currency: 'USD',
      }),
    ).toThrow();
  });
});
