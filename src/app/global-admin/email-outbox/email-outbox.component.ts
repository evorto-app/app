import type { GlobalAdminEmailOutboxKind } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { AppRpc } from '@app/core/effect-rpc-angular-client';
import { TenantDatePipe } from '@app/core/tenant-date.pipe';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowRotateRight,
  faCheckCircle,
  faCircleExclamation,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

export const emailOutboxKindLabel = {
  manualApproval: 'Manual approval',
  receiptReviewed: 'Receipt reviewed',
  registrationCancelled: 'Sign-up ended',
  registrationConfirmed: 'Ticket confirmed',
  registrationTransferred: 'Ticket transferred',
  waitlistSpotAvailable: 'Waitlist place available',
} as const satisfies Record<GlobalAdminEmailOutboxKind, string>;

const emailOutboxStatusLabel = {
  deliveryUnknown: 'Delivery not confirmed',
  failed: 'Could not send',
  queued: 'Waiting to send',
  sending: 'Sending',
  sent: 'Sent',
  suppressed: 'Not sent',
} as const;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TenantDatePipe, FontAwesomeModule, MatButtonModule],
  selector: 'app-email-outbox',
  templateUrl: './email-outbox.component.html',
})
export class EmailOutboxComponent {
  protected readonly faArrowRotateRight = faArrowRotateRight;
  protected readonly faCheckCircle = faCheckCircle;
  protected readonly faCircleExclamation = faCircleExclamation;
  protected readonly kindLabel = emailOutboxKindLabel;
  private readonly rpc = AppRpc.injectClient();
  protected readonly outboxQuery = injectQuery(() =>
    this.rpc.globalAdmin.emailOutbox.findOverview.queryOptions(),
  );
  protected readonly statusLabel = emailOutboxStatusLabel;
}
