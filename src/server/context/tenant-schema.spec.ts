import { describe, expect, it } from '@effect/vitest';
import { Tenant } from '@types/custom/tenant';
import { Schema } from 'effect';

const tenantInput = {
  currency: 'EUR',
  domain: 'tenant.example.com',
  id: 'tenant-1',
  locale: 'en-GB',
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

  it('accepts tenant email sender name when present', () => {
    const tenant = Schema.decodeUnknownSync(Tenant)({
      ...tenantInput,
      emailSenderName: 'Example Section',
    });

    expect(Schema.encodeSync(Tenant)(tenant)).toMatchObject({
      emailSenderName: 'Example Section',
    });
  });

  it('accepts tenant registration limit policy when present', () => {
    const tenant = Schema.decodeUnknownSync(Tenant)({
      ...tenantInput,
      registrationLimitCount: 4,
      registrationLimitWindowDays: 30,
    });

    expect(Schema.encodeSync(Tenant)(tenant)).toMatchObject({
      registrationLimitCount: 4,
      registrationLimitWindowDays: 30,
    });
  });

  it('defaults tenant operations policy to the conservative relaunch settings', () => {
    expect(Schema.decodeUnknownSync(Tenant)(tenantInput)).toMatchObject({
      eventReviewPolicy: 'review_required',
      stripeAccountManagement: 'platform_managed',
    });
  });

  it('accepts explicit tenant operations policy settings when present', () => {
    const tenant = Schema.decodeUnknownSync(Tenant)({
      ...tenantInput,
      eventReviewPolicy: 'organizer_self_publish',
      stripeAccountManagement: 'tenant_admin_managed',
    });

    expect(Schema.encodeSync(Tenant)(tenant)).toMatchObject({
      eventReviewPolicy: 'organizer_self_publish',
      stripeAccountManagement: 'tenant_admin_managed',
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

  it('normalizes legacy context locale and timezone values to supported tenant settings', () => {
    const tenant = Schema.decodeUnknownSync(Tenant)({
      ...tenantInput,
      locale: 'en',
      timezone: 'Europe/Amsterdam',
    });

    expect(tenant.locale).toBe('en-GB');
    expect(tenant.timezone).toBe('Europe/Berlin');
    expect(Schema.encodeSync(Tenant)(tenant)).toMatchObject({
      locale: 'en-GB',
      timezone: 'Europe/Berlin',
    });
  });

  it('rejects locale and timezone values outside the relaunch tenant policy', () => {
    expect(() =>
      Schema.decodeUnknownSync(Tenant)({
        ...tenantInput,
        locale: 'de-DE',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Tenant)({
        ...tenantInput,
        timezone: 'America/New_York',
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
