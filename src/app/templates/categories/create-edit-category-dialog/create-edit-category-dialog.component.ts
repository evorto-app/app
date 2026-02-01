import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  disabled,
  form,
  FormField,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
  MatDialogRef,
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
    MatFormFieldModule,
    MatInputModule,
    MatDialogActions,
    MatButtonModule,
    MatDialogClose,
    FormField,
    IconSelectorFieldComponent,
  ],
  selector: 'app-create-edit-category-dialog',
  styles: ``,
  templateUrl: './create-edit-category-dialog.component.html',
})
export class CreateEditCategoryDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<CreateEditCategoryDialogComponent>,
  );
  protected readonly categoryModel = signal({
    icon: fallbackIcon,
    title: '',
  });
  protected readonly categoryForm = form(this.categoryModel, (schemaPath) => {
    required(schemaPath.title);
    if (this.data.mode === 'edit') {
      disabled(schemaPath.icon, 'Icon is locked for edits');
    }
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
      this.categoryModel.set({
        icon: this.data.category.icon,
        title: this.data.category.title,
      });
    } else {
      this.categoryModel.set({
        icon: this.data.defaultIcon ?? fallbackIcon,
        title: '',
      });
    }
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.categoryForm, async (formState) => {
      this.dialogRef.close(formState().value());
    });
  }
}
