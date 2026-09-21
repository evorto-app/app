import '@angular/compiler';
import { OverlayContainer } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DEFAULT_CURRENCY_CODE,
  ErrorHandler,
  getDebugNode,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MAT_DIALOG_DEFAULT_OPTIONS,
  MatDialog,
  MatDialogRef,
} from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import {
  createRpcQueryFilter,
  createRpcQueryKey,
} from '@heddendorp/effect-angular-query';
import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { ClientTenantConfig } from '@shared/rpc-contracts/app-rpcs/config.rpcs';
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
  onlineManager,
  provideTanStackQuery,
  QueryClient,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT, AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import { ReceiptFormFieldsComponent } from '../../finance/shared/receipt-form/receipt-form-fields.component';
import {
  computeEventOrganizeStats,
  EventOrganize,
  groupEventOrganizeRegistrationOptions,
  invalidateEventOrganizeStateQueries,
  organizerRegistrationActionDisabled,
  organizerRegistrationApprovalDisabled,
  organizerRegistrationApprovalLabel,
  organizerRegistrationCancellationActionLabel,
  receiptSubmissionActionDisabled,
} from './event-organize';
import {
  ReceiptSubmitDialogComponent,
  ReceiptSubmitDialogResult,
  ReceiptSubmitFormValue,
} from './receipt-submit-dialog.component';

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
        'The cancellation outcome could not be confirmed. Load the page again to check the current sign-up status before trying again.',
      label: 'Cancel registration',
      mutation: cancelRegistration,
    },
    {
      conflict: 'Registration option has no available spots',
      fallback:
        'The approval result could not be confirmed. Check the current sign-up status before trying again.',
      label: 'Approve application',
      mutation: approveRegistration,
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
      {
        error: {
          _tag: 'EventRegistrationConflictError',
          message: { detail: 'Private malformed error detail' },
        },
        expectedMessage: action.fallback,
        name: 'malformed domain failure',
      },
    ])(
      `${action.label} shows safe feedback for $name`,
      async ({ error, expectedMessage }) => {
        action.mutation.mockRejectedValue(error);
        clickAction(action.label);

        await vi.waitFor(() => {
          expect(showError).toHaveBeenCalledExactlyOnceWith(expectedMessage);
        });
        expect(action.mutation).toHaveBeenCalledOnce();
        expect(showSuccess).not.toHaveBeenCalled();
      },
    );
  }
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
    ).toHaveLength(3);
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

  it('hides cancellation without its server capability and retires organizer reassignment', () => {
    const template = readSource(
      'src/app/events/event-organize/event-organize.html',
    );

    expect(template).not.toContain('openTransferDialog');
    expect(template).not.toContain('canTransferRegistrations');
    expect(template).toContain(
      '@if (registrationOption.canCancelRegistrations)',
    );
    expect(template).not.toContain('Review transfer');
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
    expect(source).toContain(
      "'The receipt submission outcome could not be confirmed. Your file and entries are still here. Close this dialog, then select Show latest receipts before adding another receipt.'",
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
      'The cancellation outcome could not be confirmed. Load the page again to check the current sign-up status before trying again.',
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

type OrganizerCancellationState = Pick<
  Parameters<NonNullable<OrganizerCancellationOptions['mutationFn']>>[0],
  'expectedPaymentPending' | 'expectedStatus'
>;

type OrganizerClient = ReturnType<typeof AppRpc.injectClient>;
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-organizer-cancellation-test',
  template: '',
})
class OrganizerCancellationTestComponent extends EventOrganize {
  cancelForTest(state?: OrganizerCancellationState) {
    const expectedPaymentPending = state?.expectedPaymentPending ?? false;
    const expectedStatus = state?.expectedStatus ?? 'CONFIRMED';
    return this.cancelRegistration({
      checkedIn: false,
      firstName: 'Alex',
      lastName: 'Attendee',
      paymentPending: expectedPaymentPending,
      registrationId: 'registration-1',
      status: expectedStatus,
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
  'The cancellation outcome could not be confirmed. Load the page again to check the current sign-up status before trying again.';

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
      expectedPaymentPending: false,
      expectedStatus: 'WAITLIST',
      message: 'Waitlist place removed',
    },
    {
      expectedPaymentPending: false,
      expectedStatus: 'PENDING',
      message: 'Application withdrawn',
    },
    {
      expectedPaymentPending: true,
      expectedStatus: 'PENDING',
      message: 'Sign-up cancelled',
    },
    {
      expectedPaymentPending: false,
      expectedStatus: 'CONFIRMED',
      message: 'Ticket cancelled',
    },
  ] satisfies (OrganizerCancellationState & { message: string })[])(
    'reports the confirmed outcome for $expectedStatus with payment pending $expectedPaymentPending',
    async ({ expectedPaymentPending, expectedStatus, message }) => {
      cancelOrganizerRegistration.mockResolvedValue(undefined);
      const fixture = TestBed.createComponent(
        OrganizerCancellationTestComponent,
      );
      fixture.componentRef.setInput('eventId', 'event-1');
      fixture.detectChanges();
      await fixture.componentInstance.cancelForTest({
        expectedPaymentPending,
        expectedStatus,
      });
      await vi.waitFor(() =>
        expect(showCancellationSuccess).toHaveBeenCalledExactlyOnceWith(
          message,
        ),
      );
      expect(cancelOrganizerRegistration).toHaveBeenCalledExactlyOnceWith(
        {
          eventId: 'event-1',
          expectedPaymentPending,
          expectedStatus,
          registrationId: 'registration-1',
        },
        expect.anything(),
      );
      expect(showCancellationError).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      expectedPaymentPending: false,
      expectedStatus: 'WAITLIST',
      message: 'Waitlist place removed',
    },
    {
      expectedPaymentPending: false,
      expectedStatus: 'PENDING',
      message: 'Application withdrawn',
    },
    {
      expectedPaymentPending: true,
      expectedStatus: 'PENDING',
      message: 'Sign-up cancelled',
    },
    {
      expectedPaymentPending: false,
      expectedStatus: 'CONFIRMED',
      message: 'Ticket cancelled',
    },
  ] satisfies (OrganizerCancellationState & { message: string })[])(
    'preserves the confirmed $expectedStatus outcome when refreshing the organizer view fails',
    async ({ expectedPaymentPending, expectedStatus, message }) => {
      cancelOrganizerRegistration.mockResolvedValue(undefined);
      vi.mocked(queryClient.invalidateQueries).mockRejectedValue(
        new Error('Private organizer readback diagnostic'),
      );
      const fixture = TestBed.createComponent(
        OrganizerCancellationTestComponent,
      );
      fixture.componentRef.setInput('eventId', 'event-1');
      fixture.detectChanges();
      await fixture.componentInstance.cancelForTest({
        expectedPaymentPending,
        expectedStatus,
      });
      await vi.waitFor(() => {
        expect(showCancellationError).toHaveBeenCalledExactlyOnceWith(
          `${message}. The page could not be updated. Load the page again to check the current sign-up details.`,
        );
      });
      expect(cancelOrganizerRegistration).toHaveBeenCalledOnce();
      expect(showCancellationSuccess).not.toHaveBeenCalled();
      expect(
        queryClient
          .getMutationCache()
          .getAll()
          .find(
            (mutation) =>
              mutation.options.mutationKey?.[0] === 'organizer-cancel',
          )?.state.status,
      ).toBe('success');
    },
  );

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

describe('EventOrganize receipt submission outcomes', () => {
  type Client = ReturnType<typeof AppRpc.injectClient>;
  type EventOptions = ReturnType<Client['events']['findOne']['queryOptions']>;
  type OverviewOptions = ReturnType<
    Client['events']['getOrganizeOverview']['queryOptions']
  >;
  type ByEventOptions = ReturnType<
    Client['finance']['receipts']['byEvent']['queryOptions']
  >;
  type MyOptions = ReturnType<
    Client['finance']['receipts']['my']['queryOptions']
  >;
  type ApprovalOptions = ReturnType<
    Client['finance']['receipts']['pendingApprovalGrouped']['queryOptions']
  >;
  type SubmitOptions = ReturnType<
    Client['finance']['receipts']['submit']['mutationOptions']
  >;
  type UploadOptions = ReturnType<
    Client['finance']['receiptMedia']['createUpload']['mutationOptions']
  >;
  type FinalizeOptions = ReturnType<
    Client['finance']['receiptMedia']['finalizeUpload']['mutationOptions']
  >;
  type ByEventQuery = Extract<
    NonNullable<ByEventOptions['queryFn']>,
    (...args: never[]) => unknown
  >;
  type MyQuery = Extract<
    NonNullable<MyOptions['queryFn']>,
    (...args: never[]) => unknown
  >;
  type ApprovalQuery = Extract<
    NonNullable<ApprovalOptions['queryFn']>,
    (...args: never[]) => unknown
  >;
  type EventRecord = Awaited<ReturnType<Client['events']['findOne']['call']>>;
  type SubmitInput = Parameters<NonNullable<SubmitOptions['mutationFn']>>[0];
  const eventRecord: EventRecord = {
    addOns: [],
    announcementRoleCount: 1,
    announcementRoleIds: ['role-attendee'],
    creatorId: 'creator-1',
    description: '<p>Receipt workshop</p>',
    end: '2030-01-02T12:00:00.000Z',
    hasRegistrationOptions: false,
    icon: { iconColor: 2, iconName: 'calendar:fas' },
    id: 'event-1',
    location: null,
    registrationOptions: [],
    registrationOptionsHiddenByEligibility: false,
    reviewer: null,
    start: '2030-01-02T10:00:00.000Z',
    status: 'APPROVED',
    statusComment: null,
    title: 'Receipt workshop',
    userIsCreator: true,
  };
  const receiptFile = new File(['receipt'], 'receipt.pdf', {
    type: 'application/pdf',
  });
  const enteredName = ' Custom receipt ';
  const entered: ReceiptSubmitFormValue = {
    alcoholAmount: 1.23,
    depositAmount: 2.34,
    hasAlcohol: true,
    hasDeposit: true,
    purchaseCountry: 'DE',
    receiptDate: '2026-05-20',
    taxAmount: 3.45,
    totalAmount: 12.34,
  };
  const payload = {
    attachment: { fileName: 'Custom receipt', uploadId: 'upload-1' },
    eventId: 'event-1',
    fields: {
      alcoholAmount: 123,
      depositAmount: 234,
      hasAlcohol: true,
      hasDeposit: true,
      purchaseCountry: 'DE',
      receiptDate: entered.receiptDate,
      taxAmount: 345,
      totalAmount: 1234,
    },
  } satisfies SubmitInput;
  const unknownMessage =
    'The receipt submission outcome could not be confirmed. Your file and entries are still here. Close this dialog, then select Show latest receipts before adding another receipt.';
  const savedMessage =
    'The receipt was submitted, but the receipt lists could not be updated. Close this dialog and load the event page again to see it.';
  const uploadMessage =
    'The receipt file upload outcome could not be confirmed. Receipt submission has not started. Your file and entries are still here.';
  const byEventKey = (eventId: string) =>
    createRpcQueryKey(['finance', 'receipts', 'byEvent'], {
      input: { eventId },
      keyPrefix: 'rpc',
      type: 'query',
    });
  const myKey = createRpcQueryKey<undefined>(['finance', 'receipts', 'my'], {
    keyPrefix: 'rpc',
    type: 'query',
  });
  const approvalKey = createRpcQueryKey<undefined>(
    ['finance', 'receipts', 'pendingApprovalGrouped'],
    { keyPrefix: 'rpc', type: 'query' },
  );
  const submitKey = createRpcQueryKey<undefined>(
    ['finance', 'receipts', 'submit'],
    { keyPrefix: 'rpc', type: 'mutation' },
  );
  const uploadKey = createRpcQueryKey<undefined>(
    ['finance', 'receiptMedia', 'createUpload'],
    { keyPrefix: 'rpc', type: 'mutation' },
  );
  const finalizeKey = createRpcQueryKey<undefined>(
    ['finance', 'receiptMedia', 'finalizeUpload'],
    { keyPrefix: 'rpc', type: 'mutation' },
  );
  const submitMeta = { rpc: { path: ['finance', 'receipts', 'submit'] } };
  const uploadMeta = {
    rpc: { path: ['finance', 'receiptMedia', 'createUpload'] },
  };
  const finalizeMeta = {
    rpc: { path: ['finance', 'receiptMedia', 'finalizeUpload'] },
  };
  const queryFilter: Client['queryFilter'] = (segments, options = {}) =>
    createRpcQueryFilter(segments, { keyPrefix: 'rpc', ...options });
  const button = (element: HTMLElement, title: string) => {
    const result = [
      ...element.querySelectorAll<HTMLButtonElement>('button'),
    ].find((candidate) => candidate.textContent?.trim() === title);
    if (!result) throw new Error(`Expected the ${title} button.`);
    return result;
  };
  let cleanupClient: QueryClient | undefined;
  let cleanupDialog: MatDialog | undefined;
  let cleanupFixture: ComponentFixture<EventOrganize> | undefined;
  let originalOnline: boolean | undefined;
  let operations: Promise<PromiseSettledResult<void>>[] = [];
  let dialogOperations: Promise<PromiseSettledResult<void>>[] = [];
  let dialogSettlements: PromiseSettledResult<void>[] = [];
  let releaseGates: (() => void)[] = [];
  let unsubscribeObservers: (() => void)[] = [];
  const observeSubmit = (operation: Promise<void>) => {
    operations.push(
      operation.then<PromiseSettledResult<void>, PromiseSettledResult<void>>(
        () => ({ status: 'fulfilled', value: undefined }),
        (error) => ({ reason: error, status: 'rejected' }),
      ),
    );
    return operation;
  };
  const hold = <T>(fallback: T) => {
    let release: (result: T) => void = () => {
      throw new Error('Expected the held receipt operation to be initialized.');
    };
    // Angular test compilation targets ES2022, so Promise.withResolvers is unavailable.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const promise = new Promise<T>((resolve) => {
      release = resolve;
    });
    releaseGates.push(() => release(fallback));
    return { promise, release };
  };
  const createReceiptContext = async () => {
    const submitReceipt = vi
      .fn<NonNullable<SubmitOptions['mutationFn']>>()
      .mockResolvedValue({ id: 'receipt-1' });
    const createUpload = vi
      .fn<NonNullable<UploadOptions['mutationFn']>>()
      .mockResolvedValue({
        expiresAt: '2030-01-02T12:00:00.000Z',
        fields: { key: 'original/receipt.pdf', policy: 'test-policy' },
        uploadId: 'upload-1',
        url: 'https://upload.example.invalid/receipt',
      });
    const finalizeUpload = vi
      .fn<NonNullable<FinalizeOptions['mutationFn']>>()
      .mockResolvedValue({
        fileName: receiptFile.name,
        mimeType: receiptFile.type,
        sizeBytes: receiptFile.size,
        uploadId: 'upload-1',
      });
    const uploadFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', uploadFetch);
    const findByEvent = vi.fn<ByEventQuery>().mockResolvedValue([]);
    const findMy = vi.fn<MyQuery>().mockResolvedValue([]);
    const findApproval = vi.fn<ApprovalQuery>().mockResolvedValue([]);
    const successNotice = vi.fn<(message: string) => void>();
    const errorNotice = vi.fn<(message: string) => void>();
    const unexpectedError = vi.fn<ErrorHandler['handleError']>();
    originalOnline = onlineManager.isOnline();
    onlineManager.setOnline(true);
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { gcTime: 0, retry: false },
        queries: { gcTime: 0, retry: false, staleTime: Infinity },
      },
    });
    cleanupClient = queryClient;
    const byEventOptions = (input: { eventId: string }): ByEventOptions => ({
      queryFn: findByEvent,
      queryKey: byEventKey(input.eventId),
    });
    const myOptions = (): MyOptions => ({ queryFn: findMy, queryKey: myKey });
    const approvalOptions = (): ApprovalOptions => ({
      queryFn: findApproval,
      queryKey: approvalKey,
    });
    const tenant = new ClientTenantConfig({
      cancellationDeadlineHoursBeforeStart: 24,
      currency: 'EUR',
      defaultLocation: undefined,
      discountProviders: { esnCard: { config: {}, status: 'disabled' } },
      domain: 'tenant.example.test',
      emailSenderEmail: undefined,
      emailSenderName: undefined,
      faviconUrl: undefined,
      id: 'tenant-1',
      legalNoticeText: undefined,
      legalNoticeUrl: undefined,
      logoUrl: undefined,
      maxActiveRegistrationsPerUser: 3,
      name: 'Tenant',
      paymentsConfigured: true,
      privacyPolicyText: undefined,
      privacyPolicyUrl: undefined,
      receiptSettings: { allowOther: false, receiptCountries: ['DE', 'NL'] },
      refundFeesOnCancellation: false,
      seoDescription: undefined,
      seoTitle: undefined,
      termsText: undefined,
      termsUrl: undefined,
      theme: 'evorto',
      timezone: 'Europe/Berlin',
      transferDeadlineHoursBeforeStart: 24,
    });
    await TestBed.configureTestingModule({
      imports: [EventOrganize],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: DEFAULT_CURRENCY_CODE, useValue: 'EUR' },
        { provide: TENANT_DATE_PIPE_TIMEZONE, useValue: 'Europe/Berlin' },
        {
          provide: ErrorHandler,
          useValue: { handleError: unexpectedError } satisfies Pick<
            ErrorHandler,
            'handleError'
          >,
        },
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
          provide: ConfigService,
          useValue: { tenant, updateTitle: vi.fn() } satisfies Pick<
            ConfigService,
            'tenant' | 'updateTitle'
          >,
        },
        {
          provide: NotificationService,
          useValue: {
            showError: errorNotice,
            showSuccess: successNotice,
          } satisfies Pick<NotificationService, 'showError' | 'showSuccess'>,
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            events: {
              approveRegistration: {
                mutationOptions: (): ReturnType<
                  Client['events']['approveRegistration']['mutationOptions']
                > => ({
                  mutationFn: async () => {
                    throw new Error(
                      'Receipt submission must not approve a registration.',
                    );
                  },
                  mutationKey: ['unused-receipt-approval'],
                }),
              },
              cancelEventRegistration: {
                mutationOptions: (): ReturnType<
                  Client['events']['cancelEventRegistration']['mutationOptions']
                > => ({
                  mutationFn: async () => {
                    throw new Error(
                      'Receipt submission must not cancel a registration.',
                    );
                  },
                  mutationKey: ['unused-receipt-cancellation'],
                }),
              },
              findOne: {
                queryOptions: (input: { id: string }): EventOptions => ({
                  queryFn: async () => ({ ...eventRecord, id: input.id }),
                  queryKey: createRpcQueryKey(['events', 'findOne'], {
                    input,
                    keyPrefix: 'rpc',
                    type: 'query',
                  }),
                }),
              },
              getOrganizeOverview: {
                queryOptions: (input: {
                  eventId: string;
                }): OverviewOptions => ({
                  queryFn: async () => ({
                    registrationOptions: [],
                    stats: { capacity: 0, checkedIn: 0, registered: 0 },
                  }),
                  queryKey: createRpcQueryKey(
                    ['events', 'getOrganizeOverview'],
                    { input, keyPrefix: 'rpc', type: 'query' },
                  ),
                }),
              },
            },
            finance: {
              receiptMedia: {
                createUpload: {
                  mutationOptions: (): UploadOptions => ({
                    meta: uploadMeta,
                    mutationFn: createUpload,
                    mutationKey: uploadKey,
                  }),
                },
                finalizeUpload: {
                  mutationOptions: (): FinalizeOptions => ({
                    meta: finalizeMeta,
                    mutationFn: finalizeUpload,
                    mutationKey: finalizeKey,
                  }),
                },
              },
              receipts: {
                byEvent: {
                  queryKey: (input: { eventId: string }) =>
                    byEventKey(input.eventId),
                  queryOptions: byEventOptions,
                },
                submit: {
                  mutationOptions: (): SubmitOptions => ({
                    meta: submitMeta,
                    mutationFn: submitReceipt,
                    mutationKey: submitKey,
                  }),
                },
              },
            },
            queryFilter,
          },
        },
      ],
    }).compileComponents();
    const dialog = TestBed.inject(MatDialog);
    cleanupDialog = dialog;
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const fixture = TestBed.createComponent(EventOrganize);
    cleanupFixture = fixture;
    const nativeOpen = fixture.componentInstance['openReceiptDialog'].bind(
      fixture.componentInstance,
    );
    const openOperation = vi.fn<typeof nativeOpen>().mockImplementation(() => {
      const operation = nativeOpen();
      const settled = dialogSettlements;
      const record = (result: PromiseSettledResult<void>) => {
        settled.push(result);
        return result;
      };
      dialogOperations.push(
        operation.then<PromiseSettledResult<void>, PromiseSettledResult<void>>(
          () => record({ status: 'fulfilled', value: undefined }),
          (error) => record({ reason: error, status: 'rejected' }),
        ),
      );
      return operation;
    });
    fixture.componentInstance['openReceiptDialog'] = openOperation;
    const nativeElement: unknown = fixture.nativeElement;
    if (!(nativeElement instanceof HTMLElement))
      throw new Error('Expected the actual organizer component root.');
    const root = nativeElement;
    const myObserver = new QueryObserver(queryClient, myOptions());
    unsubscribeObservers.push(
      myObserver.subscribe(() => {
        /* Keep the real personal receipt query active. */
      }),
    );
    const approvalObserver = new QueryObserver(queryClient, approvalOptions());
    unsubscribeObservers.push(
      approvalObserver.subscribe(() => {
        /* Keep the real approval receipt query active. */
      }),
    );
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button(root, 'Add receipt').disabled).toBe(false);
      expect(queryClient.getQueryState(myKey)?.status).toBe('success');
      expect(queryClient.getQueryState(approvalKey)?.status).toBe('success');
    });
    const openEditor = async () => {
      button(root, 'Add receipt').click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(dialog.openDialogs).toHaveLength(1);
      });
      const element = overlay.querySelector<HTMLElement>(
        'app-receipt-submit-dialog',
      );
      if (!element)
        throw new Error('Expected the actual receipt submit dialog.');
      const debug = getDebugNode(element);
      if (!debug) throw new Error('Expected the receipt dialog debug node.');
      const component = debug.injector.get(ReceiptSubmitDialogComponent);
      const dialogRef =
        debug.injector.get<
          MatDialogRef<ReceiptSubmitDialogComponent, ReceiptSubmitDialogResult>
        >(MatDialogRef);
      const changeDetector = debug.injector.get(ChangeDetectorRef);
      const detect = () => {
        fixture.detectChanges();
        changeDetector.detectChanges();
      };
      const formElement = element.querySelector('form');
      if (!formElement) throw new Error('Expected the receipt submit form.');
      const fieldsElement = element.querySelector('app-receipt-form-fields');
      if (!fieldsElement)
        throw new Error('Expected the actual receipt fields.');
      const fieldsDebug = getDebugNode(fieldsElement);
      if (!fieldsDebug)
        throw new Error('Expected the receipt fields debug node.');
      const receiptForm = fieldsDebug.injector
        .get(ReceiptFormFieldsComponent)
        .form();
      receiptForm.setValue(entered);
      const field = (label: string) => {
        const group = [...element.querySelectorAll('mat-form-field')].find(
          (candidate) =>
            candidate.querySelector('mat-label')?.textContent?.trim() === label,
        );
        const result = group?.querySelector<HTMLInputElement>('input');
        if (!result) throw new Error(`Expected the ${label} field.`);
        return result;
      };
      const fileInput =
        element.querySelector<HTMLInputElement>('input[type="file"]');
      if (!fileInput) throw new Error('Expected the native file input.');
      const files: FileList = Object.assign([receiptFile], {
        item: (index: number) => (index === 0 ? receiptFile : null),
      });
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: files,
      });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      const nameInput = field('Receipt name');
      nameInput.value = enteredName;
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      const nativeSubmit = component['onSubmit'].bind(component);
      const submit = vi
        .fn<typeof nativeSubmit>()
        .mockImplementation((event) => observeSubmit(nativeSubmit(event)));
      component['onSubmit'] = submit;
      const submitForm = () => {
        const count = submit.mock.calls.length;
        formElement.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
        expect(submit).toHaveBeenCalledTimes(count + 1);
        const result = submit.mock.results.at(-1);
        if (result?.type !== 'return')
          throw new Error('Expected the native receipt submit operation.');
        return result.value;
      };
      const expectValues = () => {
        expect(receiptForm.getRawValue()).toEqual(entered);
        expect(component['file']()).toBe(receiptFile);
        expect(component['attachmentName']()).toBe(enteredName);
        expect(nameInput.value).toBe(enteredName);
        expect(field('Receipt date').value).toBe(entered.receiptDate);
        expect(field('Total amount (EUR)').value).toBe('12.34');
        expect(field('Tax amount (EUR)').value).toBe('3.45');
        expect(field('Deposit amount (EUR)').value).toBe('2.34');
        expect(field('Alcohol amount (EUR)').value).toBe('1.23');
        expect(element.querySelector('mat-select')?.textContent).toContain(
          'Germany (DE)',
        );
        const checkboxes = [
          ...element.querySelectorAll<HTMLInputElement>(
            'input[type="checkbox"]',
          ),
        ];
        expect(checkboxes).toHaveLength(2);
        for (const checkbox of checkboxes) expect(checkbox.checked).toBe(true);
        expect(fileInput.files?.item(0)).toBe(receiptFile);
      };
      const expectMessage = async (message: string) => {
        await vi.waitFor(() => {
          detect();
          expect(
            element.querySelector('[role="alert"]')?.textContent?.trim(),
          ).toBe(message);
        });
        expectValues();
      };
      const expectCloseOnly = async (message: string) => {
        await expectMessage(message);
        expect(receiptForm.disabled).toBe(true);
        expect(element.querySelector('button[type="submit"]')).toBeNull();
        expect(button(element, 'Close').disabled).toBe(false);
        await submitForm();
        await openOperation();
        detect();
        expect(dialog.openDialogs).toHaveLength(1);
        expect(createUpload).toHaveBeenCalledOnce();
        expect(submitReceipt).toHaveBeenCalledOnce();
        expect(successNotice).not.toHaveBeenCalled();
      };
      detect();
      expectValues();
      expect(button(element, 'Submit receipt').disabled).toBe(false);
      return {
        component,
        detect,
        dialogRef,
        element,
        expectCloseOnly,
        expectMessage,
        expectValues,
        fileInput,
        nameInput,
        receiptForm,
        submitForm,
      };
    };
    const expectSingleWrite = () => {
      expect(createUpload).toHaveBeenCalledExactlyOnceWith(
        {
          eventId: 'event-1',
          fileName: receiptFile.name,
          mimeType: receiptFile.type,
          sizeBytes: receiptFile.size,
        },
        { client: queryClient, meta: uploadMeta, mutationKey: uploadKey },
      );
      expect(finalizeUpload).toHaveBeenCalledExactlyOnceWith(
        { uploadId: 'upload-1' },
        { client: queryClient, meta: finalizeMeta, mutationKey: finalizeKey },
      );
      expect(submitReceipt).toHaveBeenCalledExactlyOnceWith(payload, {
        client: queryClient,
        meta: submitMeta,
        mutationKey: submitKey,
      });
      expect(uploadFetch).toHaveBeenCalledOnce();
      const request = uploadFetch.mock.calls[0];
      if (!request) throw new Error('Expected the original receipt upload.');
      expect(request[0]).toBe('https://upload.example.invalid/receipt');
      expect(request[1]).toEqual({
        body: expect.any(FormData),
        credentials: 'omit',
        method: 'POST',
        mode: 'cors',
      });
      const body = request[1]?.body;
      if (!(body instanceof FormData))
        throw new Error('Expected the actual upload form data.');
      expect([...body.keys()]).toEqual(['key', 'policy', 'file']);
      expect(body.get('key')).toBe('original/receipt.pdf');
      expect(body.get('policy')).toBe('test-policy');
      const uploaded = body.get('file');
      if (!(uploaded instanceof File))
        throw new Error('Expected the original receipt file part.');
      expect({
        name: uploaded.name,
        size: uploaded.size,
        type: uploaded.type,
      }).toEqual({
        name: receiptFile.name,
        size: receiptFile.size,
        type: receiptFile.type,
      });
    };
    return {
      approvalObserver,
      byEventOptions,
      createUpload,
      dialog,
      errorNotice,
      expectSingleWrite,
      finalizeUpload,
      findApproval,
      findByEvent,
      findMy,
      fixture,
      myObserver,
      openEditor,
      openOperation,
      queryClient,
      root,
      submitReceipt,
      successNotice,
      unexpectedError,
      uploadFetch,
    };
  };
  const captureReceiptCleanup = (): {
    client: QueryClient | undefined;
    dialog: MatDialog | undefined;
    fixture: ComponentFixture<EventOrganize> | undefined;
    online: boolean | undefined;
  } => ({
    client: cleanupClient,
    dialog: cleanupDialog,
    fixture: cleanupFixture,
    online: originalOnline,
  });

  const runReceiptCase = async (
    run: (
      context: Awaited<ReturnType<typeof createReceiptContext>>,
    ) => Promise<void>,
  ) => {
    cleanupClient = undefined;
    cleanupDialog = undefined;
    cleanupFixture = undefined;
    originalOnline = undefined;
    operations = [];
    dialogOperations = [];
    dialogSettlements = [];
    releaseGates = [];
    unsubscribeObservers = [];
    const failures: unknown[] = [];
    const recordFailure = (error: unknown) => {
      if (!failures.includes(error)) failures.push(error);
    };
    try {
      const context = await createReceiptContext();
      await run(context);
      expect(context.unexpectedError).not.toHaveBeenCalled();
    } catch (error) {
      recordFailure(error);
    }
    // Release every owned read/upload before draining any native submit operation.
    for (const release of releaseGates) {
      try {
        release();
      } catch (error) {
        recordFailure(error);
      }
    }
    for (const result of await Promise.all(operations)) {
      if (result.status === 'rejected') recordFailure(result.reason);
    }
    const {
      client: ownedClient,
      dialog: ownedDialog,
      fixture: ownedFixture,
      online: ownedOnline,
    } = captureReceiptCleanup();
    for (const cleanup of [
      () => ownedDialog?.closeAll(),
      async () => {
        if (ownedDialog)
          await vi.waitFor(() =>
            expect(ownedDialog.openDialogs).toHaveLength(0),
          );
      },
      // A failed close must not prevent independent disposal by waiting indefinitely on afterClosed.
      async () => {
        await vi.waitFor(() =>
          expect(dialogSettlements).toHaveLength(dialogOperations.length),
        );
      },
      async () => {
        await ownedClient?.cancelQueries();
      },
      ...unsubscribeObservers,
      () => ownedFixture?.destroy(),
      () => ownedClient?.clear(),
      () => TestBed.resetTestingModule(),
      async () => {
        await vi.waitFor(() =>
          expect(dialogSettlements).toHaveLength(dialogOperations.length),
        );
      },
      () => {
        if (ownedOnline !== undefined) onlineManager.setOnline(ownedOnline);
      },
      () => vi.restoreAllMocks(),
      () => vi.unstubAllGlobals(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        recordFailure(error);
      }
    }
    for (const result of dialogSettlements) {
      if (result.status === 'rejected') recordFailure(result.reason);
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Organizer receipt assertion, operation, or cleanup failed',
        { cause: failures[0] },
      );
  };

  it('uploads one original file, submits the exact receipt once, checks canonical lists and closes before success feedback', async () => {
    await runReceiptCase(async (context) => {
      const editor = await context.openEditor();
      context.successNotice.mockImplementation(() => {
        expect(context.dialog.openDialogs).toHaveLength(0);
      });
      await editor.submitForm();
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(context.successNotice).toHaveBeenCalledExactlyOnceWith(
          'Receipt submitted',
        );
        expect(button(context.root, 'Add receipt').disabled).toBe(false);
      });
      context.expectSingleWrite();
      expect(context.findByEvent).toHaveBeenCalledTimes(2);
      expect(context.findMy).toHaveBeenCalledTimes(2);
      expect(context.findApproval).toHaveBeenCalledTimes(2);
      expect(context.errorNotice).not.toHaveBeenCalled();
      expect(context.unexpectedError).not.toHaveBeenCalled();
    });
  });

  it.each([
    {
      error: new Error('Connection closed after receipt commit'),
      name: 'a lost response after a simulated receipt commit',
    },
    {
      error: new RpcInternalServerError({
        message: 'Private receipt storage defect',
      }),
      name: 'an internal error after a simulated receipt commit',
    },
  ])('retains entries and prevents replay after $name', async ({ error }) => {
    await runReceiptCase(async (context) => {
      let simulatedCommitted = false;
      context.submitReceipt.mockImplementation(async () => {
        simulatedCommitted = true;
        throw error;
      });
      const editor = await context.openEditor();
      await editor.submitForm();
      await editor.expectCloseOnly(unknownMessage);
      expect(simulatedCommitted).toBe(true);
      context.expectSingleWrite();
      expect(context.findByEvent).toHaveBeenCalledOnce();
      expect(context.findMy).toHaveBeenCalledOnce();
      expect(context.findApproval).toHaveBeenCalledOnce();
      expect(context.unexpectedError).not.toHaveBeenCalled();
      button(editor.element, 'Close').click();
      await vi.waitFor(() =>
        expect(context.dialog.openDialogs).toHaveLength(0),
      );
      expect(context.successNotice).not.toHaveBeenCalled();
    });
  });

  it.each([
    {
      error: new RpcForbiddenError({ message: 'Private permission detail' }),
      message:
        'You do not have permission to add this receipt. Your file and entries are still here.',
      name: 'permission denial',
    },
    {
      error: new RpcUnauthorizedError({
        message: 'Private authentication detail',
      }),
      message:
        'Sign in again and check your membership in this organization before submitting. Your file and entries are still here.',
      name: 'expired membership',
    },
    {
      error: new RpcBadRequestError({
        message: 'Choose the receipt purchase country.',
      }),
      message: 'Choose the receipt purchase country.',
      name: 'expected field correction',
    },
  ])(
    'keeps the exact file and editable fields after $name without an automatic replay',
    async ({ error, message }) => {
      await runReceiptCase(async (context) => {
        context.submitReceipt.mockRejectedValue(error);
        const editor = await context.openEditor();
        await editor.submitForm();
        await editor.expectMessage(message);
        expect(editor.receiptForm.enabled).toBe(true);
        expect(button(editor.element, 'Submit receipt').disabled).toBe(false);
        expect(button(editor.element, 'Cancel').disabled).toBe(false);
        context.expectSingleWrite();
        expect(context.successNotice).not.toHaveBeenCalled();
      });
    },
  );

  it.each([
    {
      error: new RpcBadRequestError({
        message: 'Tax amount exceeds the total amount',
      }),
      expectedMessage: 'Tax amount exceeds the total amount',
      name: 'receipt field validation',
      stage: 'submit',
    },
    {
      error: new FinanceResourceNotFoundError({
        message: 'Event not found for receipt submission',
      }),
      expectedMessage: 'Event not found for receipt submission',
      name: 'missing receipt event',
      stage: 'submit',
    },
    {
      error: new RpcInternalServerError({ message: 'Private database detail' }),
      expectedMessage: unknownMessage,
      name: 'receipt internal failure',
      stage: 'submit',
    },
    {
      error: new RpcForbiddenError({
        message: 'Private receipt permission detail',
      }),
      expectedMessage:
        'You do not have permission to add this receipt. Your file and entries are still here.',
      name: 'receipt permission failure',
      stage: 'submit',
    },
    {
      error: new ReceiptMediaBadRequestError({
        message: 'Receipt file must be between 1 byte and 20 MB',
      }),
      expectedMessage: 'Receipt file must be between 1 byte and 20 MB',
      name: 'upload size validation',
      stage: 'create',
    },
    {
      error: new FinanceResourceNotFoundError({
        message: 'Event not found for receipt upload',
      }),
      expectedMessage: 'Event not found for receipt upload',
      name: 'missing upload event',
      stage: 'create',
    },
    {
      error: new ReceiptMediaServiceUnavailableError({
        message: 'Receipt storage is unavailable',
      }),
      expectedMessage: 'Receipt storage is unavailable',
      name: 'sanitized storage availability',
      stage: 'create',
    },
    {
      error: new ReceiptMediaInternalError({
        message: 'Private upload persistence detail',
      }),
      expectedMessage: uploadMessage,
      name: 'upload internal failure',
      stage: 'create',
    },
    {
      error: new RpcBadRequestError({ message: 'Receipt upload has expired' }),
      expectedMessage: 'Receipt upload has expired',
      name: 'expired upload',
      stage: 'finalize',
    },
    {
      error: new ReceiptMediaBadRequestError({
        message: 'Uploaded receipt content does not match its declared type',
      }),
      expectedMessage:
        'Uploaded receipt content does not match its declared type',
      name: 'uploaded content validation',
      stage: 'finalize',
    },
  ])(
    'preserves safe in-dialog guidance and write ownership for $name',
    async ({ error, expectedMessage, stage }) => {
      await runReceiptCase(async (context) => {
        const mutation =
          stage === 'submit'
            ? context.submitReceipt
            : stage === 'create'
              ? context.createUpload
              : context.finalizeUpload;
        mutation.mockRejectedValue(error);
        const editor = await context.openEditor();
        await editor.submitForm();
        if (expectedMessage === unknownMessage) {
          await editor.expectCloseOnly(expectedMessage);
        } else {
          await editor.expectMessage(expectedMessage);
          expect(editor.receiptForm.enabled).toBe(true);
          expect(button(editor.element, 'Submit receipt').disabled).toBe(false);
          expect(button(editor.element, 'Cancel').disabled).toBe(false);
        }
        expect(context.createUpload).toHaveBeenCalledOnce();
        expect(context.finalizeUpload).toHaveBeenCalledTimes(
          stage === 'create' ? 0 : 1,
        );
        expect(context.submitReceipt).toHaveBeenCalledTimes(
          stage === 'submit' ? 1 : 0,
        );
        expect(mutation).toHaveBeenCalledOnce();
        expect(context.errorNotice).not.toHaveBeenCalled();
        expect(context.successNotice).not.toHaveBeenCalled();
        if (stage === 'submit') context.expectSingleWrite();
      });
    },
  );

  it.each(['create upload', 'upload transport', 'finalize upload'] as const)(
    'retains the file and every field when %s fails before receipt submission',
    async (stage) => {
      await runReceiptCase(async (context) => {
        const error = new Error('Upload acknowledgement lost');
        switch (stage) {
          case 'create upload': {
            context.createUpload.mockRejectedValue(error);
            break;
          }
          case 'finalize upload': {
            {
              context.finalizeUpload.mockRejectedValue(error);
              // No default
            }
            break;
          }
          case 'upload transport': {
            context.uploadFetch.mockResolvedValue(
              new Response(null, { status: 503 }),
            );
            break;
          }
        }
        const editor = await context.openEditor();
        await editor.submitForm();
        await editor.expectMessage(uploadMessage);
        expect(editor.receiptForm.enabled).toBe(true);
        expect(button(editor.element, 'Submit receipt').disabled).toBe(false);
        expect(context.createUpload).toHaveBeenCalledOnce();
        expect(context.uploadFetch).toHaveBeenCalledTimes(
          stage === 'create upload' ? 0 : 1,
        );
        expect(context.finalizeUpload).toHaveBeenCalledTimes(
          stage === 'finalize upload' ? 1 : 0,
        );
        expect(context.submitReceipt).not.toHaveBeenCalled();
        expect(context.successNotice).not.toHaveBeenCalled();
        expect(context.findByEvent).toHaveBeenCalledOnce();
      });
    },
  );

  it.each(['event', 'personal', 'approval'] as const)(
    'keeps a confirmed receipt Close-only when the real %s receipt query fails',
    async (source) => {
      await runReceiptCase(async (context) => {
        const failure = new Error('Receipt list read failed');
        switch (source) {
          case 'approval': {
            {
              context.findApproval.mockRejectedValueOnce(failure);
              // No default
            }
            break;
          }
          case 'event': {
            context.findByEvent.mockRejectedValueOnce(failure);
            break;
          }
          case 'personal': {
            context.findMy.mockRejectedValueOnce(failure);
            break;
          }
        }
        const editor = await context.openEditor();
        await editor.submitForm();
        await editor.expectCloseOnly(savedMessage);
        const key =
          source === 'event'
            ? byEventKey('event-1')
            : source === 'personal'
              ? myKey
              : approvalKey;
        expect(context.queryClient.getQueryState(key)?.error).toBe(failure);
        context.expectSingleWrite();
        expect(context.findByEvent).toHaveBeenCalledTimes(2);
        expect(context.findMy).toHaveBeenCalledTimes(2);
        expect(context.findApproval).toHaveBeenCalledTimes(2);
      });
    },
  );

  it('keeps all dialog and parent actions locked until a started sibling read settles after another read rejects', async () => {
    await runReceiptCase(async (context) => {
      const secondaryKey = [...myKey, 'second-active-view'];
      const secondaryRead = vi
        .fn<() => Promise<Awaited<ReturnType<MyQuery>>>>()
        .mockResolvedValue([]);
      const secondaryObserver = new QueryObserver(context.queryClient, {
        queryFn: secondaryRead,
        queryKey: secondaryKey,
      });
      unsubscribeObservers.push(
        secondaryObserver.subscribe(() => {
          /* Exercise another active read under the same canonical filter. */
        }),
      );
      await vi.waitFor(() =>
        expect(secondaryObserver.getCurrentResult().isSuccess).toBe(true),
      );
      const heldRead = hold<Awaited<ReturnType<MyQuery>>>([]);
      secondaryRead.mockReturnValueOnce(heldRead.promise);
      context.findMy.mockRejectedValueOnce(
        new Error('First personal receipt view failed'),
      );
      const editor = await context.openEditor();
      const keydowns: KeyboardEvent[] = [];
      const subscription = editor.dialogRef
        .keydownEvents()
        .subscribe((event) => {
          keydowns.push(event);
        });
      unsubscribeObservers.push(() => subscription.unsubscribe());
      const submission = editor.submitForm();
      await vi.waitFor(() => {
        editor.detect();
        expect(context.submitReceipt).toHaveBeenCalledOnce();
        expect(secondaryRead).toHaveBeenCalledTimes(2);
        expect(context.queryClient.getQueryState(myKey)?.status).toBe('error');
      });
      expect(
        context.queryClient.getMutationCache().find({ mutationKey: submitKey })
          ?.state.status,
      ).toBe('success');
      expect(button(context.root, 'Receipt dialog open').disabled).toBe(true);
      expect(editor.receiptForm.disabled).toBe(true);
      expect(editor.fileInput.disabled).toBe(true);
      expect(editor.nameInput.disabled).toBe(true);
      expect(button(editor.element, 'Adding receipt…').disabled).toBe(true);
      expect(button(editor.element, 'Cancel').disabled).toBe(true);
      expect(editor.dialogRef.disableClose).toBe(true);
      expect(editor.element.querySelector('[role="alert"]')).toBeNull();
      expect(context.successNotice).not.toHaveBeenCalled();
      button(editor.element, 'Cancel').click();
      editor.element.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'Escape',
          key: 'Escape',
          keyCode: 27,
        }),
      );
      await vi.waitFor(() => expect(keydowns).toHaveLength(1));
      await editor.submitForm();
      await context.openOperation();
      editor.detect();
      expect(context.dialog.openDialogs).toHaveLength(1);
      expect(context.createUpload).toHaveBeenCalledOnce();
      expect(context.submitReceipt).toHaveBeenCalledOnce();
      expect(secondaryObserver.getCurrentResult().fetchStatus).toBe('fetching');
      editor.expectValues();
      heldRead.release([]);
      await submission;
      await editor.expectCloseOnly(savedMessage);
      expect(secondaryObserver.getCurrentResult().fetchStatus).toBe('idle');
      context.expectSingleWrite();
    });
  });

  it('keeps the captured event identity across an upload while the organizer input changes', async () => {
    await runReceiptCase(async (context) => {
      const oldEventObserver = new QueryObserver(
        context.queryClient,
        context.byEventOptions({ eventId: 'event-1' }),
      );
      unsubscribeObservers.push(
        oldEventObserver.subscribe(() => {
          /* Keep the captured event receipt query active after route input reuse. */
        }),
      );
      const invalidate = vi.spyOn(context.queryClient, 'invalidateQueries');
      const heldUpload = hold(new Response(null, { status: 204 }));
      context.uploadFetch.mockReturnValueOnce(heldUpload.promise);
      const editor = await context.openEditor();
      const submission = editor.submitForm();
      await vi.waitFor(() =>
        expect(context.uploadFetch).toHaveBeenCalledOnce(),
      );
      context.fixture.componentRef.setInput('eventId', 'event-2');
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(
          context.queryClient.getQueryState(byEventKey('event-2'))?.status,
        ).toBe('success');
      });
      expect(context.submitReceipt).not.toHaveBeenCalled();
      heldUpload.release(new Response(null, { status: 204 }));
      await submission;
      await vi.waitFor(() =>
        expect(context.successNotice).toHaveBeenCalledExactlyOnceWith(
          'Receipt submitted',
        ),
      );
      context.expectSingleWrite();
      expect(invalidate).toHaveBeenCalledWith(
        { queryKey: byEventKey('event-1') },
        { throwOnError: true },
      );
      expect(invalidate).not.toHaveBeenCalledWith(
        { queryKey: byEventKey('event-2') },
        { throwOnError: true },
      );
      expect(
        context.queryClient.getQueryState(byEventKey('event-2'))?.isInvalidated,
      ).toBe(false);
      expect(oldEventObserver.getCurrentResult().fetchStatus).toBe('idle');
    });
  });

  it('keeps a confirmed receipt visible with Close-only guidance when active follow-up queries are initially paused', async () => {
    await runReceiptCase(async (context) => {
      const priorReceipts = context.queryClient.getQueryData(
        byEventKey('event-1'),
      );
      context.submitReceipt.mockImplementation(async () => {
        onlineManager.setOnline(false);
        return { id: 'receipt-1' };
      });
      const editor = await context.openEditor();
      await editor.submitForm();
      await editor.expectCloseOnly(savedMessage);
      expect(onlineManager.isOnline()).toBe(false);
      for (const key of [byEventKey('event-1'), myKey, approvalKey]) {
        expect(context.queryClient.getQueryState(key)?.fetchStatus).toBe(
          'paused',
        );
        expect(context.queryClient.getQueryState(key)?.isInvalidated).toBe(
          true,
        );
      }
      expect(context.queryClient.getQueryData(byEventKey('event-1'))).toBe(
        priorReceipts,
      );
      expect(context.findByEvent).toHaveBeenCalledOnce();
      expect(context.findMy).toHaveBeenCalledOnce();
      expect(context.findApproval).toHaveBeenCalledOnce();
      context.expectSingleWrite();
      expect(context.successNotice).not.toHaveBeenCalled();
    });
  });
  const reconciliationMessage =
    'The latest receipt lists could not be loaded. Adding another receipt remains unavailable. Select Show latest receipts again, or load the original event page again to check its receipts.';
  const reconciledMessage =
    'The latest receipt lists have loaded. Check whether the previous submission is listed before adding another receipt for the same expense.';
  const observeReconciliation = (
    context: Awaited<ReturnType<typeof createReceiptContext>>,
  ) => {
    const nativeReconcile = context.fixture.componentInstance[
      'reconcileReceiptSubmission'
    ].bind(context.fixture.componentInstance);
    const reconcile = vi
      .fn<typeof nativeReconcile>()
      .mockImplementation(() => observeSubmit(nativeReconcile()));
    context.fixture.componentInstance['reconcileReceiptSubmission'] = reconcile;
    const start = () => {
      const previousCount = reconcile.mock.calls.length;
      button(context.root, 'Show latest receipts').click();
      expect(reconcile).toHaveBeenCalledTimes(previousCount + 1);
      const operation = reconcile.mock.results.at(-1);
      if (operation?.type !== 'return')
        throw new Error(
          'Expected the native receipt reconciliation operation.',
        );
      return operation.value;
    };
    return { reconcile, start };
  };

  it('keeps Add receipt blocked after an uncertain dialog closes until every explicit reconciliation read succeeds', async () => {
    await runReceiptCase(async (context) => {
      let simulatedCommitted = false;
      context.submitReceipt.mockImplementation(async () => {
        simulatedCommitted = true;
        throw new Error('Receipt committed but response lost');
      });
      const editor = await context.openEditor();
      await editor.submitForm();
      await editor.expectCloseOnly(unknownMessage);
      button(editor.element, 'Close').click();
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(context.dialog.openDialogs).toHaveLength(0);
        expect(button(context.root, 'Add receipt').disabled).toBe(true);
        expect(button(context.root, 'Show latest receipts').disabled).toBe(
          false,
        );
      });
      await context.openOperation();
      expect(context.dialog.openDialogs).toHaveLength(0);
      expect(simulatedCommitted).toBe(true);
      context.expectSingleWrite();

      const reconciliation = observeReconciliation(context);
      const failure = new Error('Original event receipt read failed');
      context.findByEvent.mockRejectedValueOnce(failure);
      await reconciliation.start();
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(
          context.root.querySelector('[role="alert"]')?.textContent,
        ).toContain(reconciliationMessage);
        expect(button(context.root, 'Show latest receipts').disabled).toBe(
          false,
        );
        expect(button(context.root, 'Add receipt').disabled).toBe(true);
      });
      expect(
        context.queryClient.getQueryState(byEventKey('event-1'))?.error,
      ).toBe(failure);
      await context.openOperation();
      expect(context.dialog.openDialogs).toHaveLength(0);
      context.expectSingleWrite();

      const heldRead = hold<Awaited<ReturnType<MyQuery>>>([]);
      context.findMy.mockReturnValueOnce(heldRead.promise);
      const completion = reconciliation.start();
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(context.findByEvent).toHaveBeenCalledTimes(3);
        expect(context.findMy).toHaveBeenCalledTimes(3);
        expect(context.findApproval).toHaveBeenCalledTimes(3);
        expect(context.queryClient.getQueryState(myKey)?.fetchStatus).toBe(
          'fetching',
        );
        expect(button(context.root, 'Checking receipt lists…').disabled).toBe(
          true,
        );
        expect(button(context.root, 'Add receipt').disabled).toBe(true);
      });
      await reconciliation.reconcile();
      await context.openOperation();
      expect(context.dialog.openDialogs).toHaveLength(0);
      expect(context.findByEvent).toHaveBeenCalledTimes(3);
      expect(context.findMy).toHaveBeenCalledTimes(3);
      expect(context.findApproval).toHaveBeenCalledTimes(3);
      context.expectSingleWrite();
      heldRead.release([]);
      await completion;
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(button(context.root, 'Add receipt').disabled).toBe(false);
        expect(
          context.root.querySelector('[role="status"]')?.textContent,
        ).toContain(reconciledMessage);
      });
      for (const key of [byEventKey('event-1'), myKey, approvalKey]) {
        expect(context.queryClient.getQueryState(key)?.fetchStatus).toBe(
          'idle',
        );
        expect(context.queryClient.getQueryState(key)?.status).toBe('success');
        expect(context.queryClient.getQueryState(key)?.isInvalidated).toBe(
          false,
        );
      }
      const nextEditor = await context.openEditor();
      expect(nextEditor.component).not.toBe(editor.component);
      context.expectSingleWrite();
      expect(context.successNotice).not.toHaveBeenCalled();
    });
  });

  it('keeps a closed uncertain submission blocked when reconciliation reads are paused until an explicit successful read', async () => {
    await runReceiptCase(async (context) => {
      context.submitReceipt.mockRejectedValue(
        new RpcInternalServerError({ message: 'Receipt response unavailable' }),
      );
      const editor = await context.openEditor();
      await editor.submitForm();
      await editor.expectCloseOnly(unknownMessage);
      button(editor.element, 'Close').click();
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(context.dialog.openDialogs).toHaveLength(0);
        expect(button(context.root, 'Show latest receipts').disabled).toBe(
          false,
        );
      });
      const reconciliation = observeReconciliation(context);
      const originalReceipts = context.queryClient.getQueryData(
        byEventKey('event-1'),
      );
      onlineManager.setOnline(false);
      await reconciliation.start();
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(
          context.root.querySelector('[role="alert"]')?.textContent,
        ).toContain(reconciliationMessage);
        expect(button(context.root, 'Add receipt').disabled).toBe(true);
        expect(button(context.root, 'Show latest receipts').disabled).toBe(
          false,
        );
      });
      for (const key of [byEventKey('event-1'), myKey, approvalKey]) {
        expect(context.queryClient.getQueryState(key)?.fetchStatus).toBe(
          'paused',
        );
        expect(context.queryClient.getQueryState(key)?.isInvalidated).toBe(
          true,
        );
      }
      expect(context.queryClient.getQueryData(byEventKey('event-1'))).toBe(
        originalReceipts,
      );
      expect(context.findByEvent).toHaveBeenCalledOnce();
      expect(context.findMy).toHaveBeenCalledOnce();
      expect(context.findApproval).toHaveBeenCalledOnce();
      await context.openOperation();
      expect(context.dialog.openDialogs).toHaveLength(0);
      context.expectSingleWrite();

      onlineManager.setOnline(true);
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        for (const key of [byEventKey('event-1'), myKey, approvalKey]) {
          expect(context.queryClient.getQueryState(key)?.fetchStatus).toBe(
            'idle',
          );
          expect(context.queryClient.getQueryState(key)?.status).toBe(
            'success',
          );
        }
        expect(button(context.root, 'Add receipt').disabled).toBe(true);
      });
      await reconciliation.start();
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(button(context.root, 'Add receipt').disabled).toBe(false);
        expect(
          context.root.querySelector('[role="status"]')?.textContent,
        ).toContain(reconciledMessage);
      });
      const nextEditor = await context.openEditor();
      expect(nextEditor.component).not.toBe(editor.component);
      context.expectSingleWrite();
      expect(context.successNotice).not.toHaveBeenCalled();
    });
  });

  it('retains the uncertain original event through input reuse and reads its inactive cache before allowing another editor', async () => {
    await runReceiptCase(async (context) => {
      const capturedQuery = context.queryClient
        .getQueryCache()
        .find({ exact: true, queryKey: byEventKey('event-1') });
      if (!capturedQuery)
        throw new Error('Expected the loaded original event receipt query.');
      // This suite otherwise uses gcTime:0. Preserve a realistic inactive cache without adding an observer.
      capturedQuery.setOptions({ ...capturedQuery.options, gcTime: Infinity });
      context.submitReceipt.mockRejectedValue(
        new Error('Original event receipt response lost'),
      );
      const editor = await context.openEditor();
      await editor.submitForm();
      await editor.expectCloseOnly(unknownMessage);
      button(editor.element, 'Close').click();
      await vi.waitFor(() =>
        expect(context.dialog.openDialogs).toHaveLength(0),
      );
      context.fixture.componentRef.setInput('eventId', 'event-2');
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(
          context.queryClient.getQueryState(byEventKey('event-2'))?.status,
        ).toBe('success');
        expect(capturedQuery.getObserversCount()).toBe(0);
        expect(button(context.root, 'Add receipt').disabled).toBe(true);
        expect(button(context.root, 'Show latest receipts').disabled).toBe(
          false,
        );
      });
      await context.openOperation();
      expect(context.dialog.openDialogs).toHaveLength(0);
      expect(context.findByEvent).toHaveBeenCalledTimes(2);
      const currentEventReceipts = context.queryClient.getQueryData(
        byEventKey('event-2'),
      );
      const invalidate = vi.spyOn(context.queryClient, 'invalidateQueries');
      const reconciliation = observeReconciliation(context);
      await reconciliation.start();
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(button(context.root, 'Add receipt').disabled).toBe(false);
        expect(
          context.root.querySelector('[role="status"]')?.textContent,
        ).toContain(
          'The latest receipt lists for the original event have loaded. Return to that event and check whether the previous submission is listed before adding another receipt for the same expense.',
        );
      });
      expect(invalidate).toHaveBeenCalledWith(
        { exact: true, queryKey: byEventKey('event-1'), refetchType: 'all' },
        { throwOnError: true },
      );
      expect(invalidate).not.toHaveBeenCalledWith(
        { exact: true, queryKey: byEventKey('event-2'), refetchType: 'all' },
        { throwOnError: true },
      );
      expect(context.findByEvent).toHaveBeenCalledTimes(3);
      expect(context.findByEvent.mock.calls.at(-1)?.[0].queryKey).toEqual(
        byEventKey('event-1'),
      );
      expect(capturedQuery.getObserversCount()).toBe(0);
      expect(capturedQuery.state.fetchStatus).toBe('idle');
      expect(capturedQuery.state.status).toBe('success');
      expect(capturedQuery.state.isInvalidated).toBe(false);
      expect(context.queryClient.getQueryData(byEventKey('event-2'))).toBe(
        currentEventReceipts,
      );
      expect(
        context.queryClient.getQueryState(byEventKey('event-2'))?.isInvalidated,
      ).toBe(false);
      const nextEditor = await context.openEditor();
      expect(nextEditor.component).not.toBe(editor.component);
      expect(context.fixture.componentInstance.eventId()).toBe('event-2');
      context.expectSingleWrite();
      expect(context.successNotice).not.toHaveBeenCalled();
    });
  });

  it('does not reconcile a programmatically closed dialog until its held submission has settled', async () => {
    await runReceiptCase(async (context) => {
      const heldSubmission = hold<undefined>(undefined);
      let simulatedCommitted = false;
      context.submitReceipt.mockImplementation(async () => {
        simulatedCommitted = true;
        await heldSubmission.promise;
        throw new Error('Receipt acknowledgement lost after commit');
      });
      const editor = await context.openEditor();
      const submission = editor.submitForm();
      await vi.waitFor(() => {
        editor.detect();
        expect(context.submitReceipt).toHaveBeenCalledOnce();
        expect(
          context.queryClient
            .getMutationCache()
            .find({ mutationKey: submitKey })?.state.status,
        ).toBe('pending');
      });
      const reconciliation = observeReconciliation(context);
      editor.dialogRef.close();
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(context.dialog.openDialogs).toHaveLength(0);
        expect(button(context.root, 'Submitting receipt…').disabled).toBe(true);
        expect(
          button(context.root, 'Waiting for receipt submission…').disabled,
        ).toBe(true);
        expect(
          context.root.querySelector('[role="alert"]')?.textContent,
        ).toContain(
          'The receipt submission is still in progress. Wait for its outcome before checking the latest receipts.',
        );
      });
      button(context.root, 'Waiting for receipt submission…').click();
      expect(reconciliation.reconcile).not.toHaveBeenCalled();
      await reconciliation.reconcile();
      await context.openOperation();
      expect(context.dialog.openDialogs).toHaveLength(0);
      expect(context.findByEvent).toHaveBeenCalledOnce();
      expect(context.findMy).toHaveBeenCalledOnce();
      expect(context.findApproval).toHaveBeenCalledOnce();
      expect(simulatedCommitted).toBe(true);
      context.expectSingleWrite();

      heldSubmission.release(undefined);
      await submission;
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(
          context.queryClient
            .getMutationCache()
            .find({ mutationKey: submitKey })?.state.status,
        ).toBe('error');
        expect(button(context.root, 'Add receipt').disabled).toBe(true);
        expect(button(context.root, 'Show latest receipts').disabled).toBe(
          false,
        );
      });
      expect(context.findByEvent).toHaveBeenCalledOnce();
      expect(context.findMy).toHaveBeenCalledOnce();
      expect(context.findApproval).toHaveBeenCalledOnce();
      await reconciliation.start();
      await vi.waitFor(() => {
        context.fixture.detectChanges();
        expect(button(context.root, 'Add receipt').disabled).toBe(false);
        expect(
          context.root.querySelector('[role="status"]')?.textContent,
        ).toContain(reconciledMessage);
      });
      expect(context.findByEvent).toHaveBeenCalledTimes(2);
      expect(context.findMy).toHaveBeenCalledTimes(2);
      expect(context.findApproval).toHaveBeenCalledTimes(2);
      const nextEditor = await context.openEditor();
      expect(nextEditor.component).not.toBe(editor.component);
      context.expectSingleWrite();
      expect(context.successNotice).not.toHaveBeenCalled();
    });
  });
});
