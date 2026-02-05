import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatSlideToggleModule, MatButtonModule, FormField],
  selector: 'app-update-visibility-dialog',
  styles: ``,
  templateUrl: './update-visibility-dialog.component.html',
})
export class UpdateVisibilityDialogComponent {
  protected readonly data: { event: { title: string; unlisted: boolean } } =
    inject(MAT_DIALOG_DATA);
  private readonly visibilityModel = signal({
    unlisted: this.data.event.unlisted,
  });
  protected readonly visibilityForm = form(this.visibilityModel);
}
