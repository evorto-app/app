import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { IconSelectorFieldComponent } from '../../../shared/components/controls/icon-selector/icon-selector-field/icon-selector-field.component';

interface IconValue {
  iconColor: number;
  iconName: string;
}
const fallbackIcon: IconValue = { iconColor: 0, iconName: 'city' };

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatDialogActions,
    MatButtonModule,
    MatDialogClose,
    IconSelectorFieldComponent,
  ],
  selector: 'app-create-edit-category-dialog',
  styles: ``,
  templateUrl: './create-edit-category-dialog.component.html',
})
export class CreateEditCategoryDialogComponent {
  private readonly formBuilder = inject(NonNullableFormBuilder);
  protected readonly categoryForm = this.formBuilder.group({
    icon: this.formBuilder.control<IconValue>(fallbackIcon),
    title: this.formBuilder.control('', { validators: [Validators.required] }),
  });
  protected readonly data = inject(MAT_DIALOG_DATA) as
    | {
        category: {
          icon: IconValue;
          id: string;
          title: string;
        };
        mode: 'edit';
      }
    | {
        defaultIcon?: IconValue;
        mode: 'create';
      };

  constructor() {
    if (this.data.mode === 'edit') {
      this.categoryForm.setValue({
        icon: this.data.category.icon,
        title: this.data.category.title,
      });
      this.categoryForm.controls.icon.disable({ emitEvent: false });
    } else {
      this.categoryForm.controls.icon.setValue(
        this.data.defaultIcon ?? fallbackIcon,
      );
    }
  }
}
