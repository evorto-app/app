import type {
  EventsPurchaseRegistrationAddonResult,
  EventsRegistrationAddonRecord,
  EventsRegistrationStatus,
  EventsRegistrationStatusRecord,
} from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import {
  CurrencyPipe,
  DatePipe,
  DOCUMENT,
  NgOptimizedImage,
} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  Injectable,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { normalizeStripeCheckoutUrl } from '../../core/stripe-checkout-url';
import { PriceWithTaxComponent } from '../../shared/components/inclusive-price-label/price-with-tax.component';
import {
  type RegistrationCancellationConfirmationData,
  RegistrationCancellationConfirmationDialogComponent,
} from '../registration-cancellation-confirmation-dialog.component';
import {
  clampRegistrationAddonQuantity,
  reconcileRegistrationAddonPurchaseAttempts,
  registrationAddonHasCanonicalPendingOrder,
  registrationAddonKey,
  type RegistrationAddonPurchaseAttempt,
  registrationAddonPurchaseBlockedCopy,
  registrationHasPendingAddonPayment,
  resolveRegistrationAddonPurchaseAttempt,
} from './event-active-registration-addon-purchase';
import {
  EventRegistrationTransferDialogComponent,
  type EventRegistrationTransferDialogData,
} from './event-registration-transfer-dialog.component';

interface RegistrationAddonPurchaseNotice {
  readonly kind: 'completed' | 'error' | 'pending';
  readonly message: string;
}

const withoutRecordEntry = <Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): Readonly<Record<string, Value>> =>
  Object.fromEntries(
    Object.entries(record).filter(([entryKey]) => entryKey !== key),
  );

interface RegistrationStatusQueryData {
  readonly isRegistered: boolean;
  readonly registrations: readonly EventsRegistrationStatusRecord[];
}

type RegistrationTransferBlockedReason =
  EventsRegistrationStatusRecord['transferBlockedReason'];

@Injectable({ providedIn: 'root' })
export class EventActiveRegistrationOperations {
  private readonly rpc = AppRpc.injectClient();

  cancelRegistration() {
    return this.rpc.events.cancelRegistration.mutationOptions();
  }

  cancelTransfer() {
    return this.rpc.registrationTransfers.cancel.mutationOptions();
  }

  createTransfer() {
    return this.rpc.registrationTransfers.createOffer.mutationOptions();
  }

  eventDetailsQueryKey(eventId: string) {
    return this.rpc.events.findOne.queryKey({ id: eventId });
  }

  eventOrganizerAccessQueryKey(eventId: string) {
    return this.rpc.events.canOrganize.queryKey({ eventId });
  }

  eventOrganizerAccessQueryOptions(eventId: string) {
    return this.rpc.events.canOrganize.queryOptions({ eventId });
  }

  purchaseRegistrationAddon() {
    return this.rpc.events.purchaseRegistrationAddon.mutationOptions();
  }

  registrationStatusQueryKey(eventId: string) {
    return this.rpc.events.getRegistrationStatus.queryKey({ eventId });
  }

  scannerAccessQueryKey() {
    return this.rpc.users.canUseScanner.queryKey();
  }

  userEventsQueryKey() {
    return this.rpc.users.events.queryKey();
  }
}

export const registrationAudienceCopy = (
  registration: Pick<
    EventsRegistrationStatusRecord,
    'organizingRegistration' | 'paymentPending' | 'status'
  >,
): {
  audienceLabel: string;
  confirmedStatus: string;
  passHeading: string;
  paymentPendingStatus: string;
  pendingApprovalStatus: string;
  qrAlt: string;
} =>
  registration.organizingRegistration
    ? {
        audienceLabel: 'Organizer/helper',
        confirmedStatus: 'Organizer/helper registration confirmed',
        passHeading: 'Your organizer/helper pass',
        paymentPendingStatus:
          'Complete payment to confirm your organizer/helper registration. Organizer access starts only after payment succeeds.',
        pendingApprovalStatus:
          'Organizer/helper application pending. Organizer access starts only after approval and any required payment.',
        qrAlt: 'QR code for the organizer/helper registration',
      }
    : {
        audienceLabel: 'Participant',
        confirmedStatus: 'Your registration is confirmed',
        passHeading: 'Your event ticket',
        paymentPendingStatus: 'Complete payment to confirm your registration.',
        pendingApprovalStatus:
          'Your registration is pending organizer approval.',
        qrAlt: 'QR code for the registration',
      };

export const recipientTransferCheckoutPending = (registration: {
  activeTransfer: EventsRegistrationStatusRecord['activeTransfer'];
  status: EventsRegistrationStatus;
}): boolean =>
  registration.status === 'PENDING' &&
  registration.activeTransfer?.registrationSide === 'recipient' &&
  registration.activeTransfer.status === 'checkout_pending';

export const registrationCancellationCopy = (registration: {
  activeTransfer: EventsRegistrationStatusRecord['activeTransfer'];
  cancellationAvailable: boolean;
  cancellationBlockedReason: EventsRegistrationStatusRecord['cancellationBlockedReason'];
  guestCount: number;
  paymentPending: boolean;
  status: EventsRegistrationStatus;
}): null | {
  buttonLabel: null | string;
  helperText: string;
} => {
  const pendingSpotNoun =
    registration.guestCount > 0 ? 'all selected spots' : 'the reserved spot';
  const confirmedSpotNoun =
    registration.guestCount > 0 ? 'all selected spots' : 'your spot';

  if (recipientTransferCheckoutPending(registration)) {
    return null;
  }

  if (!registration.cancellationAvailable) {
    switch (registration.cancellationBlockedReason) {
      case 'checkedIn': {
        return {
          buttonLabel: null,
          helperText:
            'This registration has already been checked in and can no longer be cancelled.',
        };
      }
      case 'deadlinePassed': {
        return {
          buttonLabel: null,
          helperText:
            'The cancellation deadline has passed. No cancellation, refund, or spot release has been made.',
        };
      }
      case 'eventStarted': {
        return {
          buttonLabel: null,
          helperText:
            'The event has started, so this registration can no longer be cancelled.',
        };
      }
      case 'none': {
        return {
          buttonLabel: null,
          helperText:
            'Cancellation is currently unavailable. Refresh the event page for the latest status.',
        };
      }
    }
  }

  if (registration.status === 'PENDING') {
    return {
      buttonLabel: 'Cancel registration',
      helperText: registration.paymentPending
        ? `This cancels the pending registration and releases ${pendingSpotNoun}. It does not complete a payment.`
        : 'This withdraws your pending application before organizer approval.',
    };
  }

  if (registration.status === 'CONFIRMED') {
    return {
      buttonLabel: 'Cancel registration',
      helperText: `This cancels your confirmed registration and releases ${confirmedSpotNoun}. Paid refunds start only when Stripe payment ownership, fee allocation, and add-on amounts reconcile safely. Refunds then process asynchronously.`,
    };
  }

  if (registration.status === 'WAITLIST') {
    return {
      buttonLabel: 'Leave waitlist',
      helperText:
        'This removes your waitlist registration and releases your waitlist position.',
    };
  }

  return null;
};

export const registrationDeferredActionCopy = (registration: {
  status: EventsRegistrationStatus;
}): null | string => {
  if (registration.status === 'PENDING') {
    return 'Transfer/resale is not available for pending registrations.';
  }

  if (registration.status === 'WAITLIST') {
    return 'Transfer/resale is not available for waitlist registrations.';
  }

  return null;
};

export const registrationTransferBlockedCopy = (
  reason: RegistrationTransferBlockedReason,
): string => {
  switch (reason) {
    case 'activeTransfer': {
      return 'A transfer offer is already active for this ticket.';
    }
    case 'addonPaymentPending': {
      return 'Finish or let the pending add-on checkout expire before transferring this ticket.';
    }
    case 'deadlinePassed': {
      return 'The transfer deadline for this event has passed.';
    }
    case 'eventUnavailable': {
      return 'This event is not currently available for ticket transfers.';
    }
    case 'none': {
      return '';
    }
    case 'registrationStatus': {
      return 'Only confirmed registrations can be transferred.';
    }
  }
};

export const registrationTransferActionCopy = (registration: {
  status: EventsRegistrationStatus;
  transferAvailable: boolean;
  transferBlockedReason: RegistrationTransferBlockedReason;
}): null | {
  buttonLabel: string;
  helperText: string;
} => {
  if (registration.status !== 'CONFIRMED') {
    return null;
  }

  if (registration.transferAvailable) {
    return {
      buttonLabel: 'Create transfer link',
      helperText:
        'Create a private link and code for one eligible tenant member. They review the current questions, add-ons, discount, and price before claiming it.',
    };
  }

  return {
    buttonLabel: 'Transfer unavailable',
    helperText: registrationTransferBlockedCopy(
      registration.transferBlockedReason,
    ),
  };
};

export const registrationActiveTransferStatusCopy = (
  activeTransfer: NonNullable<EventsRegistrationStatusRecord['activeTransfer']>,
): {
  body: string;
  cancelLabel: null | string;
  showExpiry: boolean;
  title: string;
} => {
  switch (activeTransfer.status) {
    case 'checkout_pending': {
      return activeTransfer.registrationSide === 'recipient'
        ? {
            body: 'Canceling stops this checkout and keeps the original ticket with its current owner.',
            cancelLabel: 'Cancel pending transfer payment',
            showExpiry: true,
            title: 'Transfer payment is pending',
          }
        : {
            body: 'Your registration remains confirmed until the recipient payment is confirmed.',
            cancelLabel: 'Cancel transfer offer',
            showExpiry: true,
            title: 'Recipient payment is pending',
          };
    }
    case 'open': {
      return {
        body: 'Your registration remains confirmed until a recipient completes the transfer.',
        cancelLabel: 'Cancel transfer offer',
        showExpiry: true,
        title: 'Transfer offer is active',
      };
    }
    case 'refund_failed': {
      return {
        body:
          activeTransfer.registrationSide === 'recipient'
            ? 'The ticket transfer is complete, but the previous owner refund needs platform-administrator attention. Your ticket remains confirmed.'
            : 'The ticket transfer is complete, but your refund needs platform-administrator attention. The transfer can no longer be cancelled.',
        cancelLabel: null,
        showExpiry: false,
        title: 'Transfer refund needs attention',
      };
    }
    case 'refund_pending': {
      if (activeTransfer.refundLifecycle?.state === 'actionRequired') {
        return {
          body:
            activeTransfer.registrationSide === 'recipient'
              ? 'The ticket transfer is complete, but the previous owner refund requires provider-side action. Your ticket remains confirmed.'
              : 'The ticket transfer is complete, but your refund requires provider-side action. Do not pay or register again to retry it.',
          cancelLabel: null,
          showExpiry: false,
          title: 'Transfer refund requires provider action',
        };
      }
      if (activeTransfer.refundLifecycle?.state === 'succeeded') {
        return {
          body:
            activeTransfer.registrationSide === 'recipient'
              ? 'The ticket transfer is complete and the previous owner refund completed. Your ticket remains confirmed.'
              : 'The ticket transfer is complete and your recorded refund completed.',
          cancelLabel: null,
          showExpiry: false,
          title: 'Transfer refund completed',
        };
      }
      if (activeTransfer.refundLifecycle?.state !== 'processing') {
        return {
          body:
            activeTransfer.registrationSide === 'recipient'
              ? 'The ticket transfer is complete, but the previous owner refund processing stopped and needs platform-administrator attention. Your ticket remains confirmed.'
              : 'The ticket transfer is complete, but your refund processing stopped and needs platform-administrator attention. Do not pay or register again to retry it.',
          cancelLabel: null,
          showExpiry: false,
          title: 'Transfer refund needs attention',
        };
      }
      return {
        body:
          activeTransfer.registrationSide === 'recipient'
            ? 'The ticket transfer is complete while the previous owner refund is processed. Your ticket remains confirmed.'
            : 'The ticket transfer is complete and your refund is being processed. The transfer can no longer be cancelled.',
        cancelLabel: null,
        showExpiry: false,
        title: 'Transfer refund is processing',
      };
    }
  }
};

export const registrationCancellationActionDisabled = (input: {
  addonPurchasePending: boolean;
  cancellationPending: boolean;
  transferPending: boolean;
}): boolean =>
  input.addonPurchasePending ||
  input.cancellationPending ||
  input.transferPending;

export const registrationTransferActionDisabled = (input: {
  addonPurchasePending: boolean;
  cancellationPending: boolean;
  transferAvailable: boolean;
  transferPending: boolean;
}): boolean =>
  !input.transferAvailable ||
  input.addonPurchasePending ||
  input.cancellationPending ||
  input.transferPending;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    DatePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    NgOptimizedImage,
    PriceWithTaxComponent,
  ],
  selector: 'app-event-active-registration',
  styles: ``,
  templateUrl: './event-active-registration.component.html',
})
export class EventActiveRegistrationComponent {
  public readonly eventId = input.required<string>();
  public readonly registrations =
    input.required<readonly EventsRegistrationStatusRecord[]>();

  protected readonly activePurchaseKey = signal<null | string>(null);

  protected readonly cancellationCopy = registrationCancellationCopy;
  private readonly operations = inject(EventActiveRegistrationOperations);
  protected readonly cancelRegistrationMutation = injectMutation(() =>
    this.operations.cancelRegistration(),
  );
  protected readonly cancelTransferMutation = injectMutation(() =>
    this.operations.cancelTransfer(),
  );
  protected readonly deferredActionCopy = registrationDeferredActionCopy;
  protected readonly purchaseRegistrationAddonMutation = injectMutation(() =>
    this.operations.purchaseRegistrationAddon(),
  );
  protected readonly recipientTransferCheckoutPending =
    recipientTransferCheckoutPending;
  protected readonly registrationActiveTransferStatusCopy =
    registrationActiveTransferStatusCopy;
  protected readonly registrationAddonHasCanonicalPendingOrder =
    registrationAddonHasCanonicalPendingOrder;
  protected readonly registrationAddonPurchaseBlockedCopy =
    registrationAddonPurchaseBlockedCopy;
  protected readonly registrationAudienceCopy = registrationAudienceCopy;
  protected readonly registrationCancellationActionDisabled =
    registrationCancellationActionDisabled;
  protected readonly registrationHasPendingAddonPayment =
    registrationHasPendingAddonPayment;
  protected readonly registrationTransferActionDisabled =
    registrationTransferActionDisabled;

  protected readonly transferActionCopy = registrationTransferActionCopy;
  protected readonly transferRegistrationMutation = injectMutation(() =>
    this.operations.createTransfer(),
  );

  private readonly dialog = inject(MatDialog);
  private readonly document = inject(DOCUMENT);
  private readonly localCheckoutUrls = signal<Readonly<Record<string, string>>>(
    {},
  );
  private readonly purchaseAttempts = signal<
    Readonly<Record<string, RegistrationAddonPurchaseAttempt>>
  >({});
  private readonly purchaseNotices = signal<
    Readonly<Record<string, RegistrationAddonPurchaseNotice>>
  >({});
  private readonly queryClient = inject(QueryClient);
  private readonly selectedAddonQuantities = signal<
    Readonly<Record<string, number>>
  >({});

  constructor() {
    effect(() => {
      const registrations = this.registrations();
      untracked(() => this.reconcileOwnerPurchaseAttempts(registrations));
    });
  }

  async cancelRegistration(
    registration: EventsRegistrationStatusRecord,
  ): Promise<void> {
    const expectedPaymentPending = registration.paymentPending;
    const expectedStatus = registration.status;
    if (expectedStatus === 'CANCELLED' || !registration.cancellationAvailable) {
      return;
    }
    if (
      !registration.cancellationAvailable ||
      recipientTransferCheckoutPending(registration) ||
      registrationCancellationActionDisabled({
        addonPurchasePending:
          this.purchaseRegistrationAddonMutation.isPending() ||
          registrationHasPendingAddonPayment(registration),
        cancellationPending: this.cancelRegistrationMutation.isPending(),
        transferPending:
          this.transferRegistrationMutation.isPending() ||
          this.cancelTransferMutation.isPending(),
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
            actor: 'participant',
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
      recipientTransferCheckoutPending(registration) ||
      registrationCancellationActionDisabled({
        addonPurchasePending:
          this.purchaseRegistrationAddonMutation.isPending() ||
          registrationHasPendingAddonPayment(registration),
        cancellationPending: this.cancelRegistrationMutation.isPending(),
        transferPending:
          this.transferRegistrationMutation.isPending() ||
          this.cancelTransferMutation.isPending(),
      })
    ) {
      return;
    }

    this.cancelRegistrationMutation.mutate(
      {
        expectedPaymentPending,
        expectedStatus,
        registrationId: registration.id,
      },
      {
        onError: async () => {
          await this.invalidateOwnerQueries(false);
        },
        onSuccess: async () => {
          await this.invalidateOwnerQueries(false);
        },
      },
    );
  }

  cancelTransfer(transferId: string): void {
    if (
      this.purchaseRegistrationAddonMutation.isPending() ||
      this.transferRegistrationMutation.isPending() ||
      this.cancelTransferMutation.isPending()
    ) {
      return;
    }
    this.cancelTransferMutation.mutate(
      { transferId },
      {
        onSuccess: async () => {
          await this.invalidateOwnerQueries(false);
        },
      },
    );
  }

  transferRegistration(registration: EventsRegistrationStatusRecord): void {
    if (
      registrationTransferActionDisabled({
        addonPurchasePending:
          this.purchaseRegistrationAddonMutation.isPending() ||
          registrationHasPendingAddonPayment(registration),
        cancellationPending: this.cancelRegistrationMutation.isPending(),
        transferAvailable: registration.transferAvailable,
        transferPending:
          this.transferRegistrationMutation.isPending() ||
          this.cancelTransferMutation.isPending(),
      })
    ) {
      return;
    }

    this.transferRegistrationMutation.mutate(
      {
        registrationId: registration.id,
      },
      {
        onSuccess: async (offer) => {
          this.dialog.open<
            EventRegistrationTransferDialogComponent,
            EventRegistrationTransferDialogData
          >(EventRegistrationTransferDialogComponent, {
            data: offer,
            width: '560px',
          });
          await this.invalidateOwnerQueries(false);
        },
      },
    );
  }

  protected addOnTaxRate(addOn: EventsRegistrationAddonRecord): null | {
    displayName: null | string;
    percentage: null | string;
  } {
    if (
      addOn.nextPurchaseTaxRateDisplayName === null &&
      addOn.nextPurchaseTaxRatePercentage === null
    ) {
      return null;
    }

    return {
      displayName: addOn.nextPurchaseTaxRateDisplayName,
      percentage: addOn.nextPurchaseTaxRatePercentage,
    };
  }

  protected checkoutUrl(
    registrationId: string,
    addOn: EventsRegistrationAddonRecord,
  ): null | string {
    if (addOn.pendingCheckoutUrl !== null) {
      return normalizeStripeCheckoutUrl(addOn.pendingCheckoutUrl);
    }

    return (
      this.localCheckoutUrls()[
        registrationAddonKey(registrationId, addOn.addOnId)
      ] ?? null
    );
  }

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Cancellation failed');
  }

  protected pendingCheckoutUrlInvalid(
    addOn: EventsRegistrationAddonRecord,
  ): boolean {
    return (
      addOn.pendingCheckoutUrl !== null &&
      normalizeStripeCheckoutUrl(addOn.pendingCheckoutUrl) === null
    );
  }

  protected purchaseNotice(
    registrationId: string,
    addOnId: string,
  ): RegistrationAddonPurchaseNotice | undefined {
    return this.purchaseNotices()[
      registrationAddonKey(registrationId, addOnId)
    ];
  }

  protected async purchaseRegistrationAddon(
    registrationId: string,
    addOn: EventsRegistrationAddonRecord,
  ): Promise<void> {
    if (this.purchaseRegistrationAddonMutation.isPending()) {
      return;
    }

    const key = registrationAddonKey(registrationId, addOn.addOnId);
    const attempt = resolveRegistrationAddonPurchaseAttempt({
      addOn,
      createOperationKey: () => crypto.randomUUID(),
      existingAttempt: this.purchaseAttempts()[key],
      quantity: this.selectedAddonQuantity(registrationId, addOn),
    });
    if (!attempt) {
      return;
    }

    this.activePurchaseKey.set(key);
    this.setPurchaseAttempt(key, attempt);
    this.clearLocalCheckoutUrl(key);
    this.clearPurchaseNotice(key);

    try {
      const result = await this.purchaseRegistrationAddonMutation.mutateAsync({
        addOnId: addOn.addOnId,
        operationKey: attempt.operationKey,
        quantity: attempt.quantity,
        registrationId,
      });
      await this.handlePurchaseSuccess({
        addOn,
        attempt,
        key,
        result,
      });
    } catch (error) {
      await this.handlePurchaseFailure({ error, key });
    } finally {
      this.activePurchaseKey.set(null);
    }
  }

  protected registrationCheckoutUrl(
    checkoutUrl: null | string | undefined,
  ): null | string {
    return normalizeStripeCheckoutUrl(checkoutUrl);
  }

  protected selectedAddonQuantity(
    registrationId: string,
    addOn: EventsRegistrationAddonRecord,
  ): number {
    const key = registrationAddonKey(registrationId, addOn.addOnId);
    return clampRegistrationAddonQuantity(
      this.selectedAddonQuantities()[key] ?? 1,
      addOn.maxPurchasableQuantity,
    );
  }

  protected transferErrorMessage(error: unknown): string {
    return getErrorMessage(error, 'Transfer failed');
  }

  protected updateAddonQuantity(
    registrationId: string,
    addOn: EventsRegistrationAddonRecord,
    event: Event,
  ): void {
    if (this.purchaseRegistrationAddonMutation.isPending()) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    const key = registrationAddonKey(registrationId, addOn.addOnId);
    const quantity = clampRegistrationAddonQuantity(
      Number(target.value),
      addOn.maxPurchasableQuantity,
    );
    this.selectedAddonQuantities.update((quantities) => ({
      ...quantities,
      [key]: quantity,
    }));

    const attempt = this.purchaseAttempts()[key];
    if (attempt && attempt.quantity !== quantity) {
      this.clearPurchaseAttempt(key);
    }
    this.clearPurchaseNotice(key);
  }

  private clearLocalCheckoutUrl(key: string): void {
    this.localCheckoutUrls.update((urls) => withoutRecordEntry(urls, key));
  }

  private clearPurchaseAttempt(key: string): void {
    this.purchaseAttempts.update((attempts) =>
      withoutRecordEntry(attempts, key),
    );
  }

  private clearPurchaseNotice(key: string): void {
    this.purchaseNotices.update((notices) => withoutRecordEntry(notices, key));
  }

  private async handlePurchaseFailure(input: {
    error: unknown;
    key: string;
  }): Promise<void> {
    const refreshed = await this.invalidateOwnerQueries(true);
    const recoveryCopy = refreshed
      ? 'Retry reuses this exact purchase request. If a pending checkout has definitively expired, reload before deliberately starting a new purchase.'
      : 'The latest ticket status could not be refreshed. Retry will reuse this exact purchase request.';
    this.setPurchaseNotice(input.key, {
      kind: 'error',
      message: `${getErrorMessage(input.error, 'Add-on purchase failed')} ${recoveryCopy}`,
    });
  }

  private async handlePurchaseSuccess(input: {
    addOn: EventsRegistrationAddonRecord;
    attempt: RegistrationAddonPurchaseAttempt;
    key: string;
    result: EventsPurchaseRegistrationAddonResult;
  }): Promise<void> {
    const refreshed = await this.invalidateOwnerQueries(true);

    if (input.result.status === 'completed') {
      this.clearPurchaseAttempt(input.key);
      this.clearLocalCheckoutUrl(input.key);
      this.setPurchaseNotice(input.key, {
        kind: 'completed',
        message: refreshed
          ? `${input.attempt.quantity} × ${input.addOn.title} added to your ticket.`
          : `${input.attempt.quantity} × ${input.addOn.title} added to your ticket. Reload this page to refresh the displayed quantities.`,
      });
      return;
    }

    if (
      !this.purchaseAttempts()[input.key] &&
      input.attempt.source === 'local'
    ) {
      this.setPurchaseAttempt(input.key, input.attempt);
    }
    const checkoutUrl = normalizeStripeCheckoutUrl(input.result.checkoutUrl);
    if (!checkoutUrl) {
      this.setPurchaseNotice(input.key, {
        kind: 'error',
        message:
          'Evorto received an invalid payment link and did not open it. Refresh the status or contact an organizer.',
      });
      return;
    }

    this.localCheckoutUrls.update((urls) => ({
      ...urls,
      [input.key]: checkoutUrl,
    }));
    this.setPurchaseNotice(input.key, {
      kind: 'pending',
      message: refreshed
        ? 'Stripe checkout is ready. Your ticket updates only after Stripe confirms payment.'
        : 'Stripe checkout is ready, but the latest ticket status could not be refreshed. Your ticket updates only after Stripe confirms payment.',
    });

    try {
      this.document.location.assign(checkoutUrl);
    } catch {
      this.setPurchaseNotice(input.key, {
        kind: 'pending',
        message:
          'Stripe checkout is ready but could not be opened automatically. Continue with the same checkout below.',
      });
    }
  }

  private async invalidateOwnerQueries(
    reconcileAttempts: boolean,
  ): Promise<boolean> {
    const eventId = this.eventId();
    const registrationStatusQueryKey =
      this.operations.registrationStatusQueryKey(eventId);
    const eventDetailsQueryKey = this.operations.eventDetailsQueryKey(eventId);
    const eventOrganizerAccessQueryKey =
      this.operations.eventOrganizerAccessQueryKey(eventId);
    const eventOrganizerAccessQueryOptions =
      this.operations.eventOrganizerAccessQueryOptions(eventId);
    const scannerAccessQueryKey = this.operations.scannerAccessQueryKey();
    const userEventsQueryKey = this.operations.userEventsQueryKey();
    const previousOwnerStatus =
      this.queryClient.getQueryData<RegistrationStatusQueryData>(
        registrationStatusQueryKey,
      );
    const previousUpdatedAt =
      this.queryClient.getQueryState(registrationStatusQueryKey)
        ?.dataUpdatedAt ?? 0;

    const [
      registrationStatusResult,
      eventDetailsResult,
      eventOrganizerAccessResult,
      scannerAccessResult,
      userEventsResult,
    ] = await Promise.allSettled([
      this.queryClient.invalidateQueries(
        { exact: true, queryKey: registrationStatusQueryKey },
        { throwOnError: true },
      ),
      this.queryClient.invalidateQueries(
        { exact: true, queryKey: eventDetailsQueryKey },
        { throwOnError: true },
      ),
      this.refreshOrganizerAccess(
        eventOrganizerAccessQueryKey,
        eventOrganizerAccessQueryOptions,
      ),
      this.queryClient.invalidateQueries(
        { exact: true, queryKey: scannerAccessQueryKey },
        { throwOnError: true },
      ),
      this.queryClient.invalidateQueries(
        { exact: true, queryKey: userEventsQueryKey },
        { throwOnError: true },
      ),
    ]);

    if (registrationStatusResult.status === 'fulfilled' && reconcileAttempts) {
      const ownerStatus =
        this.queryClient.getQueryData<RegistrationStatusQueryData>(
          registrationStatusQueryKey,
        );
      const updatedAt =
        this.queryClient.getQueryState(registrationStatusQueryKey)
          ?.dataUpdatedAt ?? 0;
      if (
        ownerStatus &&
        (ownerStatus !== previousOwnerStatus || updatedAt > previousUpdatedAt)
      ) {
        this.reconcileOwnerPurchaseAttempts(ownerStatus.registrations);
      }
    }

    return (
      registrationStatusResult.status === 'fulfilled' &&
      eventDetailsResult.status === 'fulfilled' &&
      eventOrganizerAccessResult.status === 'fulfilled' &&
      scannerAccessResult.status === 'fulfilled' &&
      userEventsResult.status === 'fulfilled'
    );
  }

  private reconcileOwnerPurchaseAttempts(
    registrations: readonly EventsRegistrationStatusRecord[],
  ): void {
    const previousAttempts = this.purchaseAttempts();
    const reconciledAttempts = reconcileRegistrationAddonPurchaseAttempts(
      previousAttempts,
      registrations,
    );
    this.purchaseAttempts.set(reconciledAttempts);
    for (const [key, attempt] of Object.entries(previousAttempts)) {
      if (
        attempt.source !== 'canonical' ||
        reconciledAttempts[key] !== undefined
      ) {
        continue;
      }

      this.clearLocalCheckoutUrl(key);
      this.clearPurchaseNotice(key);
    }
  }

  private async refreshOrganizerAccess(
    queryKey: ReturnType<
      EventActiveRegistrationOperations['eventOrganizerAccessQueryKey']
    >,
    queryOptions: ReturnType<
      EventActiveRegistrationOperations['eventOrganizerAccessQueryOptions']
    >,
  ): Promise<void> {
    await this.queryClient.resetQueries(
      { exact: true, queryKey },
      { throwOnError: true },
    );

    if (this.queryClient.getQueryData<boolean>(queryKey) === undefined) {
      await this.queryClient.fetchQuery(queryOptions);
    }
  }

  private setPurchaseAttempt(
    key: string,
    attempt: RegistrationAddonPurchaseAttempt,
  ): void {
    this.purchaseAttempts.update((attempts) => ({
      ...attempts,
      [key]: attempt,
    }));
  }

  private setPurchaseNotice(
    key: string,
    notice: RegistrationAddonPurchaseNotice,
  ): void {
    this.purchaseNotices.update((notices) => ({
      ...notices,
      [key]: notice,
    }));
  }
}
