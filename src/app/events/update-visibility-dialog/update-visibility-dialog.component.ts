import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatSlideToggleModule,
    MatButtonModule,
    ReactiveFormsModule,
  ],
  selector: 'app-update-visibility-dialog',
  styles: ``,
  templateUrl: './update-visibility-dialog.component.html',
})
export class UpdateVisibilityDialogComponent {
  protected readonly data: { event: { title: string; unlisted: boolean } } =
    inject(MAT_DIALOG_DATA);
  protected readonly unlistedControl = new FormControl<boolean>(
    this.data.event.unlisted,
    { nonNullable: true },
  );
}
