import '@angular/compiler';
import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import {
  MAT_DIALOG_DEFAULT_OPTIONS,
  MatDialog,
} from '@angular/material/dialog';
import { RpcForbiddenError } from '@shared/errors/rpc-errors';
import { EventCheckInUnavailableError } from '@shared/rpc-contracts/app-rpcs/events.errors';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import {
  ManualCheckInDialogComponent,
  type ManualCheckInDialogData,
  type ManualCheckInDialogResult,
} from './manual-check-in-dialog.component';

const baseScanResult = {
  allowCheckin: true,
  alreadyCheckedInIssue: false,
  attendeeCheckedIn: false,
  checkedInGuestCount: 0,
  checkInTimingIssue: null as 'ended' | 'notOpen' | null,
  guestCount: 2,
  registrationOption: { title: 'Standard ticket' },
  registrationStatus: 'CONFIRMED',
  registrationStatusIssue: false,
  remainingGuestCount: 2,
  sameUserIssue: false,
};

describe('ManualCheckInDialogComponent', () => {
  const checkIn = vi.fn();
  const loadScan = vi.fn();
  let queryClient: QueryClient;

  beforeEach(async () => {
    checkIn.mockReset();
    loadScan.mockReset().mockResolvedValue(baseScanResult);
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    await TestBed.configureTestingModule({
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: MAT_DIALOG_DEFAULT_OPTIONS,
          useValue: {
            autoFocus: false,
            disableClose: false,
            enterAnimationDuration: 0,
            exitAnimationDuration: 0,
            restoreFocus: false,
          },
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            events: {
              checkInRegistration: {
                mutationOptions: () => ({ mutationFn: checkIn }),
              },
              registrationScanned: {
                queryOptions: (input: { registrationId: string }) => ({
                  queryFn: loadScan,
                  queryKey: ['registration-scanned', input.registrationId],
                }),
              },
            },
            queryFilter: (segments: readonly string[]) => ({
              queryKey: segments,
            }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    TestBed.resetTestingModule();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  const openDialog = async () => {
    const dialog = TestBed.inject(MatDialog);
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const closedResults: (ManualCheckInDialogResult | undefined)[] = [];
    const dialogRef = dialog.open<
      ManualCheckInDialogComponent,
      ManualCheckInDialogData,
      ManualCheckInDialogResult
    >(ManualCheckInDialogComponent, {
      data: { attendeeName: 'Alex Able', registrationId: 'registration-1' },
    });
    dialogRef.afterClosed().subscribe((result) => {
      closedResults.push(result);
    });
    const settle = async (assertion: () => void) => {
      await vi.waitFor(() => {
        TestBed.tick();
        assertion();
      });
    };
    await settle(() => {
      expect(overlay.textContent).toContain('Check in Alex Able');
    });
    const text = () => overlay.textContent ?? '';
    const button = (label: string): HTMLButtonElement => {
      const result = [
        ...overlay.querySelectorAll<HTMLButtonElement>('button'),
      ].find((candidate) => candidate.textContent?.trim() === label);
      if (!result) {
        throw new Error(`Expected the ${label} button.`);
      }
      return result;
    };
    const guestInput = () =>
      overlay.querySelector<HTMLInputElement>('input[type="number"]');
    return { button, closedResults, guestInput, overlay, settle, text };
  };

  it('hides the guest field when no guests remain', async () => {
    loadScan.mockResolvedValue({
      ...baseScanResult,
      guestCount: 0,
      remainingGuestCount: 0,
    });
    const { button, guestInput, settle } = await openDialog();

    await settle(() => {
      expect(button('Confirm check-in')).toBeDefined();
    });
    expect(guestInput()).toBeNull();
  });

  it('shows the guest field and clamps the input to the remaining guests', async () => {
    const { button, guestInput, settle } = await openDialog();

    await settle(() => {
      expect(guestInput()).not.toBeNull();
    });
    const input = guestInput();
    if (!input) {
      throw new Error('Expected the guest input.');
    }
    input.value = '9';
    input.dispatchEvent(new Event('input'));
    await settle(() => {
      expect(button('Confirm 3 check-ins')).toBeDefined();
    });
    expect(input.value).toBe('2');
    input.value = '8';
    input.dispatchEvent(new Event('input'));
    await settle(() => {
      expect(input.value).toBe('2');
    });
    expect(button('Confirm 3 check-ins')).toBeDefined();
  });

  it('shows the timing issue and blocks confirmation', async () => {
    loadScan.mockResolvedValue({
      ...baseScanResult,
      allowCheckin: false,
      checkInTimingIssue: 'notOpen',
    });
    const { button, guestInput, settle, text } = await openDialog();

    await settle(() => {
      expect(text()).toContain('Check-in not open');
    });
    expect(text()).toContain(
      'Check-in opens one hour before the event starts.',
    );
    expect(button('Confirm check-in').disabled).toBe(true);
    expect(guestInput()).toBeNull();
  });

  it('sends the selected guests and closes with the result', async () => {
    checkIn.mockResolvedValue({
      alreadyCheckedIn: false,
      checkInTime: '2026-11-10T10:00:00.000Z',
    });
    const { button, closedResults, guestInput, settle } = await openDialog();

    await settle(() => {
      expect(guestInput()).not.toBeNull();
    });
    const input = guestInput();
    if (!input) {
      throw new Error('Expected the guest input.');
    }
    input.value = '1';
    input.dispatchEvent(new Event('input'));
    await settle(() => {
      expect(button('Confirm 2 check-ins')).toBeDefined();
    });
    button('Confirm 2 check-ins').click();

    await settle(() => {
      expect(closedResults).toEqual([{ alreadyCheckedIn: false }]);
    });
    expect(checkIn.mock.calls[0]?.[0]).toEqual({
      guestCheckInCount: 1,
      registrationId: 'registration-1',
    });
  });

  it('keeps the dialog open and explains a failed check-in', async () => {
    checkIn.mockRejectedValue(
      new EventCheckInUnavailableError({
        message: 'Check-in opens one hour before this event starts.',
        reason: 'notOpen',
      }),
    );
    const { button, closedResults, settle, text } = await openDialog();

    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(false);
    });
    button('Confirm check-in').click();

    await settle(() => {
      expect(text()).toContain(
        'Check-in opens one hour before this event starts.',
      );
    });
    expect(closedResults).toEqual([]);
    expect(
      TestBed.inject(OverlayContainer)
        .getContainerElement()
        .querySelector('[role="alert"]'),
    ).not.toBeNull();
  });

  it('does not tell the organizer to retry a forbidden check-in', async () => {
    checkIn.mockRejectedValue(
      new RpcForbiddenError({ message: 'Private permission detail' }),
    );
    const { button, closedResults, settle, text } = await openDialog();

    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(false);
    });
    button('Confirm check-in').click();

    await settle(() => {
      expect(text()).toContain('You cannot check in tickets for this event.');
    });
    expect(text()).not.toContain('Try again');
    expect(text()).not.toContain('Private permission detail');
    expect(closedResults).toEqual([]);
  });

  it('closes after a successful check-in without waiting for the refresh', async () => {
    let releaseRefresh: (() => void) | undefined;
    // Angular's browser target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(pendingRefresh);
    checkIn.mockResolvedValue({
      alreadyCheckedIn: false,
      checkInTime: '2026-11-10T10:00:00.000Z',
    });
    const { button, closedResults, settle } = await openDialog();

    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(false);
    });
    button('Confirm check-in').click();

    await settle(() => {
      expect(closedResults).toEqual([{ alreadyCheckedIn: false }]);
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledOnce();
    releaseRefresh?.();
  });

  it('tells the organizer when they may not check in this event', async () => {
    loadScan.mockRejectedValue(
      new RpcForbiddenError({ message: 'Private permission detail' }),
    );
    const { settle, text } = await openDialog();

    await settle(() => {
      expect(text()).toContain('You cannot check in tickets for this event.');
    });
    expect(text()).not.toContain('Private permission detail');
  });
});
