import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatDialogModule],
  selector: 'app-submit-event-dialog',
  template: `
    <h2 mat-dialog-title>Submit event for review</h2>
    <mat-dialog-content>
      <p>Are you sure you want to submit this event for review?</p>
      <p class="text-on-surface-variant mt-2">
        You cannot edit the event while it is waiting for review. It can be
        published or returned to draft with feedback.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [mat-dialog-close]="true">
        Submit for review
      </button>
    </mat-dialog-actions>
  `,
})
export class SubmitEventDialogComponent {}
