import type { IconValue } from '@shared/types/icon';

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
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
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CategoryManagementIconUsage } from '@shared/rpc-contracts/app-rpcs/icons.rpcs';

import { IconSelectorFieldComponent } from '../../../shared/components/controls/icon-selector/icon-selector-field/icon-selector-field.component';

const fallbackIcon: IconValue = { iconColor: 0, iconName: 'city' };

export interface CategorySaveDraft {
  icon: IconValue;
  title: string;
}

export type CategorySaveOutcome =
  { message: string; saved: false } | { message?: string; saved: true };

export type CreateEditCategoryDialogData = {
  save: (input: CategorySaveDraft) => Promise<CategorySaveOutcome>;
} & (
  | { category: CategorySaveDraft & { id: string }; mode: 'edit' }
  | { defaultIcon?: IconValue; mode: 'create' }
);

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
  protected readonly categoryModel = signal({
    icon: fallbackIcon,
    title: '',
  });
  protected readonly saveConfirmed = signal(false);
  protected readonly saving = signal(false);
  protected readonly categoryForm = form(this.categoryModel, (schemaPath) => {
    required(schemaPath.title);
    required(schemaPath.icon);
    disabled(schemaPath.title, () => this.saving() || this.saveConfirmed());
    disabled(schemaPath.icon, () => this.saving() || this.saveConfirmed());
  });
  protected readonly data =
    inject<CreateEditCategoryDialogData>(MAT_DIALOG_DATA);
  protected readonly iconUsage = CategoryManagementIconUsage.make({});
  protected readonly saveMessage = signal('');
  private readonly dialogRef = inject(
    MatDialogRef<CreateEditCategoryDialogComponent, undefined>,
  );

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
    if (this.saveConfirmed()) return;
    await submit(this.categoryForm, async (formState) => {
      const value = formState().value();
      const input: CategorySaveDraft = {
        icon: {
          iconColor: value.icon.iconColor,
          iconName: value.icon.iconName,
        },
        title: value.title,
      };
      this.saveMessage.set('');
      this.saving.set(true);
      const previousDisableClose = this.dialogRef.disableClose;
      this.dialogRef.disableClose = true;
      try {
        const outcome = await this.data.save(input);
        this.saveConfirmed.set(outcome.saved);
        if (outcome.message) {
          this.saveMessage.set(outcome.message);
        } else {
          this.dialogRef.close();
        }
      } finally {
        this.saving.set(false);
        this.dialogRef.disableClose = previousDisableClose;
      }
    });
  }
}
