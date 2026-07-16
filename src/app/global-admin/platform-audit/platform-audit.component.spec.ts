import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  platformAuditActionLabel,
  platformAuditSnapshotRows,
  platformAuditTargetLabel,
} from './platform-audit.component';

describe('platformAuditActionLabel', () => {
  it('uses plain operational labels for each application audit action', () => {
    expect(platformAuditActionLabel('tenant.create')).toBe(
      'Organization created',
    );
    expect(platformAuditActionLabel('tenant.update')).toBe(
      'Organization settings updated',
    );
    expect(platformAuditActionLabel('refundClaim.requeue')).toBe(
      'Registration refund requeued',
    );
  });

  it('keeps raw errors and actor identifiers out of the audit page', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-audit/platform-audit.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-audit/platform-audit.component.html',
      ),
      'utf8',
    );

    expect(source).not.toContain('getErrorMessage');
    expect(template).not.toContain('errorMessage(');
    expect(template).not.toContain('entry.actorId');
    expect(template).toContain('Administrator email unavailable');
  });

  it('uses a readable organization name without exposing internal ids', () => {
    expect(
      platformAuditTargetLabel({
        after: {
          resourceId: 'tenant-1',
          resourceType: 'tenant',
          state: { id: 'tenant-1', name: 'Target tenant' },
        },
        before: null,
        targetTenantName: null,
      }),
    ).toBe('Target tenant');
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
        targetTenantName: 'Example Organization',
      }),
    ).toBe('Example Organization');
    expect(
      platformAuditTargetLabel({
        after: null,
        before: null,
        targetTenantName: null,
      }),
    ).toBe('Former organization');
  });
});

describe('platformAuditSnapshotRows', () => {
  it('formats useful values and hides internal identifiers', () => {
    expect(
      platformAuditSnapshotRows({
        resourceId: 'refund-1',
        resourceType: 'refundClaim',
        state: {
          amount: 1250,
          currency: 'EUR',
          generation: 2,
          refundClaimId: 'refund-1',
          status: 'needs_attention',
          transferId: 'transfer-1',
        },
      }),
    ).toEqual([
      { label: 'Amount', value: '12,50 €' },
      { label: 'Currency', value: 'EUR' },
      { label: 'Status', value: 'needs attention' },
    ]);
  });
});
