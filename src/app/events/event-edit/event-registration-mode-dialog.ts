import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';

export type EventRegistrationConfigurationMode = 'advanced' | 'simple';

export interface EventRegistrationModeDialogData {
  from: EventRegistrationConfigurationMode;
  to: EventRegistrationConfigurationMode;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
  ],
  selector: 'app-event-registration-mode-dialog',
  template: `
    <h2 mat-dialog-title>Change sign-up setup?</h2>
    <mat-dialog-content>
      @if (data.to === 'advanced') {
        <p>
          Advanced setup keeps both current choices and lets you add choices and
          choose which ones can use each add-on. You can return to simple setup
          only while the event has exactly one organizer choice and one attendee
          choice.
        </p>
      } @else {
        <p>
          Simple setup shows the existing organizer and attendee choices.
          Questions, add-ons, and which choices can use each add-on stay saved.
          Those controls are hidden until you return to advanced setup.
        </p>
      }
      <p class="mt-3">
        This change remains reversible until you save, and switching back also
        requires confirmation.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button type="button" mat-button mat-dialog-close>
        Keep current setup
      </button>
      <button type="button" mat-flat-button [mat-dialog-close]="true">
        Use {{ data.to }} setup
      </button>
    </mat-dialog-actions>
  `,
})
export class EventRegistrationModeDialog {
  protected readonly data =
    inject<EventRegistrationModeDialogData>(MAT_DIALOG_DATA);
}
