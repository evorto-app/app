import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, type MatDialogConfig } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom, of, ReplaySubject, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import { EventOrganize } from './event-organize';
import {
  ReceiptSubmitDialogComponent,
  type ReceiptSubmitDialogData,
  type ReceiptSubmitDialogResult,
  type ReceiptSubmitSaveOutcome,
} from './receipt-submit-dialog.component';

const approveRegistration = vi.fn();
const organizeOverview = vi.fn();
const cancelRegistration = vi.fn();
const createUpload = vi.fn();
const finalizeUpload = vi.fn();
const findReceipts = vi.fn();
const openDialog = vi.fn();
const showError = vi.fn();
const showSuccess = vi.fn();
const submitReceipt = vi.fn();
const uploadFile = vi.fn();

const receiptButton = (
  fixture: ComponentFixture<EventOrganize>,
): HTMLButtonElement => {
  const root: HTMLElement = fixture.nativeElement;
  const button = [...root.querySelectorAll('button')].find((candidate) =>
    /Add receipt|Uploading receipt|Submitting receipt|Receipt dialog open/u.test(
      candidate.textContent ?? '',
    ),
  );
  if (!button) {
    throw new Error('Receipt submission button was not rendered');
  }
  return button;
};

describe('EventOrganize actions', () => {
  let queryClient: QueryClient | undefined;
  let acquiredFixture: ComponentFixture<EventOrganize> | undefined;
  let receiptDialog:
    | undefined
    | {
        closed: Subject<ReceiptSubmitDialogResult | undefined>;
        save: ReceiptSubmitDialogData['save'];
      };
  let releaseFilePost: (() => void) | undefined;
  let releaseFinalization: (() => void) | undefined;
  let receiptSaves: Promise<ReceiptSubmitSaveOutcome>[] = [];
  let receiptSaveSettlements: PromiseSettledResult<ReceiptSubmitSaveOutcome>[] =
    [];

  const currentReceiptDialog = () => {
    if (!receiptDialog) throw new Error('Receipt dialog has not opened');
    return receiptDialog;
  };

  const saveReceiptDialog = (result: ReceiptSubmitDialogResult) => {
    const settlements = receiptSaveSettlements;
    const operation = currentReceiptDialog().save(result);
    receiptSaves.push(operation);
    void operation.then(
      (value) => {
        settlements.push({ status: 'fulfilled', value });
      },
      (error: unknown) => {
        settlements.push({ reason: error, status: 'rejected' });
      },
    );
    return operation;
  };

  const receiptDialogResult = (): ReceiptSubmitDialogResult => ({
    attachmentName: 'Team receipt',
    fields: {
      alcoholAmount: 0,
      depositAmount: 0,
      hasAlcohol: false,
      hasDeposit: false,
      purchaseCountry: 'NL',
      receiptDate: '2026-09-04',
      taxAmount: 10,
      totalAmount: 100,
    },
    file: new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' }),
  });

  beforeEach(async () => {
    acquiredFixture = undefined;
    queryClient = undefined;
    receiptDialog = undefined;
    releaseFilePost = undefined;
    releaseFinalization = undefined;
    receiptSaves = [];
    receiptSaveSettlements = [];
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    organizeOverview.mockResolvedValue({
      registrationOptions: [],
      stats: { capacity: 10, checkedIn: 0, registered: 0 },
    });
    createUpload.mockResolvedValue({
      fields: { key: 'receipt.pdf' },
      uploadId: 'upload-1',
      url: 'https://storage.example.test/receipts',
    });
    finalizeUpload.mockResolvedValue({ uploadId: 'upload-1' });
    findReceipts.mockResolvedValue([]);
    submitReceipt.mockResolvedValue({ id: 'receipt-1' });
    openDialog.mockImplementation(
      (
        component: typeof ReceiptSubmitDialogComponent,
        config: MatDialogConfig<ReceiptSubmitDialogData>,
      ) => {
        if (component !== ReceiptSubmitDialogComponent || !config.data) {
          throw new Error('Unexpected receipt dialog configuration');
        }
        const closed = new Subject<ReceiptSubmitDialogResult | undefined>();
        receiptDialog = { closed, save: config.data.save };
        return { afterClosed: () => closed.asObservable() };
      },
    );
    vi.stubGlobal('fetch', uploadFile);

    await TestBed.configureTestingModule({
      imports: [EventOrganize],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: ConfigService,
          useValue: {
            tenant: {
              receiptSettings: { allowOther: false, receiptCountries: ['NL'] },
            },
            updateTitle: vi.fn(),
          },
        },
        { provide: TENANT_DATE_PIPE_TIMEZONE, useValue: 'Europe/Berlin' },
        { provide: MatDialog, useValue: { open: openDialog } },
        { provide: NotificationService, useValue: { showError, showSuccess } },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            events: {
              approveRegistration: {
                mutationOptions: () => ({ mutationFn: approveRegistration }),
              },
              cancelEventRegistration: {
                mutationOptions: () => ({ mutationFn: cancelRegistration }),
              },
              canOrganize: { queryKey: () => ['organizer-access', 'event-1'] },
              findOne: {
                queryKey: () => ['event', 'event-1'],
                queryOptions: () => ({
                  queryFn: () =>
                    Promise.resolve({
                      start: '2026-09-04T10:00:00.000Z',
                      title: 'Team event',
                    }),
                  queryKey: ['event', 'event-1'],
                }),
              },
              getOrganizeOverview: {
                queryKey: () => ['organizers', 'event-1'],
                queryOptions: () => ({
                  queryFn: organizeOverview,
                  queryKey: ['organizers', 'event-1'],
                }),
              },
              getRegistrationStatus: {
                queryKey: () => ['registration-status', 'event-1'],
              },
            },
            finance: {
              receiptMedia: {
                createUpload: {
                  mutationOptions: () => ({ mutationFn: createUpload }),
                },
                finalizeUpload: {
                  mutationOptions: () => ({ mutationFn: finalizeUpload }),
                },
              },
              receipts: {
                byEvent: {
                  queryKey: () => ['receipts', 'event-1'],
                  queryOptions: () => ({
                    queryFn: findReceipts,
                    queryKey: ['receipts', 'event-1'],
                  }),
                },
                submit: {
                  mutationOptions: () => ({ mutationFn: submitReceipt }),
                },
              },
            },
            queryFilter: (queryKey: readonly string[]) => ({ queryKey }),
            users: {
              canUseScanner: { queryKey: () => ['scanner-access'] },
              events: { queryKey: () => ['user-events'] },
            },
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(async () => {
    const failures: unknown[] = [];
    const attempt = async (operation: () => unknown) => {
      try {
        await operation();
      } catch (error) {
        if (!failures.includes(error)) failures.push(error);
      }
    };
    const ownedSaves = receiptSaves;
    const ownedSettlements = receiptSaveSettlements;
    const ownedClient = queryClient;
    const ownedFixture = acquiredFixture;
    const ownedDialog = receiptDialog;
    await attempt(() => releaseFilePost?.());
    await attempt(() => releaseFinalization?.());
    await attempt(() => ownedDialog?.closed.next(undefined));
    await attempt(() => ownedDialog?.closed.complete());
    await attempt(() => ownedClient?.cancelQueries());
    await attempt(() => ownedFixture?.destroy());
    await attempt(() => ownedClient?.clear());
    await attempt(() => TestBed.resetTestingModule());
    await attempt(() => vi.resetAllMocks());
    await attempt(() => vi.unstubAllGlobals());
    await attempt(() =>
      vi.waitFor(() =>
        expect(ownedSettlements).toHaveLength(ownedSaves.length),
      ),
    );
    for (const settled of ownedSettlements) {
      if (settled.status === 'rejected' && !failures.includes(settled.reason)) {
        failures.push(settled.reason);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Receipt fixture cleanup failed', {
        cause: failures[0],
      });
    }
  });

  const render = async () => {
    const fixture = TestBed.createComponent(EventOrganize);
    acquiredFixture = fixture;
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(receiptButton(fixture).disabled).toBe(false);
    });
    return fixture;
  };

  const withApplication = (paymentSetupRequired: boolean) => {
    organizeOverview.mockResolvedValue({
      registrationOptions: [
        {
          canApproveRegistrations: true,
          canCancelRegistrations: true,
          organizingRegistration: false,
          registrationOptionId: 'option-1',
          registrationOptionTitle: 'Participant',
          users: [
            {
              addonPurchases: [],
              checkedIn: false,
              email: 'attendee@example.test',
              firstName: 'Alice',
              lastName: 'Tester',
              manualApprovalAvailable: true,
              paymentPending: paymentSetupRequired,
              paymentSetupRequired,
              registrationId: 'registration-1',
              status: 'PENDING',
            },
          ],
        },
      ],
      stats: { capacity: 10, checkedIn: 0, registered: 0 },
    });
  };

  it('shows review instructions without another approval action for an uncertain claim', async () => {
    withApplication(true);
    const fixture = await render();
    await vi.waitFor(() => {
      fixture.detectChanges();
      const root: HTMLElement = fixture.nativeElement;
      expect(root.textContent).toContain('Payment setup needs review.');
      expect(root.textContent).toContain('Evorto support');
      expect(
        [...root.querySelectorAll('button')].some((button) =>
          /Try payment again|Approve application/.test(
            button.textContent ?? '',
          ),
        ),
      ).toBe(false);
    });
    expect(approveRegistration).not.toHaveBeenCalled();
  });

  it('preserves a typed payment conflict after a stale approval action and hides internal details', async () => {
    withApplication(false);
    const message =
      'This payment still needs attention. Contact an organizer before trying again.';
    approveRegistration.mockRejectedValueOnce(
      new EventRegistrationConflictError({ message }),
    );
    const fixture = await render();
    const root: HTMLElement = fixture.nativeElement;
    const approval = () =>
      [...root.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Approve application',
      );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(approval()).toBeDefined();
    });
    approval()?.click();
    await vi.waitFor(() => expect(showError).toHaveBeenCalledWith(message));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(approval()?.disabled).toBe(false);
    });
    approveRegistration.mockRejectedValueOnce(
      new EventRegistrationInternalError({
        message: 'private-database-detail',
      }),
    );
    approval()?.click();
    await vi.waitFor(() =>
      expect(showError).toHaveBeenCalledWith(
        'Payment setup needs review. Keep the existing sign-up and contact Evorto support before starting another payment.',
      ),
    );
    expect(showError).not.toHaveBeenCalledWith('private-database-detail');
  });

  it('shows the typed cancellation review block to the organizer', async () => {
    withApplication(true);
    const message =
      'Payment setup needs review. Keep this sign-up and contact Evorto support.';
    cancelRegistration.mockRejectedValue(
      new EventRegistrationConflictError({ message }),
    );
    openDialog.mockReturnValue({ afterClosed: () => of(true) });
    const fixture = await render();
    const root: HTMLElement = fixture.nativeElement;
    const cancellation = () =>
      [...root.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Cancel sign-up',
      );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(cancellation()).toBeDefined();
    });
    cancellation()?.click();
    await vi.waitFor(() => expect(showError).toHaveBeenCalledWith(message));
    expect(approveRegistration).not.toHaveBeenCalled();
  });

  it('keeps receipt submission unavailable throughout the file POST and finalization', async () => {
    const uploadResponse = new ReplaySubject<Response>(1);
    releaseFilePost = () => {
      uploadResponse.next(new Response(null, { status: 201 }));
      uploadResponse.complete();
    };
    uploadFile.mockImplementation(() => firstValueFrom(uploadResponse));
    const finalizationResult = new ReplaySubject<{ uploadId: string }>(1);
    releaseFinalization = () => {
      finalizationResult.next({ uploadId: 'upload-1' });
      finalizationResult.complete();
    };
    finalizeUpload.mockImplementation(() => firstValueFrom(finalizationResult));
    const fixture = await render();
    receiptButton(fixture).click();
    const result = receiptDialogResult();
    const saved = saveReceiptDialog(result);

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(uploadFile).toHaveBeenCalledOnce();
      expect(receiptButton(fixture).disabled).toBe(true);
      expect(receiptButton(fixture).textContent).toContain('Uploading receipt');
    });
    receiptButton(fixture).click();
    expect(openDialog).toHaveBeenCalledOnce();
    expect(finalizeUpload).not.toHaveBeenCalled();
    expect(submitReceipt).not.toHaveBeenCalled();

    uploadResponse.next(new Response(null, { status: 201 }));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(finalizeUpload).toHaveBeenCalledOnce();
      expect(receiptButton(fixture).disabled).toBe(true);
    });
    finalizationResult.next({ uploadId: 'upload-1' });
    expect(await saved).toEqual({ submitted: true });
    currentReceiptDialog().closed.next(result);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(showSuccess).toHaveBeenCalledWith('Receipt submitted');
      expect(receiptButton(fixture).disabled).toBe(false);
    });
    expect(submitReceipt).toHaveBeenCalledOnce();
    expect(showError).not.toHaveBeenCalled();
  });

  it('restores receipt submission after a failed file POST without submitting the receipt', async () => {
    uploadFile.mockResolvedValue(new Response(null, { status: 503 }));
    const fixture = await render();
    receiptButton(fixture).click();
    const outcome = await saveReceiptDialog(receiptDialogResult());
    expect(outcome).toEqual({
      message:
        'The receipt file upload outcome could not be confirmed. Receipt submission has not started. Your file and entries are still here.',
      retryAllowed: true,
      submitted: false,
    });
    expect(uploadFile).toHaveBeenCalledOnce();
    expect(showError).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(receiptButton(fixture).disabled).toBe(true);
    currentReceiptDialog().closed.next(undefined);

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(receiptButton(fixture).disabled).toBe(false);
      expect(receiptButton(fixture).textContent).toContain('Add receipt');
    });
    expect(finalizeUpload).not.toHaveBeenCalled();
    expect(submitReceipt).not.toHaveBeenCalled();
  });

  it('shows the rejection explanation on the event receipt card', async () => {
    findReceipts.mockResolvedValue([
      {
        attachmentFileName: 'receipt.pdf',
        createdAt: '2026-09-04T10:00:00.000Z',
        currency: 'EUR',
        id: 'receipt-1',
        previewImageUrl: null,
        receiptDate: '2026-09-04',
        rejectionReason: 'The purchase is unrelated to this event.',
        status: 'rejected',
        submittedByFirstName: 'Alice',
        submittedByLastName: 'Doe',
        taxAmount: 10,
        totalAmount: 100,
      },
    ]);
    const fixture = await render();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('article')?.textContent).toContain(
      'The purchase is unrelated to this event.',
    );
  });
});
