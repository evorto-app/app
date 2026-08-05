import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';

import {
  ALL_PERMISSIONS,
  type Permission,
  permissionLabel,
} from '../../../shared/permissions/permissions';
import { type PlatformTenantAuditAction } from '../../../shared/platform-audit';
import {
  type GlobalAdminPlatformAuditCursor,
  type GlobalAdminPlatformAuditPage,
  type GlobalAdminPlatformAuditRecord,
} from '../../../shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { tenantTimezoneLabel } from '../../core/geography-labels';

export interface PlatformAuditChangedRow {
  readonly after: string;
  readonly before: string;
  readonly label: string;
}
type AuditValueFormatter = (value: unknown) => string | undefined;

const textValue: AuditValueFormatter = (value) =>
  typeof value === 'string' && value.trim() ? value : undefined;
const numberValue: AuditValueFormatter = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : undefined;
const yesNoValue: AuditValueFormatter = (value) =>
  typeof value === 'boolean' ? (value ? 'Yes' : 'No') : undefined;
const timezoneValue: AuditValueFormatter = (value) =>
  typeof value === 'string' ? tenantTimezoneLabel(value) : undefined;
const knownPermissions = new Set<string>(ALL_PERMISSIONS);
const isKnownPermission = (value: string): value is Permission =>
  knownPermissions.has(value);
const wildcardPermissionLabels: Readonly<Record<string, string>> = {
  'admin:*': 'All administration permissions',
  'events:*': 'All event permissions',
  'finance:*': 'All finance permissions',
  'internal:*': 'All Members Hub permissions',
  'templates:*': 'All template permissions',
  'users:*': 'All member permissions',
};
const permissionListValue: AuditValueFormatter = (value) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return;
  }
  if (value.length === 0) return 'No permissions';
  return value
    .map((item) =>
      isKnownPermission(item)
        ? permissionLabel(item)
        : (wildcardPermissionLabels[item] ??
          'This role includes an access setting that cannot be shown'),
    )
    .join(', ');
};

const mappedValue =
  (labels: Readonly<Record<string, string>>): AuditValueFormatter =>
  (value) =>
    typeof value === 'string' ? labels[value] : undefined;
const statusValue = mappedValue({
  APPROVED: 'Approved',
  approved: 'Approved',
  CANCELLED: 'Cancelled',
  cancelled: 'Cancelled',
  completed: 'Completed',
  CONFIRMED: 'Confirmed',
  DRAFT: 'Draft',
  failed: 'Failed',
  needs_attention: 'Needs attention',
  PENDING: 'Pending',
  pending: 'Pending',
  PENDING_REVIEW: 'Pending review',
  processing: 'In progress',
  refunded: 'Reimbursed',
  rejected: 'Rejected',
  REJECTED: 'Rejected',
  submitted: 'Submitted',
  succeeded: 'Completed',
  WAITLIST: 'On waitlist',
});
const themeValue = mappedValue({
  classic: 'Classic Evorto theme',
  esn: 'ESN theme',
  evorto: 'Default theme',
});
const registrationSetupValue: AuditValueFormatter = (value) =>
  typeof value === 'boolean' ? (value ? 'Basic' : 'Custom') : undefined;
const paymentReadinessValue: AuditValueFormatter = (value) =>
  typeof value === 'boolean' ? (value ? 'Ready' : 'Not ready') : undefined;
type SafeAuditField = readonly [string, string, AuditValueFormatter];
const safeAuditFields: readonly SafeAuditField[] = [
  ['name', 'Name', textValue],
  ['title', 'Title', textValue],
  ['description', 'Description', textValue],
  ['domain', 'Website address', textValue],
  ['theme', 'Theme', themeValue],
  ['timezone', 'Time zone', timezoneValue],
  ['currency', 'Currency', textValue],
  ['paymentsConfigured', 'Paid sign-ups', paymentReadinessValue],
  ['locationName', 'Location', textValue],
  ['status', 'Status', statusValue],
  ['registrationOptionCount', 'Sign-up choices', numberValue],
  ['simpleModeEnabled', 'Sign-up setup', registrationSetupValue],
  ['announcementRoleCount', 'Announcement roles', numberValue],
  ['addOnCount', 'Add-ons', numberValue],
  ['questionCount', 'Sign-up questions', numberValue],
  ['permissions', 'Role permissions', permissionListValue],
  ['defaultOrganizerRole', 'Default organizer role', yesNoValue],
  ['defaultUserRole', 'Default member role', yesNoValue],
  ['displayInHub', 'Shown in Members Hub', yesNoValue],
  ['sortOrder', 'Role order', numberValue],
  ['roleCount', 'Member roles', numberValue],
  ['taxRateCount', 'Tax rates', numberValue],
  ['taxRateAddedCount', 'Tax rates added', numberValue],
  ['taxRateUpdatedCount', 'Tax rates updated', numberValue],
  ['taxRateUnchangedCount', 'Tax rates already up to date', numberValue],
  ['receiptCount', 'Receipts', numberValue],
  ['transferStatus', 'Transfer status', statusValue],
  ['attendeeCheckedIn', 'Attendee checked in', yesNoValue],
  ['checkedInGuestCount', 'Guests checked in', numberValue],
  ['guestCount', 'Guests', numberValue],
  ['remainingGuestCount', 'Guests not checked in', numberValue],
];

const snapshotState = (
  snapshot: GlobalAdminPlatformAuditRecord['after'],
): Readonly<Record<string, unknown>> | undefined => {
  return snapshot?.state;
};

export const platformAuditChangedRows = (
  entry: Partial<Pick<GlobalAdminPlatformAuditRecord, 'action'>> &
    Pick<GlobalAdminPlatformAuditRecord, 'after' | 'before'>,
): readonly PlatformAuditChangedRow[] => {
  const before = snapshotState(entry.before);
  const after = snapshotState(entry.after);
  const changedRows = safeAuditFields.flatMap(([key, label, format]) => {
    if (JSON.stringify(before?.[key]) === JSON.stringify(after?.[key]))
      return [];
    const beforeDisplay =
      before?.[key] == null ? 'Not set' : format(before[key]);
    const afterDisplay = after?.[key] == null ? 'Not set' : format(after[key]);
    if (!beforeDisplay || !afterDisplay) return [];
    if (beforeDisplay === 'Not set' && afterDisplay === 'Not set') return [];
    if (beforeDisplay === afterDisplay) return [];
    return [
      {
        after: afterDisplay,
        before: beforeDisplay,
        label,
      },
    ];
  });
  if (entry.action !== 'refundClaim.requeue') return changedRows;
  return [
    {
      after: 'Started again',
      before: 'Needed attention',
      label: 'Refund',
    },
    ...changedRows,
  ];
};

const platformAuditActionLabels = {
  'event.create': 'Event created',
  'event.review': 'Event reviewed',
  'event.submitForReview': 'Event submitted for review',
  'event.update': 'Event updated',
  'event.updateAnnouncementDiscovery': 'Who can find the announcement changed',
  'receipt.reimburse': 'Receipt reimbursement recorded',
  'receipt.review': 'Receipt reviewed',
  'refundClaim.requeue': 'Refund continued',
  'registration.approve': 'Sign-up approved',
  'registration.cancel': 'Sign-up ended',
  'registration.checkIn': 'Ticket checked in',
  'role.create': 'Organization role created',
  'role.delete': 'Organization role deleted',
  'role.update': 'Organization role updated',
  'taxRates.import': 'Tax rates checked',
  'template.create': 'Event template created',
  'template.update': 'Event template updated',
  'tenant.create': 'Organization created',
  'tenant.update': 'Organization settings updated',
  'user.assignRoles': 'Organization member roles changed',
} as const satisfies Record<PlatformTenantAuditAction, string>;

export const platformAuditActionLabel = (
  action: PlatformTenantAuditAction,
): string => platformAuditActionLabels[action];

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
  imports: [DatePipe, FontAwesomeModule, MatButtonModule, RouterLink],
  selector: 'app-platform-audit',
  templateUrl: './platform-audit.component.html',
})
export class PlatformAuditComponent {
  protected readonly actionLabel = platformAuditActionLabel;
  private readonly rpc = AppRpc.injectClient();
  private readonly findAuditEntries =
    this.rpc.globalAdmin.platformAudit.findMany;
  protected readonly auditQuery = injectInfiniteQuery(() => ({
    getNextPageParam: (lastPage: GlobalAdminPlatformAuditPage) =>
      lastPage.nextCursor ?? undefined,
    initialPageParam: null as GlobalAdminPlatformAuditCursor | null,
    queryFn: ({
      pageParam,
    }: {
      readonly pageParam: GlobalAdminPlatformAuditCursor | null;
    }) => this.findAuditEntries.call({ cursor: pageParam }),
    queryKey: this.findAuditEntries.queryKey({ cursor: null }),
  }));
  protected readonly auditEntries = computed(
    () => this.auditQuery.data()?.pages.flatMap((page) => page.items) ?? [],
  );
  protected readonly changedRows = platformAuditChangedRows;
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly targetLabel = platformAuditTargetLabel;
}
