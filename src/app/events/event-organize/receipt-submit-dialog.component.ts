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
    this.selectableCountries.find((country) => country === this.data.defaultCountry) ??
    this.selectableCountries[0] ??
    'DE';
  protected readonly form = createReceiptForm(this.formBuilder, this.defaultCountry);
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
    if (
      selectedFile &&
      this.attachmentName().trim().length === 0
    ) {
      this.attachmentName.set(selectedFile.name);
    }
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.errorMessage.set('');

    const selectedFile = this.file();
    if (!selectedFile) {
      this.errorMessage.set('Choose an image or PDF receipt file.');
      return;
    }

    if (
      !selectedFile.type.startsWith('image/') &&
      selectedFile.type !== 'application/pdf'
    ) {
      this.errorMessage.set('Only image and PDF files are supported.');
      return;
    }

    if (this.form.invalid) {
      this.errorMessage.set('Complete all required fields.');
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    if (!this.selectableCountries.includes(value.purchaseCountry)) {
      this.errorMessage.set('Selected country is not allowed.');
      return;
    }

    const totalAmount = Math.round(value.totalAmount * 100);
    const taxAmount = Math.round(value.taxAmount * 100);
    const depositAmount = value.hasDeposit ? Math.round(value.depositAmount * 100) : 0;
    const alcoholAmount = value.hasAlcohol ? Math.round(value.alcoholAmount * 100) : 0;

    if (depositAmount + alcoholAmount > totalAmount) {
      this.errorMessage.set('Deposit and alcohol cannot exceed the total amount.');
      return;
    }

    const receiptDate = new Date(value.receiptDate);
    if (Number.isNaN(receiptDate.getTime())) {
      this.errorMessage.set('Invalid receipt date.');
      return;
    }

    const attachmentName = this.attachmentName().trim() || selectedFile.name;

    this.dialogRef.close({
      attachmentName,
      fields: {
        alcoholAmount,
        depositAmount,
        hasAlcohol: value.hasAlcohol,
        hasDeposit: value.hasDeposit,
        purchaseCountry: value.purchaseCountry,
        receiptDate,
        taxAmount,
        totalAmount,
      },
      file: selectedFile,
    });
  }

  protected updateAttachmentName(value: string): void {
    this.attachmentName.set(value);
  }
}
