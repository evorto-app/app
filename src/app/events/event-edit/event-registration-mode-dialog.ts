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
    <h2 mat-dialog-title>Change registration configuration?</h2>
    <mat-dialog-content>
      @if (data.to === 'advanced') {
        <p>
          Advanced mode keeps both current options and lets you add registration
          options and choose which registration options can use each add-on. You
          can return to simple mode only while the event has exactly one
          organizing and one non-organizing option.
        </p>
      } @else {
        <p>
          Simple mode shows the existing organizing and non-organizing options.
          Questions, add-ons, and the registration options that can use each
          add-on stay saved. Those controls are hidden until you return to
          advanced mode.
        </p>
      }
      <p class="mt-3">
        This change remains reversible until you save, and switching back also
        requires confirmation.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button type="button" mat-button mat-dialog-close>
        Keep current mode
      </button>
      <button type="button" mat-flat-button [mat-dialog-close]="true">
        Use {{ data.to }} mode
      </button>
    </mat-dialog-actions>
  `,
})
export class EventRegistrationModeDialog {
  protected readonly data =
    inject<EventRegistrationModeDialogData>(MAT_DIALOG_DATA);
}
