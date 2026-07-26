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
    ['Copy code', 'Claim code copied to clipboard.'],
    ['Copy claim page link', 'Claim page link copied to clipboard.'],
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

  it('keeps the private code separate from the generic claim page URL', () => {
    const fixture = TestBed.createComponent(
      EventRegistrationTransferDialogComponent,
    );
    fixture.detectChanges();
    const nativeElement = fixture.nativeElement as HTMLElement;
    const inputs = [
      ...nativeElement.querySelectorAll<HTMLInputElement>('input'),
    ];
    const claimCode = inputs.find((input) =>
      input.value.includes('ABCD-1234'),
    )?.value;
    const claimPageUrl = inputs.find((input) =>
      input.value.startsWith('https://'),
    )?.value;

    expect(claimCode).toBe('ABCD-1234-EF56-7890-ABCD-1234-EF56-7890');
    expect(claimPageUrl).toBe('https://example.test/registration-transfers');
    expect(claimPageUrl).not.toContain(claimCode);
  });
});
