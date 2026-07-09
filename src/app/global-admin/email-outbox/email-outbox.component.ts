import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowRotateRight,
  faCheckCircle,
  faCircleExclamation,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';

const emailOutboxKindLabel = {
  manualApproval: 'Manual approval',
  receiptReviewed: 'Receipt reviewed',
} as const;

const emailOutboxStatusLabel = {
  failed: 'Failed',
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
} as const;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FontAwesomeModule, MatButtonModule],
  selector: 'app-email-outbox',
  templateUrl: './email-outbox.component.html',
})
export class EmailOutboxComponent {
  protected readonly faArrowRotateRight = faArrowRotateRight;
  protected readonly faCheckCircle = faCheckCircle;
  protected readonly faCircleExclamation = faCircleExclamation;
  protected readonly getErrorMessage = getErrorMessage;
  protected readonly kindLabel = emailOutboxKindLabel;
  private readonly rpc = AppRpc.injectClient();
  protected readonly outboxQuery = injectQuery(() =>
    this.rpc.globalAdmin.emailOutbox.findOverview.queryOptions(),
  );
  protected readonly statusLabel = emailOutboxStatusLabel;
}
