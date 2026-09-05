import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { DEFAULT_CURRENCY_CODE } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NonNullableFormBuilder } from '@angular/forms';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { validateFinanceReceiptAmounts } from '@shared/finance/receipt-values';
import { beforeEach, describe, expect, it } from 'vitest';

import { ReceiptFormFieldsComponent } from './receipt-form-fields.component';
import { createReceiptForm } from './receipt-form.model';

describe('ReceiptFormFieldsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReceiptFormFieldsComponent],
      providers: [{ provide: DEFAULT_CURRENCY_CODE, useValue: 'AUD' }],
    }).compileComponents();
  });

  it.each([
    { amount: 'alcoholAmount', label: 'Alcohol purchased' },
    { amount: 'depositAmount', label: 'Deposit involved' },
  ] as const)(
    'clears $amount when its checkbox is unchecked',
    async ({ amount, label }) => {
      const fixture = TestBed.createComponent(ReceiptFormFieldsComponent);
      const form = createReceiptForm(
        TestBed.inject(NonNullableFormBuilder),
        'AU',
      );
      form.patchValue({
        alcoholAmount: 2,
        depositAmount: 3,
        hasAlcohol: true,
        hasDeposit: true,
        totalAmount: 10,
      });
      fixture.componentRef.setInput('form', form);
      fixture.componentRef.setInput('selectableCountries', ['AU']);
      fixture.detectChanges();

      const checkbox = await TestbedHarnessEnvironment.loader(
        fixture,
      ).getHarness(MatCheckboxHarness.with({ label }));
      await checkbox.uncheck();

      expect(form.controls[amount].value).toBe(0);
      expect(await checkbox.isChecked()).toBe(false);
      expect(validateFinanceReceiptAmounts(form.getRawValue())).toBeNull();
    },
  );

  it('labels every money field with the default tenant currency', () => {
    const fixture = TestBed.createComponent(ReceiptFormFieldsComponent);
    const form = createReceiptForm(
      TestBed.inject(NonNullableFormBuilder),
      'AU',
    );
    form.controls.hasAlcohol.setValue(true);
    form.controls.hasDeposit.setValue(true);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('selectableCountries', ['AU']);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Total amount (AUD)');
    expect(text).toContain('Tax amount (AUD)');
    expect(text).toContain('Deposit amount (AUD)');
    expect(text).toContain('Alcohol amount (AUD)');
    expect(text).not.toContain('(EUR)');
  });

  it('uses the receipt currency when reviewing a recorded amount', () => {
    const fixture = TestBed.createComponent(ReceiptFormFieldsComponent);
    const form = createReceiptForm(
      TestBed.inject(NonNullableFormBuilder),
      'CZ',
    );
    form.controls.hasAlcohol.setValue(true);
    form.controls.hasDeposit.setValue(true);
    fixture.componentRef.setInput('currencyCode', 'CZK');
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('selectableCountries', ['CZ']);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Total amount (CZK)');
    expect(text).toContain('Tax amount (CZK)');
    expect(text).not.toContain('(AUD)');
  });

  it('keeps the receipt date as a calendar-date string and requires a positive bounded total', () => {
    const fixture = TestBed.createComponent(ReceiptFormFieldsComponent);
    const form = createReceiptForm(
      TestBed.inject(NonNullableFormBuilder),
      'AU',
    );
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('selectableCountries', ['AU']);
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    const receiptDate =
      root.querySelector<HTMLInputElement>('input[type="date"]');
    expect(receiptDate?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/u);

    form.controls.totalAmount.setValue(0);
    expect(form.controls.totalAmount.invalid).toBe(true);
    form.controls.totalAmount.setValue(0.01);
    expect(form.controls.totalAmount.valid).toBe(true);
    form.controls.totalAmount.setValue(21_474_836.48);
    expect(form.controls.totalAmount.invalid).toBe(true);
  });
});
