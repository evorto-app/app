import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  Validators,
} from '@angular/forms';

export type ReceiptAmountValidationError =
  | 'breakdownExceedsTotal'
  | 'taxExceedsTotal';

export interface ReceiptFormControls {
  alcoholAmount: FormControl<number>;
  depositAmount: FormControl<number>;
  hasAlcohol: FormControl<boolean>;
  hasDeposit: FormControl<boolean>;
  purchaseCountry: FormControl<string>;
  receiptDate: FormControl<Date>;
  taxAmount: FormControl<number>;
  totalAmount: FormControl<number>;
}

export type ReceiptFormGroup = FormGroup<ReceiptFormControls>;

export const receiptAmountValidationError = ({
  alcoholAmount,
  depositAmount,
  taxAmount,
  totalAmount,
}: {
  alcoholAmount: number;
  depositAmount: number;
  taxAmount: number;
  totalAmount: number;
}): null | ReceiptAmountValidationError => {
  if (depositAmount + alcoholAmount > totalAmount) {
    return 'breakdownExceedsTotal';
  }

  if (taxAmount > totalAmount) {
    return 'taxExceedsTotal';
  }

  return null;
};

export const createReceiptForm = (
  formBuilder: NonNullableFormBuilder,
  defaultCountry: string,
): ReceiptFormGroup =>
  formBuilder.group({
    alcoholAmount: formBuilder.control(0, {
      validators: [Validators.min(0)],
    }),
    depositAmount: formBuilder.control(0, {
      validators: [Validators.min(0)],
    }),
    hasAlcohol: formBuilder.control(false),
    hasDeposit: formBuilder.control(false),
    purchaseCountry: formBuilder.control(defaultCountry, {
      validators: [Validators.required],
    }),
    receiptDate: formBuilder.control(new Date(), {
      validators: [Validators.required],
    }),
    taxAmount: formBuilder.control(0, {
      validators: [Validators.min(0)],
    }),
    totalAmount: formBuilder.control(0, {
      validators: [Validators.min(0)],
    }),
  });
