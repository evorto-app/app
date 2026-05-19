import { DEFAULT_CURRENCY_CODE } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PriceWithTaxComponent } from './price-with-tax.component';

const renderPriceWithTax = async (inputs: {
  amount: number;
  currency?: string;
  isFree?: boolean;
  taxRate?: null | {
    displayName?: null | string;
    percentage?: null | string;
    stripeTaxRateId?: null | string;
  };
}): Promise<ComponentFixture<PriceWithTaxComponent>> => {
  const fixture = TestBed.createComponent(PriceWithTaxComponent);
  fixture.componentRef.setInput('amount', inputs.amount);
  if (inputs.currency !== undefined) {
    fixture.componentRef.setInput('currency', inputs.currency);
  }
  if (inputs.isFree !== undefined) {
    fixture.componentRef.setInput('isFree', inputs.isFree);
  }
  if (inputs.taxRate !== undefined) {
    fixture.componentRef.setInput('taxRate', inputs.taxRate);
  }
  fixture.detectChanges();
  return fixture;
};

describe('PriceWithTaxComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PriceWithTaxComponent],
      providers: [{ provide: DEFAULT_CURRENCY_CODE, useValue: 'CZK' }],
    }).compileComponents();
  });

  it('renders paid prices with inclusive tax labels', async () => {
    const fixture = await renderPriceWithTax({
      amount: 2500,
      taxRate: {
        displayName: 'VAT',
        percentage: '19',
      },
    });

    expect(fixture.nativeElement.textContent).toContain('CZK25.00');
    expect(fixture.nativeElement.textContent).toContain('Incl. 19% VAT');
  });

  it('allows explicit currency overrides', async () => {
    const fixture = await renderPriceWithTax({
      amount: 2500,
      currency: 'EUR',
      taxRate: {
        displayName: 'VAT',
        percentage: '19',
      },
    });

    expect(fixture.nativeElement.textContent).toContain('€25.00');
  });

  it('does not render tax labels for free options', async () => {
    const fixture = await renderPriceWithTax({
      amount: 0,
      isFree: true,
      taxRate: {
        displayName: 'VAT',
        percentage: '19',
      },
    });

    expect(fixture.nativeElement.textContent).toContain('Free');
    expect(fixture.nativeElement.textContent).not.toContain('Incl.');
    expect(fixture.nativeElement.textContent).not.toContain('VAT');
  });

  it('renders zero percent tax rates as tax free', async () => {
    const fixture = await renderPriceWithTax({
      amount: 1200,
      taxRate: {
        displayName: 'VAT',
        percentage: '0.00',
      },
    });

    expect(fixture.nativeElement.textContent).toContain('CZK12.00');
    expect(fixture.nativeElement.textContent).toContain('Tax free');
  });

  it('uses the fallback tax label when tax details are unavailable', async () => {
    const fixture = await renderPriceWithTax({
      amount: 1200,
      taxRate: {
        stripeTaxRateId: 'txr_missing_details',
      },
    });

    expect(fixture.nativeElement.textContent).toContain('CZK12.00');
    expect(fixture.nativeElement.textContent).toContain('Incl. Tax');
  });
});
