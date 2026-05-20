import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { NonNullableFormBuilder } from '@angular/forms';
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

import { ReceiptFormFieldsComponent } from '../../finance/shared/receipt-form/receipt-form-fields.component';
import { createReceiptForm } from '../../finance/shared/receipt-form/receipt-form.model';

export type ReceiptSubmitDialogPayloadResult =
  | {
      errorMessage: null;
      result: ReceiptSubmitDialogResult;
    }
  | {
      errorMessage: string;
      result: null;
    };

export interface ReceiptSubmitDialogResult {
  attachmentName: string;
  fields: {
    alcoholAmount: number;
    depositAmount: number;
    hasAlcohol: boolean;
    hasDeposit: boolean;
    purchaseCountry: string;
    receiptDate: Date;
    taxAmount: number;
    totalAmount: number;
  };
  file: File;
}

export interface ReceiptSubmitFormValue {
  alcoholAmount: number;
  depositAmount: number;
  hasAlcohol: boolean;
  hasDeposit: boolean;
  purchaseCountry: string;
  receiptDate: Date;
  taxAmount: number;
  totalAmount: number;
}

const supportedReceiptFile = (file: File): boolean =>
  file.type.startsWith('image/') || file.type === 'application/pdf';

export const receiptSubmitDialogResultFromFormValue = ({
  attachmentName,
  file,
  formInvalid,
  formValue,
  selectableCountries,
}: {
  attachmentName: string;
  file: File | null;
  formInvalid: boolean;
  formValue: ReceiptSubmitFormValue;
  selectableCountries: readonly string[];
}): ReceiptSubmitDialogPayloadResult => {
  if (!file) {
    return {
      errorMessage: 'Choose an image or PDF receipt file.',
      result: null,
    };
  }

  if (!supportedReceiptFile(file)) {
    return {
      errorMessage: 'Only image and PDF files are supported.',
      result: null,
    };
  }

  if (formInvalid) {
    return {
      errorMessage: 'Complete all required fields.',
      result: null,
    };
  }

  if (!selectableCountries.includes(formValue.purchaseCountry)) {
    return {
      errorMessage: 'Selected country is not allowed.',
      result: null,
    };
  }

  const totalAmount = Math.round(formValue.totalAmount * 100);
  const taxAmount = Math.round(formValue.taxAmount * 100);
  const depositAmount = formValue.hasDeposit
    ? Math.round(formValue.depositAmount * 100)
    : 0;
  const alcoholAmount = formValue.hasAlcohol
    ? Math.round(formValue.alcoholAmount * 100)
    : 0;

  if (depositAmount + alcoholAmount > totalAmount) {
    return {
      errorMessage: 'Deposit and alcohol cannot exceed the total amount.',
      result: null,
    };
  }

  const receiptDate = new Date(formValue.receiptDate);
  if (Number.isNaN(receiptDate.getTime())) {
    return {
      errorMessage: 'Invalid receipt date.',
      result: null,
    };
  }

  return {
    errorMessage: null,
    result: {
      attachmentName: attachmentName.trim() || file.name,
      fields: {
        alcoholAmount,
        depositAmount,
        hasAlcohol: formValue.hasAlcohol,
        hasDeposit: formValue.hasDeposit,
        purchaseCountry: formValue.purchaseCountry,
        receiptDate,
        taxAmount,
        totalAmount,
      },
      file,
    },
  };
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormFieldModule,
    MatInputModule,
    ReceiptFormFieldsComponent,
  ],
  selector: 'app-receipt-submit-dialog',
  styles: ``,
  templateUrl: './receipt-submit-dialog.component.html',
})
export class ReceiptSubmitDialogComponent {
  protected readonly attachmentName = signal('');
  protected readonly data = inject(MAT_DIALOG_DATA) as {
    countries: string[];
    defaultCountry: string;
  };
  protected readonly errorMessage = signal('');
  protected readonly file = signal<File | null>(null);
  protected readonly formBuilder = inject(NonNullableFormBuilder);
  protected readonly selectableCountries = [...this.data.countries];
  private readonly defaultCountry =
    this.selectableCountries.find(
      (country) => country === this.data.defaultCountry,
    ) ??
    this.selectableCountries[0] ??
    'DE';
  protected readonly form = createReceiptForm(
    this.formBuilder,
    this.defaultCountry,
  );
  private readonly dialogRef = inject(
    MatDialogRef<ReceiptSubmitDialogComponent, ReceiptSubmitDialogResult>,
  );

  protected clearFile(): void {
    this.file.set(null);
    this.errorMessage.set('');
  }

  protected formatFileSize(sizeBytes: number): string {
    if (sizeBytes >= 1024 * 1024) {
      return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (sizeBytes >= 1024) {
      return `${Math.round(sizeBytes / 1024)} KB`;
    }
    return `${sizeBytes} bytes`;
  }

  protected onFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement | undefined;
    const selectedFile = target?.files?.[0] ?? null;
    this.file.set(selectedFile);
    this.errorMessage.set('');
    if (selectedFile && this.attachmentName().trim().length === 0) {
      this.attachmentName.set(selectedFile.name);
    }
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.errorMessage.set('');

    const payload = receiptSubmitDialogResultFromFormValue({
      attachmentName: this.attachmentName(),
      file: this.file(),
      formInvalid: this.form.invalid,
      formValue: this.form.getRawValue(),
      selectableCountries: this.selectableCountries,
    });
    if (payload.errorMessage) {
      this.errorMessage.set(payload.errorMessage);
      if (this.form.invalid) {
        this.form.markAllAsTouched();
      }
      return;
    }

    this.dialogRef.close(payload.result);
  }

  protected updateAttachmentName(value: string): void {
    this.attachmentName.set(value);
  }
}
