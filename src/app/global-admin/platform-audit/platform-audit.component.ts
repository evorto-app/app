import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { type PlatformTenantAuditAction } from '../../../shared/platform-audit';
import { type GlobalAdminPlatformAuditRecord } from '../../../shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';

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
      return 'Tenant role created';
    }
    case 'role.delete': {
      return 'Tenant role deleted';
    }
    case 'role.update': {
      return 'Tenant role updated';
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
      return 'Tenant created';
    }
    case 'tenant.update': {
      return 'Tenant settings updated';
    }
    case 'user.assignRoles': {
      return 'Tenant user roles changed';
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
    'after' | 'before' | 'targetTenantId'
  >,
): string => {
  const name = snapshotName(entry.after) ?? snapshotName(entry.before);
  return name ? `${name} (${entry.targetTenantId})` : entry.targetTenantId;
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, JsonPipe, MatButtonModule, RouterLink],
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
  protected readonly targetLabel = platformAuditTargetLabel;

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Failed to load the platform audit log');
  }
}
