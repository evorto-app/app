import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { supportedTenantThemes } from '../../../types/custom/tenant';
import {
  GlobalAdminEmailOutboxKind,
  GlobalAdminEmailOutboxKinds,
  GlobalAdminEmailOutboxRecord,
  GlobalAdminPlatformAuditCursor,
  GlobalAdminTenantCreateInput,
  GlobalAdminTenantUpdateError,
  GlobalAdminTenantUpdateInput,
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
        id: 'email-1',
        kind: 'registrationConfirmed',
        lastAttemptAt: null,
        lastError: null,
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

describe('GlobalAdminPlatformAuditCursor', () => {
  it('accepts the explicit timestamp and id boundary returned by the server', () => {
    expect(
      Schema.decodeUnknownSync(GlobalAdminPlatformAuditCursor)({
        createdAt: '2026-07-15T14:30:00.000Z',
        id: 'audit-50',
      }),
    ).toEqual({
      createdAt: '2026-07-15T14:30:00.000Z',
      id: 'audit-50',
    });
  });

  it('rejects invalid or non-canonical timestamps', () => {
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminPlatformAuditCursor)({
        createdAt: 'not-a-timestamp',
        id: 'audit-50',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminPlatformAuditCursor)({
        createdAt: '2026-07-15T16:30:00.000+02:00',
        id: 'audit-50',
      }),
    ).toThrow();
  });
});

describe('GlobalAdminTenantWriteInput', () => {
  it('accepts every selectable tenant theme', () => {
    for (const theme of supportedTenantThemes) {
      expect(() =>
        Schema.decodeUnknownSync(GlobalAdminTenantWriteInput)({
          ...tenantWriteInput,
          theme,
        }),
      ).not.toThrow();
    }
  });

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
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantUpdateInput)({
        expectedStripeAccountId: 'acct_123',
        id: 'tenant-1',
        reason: 'Requested by tenant support contact',
        tenant: tenantWriteInput,
      }),
    ).not.toThrow();
  });

  it('requires the originally loaded Stripe account on tenant updates', () => {
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantUpdateInput)({
        id: 'tenant-1',
        reason: 'Requested by tenant support contact',
        tenant: tenantWriteInput,
      }),
    ).toThrow();
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
