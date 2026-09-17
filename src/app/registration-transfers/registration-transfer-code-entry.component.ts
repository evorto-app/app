import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  form,
  FormField,
  maxLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { registrationTransferClaimCodePattern } from '@shared/registration-transfer';

import { RegistrationTransferClaimComponent } from './registration-transfer-claim.component';

export const normalizeRegistrationTransferCode = (value: string): string =>
  value.trim().toUpperCase();

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    RegistrationTransferClaimComponent,
  ],
  selector: 'app-registration-transfer-code-entry',
  templateUrl: './registration-transfer-code-entry.component.html',
})
export class RegistrationTransferCodeEntryComponent {
  private readonly codeModel = signal({ claimCode: '' });
  protected readonly codeForm = form(this.codeModel, (code) => {
    required(code.claimCode);
    maxLength(code.claimCode, 512);
    validate(code.claimCode, ({ value }) =>
      registrationTransferClaimCodePattern.test(
        normalizeRegistrationTransferCode(value()),
      )
        ? null
        : {
            kind: 'pattern',
            message: 'Enter the complete transfer code, including its hyphens.',
          },
    );
  });
  protected readonly selectedClaimCode = signal<null | string>(null);

  protected async continue(event: Event): Promise<void> {
    event.preventDefault();
    if (this.codeForm().invalid() || this.codeForm().submitting()) return;
    await submit(this.codeForm, async (formState) => {
      const claimCode = normalizeRegistrationTransferCode(
        formState().value().claimCode,
      );
      this.selectedClaimCode.set(claimCode);
    });
  }

  protected enterAnotherCode(): void {
    this.selectedClaimCode.set(null);
    this.codeForm().reset({ claimCode: '' });
  }
}
