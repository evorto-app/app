import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { form, FormField, required } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import {
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface EventRegistrationTransferDialogResult {
  targetEmail: string;
}

export const normalizeRegistrationTransferTargetEmail = (email: string) =>
  email.trim().toLocaleLowerCase();

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
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
  protected readonly errorMessage = signal('');
  protected readonly transferModel = signal({ targetEmail: '' });
  protected readonly transferForm = form(this.transferModel, (schema) => {
    required(schema.targetEmail);
  });
  protected readonly normalizedTargetEmail = computed(() =>
    normalizeRegistrationTransferTargetEmail(
      this.transferForm().value().targetEmail,
    ),
  );
  private readonly dialogRef = inject(
    MatDialogRef<
      EventRegistrationTransferDialogComponent,
      EventRegistrationTransferDialogResult
    >,
  );

  protected submit(event: Event): void {
    event.preventDefault();
    this.errorMessage.set('');

    const targetEmail = this.normalizedTargetEmail();
    if (!targetEmail) {
      this.errorMessage.set('Enter the email address of the new participant.');
      return;
    }

    this.dialogRef.close({ targetEmail });
  }
}
