import '@angular/compiler';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import {
  FinanceResourceNotFoundError,
  ReceiptMediaBadRequestError,
  ReceiptMediaInternalError,
  ReceiptMediaServiceUnavailableError,
} from '@shared/rpc-contracts/app-rpcs/finance.errors';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT, AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import {
  computeEventOrganizeStats,
  EventOrganize,
  groupEventOrganizeRegistrationOptions,
  invalidateEventOrganizeStateQueries,
  organizerRegistrationActionDisabled,
  organizerRegistrationApprovalDisabled,
  organizerRegistrationApprovalLabel,
  organizerRegistrationCancellationActionLabel,
  organizerRegistrationTransferDisabled,
  receiptSubmissionActionDisabled,
} from './event-organize';
import { transferParticipantLabel } from './registration-transfer-dialog.component';

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(process.cwd(), sourcePath), 'utf8');

describe('event organizer error notifications', () => {
  const approveRegistration = vi.fn();
  const cancelRegistration = vi.fn();
  const createUpload = vi.fn();
  const dialogOpen = vi.fn();
  const finalizeUpload = vi.fn();
  const showError = vi.fn();
  const showSuccess = vi.fn();
  const submitReceipt = vi.fn();
  const transferRegistration = vi.fn();
  let queryClient: QueryClient;

  const inactiveQuery = (name: string) => ({
    queryKey: () => [name],
    queryOptions: () => ({ enabled: false, queryKey: [name] }),
  });
  beforeEach(async () => {
    approveRegistration.mockReset();
    cancelRegistration.mockReset();
    createUpload.mockReset().mockResolvedValue({
      fields: {},
      uploadId: 'upload-1',
      url: 'https://synthetic-upload.invalid',
    });
    dialogOpen.mockReset().mockReturnValue({ afterClosed: () => of(true) });
    finalizeUpload.mockReset().mockResolvedValue({ uploadId: 'upload-1' });
    showError.mockReset();
    showSuccess.mockReset();
    submitReceipt.mockReset();
    transferRegistration.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    TestBed.overrideComponent(EventOrganize, {
      set: {
        template: `
          <button type="button" (click)="cancelRegistration({
            checkedIn: false, firstName: 'Alex', lastName: 'Able',
            paymentPending: false, registrationId: 'registration-1', status: 'CONFIRMED'
          })">Cancel registration</button>
          <button type="button" (click)="approveRegistration({
            manualApprovalAvailable: true, paymentSetupRequired: false,
            registrationId: 'registration-1'
          })">Approve application</button>
          <button type="button" (click)="openTransferDialog({
            addonPurchases: [], checkedIn: false, email: 'alex@example.com',
            firstName: 'Alex', lastName: 'Able', manualApprovalAvailable: false,
            paymentPending: false, paymentSetupRequired: false,
            registrationId: 'registration-1', status: 'CONFIRMED'
          })">Transfer registration</button>
          <button type="button" (click)="openReceiptDialog()">Submit receipt</button>
        `,
      },
    });
    await TestBed.configureTestingModule({
      imports: [EventOrganize],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: ConfigService,
          useValue: {
            tenant: {
              receiptSettings: {
                allowOther: false,
                receiptCountries: ['DE', 'NL'],
              },
            },
            updateTitle: vi.fn(),
          },
        },
        {
          provide: MatDialog,
          useValue: { open: dialogOpen },
        },
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
              canOrganize: inactiveQuery('organizer-access'),
              findOne: {
                queryKey: () => ['event-details'],
                queryOptions: () => ({
                  enabled: false,
                  initialData: { title: 'Synthetic event' },
                  queryKey: ['event-details'],
                }),
              },
              getOrganizeOverview: inactiveQuery('organizer-overview'),
              getRegistrationStatus: inactiveQuery('registration-status'),
              transferEventRegistration: {
                mutationOptions: () => ({ mutationFn: transferRegistration }),
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
                  queryKey: () => ['event-receipts'],
                  queryOptions: () => ({
                    enabled: false,
                    initialData: [],
                    queryKey: ['event-receipts'],
                  }),
                },
                submit: {
                  mutationOptions: () => ({ mutationFn: submitReceipt }),
                },
              },
            },
            users: {
              canUseScanner: inactiveQuery('scanner-access'),
              events: inactiveQuery('user-events'),
            },
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const clickAction = (label: string) => {
    const fixture = TestBed.createComponent(EventOrganize);
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const button = [...root.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    expect(button).toBeDefined();
    button?.click();
  };

  for (const action of [
    {
      conflict: 'Checked-in registrations cannot be cancelled',
      fallback:
        'The cancellation outcome could not be confirmed. Reload the page to check the current sign-up status before trying again.',
      label: 'Cancel registration',
      mutation: cancelRegistration,
    },
    {
      conflict: 'Registration option has no available spots',
      fallback:
        'Payment setup needs review. Keep the existing sign-up and contact Evorto support before starting another payment.',
      label: 'Approve application',
      mutation: approveRegistration,
    },
    {
      conflict:
        'The registration changed before it could be transferred. Review it again.',
      fallback: 'Failed to transfer registration',
      label: 'Transfer registration',
      mutation: transferRegistration,
    },
  ]) {
    it.each([
      {
        error: new EventRegistrationConflictError({ message: action.conflict }),
        expectedMessage: action.conflict,
        name: 'registration conflict',
      },
      {
        error: new EventRegistrationNotFoundError({
          message: 'Registration not found',
        }),
        expectedMessage: 'Registration not found',
        name: 'missing registration',
      },
      {
        error: new EventRegistrationInternalError({
          message: 'Private database detail',
        }),
        expectedMessage: action.fallback,
        name: 'internal failure',
      },
      {
        error: new RpcForbiddenError({ message: 'Private permission detail' }),
        expectedMessage: action.fallback,
        name: 'forbidden request',
      },
      {
        error: new RpcUnauthorizedError({ message: 'Private session detail' }),
        expectedMessage: action.fallback,
        name: 'unauthenticated request',
      },
      {
        error: new Error('Private transport detail'),
        expectedMessage: action.fallback,
        name: 'untyped failure',
      },
    ])(
      `${action.label} shows safe feedback for $name`,
      async ({ error, expectedMessage }) => {
        action.mutation.mockRejectedValue(error);
        if (action.mutation === transferRegistration) {
          dialogOpen.mockReturnValue({
            afterClosed: () =>
              of({ previewVersion: 'preview-1', targetUserId: 'user-2' }),
          });
        }
        clickAction(action.label);

        await vi.waitFor(() => {
          expect(showError).toHaveBeenCalledExactlyOnceWith(expectedMessage);
        });
        expect(action.mutation).toHaveBeenCalledOnce();
        expect(showSuccess).not.toHaveBeenCalled();
      },
    );
  }

  it.each([
    {
      error: new RpcBadRequestError({
        message: 'Tax amount exceeds the total amount',
      }),
      expectedMessage: 'Tax amount exceeds the total amount',
      mutation: submitReceipt,
      name: 'receipt field validation',
    },
    {
      error: new FinanceResourceNotFoundError({
        message: 'Event not found for receipt submission',
      }),
      expectedMessage: 'Event not found for receipt submission',
      mutation: submitReceipt,
      name: 'missing receipt event',
    },
    {
      error: new RpcInternalServerError({ message: 'Private database detail' }),
      expectedMessage: 'Failed to submit receipt',
      mutation: submitReceipt,
      name: 'receipt internal failure',
    },
    {
      error: new RpcForbiddenError({
        message: 'Private receipt permission detail',
      }),
      expectedMessage: 'Failed to submit receipt',
      mutation: submitReceipt,
      name: 'receipt permission failure',
    },
    {
      error: new ReceiptMediaBadRequestError({
        message: 'Receipt file must be between 1 byte and 20 MB',
      }),
      expectedMessage: 'Receipt file must be between 1 byte and 20 MB',
      mutation: createUpload,
      name: 'upload size validation',
    },
    {
      error: new FinanceResourceNotFoundError({
        message: 'Event not found for receipt upload',
      }),
      expectedMessage: 'Event not found for receipt upload',
      mutation: createUpload,
      name: 'missing upload event',
    },
    {
      error: new ReceiptMediaServiceUnavailableError({
        cause: new Error('Private provider diagnostic'),
        message: 'Receipt storage is unavailable',
      }),
      expectedMessage: 'Receipt storage is unavailable',
      mutation: createUpload,
      name: 'sanitized storage availability',
    },
    {
      error: new ReceiptMediaInternalError({
        message: 'Private upload persistence detail',
      }),
      expectedMessage: 'Failed to upload receipt file',
      mutation: createUpload,
      name: 'upload internal failure',
    },
    {
      error: new RpcBadRequestError({ message: 'Receipt upload has expired' }),
      expectedMessage: 'Receipt upload has expired',
      mutation: finalizeUpload,
      name: 'expired upload',
    },
    {
      error: new ReceiptMediaBadRequestError({
        message: 'Uploaded receipt content does not match its declared type',
      }),
      expectedMessage:
        'Uploaded receipt content does not match its declared type',
      mutation: finalizeUpload,
      name: 'uploaded content validation',
    },
  ])(
    'shows safe organizer feedback for $name',
    async ({ error, expectedMessage, mutation }) => {
      mutation.mockRejectedValue(error);
      dialogOpen.mockReturnValue({
        afterClosed: () =>
          of({
            attachmentName: 'receipt.pdf',
            fields: {
              alcoholAmount: 0,
              depositAmount: 0,
              hasAlcohol: false,
              hasDeposit: false,
              purchaseCountry: 'DE',
              receiptDate: new Date('2030-01-01T12:00:00.000Z'),
              taxAmount: 0,
              totalAmount: 10,
            },
            file: new File(['synthetic receipt'], 'receipt.pdf', {
              type: 'application/pdf',
            }),
          }),
      });
      clickAction('Submit receipt');

      await vi.waitFor(() =>
        expect(showError).toHaveBeenCalledExactlyOnceWith(expectedMessage),
      );
      expect(mutation).toHaveBeenCalledOnce();
      expect(showSuccess).not.toHaveBeenCalled();
    },
  );
});

describe('computeEventOrganizeStats', () => {
  it('uses the server-provided unfiltered aggregates for organizer statistics', () => {
    expect(
      computeEventOrganizeStats({
        capacity: 18,
        checkedIn: 5,
        registered: 9,
      }),
    ).toEqual({
      capacity: 18,
      capacityPercentage: 0.5,
      checkedIn: 5,
      registered: 9,
    });
  });

  it('keeps empty organizer stats stable before the overview query resolves', () => {
    expect(computeEventOrganizeStats()).toEqual({
      capacity: 0,
      capacityPercentage: 0,
      checkedIn: 0,
      registered: 0,
    });
  });
});

describe('organizerRegistrationCancellationActionLabel', () => {
  it.each([
    ['PENDING', false, 'Withdraw application'],
    ['PENDING', true, 'Cancel sign-up'],
    ['CONFIRMED', false, 'Cancel ticket'],
  ] as const)(
    'labels %s registrations explicitly',
    (status, paymentPending, label) => {
      expect(
        organizerRegistrationCancellationActionLabel({
          paymentPending,
          status,
        }),
      ).toBe(label);
    },
  );
});

describe('invalidateEventOrganizeStateQueries', () => {
  it('invalidates every exact self-facing cache after an organizer action', async () => {
    const queryClient = new QueryClient();
    const queryKeys = {
      eventDetails: ['events', 'findOne', 'event-1'],
      organizerAccess: ['events', 'canOrganize', 'event-1'],
      organizerOverview: ['events', 'getOrganizeOverview', 'event-1'],
      registrationStatus: ['events', 'getRegistrationStatus', 'event-1'],
      scannerAccess: ['users', 'canUseScanner'],
      userEvents: ['users', 'events'],
    } as const;
    const exactQueryKeys = Object.values(queryKeys);
    const nestedOverviewKey = [...queryKeys.organizerOverview, 'nested'];

    for (const queryKey of [...exactQueryKeys, nestedOverviewKey]) {
      queryClient.setQueryData(queryKey, 'stale');
    }

    await invalidateEventOrganizeStateQueries(queryClient, queryKeys);

    for (const queryKey of exactQueryKeys) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(nestedOverviewKey)?.isInvalidated).toBe(
      false,
    );
  });

  it('maps the helper to the complete organizer self-action RPC cache set', () => {
    const source = readSource(
      'src/app/events/event-organize/event-organize.ts',
    );

    for (const queryKeyBuilder of [
      'this.rpc.events.getOrganizeOverview.queryKey',
      'this.rpc.events.findOne.queryKey',
      'this.rpc.events.getRegistrationStatus.queryKey',
      'this.rpc.events.canOrganize.queryKey',
      'this.rpc.users.canUseScanner.queryKey',
      'this.rpc.users.events.queryKey',
    ]) {
      expect(source).toContain(queryKeyBuilder);
    }
    expect(source).toContain(
      'return invalidateEventOrganizeStateQueries(this.queryClient',
    );
    expect(
      source.match(/await this\.invalidateOrganizerState\(\)/g),
    ).toHaveLength(4);
  });
});

describe('groupEventOrganizeRegistrationOptions', () => {
  it('separates the organizer/helper team from participant registrations without changing option order', () => {
    const organizerOption = {
      id: 'organizer-option',
      organizingRegistration: true,
    };
    const participantOptionA = {
      id: 'participant-option-a',
      organizingRegistration: false,
    };
    const participantOptionB = {
      id: 'participant-option-b',
      organizingRegistration: false,
    };

    const groups = groupEventOrganizeRegistrationOptions([
      participantOptionA,
      organizerOption,
      participantOptionB,
    ]);

    expect(groups).toEqual([
      {
        emptyMessage: 'No organizer/helper sign-ups yet.',
        id: 'organizer-helper-team',
        options: [organizerOption],
        title: 'Organizer/helper team',
      },
      {
        emptyMessage: 'No attendee sign-ups yet.',
        id: 'participant-registrations',
        options: [participantOptionA, participantOptionB],
        title: 'Attendee sign-ups',
      },
    ]);
  });
});

describe('transferParticipantLabel', () => {
  it('shows the participant identity before organizer-assisted transfer', () => {
    expect(
      transferParticipantLabel({
        email: 'alex@example.com',
        firstName: 'Alex',
        lastName: 'Able',
      }),
    ).toBe('Alex Able (alex@example.com)');
  });
});

describe('organizerRegistrationActionDisabled', () => {
  it('blocks organizer participant mutations for checked-in rows or in-flight writes', () => {
    expect(
      organizerRegistrationActionDisabled({
        checkedIn: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      organizerRegistrationActionDisabled({
        checkedIn: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      organizerRegistrationActionDisabled({
        checkedIn: false,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});

describe('organizerRegistrationTransferDisabled', () => {
  it('allows confirmed rows into authoritative review regardless of prior fulfillment or payment history', () => {
    expect(
      organizerRegistrationTransferDisabled({
        mutationPending: false,
        status: 'CONFIRMED',
      }),
    ).toBe(false);
    expect(
      organizerRegistrationTransferDisabled({
        mutationPending: true,
        status: 'CONFIRMED',
      }),
    ).toBe(true);
    expect(
      organizerRegistrationTransferDisabled({
        mutationPending: false,
        status: 'PENDING',
      }),
    ).toBe(true);
    expect(
      organizerRegistrationTransferDisabled({
        mutationPending: false,
        status: 'WAITLIST',
      }),
    ).toBe(true);
  });
});

describe('organizerRegistrationApprovalDisabled', () => {
  it('blocks approval unless the row is an available manual application and no write is pending', () => {
    expect(
      organizerRegistrationApprovalDisabled({
        manualApprovalAvailable: false,
        mutationPending: false,
        paymentSetupRequired: false,
      }),
    ).toBe(true);
    expect(
      organizerRegistrationApprovalDisabled({
        manualApprovalAvailable: true,
        mutationPending: true,
        paymentSetupRequired: false,
      }),
    ).toBe(true);
    expect(
      organizerRegistrationApprovalDisabled({
        manualApprovalAvailable: true,
        mutationPending: false,
        paymentSetupRequired: false,
      }),
    ).toBe(false);
  });
  it('blocks another approval request even when a stale view still grants approval access', () => {
    expect(
      organizerRegistrationApprovalDisabled({
        manualApprovalAvailable: true,
        mutationPending: false,
        paymentSetupRequired: true,
      }),
    ).toBe(true);
  });
});

describe('organizerRegistrationApprovalLabel', () => {
  it('labels fresh approval and its pending state', () => {
    expect(organizerRegistrationApprovalLabel({ approvalPending: false })).toBe(
      'Approve application',
    );
    expect(organizerRegistrationApprovalLabel({ approvalPending: true })).toBe(
      'Approving…',
    );
  });
});

describe('event organizer approval template', () => {
  it('renders organizer/helper approval only when the server grants approval access', () => {
    const template = readSource(
      'src/app/events/event-organize/event-organize.html',
    );

    expect(template).toContain('registrationOption.canApproveRegistrations &&');
    expect(template).toContain('user.manualApprovalAvailable');
    expect(template).not.toContain('@if (user.status === "PENDING")');
    expect(template).not.toContain(
      '@if (!registrationOption.organizingRegistration)',
    );
    expect(template).toContain('[attr.aria-busy]="approvalInFlight || null"');
    expect(template).toContain('Payment needs attention');
    expect(template).not.toContain('Retry payment setup');
    expect(template).toContain('!user.paymentSetupRequired');
    expect(template.replaceAll(/\s+/g, ' ')).toContain(
      'Keep this sign-up and contact Evorto support before starting another payment.',
    );
  });

  it('hides transfer and cancellation actions unless their server capabilities are present', () => {
    const template = readSource(
      'src/app/events/event-organize/event-organize.html',
    );

    expect(template).toContain(
      '@if (registrationOption.canTransferRegistrations)',
    );
    expect(template).toContain(
      '@if (registrationOption.canCancelRegistrations)',
    );
    expect(template.replaceAll(/\s+/g, ' ')).toContain(
      'Only confirmed registrations can be transferred.',
    );
  });
});

describe('event organizer overview structure', () => {
  it('uses semantic registration groups and a compact responsive definition list', () => {
    const template = readSource(
      'src/app/events/event-organize/event-organize.html',
    );

    expect(template).toContain(
      '@for (group of registrationGroups(); track group.id)',
    );
    expect(template).toContain('[attr.aria-labelledby]="group.id"');
    expect(template).toContain('<dl');
    expect(template).toContain('<dt');
    expect(template).toContain('<dd');
    expect(template).toContain('@sm:grid-cols-3');
    expect(template).not.toContain('<!-- Quick Stats Cards -->');
  });
});

describe('event organizer query-state template', () => {
  it('hides operational counts and actions until their queries succeed', () => {
    const template = readSource(
      'src/app/events/event-organize/event-organize.html',
    );

    expect(template).toContain('aria-label="Back to event"');
    expect(template).toContain('@if (eventQuery.isPending())');
    expect(template).toContain('@else if (eventQuery.isError())');
    expect(template).toContain('@else if (organizerOverviewQuery.isSuccess())');
    expect(template).toContain('Attendees could not be loaded');
    expect(template).toContain('No current sign-up counts');
    expect(template).toContain('(click)="organizerOverviewQuery.refetch()"');
    expect(template).toContain('(click)="receiptsByEventQuery.refetch()"');

    const source = readSource(
      'src/app/events/event-organize/event-organize.ts',
    );
    expect(source).toContain('if (!this.receiptsByEventQuery.isSuccess())');
    expect(source).toContain(
      'Receipt history must load before a receipt can be added.',
    );
  });

  it('binds organizer cancellation to the confirmed participant state', () => {
    const source = readSource(
      'src/app/events/event-organize/event-organize.ts',
    );

    expect(source).toContain(
      'const expectedPaymentPending = registration.paymentPending',
    );
    expect(source).toContain('const expectedStatus = registration.status');
    expect(source).toContain(
      'The cancellation outcome could not be confirmed. Reload the page to check the current sign-up status before trying again.',
    );
  });
});

describe('receiptSubmissionActionDisabled', () => {
  it('blocks receipt submission while unavailable, uploading, or submitting', () => {
    expect(
      receiptSubmissionActionDisabled({
        submissionUnavailable: true,
        submitPending: false,
        uploadPending: false,
      }),
    ).toBe(true);
    expect(
      receiptSubmissionActionDisabled({
        submissionUnavailable: false,
        submitPending: false,
        uploadPending: true,
      }),
    ).toBe(true);
    expect(
      receiptSubmissionActionDisabled({
        submissionUnavailable: false,
        submitPending: true,
        uploadPending: false,
      }),
    ).toBe(true);
    expect(
      receiptSubmissionActionDisabled({
        submissionUnavailable: false,
        submitPending: false,
        uploadPending: false,
      }),
    ).toBe(false);
  });
});

type OrganizerCancellationOptions = ReturnType<
  OrganizerClient['events']['cancelEventRegistration']['mutationOptions']
>;

type OrganizerClient = ReturnType<typeof AppRpc.injectClient>;
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-organizer-cancellation-test',
  template: '',
})
class OrganizerCancellationTestComponent extends EventOrganize {
  cancelForTest() {
    return this.cancelRegistration({
      checkedIn: false,
      firstName: 'Alex',
      lastName: 'Attendee',
      paymentPending: false,
      registrationId: 'registration-1',
      status: 'CONFIRMED',
    });
  }
}

const cancelOrganizerRegistration =
  vi.fn<NonNullable<OrganizerCancellationOptions['mutationFn']>>();
const showCancellationError = vi.fn<(message: string) => void>();
const showCancellationSuccess = vi.fn<(message: string) => void>();
const cancellationOptions = (): OrganizerCancellationOptions => ({
  mutationFn: cancelOrganizerRegistration,
  mutationKey: ['organizer-cancel'],
});

const cancellationFallback =
  'The cancellation outcome could not be confirmed. Reload the page to check the current sign-up status before trying again.';

describe('organizer cancellation outcome feedback', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    cancelOrganizerRegistration.mockReset();
    showCancellationError.mockReset();
    showCancellationSuccess.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: Infinity, retry: false },
      },
    });
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    await TestBed.configureTestingModule({
      imports: [OrganizerCancellationTestComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: ConfigService, useValue: { updateTitle: vi.fn() } },
        {
          provide: MatDialog,
          useValue: { open: () => ({ afterClosed: () => of(true) }) },
        },
        {
          provide: NotificationService,
          useValue: {
            showError: showCancellationError,
            showSuccess: showCancellationSuccess,
          },
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            events: {
              approveRegistration: {
                mutationOptions: () => ({ mutationKey: ['approve'] }),
              },
              cancelEventRegistration: { mutationOptions: cancellationOptions },
              canOrganize: { queryKey: () => ['organizer-access'] },
              findOne: {
                queryKey: () => ['event'],
                queryOptions: () => ({ enabled: false, queryKey: ['event'] }),
              },
              getOrganizeOverview: {
                queryKey: () => ['organizer-overview'],
                queryOptions: () => ({
                  enabled: false,
                  queryKey: ['organizer-overview'],
                }),
              },
              getRegistrationStatus: {
                queryKey: () => ['registration-status'],
              },
              transferEventRegistration: {
                mutationOptions: () => ({ mutationKey: ['transfer'] }),
              },
            },
            finance: {
              receiptMedia: {
                createUpload: {
                  mutationOptions: () => ({ mutationKey: ['receipt-upload'] }),
                },
                finalizeUpload: {
                  mutationOptions: () => ({
                    mutationKey: ['receipt-finalize'],
                  }),
                },
              },
              receipts: {
                byEvent: {
                  queryOptions: () => ({
                    enabled: false,
                    queryKey: ['receipts'],
                  }),
                },
                submit: {
                  mutationOptions: () => ({ mutationKey: ['receipt-submit'] }),
                },
              },
            },
            users: {
              canUseScanner: { queryKey: () => ['scanner-access'] },
              events: { queryKey: () => ['user-events'] },
            },
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  it.each([
    {
      commits: true,
      error: new Error('Connection closed before the response arrived'),
      expected: cancellationFallback,
      name: 'a response lost after cancellation commits',
    },
    {
      commits: false,
      error: new EventRegistrationConflictError({
        message: 'The sign-up changed. Reload before cancelling.',
      }),
      expected: 'The sign-up changed. Reload before cancelling.',
      name: 'an expected conflict',
    },
    {
      commits: false,
      error: new EventRegistrationNotFoundError({
        message: 'The sign-up could not be found.',
      }),
      expected: 'The sign-up could not be found.',
      name: 'an expected missing sign-up',
    },
  ])(
    'reports $name without replaying the cancellation',
    async ({ commits, error, expected }) => {
      let serverCancelled = false;
      cancelOrganizerRegistration.mockImplementation(async () => {
        serverCancelled = commits;
        throw error;
      });
      const fixture = TestBed.createComponent(
        OrganizerCancellationTestComponent,
      );
      fixture.componentRef.setInput('eventId', 'event-1');
      fixture.detectChanges();
      await fixture.componentInstance.cancelForTest();
      await vi.waitFor(() =>
        expect(showCancellationError).toHaveBeenCalledWith(expected),
      );
      expect(serverCancelled).toBe(commits);
      expect(cancelOrganizerRegistration).toHaveBeenCalledOnce();
      expect(showCancellationSuccess).not.toHaveBeenCalled();
    },
  );
});
