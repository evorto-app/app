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
    <h2 mat-dialog-title>Switch to {{ data.targetMode }} configuration?</h2>
    <mat-dialog-content>
      @if (data.targetMode === 'advanced') {
        <p>
          Advanced configuration keeps both current options and lets you add,
          remove, rename, and reclassify registration options. You can also
          choose which registration options can use each reusable add-on.
        </p>
      } @else {
        <p>
          Simple configuration shows one organizing and one non-organizing
          option. Questions, add-ons, and the registration options that can use
          each add-on stay saved. Those controls are hidden until you switch
          back to advanced configuration.
        </p>
      }
      <p class="mt-3">
        This changes only the unsaved form. You can switch back before saving.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        type="button"
        [mat-dialog-close]="undefined"
        cdkFocusInitial
      >
        Keep current mode
      </button>
      <button
        mat-flat-button
        type="button"
        [mat-dialog-close]="data.targetMode"
      >
        Switch to {{ data.targetMode }}
      </button>
    </mat-dialog-actions>
  `,
})
export class TemplateModeConfirmationDialogComponent {
  protected readonly data =
    inject<TemplateModeConfirmationData>(MAT_DIALOG_DATA);
}
