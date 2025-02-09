import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule,
    ReactiveFormsModule,
  ],
  selector: 'app-update-visibility-dialog',
  styles: ``,
  templateUrl: './update-visibility-dialog.component.html',
})
export class UpdateVisibilityDialogComponent {
  protected readonly data: { event: { title: string; visibility: string } } =
    inject(MAT_DIALOG_DATA);
  protected readonly visibilityControl = new FormControl(
    this.data.event.visibility,
    { nonNullable: true },
  );
}
