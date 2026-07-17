import type { GlobalAdminEmailOutboxKind } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Injectable,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { AppRpc } from '@app/core/effect-rpc-angular-client';
import { getErrorMessage } from '@app/core/error-message';
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
  registrationCancelled: 'Registration cancelled',
  registrationConfirmed: 'Registration confirmed',
  registrationTransferred: 'Registration transferred',
  waitlistSpotAvailable: 'Waitlist spot available',
} as const satisfies Record<GlobalAdminEmailOutboxKind, string>;

const emailOutboxStatusLabel = {
  deliveryUnknown: 'Delivery unknown',
  failed: 'Failed',
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  suppressed: 'Suppressed',
} as const;

@Injectable({ providedIn: 'root' })
export class EmailOutboxOperations {
  private readonly rpc = AppRpc.injectClient();

  overview() {
    return this.rpc.globalAdmin.emailOutbox.findOverview.queryOptions();
  }
}

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
  protected readonly getErrorMessage = getErrorMessage;
  protected readonly kindLabel = emailOutboxKindLabel;
  private readonly operations = inject(EmailOutboxOperations);
  protected readonly outboxQuery = injectQuery(() =>
    this.operations.overview(),
  );
  protected readonly statusLabel = emailOutboxStatusLabel;
}
