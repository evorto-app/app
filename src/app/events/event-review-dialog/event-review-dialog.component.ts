import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  selector: 'app-event-review-dialog',
  standalone: true,
  template: `
    <h2 mat-dialog-title>Review Event</h2>
    <form [formGroup]="reviewForm" (ngSubmit)="onSubmit()">
      <mat-dialog-content>
        <mat-form-field class="w-full">
          <mat-label>Review Comment</mat-label>
          <textarea
            matInput
            formControlName="comment"
            rows="4"
            placeholder="Please provide feedback about why the event was rejected..."
          ></textarea>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="!reviewForm.valid">
          Reject Event
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class EventReviewDialogComponent {
  private formBuilder = inject(FormBuilder);
  protected reviewForm = this.formBuilder.group({
    comment: ['', [Validators.required]],
  });

  private dialogRef = inject(MatDialogRef<EventReviewDialogComponent>);

  protected onSubmit(): void {
    if (this.reviewForm.valid) {
      this.dialogRef.close(this.reviewForm.value.comment);
    }
  }
}
