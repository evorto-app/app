import '@angular/compiler';
import { OverlayContainer } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DEFAULT_CURRENCY_CODE,
  ErrorHandler,
  getDebugNode,
  ViewContainerRef,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MAT_DIALOG_DEFAULT_OPTIONS,
  MatDialog,
} from '@angular/material/dialog';
import { describe, expect, it, vi } from 'vitest';

import { ReceiptFormFieldsComponent } from '../../finance/shared/receipt-form/receipt-form-fields.component';
import {
  ReceiptSubmitDialogComponent,
  type ReceiptSubmitDialogData,
  type ReceiptSubmitDialogResult,
  receiptSubmitDialogResultFromFormValue,
  type ReceiptSubmitFormValue,
  type ReceiptSubmitSaveOutcome,
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
  receiptDate: '2026-05-20',
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
    ).toBe('Choose a receipt image or document.');

    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: '',
        file: new File(['receipt'], 'receipt.txt', { type: 'text/plain' }),
        formInvalid: false,
        formValue,
        selectableCountries: ['DE'],
      }).errorMessage,
    ).toBe(
      'This receipt cannot be used. Choose a different receipt image or document.',
    );

    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: '',
        file: new File([], 'empty.pdf', { type: 'application/pdf' }),
        formInvalid: false,
        formValue,
        selectableCountries: ['DE'],
      }).errorMessage,
    ).toBe(
      'This receipt is empty or larger than 20 MB. Choose another image or document.',
    );
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
          receiptDate: '2026-02-30',
        },
        selectableCountries: ['DE'],
      }).errorMessage,
    ).toBe('Choose a valid receipt date.');
  });

  it('rejects precision loss, zero totals, and contradictory optional amounts', () => {
    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: '',
        file: receiptFile,
        formInvalid: false,
        formValue: {
          ...formValue,
          totalAmount: 12.345,
        },
        selectableCountries: ['DE'],
      }).errorMessage,
    ).toBe('Enter amounts with no more than two decimal places.');

    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: '',
        file: receiptFile,
        formInvalid: false,
        formValue: {
          ...formValue,
          alcoholAmount: 0,
          depositAmount: 0,
          hasAlcohol: false,
          hasDeposit: false,
          totalAmount: 0,
        },
        selectableCountries: ['DE'],
      }).errorMessage,
    ).toBe('Total amount must be at least 0.01 and within the allowed range.');

    expect(
      receiptSubmitDialogResultFromFormValue({
        attachmentName: '',
        file: receiptFile,
        formInvalid: false,
        formValue: {
          ...formValue,
          depositAmount: 2.34,
          hasDeposit: false,
        },
        selectableCountries: ['DE'],
      }).errorMessage,
    ).toBe(
      'Deposit amount must be positive when a deposit is included and zero otherwise.',
    );
  });
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-receipt-submit-dialog-test-host',
  template: '',
})
class ReceiptSubmitDialogTestHostComponent {}

describe('ReceiptSubmitDialogComponent', () => {
  const unexpectedError = vi.fn<ErrorHandler['handleError']>();
  const enteredName = ' Custom receipt ';
  const expectedPayload: ReceiptSubmitDialogResult = {
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
  };
  let cleanupDialog: MatDialog | undefined;
  let cleanupFixture:
    ComponentFixture<ReceiptSubmitDialogTestHostComponent> | undefined;
  let operations: Promise<PromiseSettledResult<void>>[] = [];
  let releaseGates: (() => void)[] = [];
  let unsubscribeObservers: (() => void)[] = [];

  const observe = (operation: Promise<void>) => {
    operations.push(
      operation.then<PromiseSettledResult<void>, PromiseSettledResult<void>>(
        () => ({ status: 'fulfilled', value: undefined }),
        (error) => ({ reason: error, status: 'rejected' }),
      ),
    );
    return operation;
  };

  const holdSave = (fallback: ReceiptSubmitSaveOutcome) => {
    let release: (outcome: ReceiptSubmitSaveOutcome) => void = () => {
      throw new Error('Expected the held receipt save to be initialized.');
    };
    // Angular test compilation targets ES2022, so Promise.withResolvers is unavailable.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const promise = new Promise<ReceiptSubmitSaveOutcome>((resolve) => {
      release = resolve;
    });
    observe(
      promise.then(() => {
        // Own the gate settlement without changing its typed result.
      }),
    );
    releaseGates.push(() => release(fallback));
    return { promise, release };
  };

  const button = (element: HTMLElement, title: string) => {
    const result = [
      ...element.querySelectorAll<HTMLButtonElement>('button'),
    ].find((candidate) => candidate.textContent?.trim() === title);
    if (!result) throw new Error(`Expected the ${title} button.`);
    return result;
  };

  const selectFile = (input: HTMLInputElement, selected: File) => {
    const files: FileList = Object.assign([selected], {
      item: (index: number) => (index === 0 ? selected : null),
    });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: files,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const captureDialogCleanup = (): {
    dialog: MatDialog | undefined;
    fixture: ComponentFixture<ReceiptSubmitDialogTestHostComponent> | undefined;
  } => ({
    dialog: cleanupDialog,
    fixture: cleanupFixture,
  });

  const runDialogCase = async (run: () => Promise<void>) => {
    unexpectedError.mockReset();
    cleanupDialog = undefined;
    cleanupFixture = undefined;
    operations = [];
    releaseGates = [];
    unsubscribeObservers = [];
    const failures: unknown[] = [];
    try {
      await run();
    } catch (error) {
      failures.push(error);
    }
    for (const release of releaseGates) {
      try {
        release();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const result of await Promise.all(operations)) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    const { dialog: ownedDialog, fixture: ownedFixture } =
      captureDialogCleanup();
    cleanupDialog = undefined;
    cleanupFixture = undefined;
    for (const cleanup of [
      () => ownedDialog?.closeAll(),
      async () => {
        if (ownedDialog)
          await vi.waitFor(() =>
            expect(ownedDialog.openDialogs).toHaveLength(0),
          );
      },
      async () => {
        await ownedFixture?.whenStable();
      },
      ...unsubscribeObservers,
      () => ownedFixture?.destroy(),
      () => TestBed.resetTestingModule(),
      () => vi.restoreAllMocks(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Receipt dialog assertion, operation, or cleanup failed',
        { cause: failures[0] },
      );
  };

  const openDialog = async (save: ReceiptSubmitDialogData['save']) => {
    await TestBed.configureTestingModule({
      imports: [
        ReceiptSubmitDialogComponent,
        ReceiptSubmitDialogTestHostComponent,
      ],
      providers: [
        { provide: DEFAULT_CURRENCY_CODE, useValue: 'EUR' },
        {
          provide: ErrorHandler,
          useValue: { handleError: unexpectedError } satisfies Pick<
            ErrorHandler,
            'handleError'
          >,
        },
        {
          provide: MAT_DIALOG_DEFAULT_OPTIONS,
          useValue: {
            autoFocus: false,
            disableClose: false,
            enterAnimationDuration: 0,
            exitAnimationDuration: 0,
            restoreFocus: false,
          },
        },
      ],
    }).compileComponents();
    const dialog = TestBed.inject(MatDialog);
    cleanupDialog = dialog;
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const fixture = TestBed.createComponent(
      ReceiptSubmitDialogTestHostComponent,
    );
    cleanupFixture = fixture;
    fixture.detectChanges();
    const data: ReceiptSubmitDialogData = {
      countries: ['DE', 'NL'],
      defaultCountry: 'DE',
      save,
    };
    const dialogRef = dialog.open<
      ReceiptSubmitDialogComponent,
      ReceiptSubmitDialogData,
      ReceiptSubmitDialogResult
    >(ReceiptSubmitDialogComponent, {
      data,
      viewContainerRef: fixture.componentRef.injector.get(ViewContainerRef),
    });
    const closedResults: (ReceiptSubmitDialogResult | undefined)[] = [];
    const keydownEvents: KeyboardEvent[] = [];
    const closedSubscription = dialogRef.afterClosed().subscribe((result) => {
      closedResults.push(result);
    });
    unsubscribeObservers.push(() => closedSubscription.unsubscribe());
    const keydownSubscription = dialogRef.keydownEvents().subscribe((event) => {
      keydownEvents.push(event);
    });
    unsubscribeObservers.push(() => keydownSubscription.unsubscribe());
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(dialog.openDialogs).toHaveLength(1);
      expect(overlay.querySelector('app-receipt-submit-dialog')).not.toBeNull();
    });
    const element = overlay.querySelector<HTMLElement>(
      'app-receipt-submit-dialog',
    );
    if (!element) throw new Error('Expected the actual receipt submit dialog.');
    const debug = getDebugNode(element);
    if (!debug) throw new Error('Expected the receipt dialog debug node.');
    const component = debug.injector.get(ReceiptSubmitDialogComponent);
    expect(dialogRef.componentInstance).toBe(component);
    const changeDetector = debug.injector.get(ChangeDetectorRef);
    const detect = () => {
      fixture.detectChanges();
      changeDetector.detectChanges();
    };
    const nativeSubmit = component['onSubmit'].bind(component);
    const submit = vi.fn((event: Event): Promise<void> => {
      const operation = nativeSubmit(event);
      return observe(operation);
    });
    component['onSubmit'] = submit;
    const formElement = element.querySelector('form');
    if (!formElement) throw new Error('Expected the actual receipt form.');
    const childElement = element.querySelector('app-receipt-form-fields');
    if (!childElement) throw new Error('Expected the actual receipt fields.');
    const childDebug = getDebugNode(childElement);
    if (!childDebug) throw new Error('Expected the receipt fields debug node.');
    const receiptFields = childDebug.injector.get(ReceiptFormFieldsComponent);
    const receiptForm = receiptFields.form();
    receiptForm.setValue(formValue);
    const field = (label: string) => {
      const group = [...element.querySelectorAll('mat-form-field')].find(
        (candidate) =>
          candidate.querySelector('mat-label')?.textContent?.trim() === label,
      );
      const input = group?.querySelector<HTMLInputElement>('input');
      if (!input) throw new Error(`Expected the ${label} field.`);
      return input;
    };
    const nameInput = field('Receipt name');
    const fileInput =
      element.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error('Expected the receipt file input.');
    selectFile(fileInput, receiptFile);
    nameInput.value = enteredName;
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    detect();
    const expectModelValues = () => {
      expect(receiptForm.getRawValue()).toEqual(formValue);
      expect(component['file']()).toBe(receiptFile);
      expect(component['attachmentName']()).toBe(enteredName);
    };
    const expectValues = () => {
      expectModelValues();
      expect(nameInput.value).toBe(enteredName);
      expect(field('Receipt date').value).toBe(formValue.receiptDate);
      expect(field('Total amount (EUR)').value).toBe('12.34');
      expect(field('Tax amount (EUR)').value).toBe('3.45');
      expect(field('Deposit amount (EUR)').value).toBe('2.34');
      expect(field('Alcohol amount (EUR)').value).toBe('1.23');
      expect(element.querySelector('mat-select')?.textContent).toContain(
        'Germany (DE)',
      );
      const checkboxes = [
        ...element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      ];
      expect(checkboxes).toHaveLength(2);
      for (const checkbox of checkboxes) expect(checkbox.checked).toBe(true);
      expect(element.textContent).toContain(receiptFile.name);
      expect(fileInput.files?.item(0)).toBe(receiptFile);
    };
    const expectFieldsDisabled = (disabled: boolean) => {
      expect(receiptForm.disabled).toBe(disabled);
      for (const control of Object.values(receiptForm.controls))
        expect(control.disabled).toBe(disabled);
      for (const input of element.querySelectorAll<HTMLInputElement>('input'))
        expect(input.disabled).toBe(disabled);
      expect(
        element.querySelector('mat-select')?.getAttribute('aria-disabled'),
      ).toBe(String(disabled));
      expect(button(element, 'Choose receipt').disabled).toBe(disabled);
      expect(button(element, 'Remove').disabled).toBe(disabled);
    };
    const submitForm = () => {
      const previousCount = submit.mock.calls.length;
      formElement.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      expect(submit).toHaveBeenCalledTimes(previousCount + 1);
      const result = submit.mock.results.at(-1);
      if (result?.type !== 'return')
        throw new Error('Expected the real receipt submit operation.');
      return result.value;
    };
    const expectCloseOnly = (message: string) => {
      detect();
      expectValues();
      expectFieldsDisabled(true);
      expect(element.querySelector('[role="alert"]')?.textContent).toContain(
        message,
      );
      expect(element.querySelector('[role="status"]')).toBeNull();
      expect(element.querySelector('button[type="submit"]')).toBeNull();
      expect(button(element, 'Close').disabled).toBe(false);
      expect(dialogRef.disableClose).toBe(false);
      expect(dialog.openDialogs).toEqual([dialogRef]);
      expect(closedResults).toEqual([]);
    };
    expectValues();
    expectFieldsDisabled(false);
    expect(button(element, 'Submit receipt').disabled).toBe(false);
    const expectClosed = async () => {
      await vi.waitFor(() => {
        expect(dialog.openDialogs).toHaveLength(0);
        expect(overlay.querySelector('app-receipt-submit-dialog')).toBeNull();
      });
    };
    return {
      closedResults,
      component,
      detect,
      dialog,
      dialogRef,
      element,
      expectClosed,
      expectCloseOnly,
      expectFieldsDisabled,
      expectModelValues,
      expectValues,
      fileInput,
      keydownEvents,
      nameInput,
      receiptForm,
      submitForm,
    };
  };

  it('closes with the exact payload after one successful native submit', () =>
    runDialogCase(async () => {
      const save = vi
        .fn<ReceiptSubmitDialogData['save']>()
        .mockResolvedValue({ submitted: true });
      const editor = await openDialog(save);

      await editor.submitForm();
      await editor.expectClosed();

      expect(save).toHaveBeenCalledExactlyOnceWith(expectedPayload);
      expect(save.mock.calls[0]?.[0].file).toBe(receiptFile);
      expect(editor.closedResults).toEqual([expectedPayload]);
      expect(editor.closedResults[0]).toBe(save.mock.calls[0]?.[0]);
    }));

  it('retains the exact file, fields, and name after an editable save denial', () =>
    runDialogCase(async () => {
      const message = 'You no longer have permission to add this receipt.';
      const save = vi.fn<ReceiptSubmitDialogData['save']>().mockResolvedValue({
        message,
        retryAllowed: true,
        submitted: false,
      });
      const editor = await openDialog(save);

      await editor.submitForm();
      editor.detect();

      editor.expectValues();
      editor.expectFieldsDisabled(false);
      expect(save).toHaveBeenCalledExactlyOnceWith(expectedPayload);
      expect(save.mock.calls[0]?.[0].file).toBe(receiptFile);
      expect(
        editor.element.querySelector('[role="alert"]')?.textContent,
      ).toContain(message);
      expect(editor.element.querySelector('[role="status"]')).toBeNull();
      expect(button(editor.element, 'Submit receipt').disabled).toBe(false);
      expect(button(editor.element, 'Cancel').disabled).toBe(false);
      expect(editor.dialogRef.disableClose).toBe(false);
      expect(editor.dialog.openDialogs).toEqual([editor.dialogRef]);
      expect(editor.closedResults).toEqual([]);
    }));

  it('keeps an unknown outcome Close-only and blocks another native submit', () =>
    runDialogCase(async () => {
      const message =
        'The result could not be confirmed. Check the receipt lists before trying again.';
      const save = vi.fn<ReceiptSubmitDialogData['save']>().mockResolvedValue({
        message,
        retryAllowed: false,
        submitted: false,
      });
      const editor = await openDialog(save);

      await editor.submitForm();
      editor.expectCloseOnly(message);
      await editor.submitForm();

      editor.expectCloseOnly(message);
      expect(save).toHaveBeenCalledExactlyOnceWith(expectedPayload);
      expect(save.mock.calls[0]?.[0].file).toBe(receiptFile);
      button(editor.element, 'Close').click();
      await editor.expectClosed();
      expect(editor.closedResults).toHaveLength(1);
      expect(editor.closedResults[0]).toBeFalsy();
    }));

  it('keeps a submitted receipt Close-only when the follow-up read failed', () =>
    runDialogCase(async () => {
      const message =
        'Your receipt was submitted, but the receipt lists could not be refreshed.';
      const save = vi.fn<ReceiptSubmitDialogData['save']>().mockResolvedValue({
        message,
        submitted: true,
      });
      const editor = await openDialog(save);

      await editor.submitForm();
      editor.expectCloseOnly(message);
      await editor.submitForm();

      editor.expectCloseOnly(message);
      expect(save).toHaveBeenCalledExactlyOnceWith(expectedPayload);
      expect(save.mock.calls[0]?.[0].file).toBe(receiptFile);
      button(editor.element, 'Close').click();
      await editor.expectClosed();
      expect(editor.closedResults).toHaveLength(1);
      expect(editor.closedResults[0]).toBeFalsy();
    }));

  it('blocks duplicate submits, edits, removal, Cancel, and Escape while save is held', () =>
    runDialogCase(async () => {
      const settledOutcome: ReceiptSubmitSaveOutcome = {
        message: 'The receipt could not be submitted. Review the details.',
        retryAllowed: true,
        submitted: false,
      };
      const held = holdSave(settledOutcome);
      const save = vi
        .fn<ReceiptSubmitDialogData['save']>()
        .mockImplementation(() => held.promise);
      const editor = await openDialog(save);

      const operation = editor.submitForm();
      editor.detect();
      editor.expectValues();
      editor.expectFieldsDisabled(true);
      expect(button(editor.element, 'Adding receipt…').disabled).toBe(true);
      expect(button(editor.element, 'Cancel').disabled).toBe(true);
      expect(editor.dialogRef.disableClose).toBe(true);
      expect(
        editor.element.querySelector('[role="status"]')?.textContent,
      ).toContain('Adding the receipt and checking the receipt lists.');
      expect(editor.element.querySelector('[role="alert"]')).toBeNull();
      await editor.submitForm();
      button(editor.element, 'Remove').click();
      button(editor.element, 'Cancel').click();
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          code: 'Escape',
          key: 'Escape',
          keyCode: 27,
        }),
      );
      editor.detect();
      editor.expectValues();
      expect(editor.keydownEvents.map((event) => event.key)).toEqual([
        'Escape',
      ]);

      // Dispatch changes directly as well, to exercise the native handler guards.
      const replacement = new File(['replacement'], 'replacement.pdf', {
        type: 'application/pdf',
      });
      selectFile(editor.fileInput, replacement);
      editor.nameInput.value = 'Replacement receipt';
      editor.nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      button(editor.element, 'Remove').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      editor.detect();
      editor.expectModelValues();
      editor.expectFieldsDisabled(true);
      expect(editor.element.textContent).toContain(receiptFile.name);
      expect(editor.element.textContent).not.toContain(replacement.name);
      expect(editor.dialog.openDialogs).toEqual([editor.dialogRef]);
      expect(editor.closedResults).toEqual([]);
      expect(save).toHaveBeenCalledExactlyOnceWith(expectedPayload);
      expect(save.mock.calls[0]?.[0].file).toBe(receiptFile);

      held.release(settledOutcome);
      await operation;
      editor.detect();

      editor.expectModelValues();
      editor.expectFieldsDisabled(false);
      expect(editor.dialogRef.disableClose).toBe(false);
      expect(button(editor.element, 'Submit receipt').disabled).toBe(false);
      expect(button(editor.element, 'Cancel').disabled).toBe(false);
      expect(editor.element.querySelector('[role="status"]')).toBeNull();
      expect(
        editor.element.querySelector('[role="alert"]')?.textContent,
      ).toContain(settledOutcome.message);
      expect(save).toHaveBeenCalledExactlyOnceWith(expectedPayload);
      button(editor.element, 'Cancel').click();
      await editor.expectClosed();
      expect(editor.closedResults).toHaveLength(1);
      expect(editor.closedResults[0]).toBeFalsy();
    }));
  it.each(['throwing', 'rejecting'] as const)(
    'keeps an unexpected %s save callback Close-only and reports its original error once',
    async (failureMode) => {
      await runDialogCase(async () => {
        const error = new Error('Unexpected receipt callback failure');
        const save = vi.fn<ReceiptSubmitDialogData['save']>();
        if (failureMode === 'throwing')
          save.mockImplementation(() => {
            throw error;
          });
        else save.mockRejectedValue(error);
        const editor = await openDialog(save);
        const message =
          'The receipt submission outcome could not be confirmed. Your file and entries are still here. Close this dialog and load the event page again to check its receipts before trying again.';

        await editor.submitForm();
        editor.expectCloseOnly(message);
        await editor.submitForm();
        editor.expectCloseOnly(message);

        expect(save).toHaveBeenCalledExactlyOnceWith(expectedPayload);
        expect(save.mock.calls[0]?.[0].file).toBe(receiptFile);
        expect(unexpectedError).toHaveBeenCalledExactlyOnceWith(error);
        expect(editor.component['submissionConfirmed']()).toBe(false);
        expect(editor.component['submissionUncertain']()).toBe(true);
        button(editor.element, 'Close').click();
        await editor.expectClosed();
        expect(editor.closedResults).toHaveLength(1);
        expect(editor.closedResults[0]).toBeFalsy();
      });
    },
  );

  it('preserves a confirmed submission if dialog close fails and reports the close error without replay', () =>
    runDialogCase(async () => {
      const error = new Error('Dialog close failed');
      const save = vi
        .fn<ReceiptSubmitDialogData['save']>()
        .mockResolvedValue({ submitted: true });
      const editor = await openDialog(save);
      const close = vi.spyOn(editor.dialogRef, 'close');
      close.mockImplementationOnce(() => {
        throw error;
      });
      const message =
        'The receipt was submitted, but this dialog could not be completed. Close it and load the event page again to see it.';

      await editor.submitForm();
      editor.expectCloseOnly(message);
      await editor.submitForm();
      editor.expectCloseOnly(message);

      expect(save).toHaveBeenCalledExactlyOnceWith(expectedPayload);
      expect(unexpectedError).toHaveBeenCalledExactlyOnceWith(error);
      expect(editor.component['submissionConfirmed']()).toBe(true);
      expect(editor.component['submissionUncertain']()).toBe(false);
      button(editor.element, 'Close').click();
      await editor.expectClosed();
      expect(editor.closedResults).toHaveLength(1);
      expect(editor.closedResults[0]).toBeFalsy();
    }));
});
