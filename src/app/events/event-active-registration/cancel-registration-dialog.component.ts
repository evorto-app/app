import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTextareaModule } from '@angular/material/textarea';
import { injectMutation } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';
import { CancellationReason } from '../../../types/cancellation';

interface DialogData {
  registrationId: string;
  policy?: any;
  eventStart?: Date;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatTextareaModule,
  ],
  template: `
    <h2 mat-dialog-title>Cancel Registration</h2>
    
    <mat-dialog-content class="flex flex-col gap-4">
      @if (data.policy) {
        <div class="bg-surface-variant rounded-lg p-4">
          <h3 class="font-medium mb-2">Refund Information</h3>
          @if (data.policy.includeTransactionFees && data.policy.includeAppFees) {
            <p class="text-sm">You will receive a full refund including all fees.</p>
          } @else if (data.policy.includeAppFees) {
            <p class="text-sm">You will receive a refund including app fees, but transaction fees will be deducted.</p>
          } @else if (data.policy.includeTransactionFees) {
            <p class="text-sm">You will receive a refund including transaction fees, but app fees will be deducted.</p>
          } @else {
            <p class="text-sm">You will receive a partial refund. Transaction and app fees will be deducted.</p>
          }
        </div>
      }
      
      <form [formGroup]="cancelForm" class="flex flex-col gap-4">
        <mat-form-field>
          <mat-label>Reason for cancellation</mat-label>
          <mat-select formControlName="reason" required>
            <mat-option value="user-request">Personal request</mat-option>
            <mat-option value="no-show">Cannot attend</mat-option>
            <mat-option value="duplicate">Duplicate registration</mat-option>
            <mat-option value="other">Other</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Additional notes (optional)</mat-label>
          <textarea matInput formControlName="reasonNote" rows="3"></textarea>
        </mat-form-field>
      </form>

      <div class="bg-warning-container text-on-warning-container rounded-lg p-3">
        <p class="text-sm font-medium">⚠️ This action cannot be undone</p>
        <p class="text-sm">Once you cancel your registration, you will need to register again if you change your mind.</p>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Keep Registration</button>
      <button 
        mat-raised-button 
        color="warn"
        [disabled]="cancelForm.invalid || cancelMutation.isPending()"
        (click)="onCancel()"
      >
        @if (cancelMutation.isPending()) {
          Cancelling...
        } @else {
          Cancel Registration
        }
      </button>
    </mat-dialog-actions>
  `,
})
export class CancelRegistrationDialogComponent {
  private readonly trpc = injectTRPC();
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialogRef = inject(MatDialogRef<CancelRegistrationDialogComponent>);
  protected readonly data = inject<DialogData>(MAT_DIALOG_DATA);

  protected readonly cancelForm = this.fb.group({
    reason: ['user-request' as CancellationReason, Validators.required],
    reasonNote: [''],
  });

  protected readonly cancelMutation = injectMutation(() =>
    this.trpc.events.cancelRegistration.mutationOptions()
  );

  protected onCancel() {
    if (this.cancelForm.valid) {
      const formValue = this.cancelForm.value;
      
      this.cancelMutation.mutate({
        registrationId: this.data.registrationId,
        reason: formValue.reason as CancellationReason,
        reasonNote: formValue.reasonNote || undefined,
      }, {
        onSuccess: (result) => {
          this.snackBar.open('Registration cancelled successfully', 'Close', {
            duration: 5000,
          });
          
          if (result.refundAmount && result.refundAmount > 0) {
            const feeMessage = [];
            if (result.refundIncludesTransactionFees && result.refundIncludesAppFees) {
              feeMessage.push('including all fees');
            } else if (result.refundIncludesAppFees) {
              feeMessage.push('including app fees');
            } else if (result.refundIncludesTransactionFees) {
              feeMessage.push('including transaction fees');
            } else {
              feeMessage.push('fees excluded');
            }
            
            this.snackBar.open(
              `Refund of €${(result.refundAmount / 100).toFixed(2)} ${feeMessage.join(', ')} will be processed within 3-5 business days`,
              'Close',
              { duration: 10000 }
            );
          }
          
          this.dialogRef.close(true);
        },
        onError: (error) => {
          this.snackBar.open(`Failed to cancel registration: ${error.message}`, 'Close', {
            duration: 5000,
          });
        },
      });
    }
  }
}