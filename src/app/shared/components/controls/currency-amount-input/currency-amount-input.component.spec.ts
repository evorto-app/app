import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, hidden, min } from '@angular/forms/signals';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CurrencyAmountInputComponent,
  majorCurrencyInputToMinorUnits,
  minorUnitsToMajorCurrencyInput,
} from './currency-amount-input.component';

@Component({
  imports: [CurrencyAmountInputComponent, FormField],
  template: `
    @if (!amountForm.amount().hidden()) {
      <app-currency-amount-input
        currencyCode="EUR"
        label="Price"
        [formField]="amountForm.amount"
      />
    }
  `,
})
class CurrencyAmountInputHost {
  readonly amountModel = signal({ amount: 450, isPaid: true });
  readonly amountForm = form(this.amountModel, (amount) => {
    hidden(amount.amount, ({ valueOf }) => !valueOf(amount.isPaid));
    min(amount.amount, 1, { message: 'Amount must be at least EUR 0.01.' });
  });
}

const amountInput = (fixture: ComponentFixture<unknown>): HTMLInputElement => {
  const input: HTMLInputElement | null =
    fixture.nativeElement.querySelector('input');
  if (!input) throw new Error('Expected the currency amount input');
  return input;
};

describe('currency amount conversion', () => {
  it('converts ordinary two-decimal amounts to and from integer minor units', () => {
    expect(majorCurrencyInputToMinorUnits('12.34', false)).toEqual({
      value: 1234,
    });
    expect(majorCurrencyInputToMinorUnits('0.29', false)).toEqual({
      value: 29,
    });
    expect(minorUnitsToMajorCurrencyInput(1234)).toBe('12.34');
    expect(minorUnitsToMajorCurrencyInput(450)).toBe('4.5');
  });

  it('rejects fractional minor units and supports explicitly optional amounts', () => {
    expect(majorCurrencyInputToMinorUnits('1.001', false)).toEqual({
      error: {
        kind: 'currencyFraction',
        message: 'Enter an amount with no more than two decimal places.',
      },
    });
    expect(majorCurrencyInputToMinorUnits('', true)).toEqual({ value: '' });
    expect(majorCurrencyInputToMinorUnits('', false)).toEqual({
      error: { kind: 'currencyRequired', message: 'Enter an amount.' },
    });
  });
});

describe('CurrencyAmountInputComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows a normal currency amount and keeps the Signal Form model in minor units', async () => {
    await TestBed.configureTestingModule({
      imports: [CurrencyAmountInputHost],
    }).compileComponents();
    const fixture = TestBed.createComponent(CurrencyAmountInputHost);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Price (EUR)');
    const input = amountInput(fixture);
    expect(input.getAttribute('aria-label')).toBe('Price (EUR)');
    expect(input.labels?.[0]?.textContent).toContain('Price (EUR)');
    expect(input.value).toBe('4.5');

    input.value = '7.25';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.amountModel().amount).toBe(725);
    expect(fixture.componentInstance.amountForm().valid()).toBe(true);
  });

  it('renders a labelled native input when a paid amount becomes visible', async () => {
    await TestBed.configureTestingModule({
      imports: [CurrencyAmountInputHost],
    }).compileComponents();
    const fixture = TestBed.createComponent(CurrencyAmountInputHost);
    fixture.componentInstance.amountForm.isPaid().value.set(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('input')).toBeNull();

    fixture.componentInstance.amountForm.isPaid().value.set(true);
    fixture.detectChanges();

    const input = amountInput(fixture);
    expect(input.getAttribute('aria-label')).toBe('Price (EUR)');
    expect(input.labels?.[0]?.textContent).toContain('Price (EUR)');
  });

  it('reports too many decimal places without replacing the last valid minor-unit value', async () => {
    await TestBed.configureTestingModule({
      imports: [CurrencyAmountInputHost],
    }).compileComponents();
    const fixture = TestBed.createComponent(CurrencyAmountInputHost);
    fixture.detectChanges();

    const input = amountInput(fixture);
    input.value = '1.001';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(fixture.componentInstance.amountModel().amount).toBe(450);
    expect(fixture.componentInstance.amountForm().invalid()).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain(
      'Enter an amount with no more than two decimal places.',
    );
  });

  it('prioritizes the typed amount error over validation for the retained model value', async () => {
    await TestBed.configureTestingModule({
      imports: [CurrencyAmountInputHost],
    }).compileComponents();
    const fixture = TestBed.createComponent(CurrencyAmountInputHost);
    fixture.componentInstance.amountModel.set({ amount: 0, isPaid: true });
    fixture.detectChanges();

    const input = amountInput(fixture);
    input.value = '1.001';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Enter an amount with no more than two decimal places.',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Amount must be at least EUR 0.01.',
    );
  });
});
