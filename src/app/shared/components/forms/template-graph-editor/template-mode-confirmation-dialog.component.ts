import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';

export type TemplateConfigurationMode = 'advanced' | 'simple';

export interface TemplateModeConfirmationData {
  targetMode: TemplateConfigurationMode;
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
  selector: 'app-template-mode-confirmation-dialog',
  template: `
    <h2 mat-dialog-title>Switch to {{ data.targetMode }} setup?</h2>
    <mat-dialog-content>
      @if (data.targetMode === 'advanced') {
        <p>
          Advanced setup keeps both current choices and lets you add, remove,
          rename, and choose who each choice is for. You can also choose which
          choices can use each reusable add-on.
        </p>
      } @else {
        <p>
          Simple setup shows one organizer choice and one attendee choice.
          Questions, add-ons, and which choices can use each add-on stay saved.
          Those controls are hidden until you switch back to advanced setup.
        </p>
      }
      <p class="mt-3">
        This change is not saved yet. You can switch back before saving.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        type="button"
        [mat-dialog-close]="undefined"
        cdkFocusInitial
      >
        Keep current setup
      </button>
      <button
        mat-flat-button
        type="button"
        [mat-dialog-close]="data.targetMode"
      >
        Use {{ data.targetMode }} setup
      </button>
    </mat-dialog-actions>
  `,
})
export class TemplateModeConfirmationDialogComponent {
  protected readonly data =
    inject<TemplateModeConfirmationData>(MAT_DIALOG_DATA);
}
