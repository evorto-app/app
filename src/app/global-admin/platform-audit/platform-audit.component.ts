import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { type PlatformTenantAuditAction } from '../../../shared/platform-audit';
import { type GlobalAdminPlatformAuditRecord } from '../../../shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import { AppRpc } from '../../core/effect-rpc-angular-client';

export interface PlatformAuditDisplayRow {
  readonly label: string;
  readonly value: string;
}

const hiddenAuditField = (key: string): boolean =>
  /(^id$|Id$|Ids$|digest|generation|idempotency|attempts?|hasLastError|hasRefundId|mode$|permissions$|stripeRefundStatus)/i.test(
    key,
  );

const auditFieldLabel = (key: string): string => {
  const spaced = key
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const auditFieldValue = (
  key: string,
  value: unknown,
  currency: null | string,
): string => {
  if (value === null) return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (currency && /(amount|price)$/i.test(key)) {
      return new Intl.NumberFormat('de-DE', {
        currency,
        style: 'currency',
      }).format(value / 100);
    }
    return new Intl.NumberFormat('de-DE').format(value);
  }
  if (typeof value === 'string') {
    return value.replaceAll('_', ' ');
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) {
      return value.length === 0 ? 'None' : value.join(', ');
    }
    return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  }
  return 'Updated details';
};

export const platformAuditSnapshotRows = (
  snapshot: GlobalAdminPlatformAuditRecord['after'],
): readonly PlatformAuditDisplayRow[] => {
  if (
    snapshot === null ||
    typeof snapshot.state !== 'object' ||
    snapshot.state === null ||
    Array.isArray(snapshot.state)
  ) {
    return [];
  }

  const state = snapshot.state as Record<string, unknown>;
  const currency =
    typeof state['currency'] === 'string' ? state['currency'] : null;
  return Object.entries(state)
    .filter(([key]) => !hiddenAuditField(key))
    .map(([key, value]) => ({
      label: auditFieldLabel(key),
      value: auditFieldValue(key, value, currency),
    }));
};

export const platformAuditActionLabel = (
  action: PlatformTenantAuditAction,
): string => {
  switch (action) {
    case 'event.create': {
      return 'Event created';
    }
    case 'event.review': {
      return 'Event reviewed';
    }
    case 'event.submitForReview': {
      return 'Event submitted for review';
    }
    case 'event.update': {
      return 'Event updated';
    }
    case 'event.updateListing': {
      return 'Event listing changed';
    }
    case 'receipt.reimburse': {
      return 'Receipt reimbursement recorded';
    }
    case 'receipt.review': {
      return 'Receipt reviewed';
    }
    case 'refundClaim.requeue': {
      return 'Registration refund requeued';
    }
    case 'registration.approve': {
      return 'Registration approved';
    }
    case 'registration.cancel': {
      return 'Registration cancelled';
    }
    case 'registration.checkIn': {
      return 'Registration checked in';
    }
    case 'role.create': {
      return 'Organization role created';
    }
    case 'role.delete': {
      return 'Organization role deleted';
    }
    case 'role.update': {
      return 'Organization role updated';
    }
    case 'taxRates.import': {
      return 'Tax rates imported';
    }
    case 'template.create': {
      return 'Event template created';
    }
    case 'template.update': {
      return 'Event template updated';
    }
    case 'tenant.create': {
      return 'Organization created';
    }
    case 'tenant.update': {
      return 'Organization settings updated';
    }
    case 'user.assignRoles': {
      return 'Organization member roles changed';
    }
  }
};

const snapshotName = (
  snapshot: GlobalAdminPlatformAuditRecord['after'],
): string | undefined => {
  if (snapshot === null || snapshot.resourceType !== 'tenant') {
    return;
  }

  const state = snapshot.state;
  if (typeof state !== 'object' || state === null || !('name' in state)) {
    return;
  }

  const name = state['name'];
  return typeof name === 'string' && name.trim().length > 0 ? name : undefined;
};

export const platformAuditTargetLabel = (
  entry: Pick<
    GlobalAdminPlatformAuditRecord,
    'after' | 'before' | 'targetTenantName'
  >,
): string => {
  return (
    entry.targetTenantName ??
    snapshotName(entry.after) ??
    snapshotName(entry.before) ??
    'Former organization'
  );
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, MatButtonModule, RouterLink],
  selector: 'app-platform-audit',
  templateUrl: './platform-audit.component.html',
})
export class PlatformAuditComponent {
  protected readonly actionLabel = platformAuditActionLabel;
  private readonly rpc = AppRpc.injectClient();
  protected readonly auditQuery = injectQuery(() =>
    this.rpc.globalAdmin.platformAudit.findMany.queryOptions(),
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly snapshotRows = platformAuditSnapshotRows;
  protected readonly targetLabel = platformAuditTargetLabel;
}
