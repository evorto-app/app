import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RegistrationTransferDialogComponent,
  type RegistrationTransferDialogData,
  RegistrationTransferDialogOperations,
} from './registration-transfer-dialog.component';

const close = vi.fn();
const findTransferTargets = vi.fn();
const previewTransfer = vi.fn();

const dialogData: RegistrationTransferDialogData = {
  currentUser: {
    email: 'stale-source@example.com',
    firstName: 'Stale',
    lastName: 'Source',
  },
  eventId: 'event-1',
  registrationId: 'registration-1',
};

const preview = {
  bundle: {
    addOns: [
      {
        cancelledQuantity: 1,
        currentUnitPrice: 0,
        description: null,
        id: 'addon-1',
        includedQuantity: 2,
        purchasedQuantity: 3,
        quantity: 5,
        redeemedQuantity: 2,
        remainingQuantity: 2,
        title: 'Welcome dinner',
      },
    ],
    checkedInGuestCount: 1,
    checkInTime: null,
    guestCount: 2,
    guestUnitPrice: 0,
  },
  completionMode: 'databaseOnly',
  currency: 'EUR',
  previewVersion: 'authoritative-preview-v1',
  pricing: {
    appliedDiscountedPrice: 0,
    appliedDiscountType: 'esnCard',
    discountAmount: 1200,
    recipientBundlePrice: 0,
    recipientRegistrationPrice: 0,
    sourceRefundAmountDue: 0,
  },
  recipient: {
    email: 'riley@example.com',
    firstName: 'Riley',
    id: 'user-2',
    lastName: 'Recipient',
  },
  registrationOption: {
    currentPrice: 1200,
    id: 'option-1',
    title: 'Participant ticket',
  },
  source: {
    email: 'alex@example.com',
    firstName: 'Alex',
    id: 'user-1',
    lastName: 'Able',
  },
} as const;

const normalizeText = (
  fixture: ComponentFixture<RegistrationTransferDialogComponent>,
): string => fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

const findButton = (
  fixture: ComponentFixture<RegistrationTransferDialogComponent>,
  label: string,
): HTMLButtonElement | undefined => {
  const root: HTMLElement = fixture.nativeElement;
  return [...root.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(label),
  );
};

describe('RegistrationTransferDialogComponent', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    close.mockReset();
    findTransferTargets.mockReset();
    findTransferTargets.mockResolvedValue([
      {
        email: 'riley@example.com',
        firstName: 'Riley',
        id: 'user-2',
        lastName: 'Recipient',
      },
    ]);
    previewTransfer.mockReset();
    previewTransfer.mockResolvedValue(preview);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, retry: false },
      },
    });

    await TestBed.configureTestingModule({
      imports: [RegistrationTransferDialogComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: { close } },
        {
          provide: RegistrationTransferDialogOperations,
          useValue: {
            findTransferTargets: (input: object) => ({
              queryFn: findTransferTargets,
              queryKey: ['transfer-targets', input],
            }),
            previewTransfer: (input: object) => ({
              queryFn: previewTransfer,
              queryKey: ['transfer-preview', input],
            }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    for (const element of document.querySelectorAll(
      'app-registration-transfer-dialog',
    )) {
      element.remove();
    }
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  const render = async (): Promise<
    ComponentFixture<RegistrationTransferDialogComponent>
  > => {
    const fixture = TestBed.createComponent(
      RegistrationTransferDialogComponent,
    );
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Riley Recipient');
    });

    return fixture;
  };

  const selectRecipient = async (
    fixture: ComponentFixture<RegistrationTransferDialogComponent>,
  ): Promise<void> => {
    findButton(fixture, 'Riley Recipient')?.click();
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Transfer reviewed bundle');
    });
  };

  it('renders only the authoritative preview before confirmation', async () => {
    const fixture = await render();

    expect(close).not.toHaveBeenCalled();
    await selectRecipient(fixture);

    const text = normalizeText(fixture);
    expect(text).toContain('Review direct transfer');
    expect(text).toContain('Alex Able (alex@example.com)');
    expect(text).not.toContain('Stale Source (stale-source@example.com)');
    expect(text).toContain('Riley Recipient (riley@example.com)');
    expect(text).toContain('1 × Participant ticket');
    expect(text).toContain('2 additional guests');
    expect(text).toContain('1 of 2 guests checked in');
    expect(text).toContain('5 × Welcome dinner');
    expect(text).toContain(
      '2 included · 3 purchased · 2 remaining · 2 redeemed · 1 cancelled',
    );
    expect(text).toContain("Recipient's current ESNcard discount applied");
    expect(text).toContain('recipient cannot omit anything');
    expect(text).toContain('confirmation is rejected');
  });

  it('keeps cancel focused and returns the reviewed version only after confirmation', async () => {
    const fixture = await render();
    document.body.append(fixture.nativeElement);

    const initialCancel = findButton(fixture, 'Cancel');
    expect(initialCancel?.hasAttribute('cdkfocusinitial')).toBe(true);

    findButton(fixture, 'Riley Recipient')?.click();
    fixture.detectChanges();

    const reviewCancel = findButton(fixture, 'Cancel');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(document.activeElement).toBe(reviewCancel);
    });
    expect(close).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findButton(fixture, 'Transfer reviewed bundle')).toBeDefined();
    });
    findButton(fixture, 'Transfer reviewed bundle')?.click();

    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith({
      previewVersion: 'authoritative-preview-v1',
      targetUserId: 'user-2',
    });
  });

  it('shows preview failures inline and never enables confirmation', async () => {
    previewTransfer.mockRejectedValue(
      new Error('A private transfer offer is required for this recipient.'),
    );
    const fixture = await render();

    findButton(fixture, 'Riley Recipient')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(
        'A private transfer offer is required for this recipient.',
      );
    });

    expect(normalizeText(fixture)).toContain('Direct transfer is unavailable');
    expect(findButton(fixture, 'Transfer reviewed bundle')).toBeUndefined();
    expect(close).not.toHaveBeenCalled();
  });

  it('returns to recipient selection without mutating the registration', async () => {
    const fixture = await render();

    await selectRecipient(fixture);
    findButton(fixture, 'Back')?.click();
    fixture.detectChanges();

    expect(normalizeText(fixture)).toContain('Choose the new participant');
    expect(normalizeText(fixture)).not.toContain('Review direct transfer');
    expect(close).not.toHaveBeenCalled();
  });
});
