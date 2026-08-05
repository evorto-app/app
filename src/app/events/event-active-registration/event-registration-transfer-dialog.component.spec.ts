import '@angular/compiler';
import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EventRegistrationTransferDialogComponent,
  EventRegistrationTransferDialogData,
} from './event-registration-transfer-dialog.component';

describe('EventRegistrationTransferDialogComponent', () => {
  const clipboard = { copy: vi.fn(() => true) };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [EventRegistrationTransferDialogComponent],
      providers: [
        { provide: Clipboard, useValue: clipboard },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            claimCode: 'ABCD-1234-EF56-7890-ABCD-1234-EF56-7890',
            claimPageUrl: 'https://example.test/registration-transfers',
            expiresAt: '2030-05-01T12:00:00.000Z',
            status: 'open',
          } satisfies EventRegistrationTransferDialogData,
        },
      ],
    }).compileComponents();
  });

  it.each([
    ['Copy code', 'Transfer code copied to clipboard.'],
    ['Copy transfer page link', 'Transfer page link copied to clipboard.'],
  ])('announces successful %s actions', (buttonLabel, announcement) => {
    const fixture = TestBed.createComponent(
      EventRegistrationTransferDialogComponent,
    );
    fixture.detectChanges();
    const nativeElement = fixture.nativeElement as HTMLElement;

    const button = [
      ...nativeElement.querySelectorAll<HTMLButtonElement>('button'),
    ].find((candidate) => candidate.textContent?.includes(buttonLabel));
    button?.click();
    fixture.detectChanges();

    const status = nativeElement.querySelector<HTMLElement>('[role="status"]');
    expect(button).toBeDefined();
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain(announcement);
  });

  it('copies the transfer page without displaying its address', () => {
    const fixture = TestBed.createComponent(
      EventRegistrationTransferDialogComponent,
    );
    fixture.detectChanges();
    const nativeElement = fixture.nativeElement as HTMLElement;
    const claimCode = nativeElement.querySelector<HTMLInputElement>('input');
    const copyPageLink = [
      ...nativeElement.querySelectorAll<HTMLButtonElement>('button'),
    ].find((candidate) =>
      candidate.textContent?.includes('Copy transfer page link'),
    );
    copyPageLink?.click();

    expect(claimCode?.value).toBe('ABCD-1234-EF56-7890-ABCD-1234-EF56-7890');
    expect(nativeElement.textContent).not.toContain(
      'https://example.test/registration-transfers',
    );
    expect(copyPageLink).toBeDefined();
    expect(clipboard.copy).toHaveBeenCalledWith(
      'https://example.test/registration-transfers',
    );
    expect('https://example.test/registration-transfers').not.toContain(
      claimCode?.value,
    );
  });
});
