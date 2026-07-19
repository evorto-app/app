import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, expect, it, vi } from 'vitest';

import {
  type PlatformReimbursementConfirmationData,
  PlatformReimbursementConfirmationDialogComponent,
} from './platform-reimbursement-confirmation-dialog.component';

describe('PlatformReimbursementConfirmationDialogComponent', () => {
  it('shows the complete payout batch before it can be recorded', async () => {
    const data: PlatformReimbursementConfirmationData = {
      currency: 'EUR',
      payoutDestination: 'DE89370400440532013000',
      payoutMethod: 'Bank transfer',
      receiptCount: 2,
      recipient: 'Ada Lovelace',
      totalAmount: 2900,
    };
    await TestBed.configureTestingModule({
      imports: [PlatformReimbursementConfirmationDialogComponent],
      providers: [
        { provide: LOCALE_ID, useValue: 'en-US' },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(
      PlatformReimbursementConfirmationDialogComponent,
    );
    await fixture.whenStable();

    const root: HTMLElement = fixture.nativeElement;
    const text = root.textContent?.replaceAll(/\s+/g, ' ').trim();
    const details = Object.fromEntries(
      [...root.querySelectorAll(':scope dl > div')].map((row) => [
        row.querySelector('dt')?.textContent?.trim(),
        row.querySelector('dd')?.textContent?.replaceAll(/\s+/g, ' ').trim(),
      ]),
    );
    expect(details).toEqual({
      Currency: 'EUR',
      'Payout destination': 'Bank transfer · DE89370400440532013000',
      Receipts: '2',
      Recipient: 'Ada Lovelace',
      Total: '€29.00',
    });
    expect(text).toContain('cannot be undone');
    expect(
      [...root.querySelectorAll('button')].map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual(['Go back', 'Record reimbursement']);
  });
});
