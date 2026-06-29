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

  it('accepts tenant legal links when present', () => {
    const tenant = Schema.decodeUnknownSync(Tenant)({
      ...tenantInput,
      legalNoticeUrl: 'https://tenant.example.com/imprint',
      privacyPolicyUrl: 'https://tenant.example.com/privacy',
      termsUrl: 'https://tenant.example.com/terms',
    });

    expect(Schema.encodeSync(Tenant)(tenant)).toMatchObject({
      legalNoticeUrl: 'https://tenant.example.com/imprint',
      privacyPolicyUrl: 'https://tenant.example.com/privacy',
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
});
