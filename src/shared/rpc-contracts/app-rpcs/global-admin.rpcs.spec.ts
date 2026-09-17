import {
  platformTenantSettingsSnapshot,
  TenantSettingsConflictError,
} from '@shared/tenant-settings-snapshot';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  GlobalAdminEmailOutboxKind,
  GlobalAdminEmailOutboxKinds,
  GlobalAdminEmailOutboxRecord,
  GlobalAdminPlatformAuditCursor,
  GlobalAdminPlatformAuditRecord,
  GlobalAdminPlatformAuditState,
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

  it('preserves PostgreSQL microseconds without passing through a Date', () => {
    const cursor = { createdAt: '2026-07-15T14:30:00.123456Z', id: 'audit-50' };
    expect(
      Schema.decodeUnknownSync(GlobalAdminPlatformAuditCursor)(cursor),
    ).toEqual(cursor);
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

describe('GlobalAdminPlatformAuditRecord', () => {
  it('projects persisted audit details through the typed public state', () => {
    const record = Schema.decodeUnknownSync(GlobalAdminPlatformAuditRecord)({
      action: 'taxRates.import',
      actorEmail: 'admin@example.org',
      actorId: 'admin-1',
      after: {
        resourceId: 'tenant-1',
        resourceType: 'taxRateBatch',
        state: {
          providerPayload: 'private',
          taxRateAddedCount: 2,
          taxRateCount: 5,
          taxRateUnchangedCount: 1,
          taxRateUpdatedCount: 2,
        },
      },
      before: null,
      createdAt: '2026-08-06T00:00:00.000Z',
      id: 'audit-1',
      reason: 'Refresh tax rates',
      targetTenantId: 'tenant-1',
      targetTenantName: 'Example organization',
    });

    expect(record.after?.state).toEqual({
      taxRateAddedCount: 2,
      taxRateCount: 5,
      taxRateUnchangedCount: 1,
      taxRateUpdatedCount: 2,
    });
  });
});

describe('GlobalAdminPlatformAuditState role assignment summary', () => {
  it('retains safe role counts while omitting persisted identifiers', () => {
    expect(
      Schema.decodeUnknownSync(GlobalAdminPlatformAuditState)({
        roleAddedCount: 1,
        roleCount: 2,
        roleIds: ['private-role'],
        roleRemovedCount: 0,
        userId: 'private-member',
      }),
    ).toEqual({ roleAddedCount: 1, roleCount: 2, roleRemovedCount: 0 });
  });

  it.each(['roleAddedCount', 'roleRemovedCount'])(
    'rejects invalid %s values',
    (field) => {
      for (const value of [-1, 0.5, Infinity, NaN]) {
        expect(() =>
          Schema.decodeUnknownSync(GlobalAdminPlatformAuditState)({
            [field]: value,
          }),
        ).toThrow();
      }
    },
  );
});

describe('GlobalAdminTenantWriteInput', () => {
  it('requires a snapshot for edits while leaving creation independent', () => {
    const edit = {
      id: 'tenant-1',
      reason: 'Correction',
      tenant: tenantWriteInput,
    };
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantUpdateInput)(edit),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(GlobalAdminTenantUpdateInput)({
        ...edit,
        expectedSettings: platformTenantSettingsSnapshot(tenantWriteInput),
      }),
    ).not.toThrow();
    expect(
      Schema.decodeUnknownSync(GlobalAdminTenantUpdateError)(
        new TenantSettingsConflictError({ message: 'Reload settings' }),
      ),
    ).toMatchObject({ _tag: 'TenantSettingsConflictError' });
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
