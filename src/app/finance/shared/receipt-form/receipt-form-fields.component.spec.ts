import { DEFAULT_CURRENCY_CODE } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NonNullableFormBuilder } from '@angular/forms';
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
});
