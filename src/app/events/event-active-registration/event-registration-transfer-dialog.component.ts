import { Clipboard } from '@angular/cdk/clipboard';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { TenantDatePipe } from '../../core/tenant-date.pipe';

export interface EventRegistrationTransferDialogData {
  readonly claimCode: string;
  readonly claimUrl: string;
  readonly expiresAt: string;
  readonly status: 'open';
}

type CopiedTransferCredential = 'code' | 'link';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TenantDatePipe,
    MatButtonModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormFieldModule,
    MatInputModule,
  ],
  selector: 'app-event-registration-transfer-dialog',
  templateUrl: './event-registration-transfer-dialog.component.html',
})
export class EventRegistrationTransferDialogComponent {
  protected readonly copied = signal<CopiedTransferCredential | null>(null);
  protected readonly copyError = signal(false);
  protected readonly data =
    inject<EventRegistrationTransferDialogData>(MAT_DIALOG_DATA);
  private readonly clipboard = inject(Clipboard);

  protected copy(value: string, credential: CopiedTransferCredential): void {
    this.copyError.set(false);
    if (!this.clipboard.copy(value)) {
      this.copied.set(null);
      this.copyError.set(true);
      return;
    }
    this.copied.set(credential);
  }
}
