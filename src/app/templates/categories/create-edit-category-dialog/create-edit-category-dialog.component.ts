import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    ReactiveFormsModule,
    MatInputModule,
    MatDialogActions,
    MatButtonModule,
    MatDialogClose,
  ],
  selector: 'app-create-edit-category-dialog',
  styles: ``,
  templateUrl: './create-edit-category-dialog.component.html',
})
export class CreateEditCategoryDialogComponent {
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly dialogRef = inject(MatDialogRef<CreateEditCategoryDialogComponent>);
  protected readonly categoryForm = this.formBuilder.group({
    icon: this.formBuilder.control({ iconColor: 0, iconName: 'ticket--v1' }),
    title: this.formBuilder.control(''),
  });
  protected readonly data = inject(MAT_DIALOG_DATA) as
    | {
        category: {
          icon: { iconColor: number; iconName: string };
          id: string;
          title: string;
        };
        mode: 'edit';
      }
    | {
        mode: 'create';
      };

  constructor() {
    if (this.data.mode === 'edit') {
      this.categoryForm.setValue({
        icon: this.data.category.icon,
        title: this.data.category.title,
      });
    }
  }

  protected saveCategory() {
    this.dialogRef.close(this.categoryForm.getRawValue());
  }
}
