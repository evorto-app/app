import { DEFAULT_CURRENCY_CODE, LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ReceiptAmountPipe } from './receipt-amount.pipe';

describe('ReceiptAmountPipe', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: DEFAULT_CURRENCY_CODE, useValue: 'CZK' },
        { provide: LOCALE_ID, useValue: 'en-US' },
      ],
    });
  });

  it('formats minor units with the injected tenant currency', () => {
    const pipe = TestBed.runInInjectionContext(() => new ReceiptAmountPipe());

    expect(pipe.transform(12_345)).toBe('CZK123.45');
  });

  it('supports an explicit currency override without changing the amount unit', () => {
    const pipe = TestBed.runInInjectionContext(() => new ReceiptAmountPipe());

    expect(pipe.transform(12_345, 'AUD')).toBe('A$123.45');
  });
});
