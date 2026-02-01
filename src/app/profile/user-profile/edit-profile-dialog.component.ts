import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { form, FormField, required, submit } from '@angular/forms/signals';
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

export interface EditProfileDialogData {
  firstName: string;
  lastName: string;
}

export interface EditProfileDialogResult {
  firstName: string;
  lastName: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatInputModule,
    FormField,
  ],
  selector: 'app-edit-profile-dialog',
  styles: ``,
  templateUrl: './edit-profile-dialog.component.html',
})
export class EditProfileDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<EditProfileDialogComponent>,
  );
  protected readonly data = inject(MAT_DIALOG_DATA) as EditProfileDialogData;
  protected readonly profileModel = signal({
    firstName: this.data.firstName ?? '',
    lastName: this.data.lastName ?? '',
  });
  protected readonly profileForm = form(this.profileModel, (schemaPath) => {
    required(schemaPath.firstName);
    required(schemaPath.lastName);
  });

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.profileForm, async (formState) => {
      const formValue = formState.value();
      this.dialogRef.close({
        firstName: formValue.firstName.trim(),
        lastName: formValue.lastName.trim(),
      });
    });
  }
}
