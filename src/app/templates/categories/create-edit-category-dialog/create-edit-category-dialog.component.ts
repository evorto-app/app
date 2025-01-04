import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';

@Component({
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
  protected readonly categoryForm = new FormGroup({
    title: new FormControl(''),
  });
  protected readonly data = inject(MAT_DIALOG_DATA) as
    | {
        category: {
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
        title: this.data.category.title,
      });
    }
  }
}
