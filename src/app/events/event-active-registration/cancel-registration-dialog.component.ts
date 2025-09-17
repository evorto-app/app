import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import type { CancellationReason } from '../../../types/cancellation';

interface DialogData {
  registrationTitle: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
  ],
  selector: 'app-cancel-registration-dialog',
  template: `
    <h2 mat-dialog-title>Cancel Registration</h2>
    
    <mat-dialog-content>
      <p class="mb-4">
        Are you sure you want to cancel your registration for 
        <strong>{{ data.registrationTitle }}</strong>?
      </p>
      
      <form [formGroup]="form" class="space-y-4">
        <mat-form-field class="w-full">
          <mat-label>Reason for cancellation</mat-label>
          <mat-select formControlName="reason">
            <mat-option value="user">Personal reasons</mat-option>
            <mat-option value="other">Other</mat-option>
          </mat-select>
        </mat-form-field>

        @if (form.get('reason')?.value === 'other') {
          <mat-form-field class="w-full">
            <mat-label>Please specify</mat-label>
            <textarea 
              matInput 
              formControlName="reasonNote" 
              rows="3"
              placeholder="Please provide more details..."
            ></textarea>
          </mat-form-field>
        }
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button [mat-dialog-close]="false">
        Keep Registration
      </button>
      <button 
        mat-flat-button 
        color="warn" 
        [mat-dialog-close]="form.value"
        [disabled]="form.invalid"
      >
        Cancel Registration
      </button>
    </mat-dialog-actions>
  `,
})
export class CancelRegistrationDialogComponent {
  protected readonly data = inject<DialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<CancelRegistrationDialogComponent>);
  private readonly fb = inject(FormBuilder);

  protected readonly form = this.fb.nonNullable.group({
    reason: ['user' as CancellationReason, Validators.required],
    reasonNote: [''],
  });

  constructor() {
    // Add validator for reasonNote when reason is 'other'
    this.form.get('reason')?.valueChanges.subscribe((reason) => {
      const reasonNoteControl = this.form.get('reasonNote');
      if (reason === 'other') {
        reasonNoteControl?.setValidators([Validators.required]);
      } else {
        reasonNoteControl?.clearValidators();
      }
      reasonNoteControl?.updateValueAndValidity();
    });
  }
}