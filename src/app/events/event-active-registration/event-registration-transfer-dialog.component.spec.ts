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
            claimCode: 'claim-code',
            claimUrl: 'https://example.test/registration-transfers/claim-code',
            expiresAt: '2030-05-01T12:00:00.000Z',
            status: 'open',
          } satisfies EventRegistrationTransferDialogData,
        },
      ],
    }).compileComponents();
  });

  it.each([
    ['Copy link', 'Claim link copied to clipboard.'],
    ['Copy code', 'Claim code copied to clipboard.'],
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
});
