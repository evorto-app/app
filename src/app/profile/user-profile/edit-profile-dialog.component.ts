import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  required,
  submit,
  validate,
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
import { isValidIbanInput, normalizeIban } from '@shared/iban';
import {
  isValidEmailAddressInput,
  normalizeEmailAddress,
} from '@shared/notification-email';

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
  communicationEmail: normalizeEmailAddress(formValue.communicationEmail),
  firstName: formValue.firstName.trim(),
  iban: normalizeIban(formValue.iban) || null,
  lastName: formValue.lastName.trim(),
  paypalEmail: normalizeEmailAddress(formValue.paypalEmail) || null,
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
    communicationEmail: this.data.communicationEmail,
    firstName: this.data.firstName ?? '',
    iban: this.data.iban ?? '',
    lastName: this.data.lastName ?? '',
    paypalEmail: this.data.paypalEmail ?? '',
  });
  protected readonly profileForm = form(this.profileModel, (schemaPath) => {
    required(schemaPath.communicationEmail);
    validate(schemaPath.communicationEmail, ({ value }) =>
      isValidEmailAddressInput(value())
        ? undefined
        : {
            kind: 'email',
            message: 'Enter a valid email address for updates.',
          },
    );
    required(schemaPath.firstName);
    validate(schemaPath.iban, ({ value }) =>
      normalizeIban(value()).length === 0 || isValidIbanInput(value())
        ? undefined
        : {
            kind: 'iban',
            message: 'Enter a valid IBAN.',
          },
    );
    required(schemaPath.lastName);
    validate(schemaPath.paypalEmail, ({ value }) =>
      normalizeEmailAddress(value()).length === 0 ||
      isValidEmailAddressInput(value())
        ? undefined
        : {
            kind: 'email',
            message: 'Enter a valid PayPal email address.',
          },
    );
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
