import { describe, expect, it } from '@effect/vitest';
import { Tenant } from '@types/custom/tenant';
import { Schema } from 'effect';

const tenantInput = {
  canonicalRootUrl: 'https://tenant.example.com',
  currency: 'EUR',
  domain: 'tenant.example.com',
  id: 'tenant-1',
  locale: 'de-DE',
  name: 'Tenant',
  stripeAccountId: null,
  theme: 'evorto',
  timezone: 'Europe/Berlin',
};

const omitUndefinedValues = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );

describe('Tenant schema', () => {
  it('requires the persisted canonical root in tenant request context', () => {
    const { canonicalRootUrl: _canonicalRootUrl, ...missingCanonicalRoot } =
      tenantInput;

    expect(() =>
      Schema.decodeUnknownSync(Tenant)(missingCanonicalRoot),
    ).toThrow();
  });

  it('applies secure tenant registration policy defaults', () => {
    const tenant = Schema.decodeUnknownSync(Tenant)(tenantInput);

    expect(tenant).toMatchObject({
      cancellationDeadlineHoursBeforeStart: 120,
      refundFeesOnCancellation: true,
      transferDeadlineHoursBeforeStart: 0,
    });
  });

  it('rejects negative tenant registration policy deadlines', () => {
    expect(() =>
      Schema.decodeUnknownSync(Tenant)({
        ...tenantInput,
        cancellationDeadlineHoursBeforeStart: -1,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Tenant)({
        ...tenantInput,
        transferDeadlineHoursBeforeStart: -1,
      }),
    ).toThrow();
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

  it('normalizes a legacy context locale while retaining a valid IANA timezone', () => {
    const tenant = Schema.decodeUnknownSync(Tenant)({
      ...tenantInput,
      locale: 'en',
      timezone: 'Europe/Amsterdam',
    });

    expect(tenant.locale).toBe('de-DE');
    expect(tenant.timezone).toBe('Europe/Amsterdam');
    expect(Schema.encodeSync(Tenant)(tenant)).toMatchObject({
      locale: 'de-DE',
      timezone: 'Europe/Amsterdam',
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
