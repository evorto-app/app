import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { supportedTenantThemes } from '../../../types/custom/tenant';
import {
  GlobalAdminEmailOutboxKind,
  GlobalAdminEmailOutboxKinds,
  GlobalAdminEmailOutboxRecord,
  GlobalAdminPlatformAuditCursor,
  GlobalAdminPlatformAuditRecord,
  GlobalAdminTenantCreateInput,
  GlobalAdminTenantRecord,
  GlobalAdminTenantUpdateError,
  GlobalAdminTenantUpdateInput,
  GlobalAdminTenantUrlMigrationBlockedError,
  GlobalAdminTenantWriteInput,
} from './global-admin.rpcs';

const tenantWriteInput = {
  currency: 'EUR' as const,
  domain: 'tenant.example.com',
  name: 'Tenant',
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
        recordIncomplete: false,
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
        id: 'tenant-1',
        reason: 'Requested by tenant support contact',
        tenant: tenantWriteInput,
      }),
    ).not.toThrow();
  });

  it('refuses removed payment-account fields at the tenant RPC boundary', () => {
    for (const legacyPayload of [
      {
        expectedStripeAccountId: 'acct_legacy',
        id: 'tenant-1',
        reason: 'Update the organization address',
        tenant: tenantWriteInput,
      },
      {
        id: 'tenant-1',
        reason: 'Update the organization address',
        tenant: {
          ...tenantWriteInput,
          stripeAccountId: 'acct_legacy',
        },
      },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(GlobalAdminTenantUpdateInput)(legacyPayload),
      ).toThrow();
    }
  });

  it('returns payment readiness without the payment-account identifier', () => {
    const decoded = Schema.decodeUnknownSync(GlobalAdminTenantRecord)({
      currency: 'EUR',
      domain: 'tenant.example.com',
      id: 'tenant-1',
      name: 'Tenant',
      paymentsConfigured: true,
      stripeAccountId: 'acct_server_only',
      theme: 'evorto',
      timezone: 'Europe/Berlin',
    });

    expect(decoded.paymentsConfigured).toBe(true);
    expect(decoded).not.toHaveProperty('stripeAccountId');
  });

  it('keeps internal identifiers out of audit records and snapshots', () => {
    const decoded = Schema.decodeUnknownSync(GlobalAdminPlatformAuditRecord)({
      action: 'tenant.update',
      actorEmail: 'Evorto operations',
      actorId: 'operations:payment-setup',
      after: {
        resourceId: 'tenant-1',
        resourceType: 'tenant',
        state: {
          currency: 'EUR',
          domain: 'tenant.example.com',
          id: 'tenant-1',
          name: 'Tenant',
          paymentsConfigured: true,
          stripeAccountId: 'acct_server_only',
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
      },
      before: null,
      createdAt: '2026-08-03T12:00:00.000Z',
      id: 'audit-1',
      reason: 'Enable paid sign-ups',
      targetTenantId: 'tenant-1',
      targetTenantName: 'Tenant',
    });

    expect(decoded.after?.state).not.toHaveProperty('stripeAccountId');
    expect(decoded.after).not.toHaveProperty('resourceId');
    expect(decoded).not.toHaveProperty('actorId');
    expect(decoded).not.toHaveProperty('targetTenantId');
  });

  it('drops broad provider records at the audit transport boundary', () => {
    const decoded = Schema.decodeUnknownSync(GlobalAdminPlatformAuditRecord)({
      action: 'taxRates.import',
      actorEmail: 'Evorto operations',
      after: {
        resourceId: 'internal-tax-rate-batch',
        resourceType: 'taxRateBatch',
        state: {
          rates: [
            {
              displayName: 'Standard',
              stripeAccountId: 'acct_server_only',
              stripeTaxRateId: 'txr_server_only',
            },
          ],
          taxRateCount: 1,
          taxRateUpdatedCount: 1,
        },
      },
      before: null,
      createdAt: '2026-08-03T12:00:00.000Z',
      id: 'audit-1',
      reason: 'Add the current tax rates',
      targetTenantName: 'Tenant',
    });

    expect(decoded.after?.state).toEqual({
      taxRateCount: 1,
      taxRateUpdatedCount: 1,
    });
    expect(JSON.stringify(decoded)).not.toContain('acct_server_only');
    expect(JSON.stringify(decoded)).not.toContain('txr_server_only');
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
