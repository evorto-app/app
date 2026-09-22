import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  Validators,
} from '@angular/forms';
import { maximumFinanceReceiptMinorUnits } from '@shared/finance/receipt-values';

export interface ReceiptFormControls {
  alcoholAmount: FormControl<number>;
  depositAmount: FormControl<number>;
  hasAlcohol: FormControl<boolean>;
  hasDeposit: FormControl<boolean>;
  purchaseCountry: FormControl<string>;
  receiptDate: FormControl<string>;
  taxAmount: FormControl<number>;
  totalAmount: FormControl<number>;
}

export type ReceiptFormGroup = FormGroup<ReceiptFormControls>;

const currentLocalCalendarDate = (): string => {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const createReceiptForm = (
  formBuilder: NonNullableFormBuilder,
  defaultCountry: string,
): ReceiptFormGroup =>
  formBuilder.group({
    alcoholAmount: formBuilder.control(0, {
      validators: [
        Validators.min(0),
        Validators.max(maximumFinanceReceiptMinorUnits / 100),
      ],
    }),
    depositAmount: formBuilder.control(0, {
      validators: [
        Validators.min(0),
        Validators.max(maximumFinanceReceiptMinorUnits / 100),
      ],
    }),
    hasAlcohol: formBuilder.control(false),
    hasDeposit: formBuilder.control(false),
    purchaseCountry: formBuilder.control(defaultCountry, {
      validators: [Validators.required],
    }),
    receiptDate: formBuilder.control(currentLocalCalendarDate(), {
      validators: [Validators.required],
    }),
    taxAmount: formBuilder.control(0, {
      validators: [
        Validators.min(0),
        Validators.max(maximumFinanceReceiptMinorUnits / 100),
      ],
    }),
    totalAmount: formBuilder.control(0, {
      validators: [
        Validators.min(0.01),
        Validators.max(maximumFinanceReceiptMinorUnits / 100),
      ],
    }),
  });
