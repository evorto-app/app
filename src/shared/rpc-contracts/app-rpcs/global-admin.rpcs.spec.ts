import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  GlobalAdminEmailOutboxKind,
  GlobalAdminEmailOutboxKinds,
  GlobalAdminEmailOutboxRecord,
  GlobalAdminTenantCreateInput,
  GlobalAdminTenantUpdateError,
  GlobalAdminTenantUrlMigrationBlockedError,
  GlobalAdminTenantWriteInput,
} from './global-admin.rpcs';

const tenantWriteInput = {
  currency: 'EUR' as const,
  domain: 'tenant.example.com',
  name: 'Tenant',
  stripeAccountId: 'acct_123',
  theme: 'evorto' as const,
  timezone: 'Europe/Berlin' as const,
};

describe('GlobalAdminEmailOutboxKind', () => {
  it('accepts every durable outbox producer kind', () => {
    for (const kind of GlobalAdminEmailOutboxKinds) {
      expect(() =>
        Schema.decodeUnknownSync(GlobalAdminEmailOutboxKind)(kind),
      ).not.toThrow();
    }
  });

  it('rejects outbox kinds outside the durable producer inventory', () => {
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminEmailOutboxKind)('unknownKind'),
    ).toThrow();
  });

  it('requires the owning tenant timezone on operator records', () => {
    expect(
      Schema.decodeUnknownSync(GlobalAdminEmailOutboxRecord)({
        attempts: 0,
        createdAt: '2026-07-15T14:30:00.000Z',
        deliveryUnknownAt: null,
        exhaustedAt: null,
        id: 'email-1',
        kind: 'registrationConfirmed',
        lastAttemptAt: null,
        lastError: null,
        maxAttempts: 8,
        nextAttemptAt: '2026-07-15T14:30:00.000Z',
        provider: null,
        providerMessageId: null,
        recipient: 'member@example.org',
        sentAt: null,
        status: 'queued',
        subject: 'Registration confirmed',
        suppressedAt: null,
        tenantDomain: 'section.example.org',
        tenantId: 'tenant-1',
        tenantName: 'Section',
        tenantTimezone: 'Australia/Brisbane',
        updatedAt: '2026-07-15T14:30:00.000Z',
      }),
    ).toMatchObject({ tenantTimezone: 'Australia/Brisbane' });
  });
});

describe('GlobalAdminTenantWriteInput', () => {
  it('accepts the global-admin tenant create/edit surface', () => {
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantWriteInput)(tenantWriteInput),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantCreateInput)({
        initialPrivacyPolicy: {
          privacyPolicyText: 'Tenant privacy policy',
          privacyPolicyUrl: '',
        },
        reason: 'Requested by tenant support contact',
        tenant: tenantWriteInput,
      }),
    ).not.toThrow();
  });

  it('requires a primary domain on tenant writes', () => {
    const { domain: _domain, ...missingDomain } = tenantWriteInput;

    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantWriteInput)(missingDomain),
    ).toThrow();
  });

  it('rejects unsupported tenant runtime settings', () => {
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantWriteInput)({
        ...tenantWriteInput,
        currency: 'USD',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantWriteInput)({
        ...tenantWriteInput,
        timezone: 'not-a-timezone',
      }),
    ).toThrow();
  });

  it('requires a bounded reason for every tenant mutation', () => {
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantCreateInput)({
        initialPrivacyPolicy: {
          privacyPolicyText: 'Tenant privacy policy',
          privacyPolicyUrl: '',
        },
        reason: '',
        tenant: tenantWriteInput,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantCreateInput)({
        initialPrivacyPolicy: {
          privacyPolicyText: 'Tenant privacy policy',
          privacyPolicyUrl: '',
        },
        reason: 'x'.repeat(501),
        tenant: tenantWriteInput,
      }),
    ).toThrow();
  });
});

describe('GlobalAdminTenantUrlMigrationBlockedError', () => {
  it('preserves typed active-link blockers across the global-admin RPC boundary', () => {
    const error = new GlobalAdminTenantUrlMigrationBlockedError({
      activeRegistrationTransfers: true,
      message:
        'Organization public URL cannot change while issued links are active',
      pendingStripeObligations: false,
      reason:
        "Complete or cancel every active registration transfer before changing the organization's public URL.",
      tenantId: 'tenant-1',
    });

    expect(
      Schema.decodeUnknownSync(GlobalAdminTenantUpdateError)(error),
    ).toMatchObject({
      _tag: 'GlobalAdminTenantUrlMigrationBlockedError',
      activeRegistrationTransfers: true,
      pendingStripeObligations: false,
      tenantId: 'tenant-1',
    });
  });
});
