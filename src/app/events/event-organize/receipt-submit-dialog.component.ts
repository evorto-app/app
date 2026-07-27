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
import { firstReceiptCountry } from '@shared/finance/receipt-countries';
import {
  receiptFileAccept,
  validateReceiptFileMetadata,
} from '@shared/finance/receipt-media';
import {
  isFinanceReceiptCalendarDate,
  validateFinanceReceiptAmounts,
} from '@shared/finance/receipt-values';

import { ReceiptFormFieldsComponent } from '../../finance/shared/receipt-form/receipt-form-fields.component';
import { createReceiptForm } from '../../finance/shared/receipt-form/receipt-form.model';
import { majorCurrencyInputToMinorUnits } from '../../shared/components/controls/currency-amount-input/currency-amount-input.component';

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
    receiptDate: string;
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
  receiptDate: string;
  taxAmount: number;
  totalAmount: number;
}

const parseRequiredMinorUnits = (value: number): null | number => {
  const parsed = majorCurrencyInputToMinorUnits(String(value), false);
  return 'value' in parsed && typeof parsed.value === 'number'
    ? parsed.value
    : null;
};

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

  const fileValidationError = validateReceiptFileMetadata({
    mimeType: file.type,
    sizeBytes: file.size,
  });
  if (fileValidationError) {
    return {
      errorMessage: fileValidationError,
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

  const totalAmount = parseRequiredMinorUnits(formValue.totalAmount);
  const taxAmount = parseRequiredMinorUnits(formValue.taxAmount);
  const depositAmount = parseRequiredMinorUnits(formValue.depositAmount);
  const alcoholAmount = parseRequiredMinorUnits(formValue.alcoholAmount);
  if (
    totalAmount === null ||
    taxAmount === null ||
    depositAmount === null ||
    alcoholAmount === null
  ) {
    return {
      errorMessage: 'Enter amounts with no more than two decimal places.',
      result: null,
    };
  }

  const amountError = validateFinanceReceiptAmounts({
    alcoholAmount,
    depositAmount,
    hasAlcohol: formValue.hasAlcohol,
    hasDeposit: formValue.hasDeposit,
    taxAmount,
    totalAmount,
  });
  if (amountError) {
    const errorMessage = {
      alcoholAmountOutOfRange: 'Alcohol amount is outside the allowed range.',
      alcoholFlagContradiction:
        'Alcohol amount must be positive when alcohol is included and zero otherwise.',
      depositAmountOutOfRange: 'Deposit amount is outside the allowed range.',
      depositAndAlcoholExceedTotal:
        'Deposit and alcohol cannot exceed the total amount.',
      depositFlagContradiction:
        'Deposit amount must be positive when a deposit is included and zero otherwise.',
      taxAmountExceedsTotal: 'Tax amount cannot exceed the total amount.',
      taxAmountOutOfRange: 'Tax amount is outside the allowed range.',
      totalAmountOutOfRange:
        'Total amount must be at least 0.01 and within the allowed range.',
    } as const;
    return { errorMessage: errorMessage[amountError], result: null };
  }

  if (!isFinanceReceiptCalendarDate(formValue.receiptDate)) {
    return {
      errorMessage: 'Enter a valid receipt date in YYYY-MM-DD format.',
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
        receiptDate: formValue.receiptDate,
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
    ) ?? firstReceiptCountry(this.selectableCountries);
  protected readonly form = createReceiptForm(
    this.formBuilder,
    this.defaultCountry,
  );
  protected readonly receiptFileAccept = receiptFileAccept;
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
