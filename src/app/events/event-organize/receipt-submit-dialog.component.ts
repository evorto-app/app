import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
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
import { MatSelectModule } from '@angular/material/select';

export interface ReceiptSubmitDialogResult {
  fields: {
    alcoholAmount: number;
    depositAmount: number;
    hasAlcohol: boolean;
    hasDeposit: boolean;
    purchaseCountry: string;
    receiptDate: Date;
    stripeTaxRateId: string;
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
    MatSelectModule,
    ReactiveFormsModule,
  ],
  selector: 'app-receipt-submit-dialog',
  styles: ``,
  templateUrl: './receipt-submit-dialog.component.html',
})
export class ReceiptSubmitDialogComponent {
  protected readonly data = inject(MAT_DIALOG_DATA) as {
    taxRates: {
      displayName: null | string;
      percentage: null | string;
      stripeTaxRateId: string;
    }[];
  };
  protected readonly errorMessage = signal('');
  protected readonly file = signal<File | null>(null);

  private readonly formBuilder = inject(FormBuilder).nonNullable;
  protected readonly form = this.formBuilder.group({
    alcoholAmount: this.formBuilder.control(0, {
      validators: [Validators.min(0)],
    }),
    depositAmount: this.formBuilder.control(0, {
      validators: [Validators.min(0)],
    }),
    hasAlcohol: this.formBuilder.control(false),
    hasDeposit: this.formBuilder.control(false),
    purchaseCountry: this.formBuilder.control('DE', {
      validators: [Validators.required],
    }),
    receiptDate: this.formBuilder.control(new Date().toISOString().slice(0, 10), {
      validators: [Validators.required],
    }),
    stripeTaxRateId: this.formBuilder.control(
      this.data.taxRates[0]?.stripeTaxRateId ?? '',
      {
        validators: [Validators.required],
      },
    ),
    totalAmount: this.formBuilder.control(0, {
      validators: [Validators.min(0)],
    }),
  });
  private readonly dialogRef = inject(
    MatDialogRef<ReceiptSubmitDialogComponent, ReceiptSubmitDialogResult>,
  );

  protected formatTaxRateLabel(taxRate: {
    displayName: null | string;
    percentage: null | string;
    stripeTaxRateId: string;
  }): string {
    const displayName = taxRate.displayName ?? 'Tax rate';
    const percentage = taxRate.percentage ? `${taxRate.percentage}%` : '';
    return [displayName, percentage].filter(Boolean).join(' ');
  }

  protected onFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const selectedFile = target?.files?.[0] ?? null;
    this.file.set(selectedFile);
    this.errorMessage.set('');
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.errorMessage.set('');

    const selectedFile = this.file();
    if (!selectedFile) {
      this.errorMessage.set('Select an image or PDF receipt file.');
      return;
    }

    if (!selectedFile.type.startsWith('image/') && selectedFile.type !== 'application/pdf') {
      this.errorMessage.set('Only image and PDF files are supported.');
      return;
    }

    if (this.form.invalid) {
      this.errorMessage.set('Complete all required fields.');
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const totalAmount = Math.round(value.totalAmount * 100);
    const depositAmount = value.hasDeposit ? Math.round(value.depositAmount * 100) : 0;
    const alcoholAmount = value.hasAlcohol ? Math.round(value.alcoholAmount * 100) : 0;

    if (depositAmount + alcoholAmount > totalAmount) {
      this.errorMessage.set('Deposit and alcohol cannot exceed the total amount.');
      return;
    }

    const receiptDate = new Date(`${value.receiptDate}T12:00:00.000Z`);
    if (Number.isNaN(receiptDate.getTime())) {
      this.errorMessage.set('Invalid receipt date.');
      return;
    }

    this.dialogRef.close({
      fields: {
        alcoholAmount,
        depositAmount,
        hasAlcohol: value.hasAlcohol,
        hasDeposit: value.hasDeposit,
        purchaseCountry: value.purchaseCountry.trim(),
        receiptDate,
        stripeTaxRateId: value.stripeTaxRateId,
        totalAmount,
      },
      file: selectedFile,
    });
  }
}
