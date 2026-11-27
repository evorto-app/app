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
  onlineManager,
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

const attendeeData: ManualCheckInDialogData = {
  attendeeName: 'Alex Able',
  mode: 'attendee',
  registrationId: 'registration-1',
  userId: 'attendee-1',
};

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
  user: { firstName: 'Alex', id: 'attendee-1', lastName: 'Able' },
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
                queryKey: (input: { registrationId: string }) => [
                  'registration-scanned',
                  input.registrationId,
                ],
                queryOptions: (input: {
                  checkInMethod: string;
                  registrationId: string;
                }) => ({
                  queryFn: () => loadScan(input),
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
    onlineManager.setOnline(true);
    TestBed.inject(MatDialog).closeAll();
    TestBed.resetTestingModule();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  const openDialog = async (
    data: ManualCheckInDialogData = attendeeData,
    expectedTitle = 'Check in Alex Able',
  ) => {
    const dialog = TestBed.inject(MatDialog);
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const closedResults: (ManualCheckInDialogResult | undefined)[] = [];
    const dialogRef = dialog.open<
      ManualCheckInDialogComponent,
      ManualCheckInDialogData,
      ManualCheckInDialogResult
    >(ManualCheckInDialogComponent, {
      data,
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
      expect(overlay.textContent).toContain(expectedTitle);
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

  it('blocks confirmation for more guests than remain', async () => {
    const { button, guestInput, settle, text } = await openDialog();

    await settle(() => {
      expect(guestInput()).not.toBeNull();
    });
    const input = guestInput();
    if (!input) {
      throw new Error('Expected the guest input.');
    }
    input.value = '9';
    input.dispatchEvent(new Event('input'));
    input.focus();
    input.blur();
    await settle(() => {
      expect(text()).toContain('Enter a whole number from 0 to 2.');
    });
    expect(button('Confirm check-in').disabled).toBe(true);
    expect(checkIn).not.toHaveBeenCalled();

    input.value = '1.5';
    input.dispatchEvent(new Event('input'));
    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(true);
    });

    input.value = '2';
    input.dispatchEvent(new Event('input'));
    await settle(() => {
      expect(button('Confirm 3 check-ins').disabled).toBe(false);
    });
    expect(text()).not.toContain('Enter a whole number');
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
      expect(closedResults).toEqual([
        { alreadyCheckedIn: false, checkedInGuestCount: 1 },
      ]);
    });
    expect(checkIn.mock.calls[0]?.[0]).toEqual({
      checkInMethod: 'manual',
      expectedAttendeeCheckedIn: false,
      expectedCheckedInGuestCount: 0,
      expectedUserId: 'attendee-1',
      guestCheckInCount: 1,
      operationKey: expect.any(String),
      registrationId: 'registration-1',
    });
  });

  it('looks the ticket up as a manual check-in', async () => {
    const { settle } = await openDialog();

    await settle(() => {
      expect(loadScan).toHaveBeenCalledWith({
        checkInMethod: 'manual',
        registrationId: 'registration-1',
      });
    });
  });

  it('starts the guest check-in at one guest for a checked-in attendee', async () => {
    loadScan.mockResolvedValue({
      ...baseScanResult,
      alreadyCheckedInIssue: true,
      attendeeCheckedIn: true,
      checkedInGuestCount: 1,
      remainingGuestCount: 1,
    });
    checkIn.mockResolvedValue({
      alreadyCheckedIn: true,
      checkInTime: '2026-11-10T10:00:00.000Z',
    });
    const { button, closedResults, guestInput, settle } = await openDialog(
      { ...attendeeData, mode: 'guests' },
      'Check in guests of Alex Able',
    );

    await settle(() => {
      expect(guestInput()?.value).toBe('1');
    });
    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(false);
    });
    button('Confirm check-in').click();

    await settle(() => {
      expect(closedResults).toEqual([
        { alreadyCheckedIn: true, checkedInGuestCount: 1 },
      ]);
    });
    expect(checkIn.mock.calls[0]?.[0]).toEqual({
      checkInMethod: 'manual',
      expectedAttendeeCheckedIn: true,
      expectedCheckedInGuestCount: 1,
      expectedUserId: 'attendee-1',
      guestCheckInCount: 1,
      operationKey: expect.any(String),
      registrationId: 'registration-1',
    });
  });

  it('resends the same request after an unconfirmed check-in', async () => {
    checkIn
      .mockRejectedValueOnce({
        _tag: 'EventRegistrationInternalError',
        message: 'Internal detail',
      })
      .mockResolvedValueOnce({
        alreadyCheckedIn: false,
        checkInTime: '2026-11-10T10:00:00.000Z',
        registration: null,
      });
    const { button, closedResults, guestInput, settle, text } =
      await openDialog();

    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(false);
    });
    button('Confirm check-in').click();

    await settle(() => {
      expect(text()).toContain('Check-in not confirmed');
    });
    expect(text()).toContain(
      'The server could not confirm whether this check-in was saved.',
    );
    expect(text()).not.toContain('Internal detail');
    expect(guestInput()?.disabled).toBe(true);
    expect(button('Try again').disabled).toBe(false);
    button('Try again').click();

    await settle(() => {
      expect(closedResults).toEqual([
        { alreadyCheckedIn: false, checkedInGuestCount: 0 },
      ]);
    });
    expect(checkIn).toHaveBeenCalledTimes(2);
    expect(checkIn.mock.calls[1]?.[0]).toEqual(checkIn.mock.calls[0]?.[0]);
  });

  it('sends a new operation key for each new confirmation', async () => {
    checkIn.mockRejectedValue(
      new EventCheckInUnavailableError({
        message: 'Check-in opens one hour before this event starts.',
        reason: 'notOpen',
      }),
    );
    const { button, settle } = await openDialog();

    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(false);
    });
    button('Confirm check-in').click();
    await settle(() => {
      expect(checkIn).toHaveBeenCalledOnce();
      expect(button('Confirm check-in').disabled).toBe(false);
    });
    button('Confirm check-in').click();

    await settle(() => {
      expect(checkIn).toHaveBeenCalledTimes(2);
    });
    // Same ticket and count, so only a new operation key tells them apart.
    expect(checkIn.mock.calls[1]?.[0]).toMatchObject({
      operationKey: expect.any(String),
    });
    expect(checkIn.mock.calls[1]?.[0]).not.toEqual(checkIn.mock.calls[0]?.[0]);
  });

  it('reloads the ticket when another device changed it', async () => {
    checkIn.mockRejectedValue({
      _tag: 'EventRegistrationConflictError',
      message:
        'This ticket changed on another device. Review the current check-in count, then confirm again.',
    });
    const { button, closedResults, settle } = await openDialog();

    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(false);
    });
    button('Confirm check-in').click();

    await settle(() => {
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        exact: true,
        queryKey: ['registration-scanned', 'registration-1'],
      });
    });
    expect(closedResults).toEqual([]);
  });

  it('keeps confirmation disabled while the ticket reloads', async () => {
    const { button, settle } = await openDialog();

    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(false);
    });
    let releaseReload: (() => void) | undefined;
    // Angular's browser target does not expose Promise.withResolvers.

    const pendingReload = new Promise<typeof baseScanResult>((resolve) => {
      releaseReload = () => {
        resolve(baseScanResult);
      };
    });
    loadScan.mockReturnValueOnce(pendingReload);
    void queryClient.refetchQueries({ queryKey: ['registration-scanned'] });

    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(true);
    });
    releaseReload?.();
    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(false);
    });
  });

  it('keeps confirmation disabled after the ticket fails to reload', async () => {
    const { button, settle, text } = await openDialog();

    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(false);
    });
    loadScan.mockRejectedValueOnce(new Error('Network down'));
    // Without throwOnError, refetchQueries settles even when the lookup fails.
    await queryClient.refetchQueries({ queryKey: ['registration-scanned'] });

    await settle(() => {
      expect(text()).toContain(
        'The ticket could not be loaded. Close this dialog and try again.',
      );
    });
    expect(
      queryClient.getQueryData(['registration-scanned', 'registration-1']),
    ).toEqual(baseScanResult);
    expect(button('Confirm check-in').disabled).toBe(true);
  });

  it('keeps confirmation disabled while a reload waits for the network', async () => {
    const { button, settle } = await openDialog();

    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(false);
    });
    onlineManager.setOnline(false);
    void queryClient.refetchQueries({ queryKey: ['registration-scanned'] });

    await settle(() => {
      expect(
        queryClient.getQueryState(['registration-scanned', 'registration-1'])
          ?.fetchStatus,
      ).toBe('paused');
      expect(button('Confirm check-in').disabled).toBe(true);
    });
  });

  it('blocks confirmation when the ticket now belongs to someone else', async () => {
    loadScan.mockResolvedValue({
      ...baseScanResult,
      user: { firstName: 'Bo', id: 'attendee-2', lastName: 'Other' },
    });
    const { button, guestInput, settle, text } = await openDialog();

    await settle(() => {
      expect(text()).toContain('This ticket now belongs to Bo Other');
    });
    expect(text()).toContain(
      'It was transferred after the list loaded. Close this dialog and check the updated list.',
    );
    expect(button('Confirm check-in').disabled).toBe(true);
    expect(guestInput()).toBeNull();
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['events', 'getOrganizeOverview'],
    });
  });

  it('locks the guest count while the check-in is pending', async () => {
    let finishCheckIn: (() => void) | undefined;
    checkIn.mockReturnValue(
      // Angular's browser target does not expose Promise.withResolvers.

      new Promise((resolve) => {
        finishCheckIn = () => {
          resolve({
            alreadyCheckedIn: false,
            checkInTime: '2026-11-10T10:00:00.000Z',
          });
        };
      }),
    );
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
      expect(button('Confirm 2 check-ins').disabled).toBe(false);
    });
    button('Confirm 2 check-ins').click();

    await settle(() => {
      expect(input.disabled).toBe(true);
    });
    finishCheckIn?.();
    await settle(() => {
      expect(closedResults).toEqual([
        { alreadyCheckedIn: false, checkedInGuestCount: 1 },
      ]);
    });
  });

  it('sends the check-in while offline so a failure frees the dialog', async () => {
    checkIn.mockRejectedValue(new TypeError('Failed to fetch'));
    const { button, closedResults, settle, text } = await openDialog();

    await settle(() => {
      expect(button('Confirm check-in').disabled).toBe(false);
    });
    onlineManager.setOnline(false);
    button('Confirm check-in').click();

    await settle(() => {
      expect(checkIn).toHaveBeenCalledOnce();
    });
    await settle(() => {
      expect(button('Cancel').disabled).toBe(false);
    });
    expect(text()).toContain('Check-in could not be completed. Try again.');
    expect(closedResults).toEqual([]);
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
      expect(closedResults).toEqual([
        { alreadyCheckedIn: false, checkedInGuestCount: 0 },
      ]);
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
