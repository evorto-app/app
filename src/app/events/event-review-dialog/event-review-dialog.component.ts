import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { form, FormField, required, submit } from '@angular/forms/signals';
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
    FormField,
  ],
  selector: 'app-event-review-dialog',
  standalone: true,
  template: `
    <h2 mat-dialog-title>Review Event</h2>
    <form (submit)="onSubmit($event)">
      <mat-dialog-content>
        <mat-form-field class="w-full">
          <mat-label>Review Comment</mat-label>
          <textarea
            matInput
            [formField]="reviewForm.comment"
            rows="4"
            placeholder="Please provide feedback about why the event was rejected..."
          ></textarea>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button mat-dialog-close>Cancel</button>
        <button
          mat-flat-button
          type="submit"
          [disabled]="reviewForm().invalid() || reviewForm().submitting()"
        >
          Reject Event
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class EventReviewDialogComponent {
  private readonly reviewModel = signal({ comment: '' });
  protected readonly reviewForm = form(this.reviewModel, (schema) => {
    required(schema.comment);
  });

  private dialogRef = inject(MatDialogRef<EventReviewDialogComponent>);

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.reviewForm, async (formState) => {
      this.dialogRef.close(formState().value().comment);
    });
  }
}
