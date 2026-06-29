import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  pattern,
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
import { notificationEmailPattern } from '@shared/notification-email';

export interface EditProfileDialogData {
  communicationEmail: string;
  firstName: string;
  iban: null | string;
  lastName: string;
  paypalEmail: null | string;
}

export interface EditProfileDialogResult {
  communicationEmail: string;
  firstName: string;
  iban: null | string;
  lastName: string;
  paypalEmail: null | string;
}

export const editProfileDialogResultFromFormValue = (formValue: {
  communicationEmail: string;
  firstName: string;
  iban: string;
  lastName: string;
  paypalEmail: string;
}): EditProfileDialogResult => ({
  communicationEmail: formValue.communicationEmail.trim(),
  firstName: formValue.firstName.trim(),
  iban: formValue.iban.trim() || null,
  lastName: formValue.lastName.trim(),
  paypalEmail: formValue.paypalEmail.trim() || null,
});

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
  protected readonly data = inject(MAT_DIALOG_DATA) as EditProfileDialogData;
  protected readonly profileModel = signal({
    communicationEmail: this.data.communicationEmail ?? '',
    firstName: this.data.firstName ?? '',
    iban: this.data.iban ?? '',
    lastName: this.data.lastName ?? '',
    paypalEmail: this.data.paypalEmail ?? '',
  });
  protected readonly profileForm = form(this.profileModel, (schemaPath) => {
    required(schemaPath.communicationEmail);
    pattern(schemaPath.communicationEmail, notificationEmailPattern);
    required(schemaPath.firstName);
    required(schemaPath.lastName);
  });
  private readonly dialogRef = inject(MatDialogRef<EditProfileDialogComponent>);

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.profileForm, async (formState) => {
      this.dialogRef.close(
        editProfileDialogResultFromFormValue(formState().value()),
      );
    });
  }
}
