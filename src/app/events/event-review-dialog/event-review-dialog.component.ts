import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
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
  template: `
    <h2 mat-dialog-title>Return Event to Draft</h2>
    <form (submit)="onSubmit($event)">
      <mat-dialog-content>
        <p class="text-on-surface-variant mb-4">
          The event will become editable again. Tell the creator what must
          change before they submit it for another review.
        </p>
        <mat-form-field class="w-full">
          <mat-label>Feedback for the creator</mat-label>
          <textarea
            matInput
            [formField]="reviewForm.comment"
            rows="4"
            autocomplete="off"
            placeholder="Explain what should change before resubmitting…"
          ></textarea>
          @if (
            reviewForm.comment().touched() && reviewForm.comment().invalid()
          ) {
            <mat-error>Feedback is required.</mat-error>
          }
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button mat-dialog-close>Cancel</button>
        <button
          mat-flat-button
          type="submit"
          [disabled]="reviewForm().invalid() || reviewForm().submitting()"
        >
          Return to Draft
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class EventReviewDialogComponent {
  private readonly reviewModel = signal({ comment: '' });
  protected readonly reviewForm = form(this.reviewModel, (schema) => {
    required(schema.comment);
    validate(schema.comment, ({ value }) =>
      value().trim().length === 0
        ? { kind: 'required', message: 'Feedback is required.' }
        : undefined,
    );
  });

  private dialogRef = inject(MatDialogRef<EventReviewDialogComponent>);

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.reviewForm, async (formState) => {
      this.dialogRef.close(formState().value().comment.trim());
    });
  }
}
