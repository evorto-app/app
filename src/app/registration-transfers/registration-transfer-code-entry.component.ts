import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  maxLength,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';

export const normalizeRegistrationTransferCode = (value: string): string =>
  value.trim().toUpperCase();

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, MatButtonModule, MatFormFieldModule, MatInputModule],
  selector: 'app-registration-transfer-code-entry',
  templateUrl: './registration-transfer-code-entry.component.html',
})
export class RegistrationTransferCodeEntryComponent {
  private readonly codeModel = signal({ credential: '' });
  protected readonly codeForm = form(this.codeModel, (code) => {
    required(code.credential);
    maxLength(code.credential, 512);
  });
  private readonly router = inject(Router);

  protected async continue(event: Event): Promise<void> {
    event.preventDefault();
    if (this.codeForm().invalid() || this.codeForm().submitting()) return;
    await submit(this.codeForm, async (formState) => {
      const credential = normalizeRegistrationTransferCode(
        formState().value().credential,
      );
      await this.router.navigate(['/registration-transfers', credential]);
    });
  }
}
