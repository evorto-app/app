import { describe, expect, it } from 'vitest';

import {
  receiptSubmitDialogResultFromFormValue,
  type ReceiptSubmitFormValue,
} from './receipt-submit-dialog.component';

const receiptFile = new File(['receipt'], 'receipt.pdf', {
  type: 'application/pdf',
});

const formValue: ReceiptSubmitFormValue = {
  alcoholAmount: 1.23,
  depositAmount: 2.34,
  hasAlcohol: true,
  hasDeposit: true,
  purchaseCountry: 'DE',
  receiptDate: new Date('2026-05-20T12:00:00.000Z'),
  taxAmount: 3.45,
  totalAmount: 12.34,
};

describe('receiptSubmitDialogResultFromFormValue', () => {
  it('normalizes successful receipt submission payloads', () => {
    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: ' Custom receipt ',
        file: receiptFile,
        formInvalid: false,
        formValue,
        selectableCountries: ['DE', 'NL'],
      }),
    ).toEqual({
      errorMessage: null,
      result: {
        attachmentName: 'Custom receipt',
        fields: {
          alcoholAmount: 123,
          depositAmount: 234,
          hasAlcohol: true,
          hasDeposit: true,
          purchaseCountry: 'DE',
          receiptDate: formValue.receiptDate,
          taxAmount: 345,
          totalAmount: 1234,
        },
        file: receiptFile,
      },
    });
  });

  it('falls back to the selected file name when the attachment label is blank', () => {
    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: ' ',
        file: receiptFile,
        formInvalid: false,
        formValue,
        selectableCountries: ['DE'],
      }).result?.attachmentName,
    ).toBe('receipt.pdf');
  });

  it('rejects missing or unsupported receipt files', () => {
    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: '',
        file: null,
        formInvalid: false,
        formValue,
        selectableCountries: ['DE'],
      }).errorMessage,
    ).toBe('Choose an image or PDF receipt file.');

    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: '',
        file: new File(['receipt'], 'receipt.txt', { type: 'text/plain' }),
        formInvalid: false,
        formValue,
        selectableCountries: ['DE'],
      }).errorMessage,
    ).toBe('Only image and PDF files are supported.');
  });

  it('rejects invalid form state and countries outside tenant settings', () => {
    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: '',
        file: receiptFile,
        formInvalid: true,
        formValue,
        selectableCountries: ['DE'],
      }).errorMessage,
    ).toBe('Complete all required fields.');

    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: '',
        file: receiptFile,
        formInvalid: false,
        formValue: {
          ...formValue,
          purchaseCountry: 'FR',
        },
        selectableCountries: ['DE'],
      }).errorMessage,
    ).toBe('Selected country is not allowed.');
  });

  it('rejects impossible receipt amount breakdowns and invalid dates', () => {
    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: '',
        file: receiptFile,
        formInvalid: false,
        formValue: {
          ...formValue,
          alcoholAmount: 7,
          depositAmount: 6,
          totalAmount: 12,
        },
        selectableCountries: ['DE'],
      }).errorMessage,
    ).toBe('Deposit and alcohol cannot exceed the total amount.');

    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: '',
        file: receiptFile,
        formInvalid: false,
        formValue: {
          ...formValue,
          taxAmount: 13,
          totalAmount: 12,
        },
        selectableCountries: ['DE'],
      }).errorMessage,
    ).toBe('Tax amount cannot exceed the total amount.');

    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: '',
        file: receiptFile,
        formInvalid: false,
        formValue: {
          ...formValue,
          receiptDate: new Date('invalid'),
        },
        selectableCountries: ['DE'],
      }).errorMessage,
    ).toBe('Invalid receipt date.');
  });
});
