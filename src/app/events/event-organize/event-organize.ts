import type { EventsRegistrationStatus } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { PercentPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  buildSelectableReceiptCountries,
  resolveReceiptCountrySettings,
} from '@shared/finance/receipt-countries';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import { ReceiptAmountPipe } from '../../finance/shared/receipt-amount.pipe';
import { receiptStatusLabel } from '../../finance/shared/receipt-status-label';
import {
  type RegistrationCancellationConfirmationData,
  RegistrationCancellationConfirmationDialogComponent,
} from '../registration-cancellation-confirmation-dialog.component';
import {
  ReceiptSubmitDialogComponent,
  ReceiptSubmitDialogResult,
} from './receipt-submit-dialog.component';
import {
  RegistrationTransferDialogComponent,
  RegistrationTransferDialogData,
  RegistrationTransferDialogResult,
} from './registration-transfer-dialog.component';

interface EventOrganizeStatsInput {
  capacity: number;
  checkedIn: number;
  registered: number;
}

export const computeEventOrganizeStats = (
  serverStats?: EventOrganizeStatsInput | null,
) => {
  const capacity = serverStats?.capacity ?? 0;
  const checkedIn = serverStats?.checkedIn ?? 0;
  const registered = serverStats?.registered ?? 0;

  return {
    capacity,
    capacityPercentage: capacity > 0 ? registered / capacity : 0,
    checkedIn,
    registered,
  };
};

interface EventOrganizeStateQueryKeys {
  eventDetails: readonly unknown[];
  organizerAccess: readonly unknown[];
  organizerOverview: readonly unknown[];
  registrationStatus: readonly unknown[];
  scannerAccess: readonly unknown[];
  userEvents: readonly unknown[];
}

interface ExactQueryInvalidator {
  invalidateQueries(
    filters: { exact: true; queryKey: readonly unknown[] },
    options: { throwOnError: true },
  ): Promise<unknown>;
}

export const invalidateEventOrganizeStateQueries = async (
  queryClient: ExactQueryInvalidator,
  queryKeys: EventOrganizeStateQueryKeys,
): Promise<void> => {
  await Promise.all(
    [
      queryKeys.organizerOverview,
      queryKeys.eventDetails,
      queryKeys.registrationStatus,
      queryKeys.organizerAccess,
      queryKeys.scannerAccess,
      queryKeys.userEvents,
    ].map((queryKey) =>
      queryClient.invalidateQueries(
        { exact: true, queryKey },
        { throwOnError: true },
      ),
    ),
  );
};

export const groupEventOrganizeRegistrationOptions = <
  RegistrationOption extends { organizingRegistration: boolean },
>(
  registrationOptions: readonly RegistrationOption[],
) =>
  [
    {
      emptyMessage: 'No organizer/helper registrations yet.',
      id: 'organizer-helper-team',
      options: registrationOptions.filter(
        (option) => option.organizingRegistration,
      ),
      title: 'Organizer/helper team',
    },
    {
      emptyMessage: 'No participant registrations yet.',
      id: 'participant-registrations',
      options: registrationOptions.filter(
        (option) => !option.organizingRegistration,
      ),
      title: 'Participant registrations',
    },
  ] as const;

export interface EventOrganizeParticipant {
  addonPurchases: readonly {
    quantity: number;
    title: string;
    unitPrice: number;
  }[];
  checkedIn: boolean;
  email: string;
  firstName: string;
  lastName: string;
  manualApprovalAvailable: boolean;
  paymentPending: boolean;
  paymentSetupRequired: boolean;
  registrationId: string;
  status: EventsRegistrationStatus;
}

export const organizerRegistrationActionDisabled = ({
  checkedIn,
  mutationPending,
}: {
  checkedIn: boolean;
  mutationPending: boolean;
}): boolean => checkedIn || mutationPending;

export const organizerRegistrationTransferDisabled = ({
  mutationPending,
  status,
}: {
  mutationPending: boolean;
  status: EventsRegistrationStatus;
}): boolean => mutationPending || status !== 'CONFIRMED';

export const organizerRegistrationApprovalDisabled = ({
  manualApprovalAvailable,
  mutationPending,
}: {
  manualApprovalAvailable: boolean;
  mutationPending: boolean;
}): boolean => mutationPending || !manualApprovalAvailable;

export const organizerRegistrationApprovalLabel = ({
  approvalPending,
  paymentSetupRequired,
}: {
  approvalPending: boolean;
  paymentSetupRequired: boolean;
}): string => {
  if (approvalPending) {
    return 'Approving…';
  }

  return paymentSetupRequired ? 'Retry payment setup' : 'Approve application';
};

export const receiptSubmissionActionDisabled = ({
  submissionUnavailable,
  submitPending,
  uploadPending,
}: {
  submissionUnavailable: boolean;
  submitPending: boolean;
  uploadPending: boolean;
}): boolean => submissionUnavailable || submitPending || uploadPending;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TenantDatePipe,
    FontAwesomeModule,
    MatButtonModule,
    PercentPipe,
    ReceiptAmountPipe,
    RouterLink,
  ],
  selector: 'app-event-organize',
  templateUrl: './event-organize.html',
})
export class EventOrganize {
  eventId = input.required<string>();

  private readonly rpc = AppRpc.injectClient();
  protected readonly approveRegistrationMutation = injectMutation(() =>
    this.rpc.events.approveRegistration.mutationOptions(),
  );
  protected readonly cancelRegistrationMutation = injectMutation(() =>
    this.rpc.events.cancelEventRegistration.mutationOptions(),
  );
  protected readonly eventQuery = injectQuery(() =>
    this.rpc.events.findOne.queryOptions({ id: this.eventId() }),
  );
  protected readonly event = computed(() => this.eventQuery.data());
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly organizerOverviewQuery = injectQuery(() =>
    this.rpc.events.getOrganizeOverview.queryOptions({
      eventId: this.eventId(),
    }),
  );
  protected readonly organizerRegistrationActionDisabled =
    organizerRegistrationActionDisabled;
  protected readonly organizerRegistrationApprovalDisabled =
    organizerRegistrationApprovalDisabled;
  protected readonly organizerRegistrationApprovalLabel =
    organizerRegistrationApprovalLabel;
  protected readonly organizerRegistrationTransferDisabled =
    organizerRegistrationTransferDisabled;
  protected readonly receiptOriginalUploadMutation = injectMutation(() =>
    this.rpc.finance.receiptMedia.uploadOriginal.mutationOptions(),
  );
  protected readonly receiptsByEventQuery = injectQuery(() =>
    this.rpc.finance.receipts.byEvent.queryOptions({
      eventId: this.eventId(),
    }),
  );
  protected readonly receiptStatusLabel = receiptStatusLabel;

  protected readonly receiptSubmissionActionDisabled =
    receiptSubmissionActionDisabled;
  protected readonly receiptSubmissionUnavailableMessage = computed(() => {
    const event = this.event();
    if (!event) {
      return 'Receipts can be added after the event has loaded.';
    }

    if (!this.receiptsByEventQuery.isSuccess()) {
      return 'Receipt history must load before a receipt can be added.';
    }

    return null;
  });
  protected readonly registrationGroups = computed(() =>
    groupEventOrganizeRegistrationOptions(
      this.organizerOverviewQuery.data()?.registrationOptions ?? [],
    ),
  );
  protected readonly stats = computed(() =>
    computeEventOrganizeStats(this.organizerOverviewQuery.data()?.stats),
  );

  protected readonly submitReceiptMutation = injectMutation(() =>
    this.rpc.finance.receipts.submit.mutationOptions(),
  );
  protected readonly transferRegistrationMutation = injectMutation(() =>
    this.rpc.events.transferEventRegistration.mutationOptions(),
  );
  private readonly approvalPendingRegistrationId = signal<null | string>(null);
  private readonly config = inject(ConfigService);

  private readonly dialog = inject(MatDialog);

  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  constructor() {
    effect(() => {
      const event = this.event();
      if (event) {
        this.config.updateTitle(`Organize ${event.title}`);
      }
    });
  }

  protected approvalPending(registrationId: string): boolean {
    return this.approvalPendingRegistrationId() === registrationId;
  }

  protected approveRegistration(
    registration: Pick<
      EventOrganizeParticipant,
      'manualApprovalAvailable' | 'paymentSetupRequired' | 'registrationId'
    >,
  ) {
    if (
      organizerRegistrationApprovalDisabled({
        manualApprovalAvailable: registration.manualApprovalAvailable,
        mutationPending:
          this.approveRegistrationMutation.isPending() ||
          this.cancelRegistrationMutation.isPending() ||
          this.transferRegistrationMutation.isPending(),
      })
    ) {
      return;
    }

    this.approvalPendingRegistrationId.set(registration.registrationId);
    this.approveRegistrationMutation.mutate(
      {
        eventId: this.eventId(),
        registrationId: registration.registrationId,
      },
      {
        onError: (error) => {
          this.notifications.showError(
            getErrorMessage(
              error,
              registration.paymentSetupRequired
                ? 'Failed to set up registration payment'
                : 'Failed to approve application',
            ),
          );
        },
        onSettled: async () => {
          try {
            await this.invalidateOrganizerState();
          } finally {
            this.approvalPendingRegistrationId.set(null);
          }
        },
        onSuccess: (result) => {
          this.notifications.showSuccess(
            result.status === 'confirmed'
              ? 'Registration confirmed'
              : 'Application approved. Payment is required before confirmation.',
          );
        },
      },
    );
  }

  protected async cancelRegistration(
    registration: Pick<
      EventOrganizeParticipant,
      | 'checkedIn'
      | 'firstName'
      | 'lastName'
      | 'paymentPending'
      | 'registrationId'
      | 'status'
    >,
  ): Promise<void> {
    const expectedPaymentPending = registration.paymentPending;
    const expectedStatus = registration.status;
    if (expectedStatus === 'CANCELLED') {
      return;
    }
    if (
      organizerRegistrationActionDisabled({
        checkedIn: registration.checkedIn,
        mutationPending:
          this.approveRegistrationMutation.isPending() ||
          this.cancelRegistrationMutation.isPending() ||
          this.transferRegistrationMutation.isPending(),
      })
    ) {
      return;
    }

    const confirmed = await firstValueFrom(
      this.dialog
        .open<
          RegistrationCancellationConfirmationDialogComponent,
          RegistrationCancellationConfirmationData,
          boolean
        >(RegistrationCancellationConfirmationDialogComponent, {
          data: {
            actor: 'organizer',
            participantName: `${registration.firstName} ${registration.lastName}`,
            paymentPending: expectedPaymentPending,
            status: expectedStatus,
          },
          width: 'min(32rem, calc(100vw - 2rem))',
        })
        .afterClosed(),
    );
    if (confirmed !== true) {
      return;
    }
    if (
      organizerRegistrationActionDisabled({
        checkedIn: registration.checkedIn,
        mutationPending:
          this.approveRegistrationMutation.isPending() ||
          this.cancelRegistrationMutation.isPending() ||
          this.transferRegistrationMutation.isPending(),
      })
    ) {
      return;
    }

    this.cancelRegistrationMutation.mutate(
      {
        eventId: this.eventId(),
        expectedPaymentPending,
        expectedStatus,
        registrationId: registration.registrationId,
      },
      {
        onError: async (error) => {
          try {
            await this.invalidateOrganizerState();
          } finally {
            this.notifications.showError(
              getErrorMessage(error, 'Failed to cancel registration'),
            );
          }
        },
        onSuccess: async () => {
          await this.invalidateOrganizerState();
          this.notifications.showSuccess('Registration cancelled');
        },
      },
    );
  }

  protected async openReceiptDialog(): Promise<void> {
    if (
      receiptSubmissionActionDisabled({
        submissionUnavailable: !!this.receiptSubmissionUnavailableMessage(),
        submitPending: this.submitReceiptMutation.isPending(),
        uploadPending: this.receiptOriginalUploadMutation.isPending(),
      })
    ) {
      return;
    }

    const receiptCountrySettings = resolveReceiptCountrySettings(
      this.config.tenant.receiptSettings,
    );
    const countries = buildSelectableReceiptCountries(receiptCountrySettings);

    const dialogReference = this.dialog.open<
      ReceiptSubmitDialogComponent,
      { countries: string[]; defaultCountry: string },
      ReceiptSubmitDialogResult
    >(ReceiptSubmitDialogComponent, {
      data: {
        countries,
        defaultCountry: receiptCountrySettings.receiptCountries[0] ?? 'DE',
      },
      width: '640px',
    });

    const result = await firstValueFrom(dialogReference.afterClosed());
    if (!result) {
      return;
    }

    try {
      const attachment = await this.prepareAttachment(
        result.file,
        result.attachmentName,
      );

      this.submitReceiptMutation.mutate(
        {
          attachment,
          eventId: this.eventId(),
          fields: {
            ...result.fields,
            receiptDate: result.fields.receiptDate.toISOString(),
          },
        },
        {
          onSuccess: async () => {
            await this.queryClient.invalidateQueries({
              queryKey: this.rpc.finance.receipts.byEvent.queryKey({
                eventId: this.eventId(),
              }),
            });
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter(['finance', 'receipts.my']),
            );
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter([
                'finance',
                'receipts.pendingApprovalGrouped',
              ]),
            );
            this.notifications.showSuccess('Receipt submitted');
          },
        },
      );
    } catch (error) {
      this.notifications.showError(
        getErrorMessage(error, 'Failed to upload receipt file'),
      );
    }
  }

  protected async openTransferDialog(
    registration: EventOrganizeParticipant,
  ): Promise<void> {
    if (
      organizerRegistrationTransferDisabled({
        mutationPending:
          this.approveRegistrationMutation.isPending() ||
          this.transferRegistrationMutation.isPending() ||
          this.cancelRegistrationMutation.isPending(),
        status: registration.status,
      })
    ) {
      return;
    }

    const dialogReference = this.dialog.open<
      RegistrationTransferDialogComponent,
      RegistrationTransferDialogData,
      RegistrationTransferDialogResult
    >(RegistrationTransferDialogComponent, {
      data: {
        currentUser: {
          email: registration.email,
          firstName: registration.firstName,
          lastName: registration.lastName,
        },
        eventId: this.eventId(),
        registrationId: registration.registrationId,
      },
      width: '560px',
    });

    const result = await firstValueFrom(dialogReference.afterClosed());
    if (!result) {
      return;
    }

    this.transferRegistrationMutation.mutate(
      {
        eventId: this.eventId(),
        previewVersion: result.previewVersion,
        registrationId: registration.registrationId,
        targetUserId: result.targetUserId,
      },
      {
        onError: (error) => {
          this.notifications.showError(
            getErrorMessage(error, 'Failed to transfer registration'),
          );
        },
        onSuccess: async () => {
          await this.invalidateOrganizerState();
          this.notifications.showSuccess('Registration transferred');
        },
      },
    );
  }

  protected readonly showOrganizerRow = (
    index: number,
    row: { type?: string },
  ) => row?.type !== 'Registration Option';

  protected readonly showRegistrationOptionRow = (
    index: number,
    row: { type?: string },
  ) => row?.type === 'Registration Option';

  private invalidateOrganizerState(): Promise<void> {
    const eventId = this.eventId();
    return invalidateEventOrganizeStateQueries(this.queryClient, {
      eventDetails: this.rpc.events.findOne.queryKey({ id: eventId }),
      organizerAccess: this.rpc.events.canOrganize.queryKey({ eventId }),
      organizerOverview: this.rpc.events.getOrganizeOverview.queryKey({
        eventId,
      }),
      registrationStatus: this.rpc.events.getRegistrationStatus.queryKey({
        eventId,
      }),
      scannerAccess: this.rpc.users.canUseScanner.queryKey(),
      userEvents: this.rpc.users.events.queryKey(),
    });
  }

  private async prepareAttachment(file: File, attachmentName: string) {
    const originalUpload = await this.uploadReceiptOriginal(file);

    return {
      fileName: attachmentName,
      uploadId: originalUpload.uploadId,
    };
  }

  private async readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('error', () => {
        reject(new Error('Failed to read receipt file'));
      });
      reader.addEventListener('load', () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('Invalid receipt file payload'));
          return;
        }
        const commaIndex = reader.result.indexOf(',');
        if (commaIndex === -1) {
          reject(new Error('Invalid receipt data URL'));
          return;
        }
        resolve(reader.result.slice(commaIndex + 1));
      });
      reader.readAsDataURL(file);
    });
  }

  private async uploadReceiptOriginal(
    file: File,
  ): Promise<{ uploadId: string }> {
    return this.receiptOriginalUploadMutation.mutateAsync({
      eventId: this.eventId(),
      fileBase64: await this.readFileAsBase64(file),
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType: file.type,
    });
  }
}
