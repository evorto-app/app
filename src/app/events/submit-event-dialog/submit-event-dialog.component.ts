import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

@Component({
  selector: 'app-submit-event-dialog',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Submit Event for Review</h2>
    <mat-dialog-content>
      <p>Are you sure you want to submit this event for review?</p>
      <p class="mt-2 text-on-surface-variant">
        Once submitted, the event will be locked for editing until it is either approved or rejected.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" [mat-dialog-close]="true">
        Submit for Review
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubmitEventDialogComponent {}