import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registrationAddonCancellationAllocation,
  RegistrationAddonCancellationDialogComponent,
  registrationAddonCancellationResult,
  registrationAddonRefundChoiceDescription,
  registrationAddonRefundChoiceTitle,
  registrationAddonRefundQuantityDescription,
} from './registration-addon-cancellation-dialog.component';

describe('registrationAddonRefundChoiceDescription', () => {
  it('makes free optional add-on cancellation explicit', () => {
    expect(
      registrationAddonRefundChoiceDescription('noMonetaryRefundRequired'),
    ).toBe(
      'No monetary refund is required because these optional units were free. The result will be recorded as refund not required.',
    );
    expect(registrationAddonRefundChoiceTitle('noMonetaryRefundRequired')).toBe(
      'Cancel with refund handling (no payment refund)',
    );
  });

  it('distinguishes a monetary refund from an ineligible purchase', () => {
    expect(
      registrationAddonRefundChoiceDescription('monetaryRefundAvailable'),
    ).toContain('Refund the eligible payment');
    expect(registrationAddonRefundChoiceDescription('none')).toContain(
      'No optional purchase',
    );
    expect(registrationAddonRefundChoiceTitle('monetaryRefundAvailable')).toBe(
      'Cancel with refund',
    );
  });
});

describe('registrationAddonCancellationAllocation', () => {
  it('allocates optional purchases before included units', () => {
    expect(
      registrationAddonCancellationAllocation({
        cancellablePurchasedQuantity: 2,
        quantity: 1,
      }),
    ).toEqual({ includedQuantity: 0, optionalQuantity: 1 });
    expect(
      registrationAddonCancellationAllocation({
        cancellablePurchasedQuantity: 2,
        quantity: 3,
      }),
    ).toEqual({ includedQuantity: 1, optionalQuantity: 2 });
  });
});

describe('registrationAddonRefundQuantityDescription', () => {
  it('separates total cancellable units from the optional refundable portion', () => {
    expect(registrationAddonRefundQuantityDescription(2)).toBe(
      'Up to 2 optional units may have refund handling. Included units are never refunded.',
    );
    expect(registrationAddonRefundQuantityDescription(0)).toBe(
      'Only included units remain. No payment refund applies to them.',
    );
  });
});

describe('registrationAddonCancellationResult', () => {
  it('normalizes a valid cancellation and preserves the refund choice', () => {
    expect(
      registrationAddonCancellationResult({
        cancellablePurchasedQuantity: 2,
        maxQuantity: 3,
        model: {
          quantity: 2,
          reason: '  Attendee no longer needs these units.  ',
          refundChoice: 'refund',
        },
      }),
    ).toEqual({
      quantity: 2,
      reason: 'Attendee no longer needs these units.',
      refundRequested: true,
    });
  });

  it('rejects missing decisions, blank reasons, fractions, and excess units', () => {
    for (const model of [
      { quantity: 1, reason: 'Reason', refundChoice: '' as const },
      { quantity: 1, reason: '  ', refundChoice: 'noRefund' as const },
      {
        quantity: 1,
        reason: 'x'.repeat(501),
        refundChoice: 'noRefund' as const,
      },
      { quantity: 1.5, reason: 'Reason', refundChoice: 'refund' as const },
      { quantity: 4, reason: 'Reason', refundChoice: 'refund' as const },
    ]) {
      expect(
        registrationAddonCancellationResult({
          cancellablePurchasedQuantity: 2,
          maxQuantity: 3,
          model,
        }),
      ).toBeUndefined();
    }
  });

  it('forces included-only cancellations to no refund', () => {
    expect(
      registrationAddonCancellationResult({
        cancellablePurchasedQuantity: 0,
        maxQuantity: 1,
        model: {
          quantity: 1,
          reason: 'Included unit no longer needed',
          refundChoice: 'refund',
        },
      }),
    ).toEqual({
      quantity: 1,
      reason: 'Included unit no longer needed',
      refundRequested: false,
    });
  });
});

describe('RegistrationAddonCancellationDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegistrationAddonCancellationDialogComponent],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            addOnTitle: 'Included checklist',
            cancellablePurchasedQuantity: 0,
            cancellableQuantity: 2,
            refundAvailability: 'none',
          },
        },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('renders the included-only outcome and rejects fractional quantities', async () => {
    const fixture = TestBed.createComponent(
      RegistrationAddonCancellationDialogComponent,
    );
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('No refund applies.');
    expect(fixture.nativeElement.querySelector('mat-radio-group')).toBeNull();

    const reason: HTMLTextAreaElement =
      fixture.nativeElement.querySelector('textarea');
    reason.value = 'Checklist no longer needed';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    const submit: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    );
    expect(submit.disabled).toBe(false);

    const quantity: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[type="number"]',
    );
    quantity.value = '1.5';
    quantity.dispatchEvent(new Event('input', { bubbles: true }));
    quantity.focus();
    quantity.blur();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain(
      'Choose an available whole-unit quantity.',
    );
    expect(submit.disabled).toBe(true);
  });
});
