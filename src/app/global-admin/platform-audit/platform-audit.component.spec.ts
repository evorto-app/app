import { describe, expect, it } from 'vitest';

import {
  platformAuditActionLabel,
  platformAuditTargetLabel,
} from './platform-audit.component';

describe('platformAuditActionLabel', () => {
  it('uses plain operational labels for each application audit action', () => {
    expect(platformAuditActionLabel('tenant.create')).toBe('Tenant created');
    expect(platformAuditActionLabel('tenant.update')).toBe(
      'Tenant settings updated',
    );
    expect(platformAuditActionLabel('refundClaim.requeue')).toBe(
      'Registration refund requeued',
    );
  });

  it('uses a snapshot tenant name when present and safely falls back to the id', () => {
    expect(
      platformAuditTargetLabel({
        after: {
          resourceId: 'tenant-1',
          resourceType: 'tenant',
          state: { id: 'tenant-1', name: 'Target tenant' },
        },
        before: null,
        targetTenantId: 'tenant-1',
      }),
    ).toBe('Target tenant (tenant-1)');
    expect(
      platformAuditTargetLabel({
        after: {
          resourceId: 'event-1',
          resourceType: 'event',
          state: { id: 'event-1', status: 'APPROVED' },
        },
        before: {
          resourceId: 'event-1',
          resourceType: 'event',
          state: { id: 'event-1', status: 'PENDING_REVIEW' },
        },
        targetTenantId: 'tenant-1',
      }),
    ).toBe('tenant-1');
  });
});
