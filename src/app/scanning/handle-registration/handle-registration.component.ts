import type { EventCheckInTimingIssue } from '@shared/event-check-in';
import type {
  EventCheckInMethod,
  EventsRegistrationAddonCancellationBlockedReason,
  EventsRegistrationAddonFulfillmentRecord,
  EventsRegistrationAddonRefundStatus,
  EventsRegistrationStatus,
} from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
  type QueryKey,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import {
  isRpcTransportError,
  rpcTransportRetry,
  rpcTransportRetryDelay,
} from '../../core/rpc-transport-retry';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import {
  RegistrationAddonCancellationDialogComponent,
  RegistrationAddonCancellationDialogResult,
} from './registration-addon-cancellation-dialog.component';

export interface ScanCheckInPayload {
  /** How the ticket was reached; `scanCheckInPayload` always sends `scan`. */
  checkInMethod: EventCheckInMethod;
  /** Whether the helper saw the attendee as already checked in. */
  expectedAttendeeCheckedIn: boolean;
  expectedCheckedInGuestCount: number;
  guestCheckInCount: number;
  /** Unique per confirmed check-in; a resend keeps it so nobody counts twice. */
  operationKey: string;
  registrationId: string;
}

type RegistrationAddonOperationKeyInput =
  | {
      action: 'cancel';
      latestFulfillmentEventId: null | string;
      quantity: number;
      refundRequested: boolean;
      registrationAddonId: string;
    }
  | {
      action: 'redeem';
      intentNonce: string;
      latestFulfillmentEventId: null | string;
      registrationAddonId: string;
    }
  | {
      action: 'undo';
      redemptionEventId: string;
    };

export const registrationAddonOperationKey = (
  input: RegistrationAddonOperationKeyInput,
): string => {
  switch (input.action) {
    case 'cancel': {
      return `scanner-cancel:${input.registrationAddonId}:${input.latestFulfillmentEventId ?? 'initial'}:${input.quantity}:${input.refundRequested ? 'refund' : 'no-refund'}`;
    }
    case 'redeem': {
      return `scanner-redeem:${input.registrationAddonId}:${input.intentNonce}`;
    }
    case 'undo': {
      return `scanner-undo:${input.redemptionEventId}`;
    }
  }
};

interface RegistrationAddonRedeemSnapshot {
  latestFulfillmentEventId: null | string;
  registrationAddonId: string;
}

/**
 * Create this once per logical redemption intent. Reusing the returned intent
 * preserves its operation key across retry clicks, while a separate client
 * creates a separate nonce even when both clients started from the same state.
 */
export const createRegistrationAddonRedeemIntent = (
  snapshot: RegistrationAddonRedeemSnapshot,
  createNonce: () => string = () =>
    globalThis.crypto.randomUUID().replaceAll('-', ''),
): Extract<RegistrationAddonOperationKeyInput, { action: 'redeem' }> => ({
  action: 'redeem',
  intentNonce: createNonce(),
  ...snapshot,
});

/** Retains an intent until the fulfillment snapshot changes or success is known. */
export class RegistrationAddonRedeemIntentStore {
  private readonly intents = new Map<
    string,
    Extract<RegistrationAddonOperationKeyInput, { action: 'redeem' }>
  >();

  constructor(
    private readonly createNonce: () => string = () =>
      globalThis.crypto.randomUUID().replaceAll('-', ''),
  ) {}

  complete(registrationAddonId: string): void {
    this.intents.delete(registrationAddonId);
  }

  forSnapshot(
    snapshot: RegistrationAddonRedeemSnapshot,
  ): Extract<RegistrationAddonOperationKeyInput, { action: 'redeem' }> {
    const existing = this.intents.get(snapshot.registrationAddonId);
    if (
      existing?.latestFulfillmentEventId === snapshot.latestFulfillmentEventId
    ) {
      return existing;
    }

    const intent = createRegistrationAddonRedeemIntent(
      snapshot,
      this.createNonce,
    );
    this.intents.set(snapshot.registrationAddonId, intent);
    return intent;
  }
}

export const registrationAddonRefundStatusLabel = (
  status: EventsRegistrationAddonRefundStatus,
): string => {
  switch (status) {
    case 'actionRequired': {
      return 'Refund needs review';
    }
    case 'cancelledWithoutRefund': {
      return 'Cancelled without refund';
    }
    case 'failed': {
      return 'Refund needs attention';
    }
    case 'notApplicable': {
      return 'Not applicable';
    }
    case 'notRequested': {
      return 'No refund requested';
    }
    case 'notRequired': {
      return 'No refund needed';
    }
    case 'partiallyRefunded': {
      return 'Partially refunded';
    }
    case 'pending': {
      return 'Refund in progress';
    }
    case 'refunded': {
      return 'Refunded';
    }
  }
};

export const registrationAddonCancellationSuccessMessage = (
  status: EventsRegistrationAddonRefundStatus,
): string => {
  switch (status) {
    case 'actionRequired': {
      return 'The items were cancelled, but the refund needs attention. Do not cancel them or charge again. Ask an administrator to review this ticket.';
    }
    case 'cancelledWithoutRefund': {
      return 'The items were cancelled without a refund, as requested.';
    }
    case 'failed': {
      return 'The items were cancelled, but the refund needs attention. Do not cancel them or charge again. Ask an administrator to review this ticket.';
    }
    case 'notApplicable': {
      return 'The items were cancelled. No refund applies to this add-on.';
    }
    case 'notRequested': {
      return 'The items were cancelled. No refund was requested.';
    }
    case 'notRequired': {
      return 'The items were cancelled. No refund was needed.';
    }
    case 'partiallyRefunded': {
      return 'The items were cancelled. Part of the refund is complete; the rest is still in progress.';
    }
    case 'pending': {
      return 'The items were cancelled. The refund has started.';
    }
    case 'refunded': {
      return 'The items were cancelled and refunded.';
    }
  }
};

export interface ScanRegistrationStatusIssueCopy {
  readonly body: string;
  readonly title: string;
}

export const scanCheckInTimingIssueCopy = (
  issue: EventCheckInTimingIssue | null,
): null | ScanRegistrationStatusIssueCopy => {
  switch (issue) {
    case 'ended': {
      return {
        body: 'The event ended more than two hours ago, so check-in is closed. The attendee was not checked in.',
        title: 'Check-in closed',
      };
    }
    case 'notOpen': {
      return {
        body: 'Check-in opens one hour before the event starts.',
        title: 'Check-in not open',
      };
    }
    case null: {
      return null;
    }
  }
};

export const scanRegistrationStatusIssueCopy = (
  status: EventsRegistrationStatus,
): null | ScanRegistrationStatusIssueCopy => {
  switch (status) {
    case 'CANCELLED': {
      return {
        body: 'This sign-up has ended and cannot be checked in. Do not ask the attendee to pay or sign up again. If the cancellation or refund looks wrong, review the existing sign-up instead of creating a replacement.',
        title: 'Sign-up ended',
      };
    }
    case 'CONFIRMED': {
      return null;
    }
    case 'PENDING': {
      return {
        body: 'This ticket is not confirmed yet and cannot be checked in. Ask the attendee to open the event or Profile to see whether organizer approval or their existing payment is still needed. Do not start another sign-up or payment from the scanner.',
        title: 'Sign-up pending',
      };
    }
    case 'WAITLIST': {
      return {
        body: 'This attendee does not have a confirmed place yet and cannot be checked in. Ask an organizer to review the waitlist and available places. Do not take payment or start another sign-up from the scanner.',
        title: 'On waitlist',
      };
    }
  }
};

export const registrationAddonCancellationBlockedMessage = (
  reason: EventsRegistrationAddonCancellationBlockedReason,
): string => {
  switch (reason) {
    case 'none': {
      return '';
    }
    case 'noQuantity': {
      return 'No unused items remain to cancel.';
    }
    case 'permission': {
      return 'You cannot cancel these items. Ask someone who manages tickets and add-ons for this event.';
    }
    case 'registrationStatus': {
      return 'Add-on items can be cancelled only while the ticket is confirmed.';
    }
  }
};

export const registrationAddonQuantitySummary = ({
  includedQuantity,
  purchasedQuantity,
}: Pick<
  EventsRegistrationAddonFulfillmentRecord,
  'includedQuantity' | 'purchasedQuantity'
>): string => {
  const quantities = [
    includedQuantity > 0 ? `${includedQuantity} included` : '',
    purchasedQuantity > 0 ? `${purchasedQuantity} purchased` : '',
  ].filter((quantity) => quantity.length > 0);

  return quantities.length > 0 ? quantities.join(' · ') : 'No items';
};

export type ScanCheckInState =
  | 'confirmed'
  | 'failed'
  | 'idle'
  | 'notConfirmed'
  | 'retrying'
  | 'sending'
  | 'waitingForConnection';

const hasErrorTag = (error: unknown, tag: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  '_tag' in error &&
  error._tag === tag;

/**
 * Describes the check-in request from the helper's point of view. A transport
 * error means every retry was used up without an answer, so it is unknown
 * whether the server saved the check-in. An internal error can come from a
 * lost commit acknowledgement, so it is just as unknown.
 */
export const scanCheckInState = ({
  error,
  failureCount,
  isError,
  isPaused,
  isPending,
  isSuccess,
}: {
  error: unknown;
  failureCount: number;
  isError: boolean;
  isPaused: boolean;
  isPending: boolean;
  isSuccess: boolean;
}): ScanCheckInState => {
  if (isPending) {
    if (isPaused) {
      return 'waitingForConnection';
    }
    return failureCount > 0 ? 'retrying' : 'sending';
  }
  if (isSuccess) {
    return 'confirmed';
  }
  if (isError) {
    return isRpcTransportError(error) ||
      hasErrorTag(error, 'EventRegistrationInternalError')
      ? 'notConfirmed'
      : 'failed';
  }
  return 'idle';
};

export const scanCheckInButtonLabel = ({
  completed,
  spotCount,
  state,
}: {
  completed: boolean;
  spotCount: number;
  state: ScanCheckInState;
}): string => {
  switch (state) {
    case 'retrying': {
      return 'Retrying…';
    }
    case 'sending': {
      return 'Checking in…';
    }
    case 'waitingForConnection': {
      return 'Waiting for connection…';
    }
    default: {
      break;
    }
  }

  if (completed || state === 'confirmed') {
    return 'Checked in';
  }

  if (state === 'notConfirmed') {
    return 'Try again';
  }

  return spotCount > 1 ? `Confirm ${spotCount} check-ins` : 'Confirm check-in';
};

/**
 * After an unconfirmed check-in the exact previous request is sent again, so
 * the server recognizes it and never counts it twice. Returns null when a fresh
 * request should be built from the current ticket.
 */
export const scanCheckInRetryPayload = <Payload>(
  state: ScanCheckInState,
  lastVariables: Payload | undefined,
): null | Payload =>
  state === 'notConfirmed' && lastVariables !== undefined
    ? lastVariables
    : null;

export const createScanCheckInOperationKey = (): string =>
  globalThis.crypto.randomUUID();

/** A fresh confirmation always gets its own operation key. */
export const scanCheckInPayload = ({
  createOperationKey = createScanCheckInOperationKey,
  expectedAttendeeCheckedIn,
  expectedCheckedInGuestCount,
  guestCheckInCount,
  registrationId,
}: {
  createOperationKey?: () => string;
  expectedAttendeeCheckedIn: boolean;
  expectedCheckedInGuestCount: number;
  guestCheckInCount: number;
  registrationId: string;
}): ScanCheckInPayload => ({
  checkInMethod: 'scan',
  expectedAttendeeCheckedIn,
  expectedCheckedInGuestCount,
  guestCheckInCount,
  operationKey: createOperationKey(),
  registrationId,
});

/**
 * Records a committed check-in for exactly one ticket. A missing ticket read
 * (null) still counts as confirmed; that ticket alone is refetched. A refetch
 * already in flight (for example after an add-on action) is cancelled so it
 * cannot overwrite the confirmed state, and is started again afterwards so its
 * fresh data is not lost.
 */
export const applyScanCheckInResult = async <Registration>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  result: { registration: null | Registration },
  initialDataUpdateCount: number,
): Promise<void> => {
  const { registration } = result;
  if (registration === null) {
    await queryClient.invalidateQueries({ exact: true, queryKey });
    return;
  }
  // A ticket refetch that started before the commit must not overwrite the
  // confirmed state.
  const wasFetching = queryClient.isFetching({ exact: true, queryKey }) > 0;
  await queryClient.cancelQueries({ exact: true, queryKey });
  const currentState = queryClient.getQueryState(queryKey);
  if (
    (currentState?.dataUpdateCount ?? 0) !== initialDataUpdateCount ||
    currentState?.status === 'error'
  ) {
    // Preserve the last lookup's data or warning until a new lookup succeeds.
    void queryClient.invalidateQueries({ exact: true, queryKey });
    return;
  }
  queryClient.setQueryData<{ registration: Registration }>(
    queryKey,
    (previous) => previous && { ...previous, registration },
  );
  if (wasFetching) {
    void queryClient.invalidateQueries({ exact: true, queryKey });
  }
};

/** The guest input is locked while a request is in flight or being resent. */
export const scanGuestInputLocked = (state: ScanCheckInState): boolean =>
  state === 'notConfirmed' ||
  state === 'retrying' ||
  state === 'sending' ||
  state === 'waitingForConnection';

export const scanSpotCountLabel = (spotCount: number): string =>
  spotCount === 1 ? '1 place now' : `${spotCount} places now`;

export const scanCheckInActionDisabled = ({
  allowCheckin,
  completed,
  mutationPending,
  resend = false,
  spotCount,
}: {
  allowCheckin: boolean;
  completed: boolean;
  mutationPending: boolean;
  /** Resending the original unconfirmed request: only a pending request blocks it. */
  resend?: boolean;
  spotCount: number;
}): boolean =>
  resend
    ? mutationPending
    : !allowCheckin || completed || mutationPending || spotCount < 1;

export const scanGuestCheckInCountFromInput = ({
  inputValue,
  remainingGuestCount,
}: {
  inputValue: string;
  remainingGuestCount: number;
}): number => {
  const nextGuestCount = Number.parseInt(inputValue, 10);
  return Math.max(
    0,
    Math.min(
      Number.isNaN(nextGuestCount) ? 0 : nextGuestCount,
      remainingGuestCount,
    ),
  );
};

export const scannerRegistrationErrorMessage = (
  error: unknown,
  fallback: string,
): string =>
  getErrorMessage(error, fallback, [
    'EventCheckInUnavailableError',
    'EventRegistrationConflictError',
    'EventRegistrationNotFoundError',
  ]);

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FaDuotoneIconComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    RouterLink,
    TenantDatePipe,
  ],
  selector: 'app-handle-registration',
  styles: ``,
  templateUrl: './handle-registration.component.html',
})
export class HandleRegistrationComponent {
  public readonly registrationId = input.required<string>();
  protected readonly addonActionError = signal<undefined | unknown>(undefined);
  protected readonly addonActionMessage = signal('');
  private readonly rpc = AppRpc.injectClient();
  protected readonly cancelAddonMutation = injectMutation(() =>
    this.rpc.events.cancelRegistrationAddon.mutationOptions(),
  );
  protected readonly redeemAddonMutation = injectMutation(() =>
    this.rpc.events.redeemRegistrationAddon.mutationOptions(),
  );
  protected readonly undoAddonMutation = injectMutation(() =>
    this.rpc.events.undoRegistrationAddonRedemption.mutationOptions(),
  );
  protected readonly addonMutationPending = computed(
    () =>
      this.cancelAddonMutation.isPending() ||
      this.redeemAddonMutation.isPending() ||
      this.undoAddonMutation.isPending(),
  );
  // TanStack's default networkMode ('online') pauses the mutation while the
  // browser is offline and continues it when the connection returns.
  protected readonly checkInMutation = injectMutation(() => ({
    ...this.rpc.events.checkInRegistration.mutationOptions(),
    retry: rpcTransportRetry,
    retryDelay: rpcTransportRetryDelay,
  }));
  protected readonly checkInState = computed(() => {
    if (
      this.checkInMutation.variables()?.registrationId !== this.registrationId()
    ) {
      return 'idle';
    }
    return scanCheckInState({
      error: this.checkInMutation.error(),
      failureCount: this.checkInMutation.failureCount(),
      isError: this.checkInMutation.isError(),
      isPaused: this.checkInMutation.isPaused(),
      isPending: this.checkInMutation.isPending(),
      isSuccess: this.checkInMutation.isSuccess(),
    });
  });
  /**
   * An unconfirmed check-in that the server answered with an internal error
   * instead of a dropped connection. Internal wording stays hidden, as with
   * every scanner error.
   */
  protected readonly checkInServerUnconfirmed = computed(
    () =>
      this.checkInState() === 'notConfirmed' &&
      hasErrorTag(
        this.checkInMutation.error(),
        'EventRegistrationInternalError',
      ),
  );
  protected readonly scanTicketQuery = injectQuery(() => ({
    ...this.rpc.events.scanTicket.queryOptions({
      registrationId: this.registrationId(),
    }),
    retry: rpcTransportRetry,
    retryDelay: rpcTransportRetryDelay,
  }));
  protected readonly guestCheckInCount = linkedSignal({
    computation: () => 0,
    source: this.registrationId,
  });
  protected readonly selectedGuestCheckInCount = computed(() => {
    const scanResult = this.scanTicketQuery.data()?.registration;
    if (!scanResult) {
      return 0;
    }
    return Math.min(this.guestCheckInCount(), scanResult.remainingGuestCount);
  });
  protected readonly selectedSpotCheckInCount = computed(() => {
    const scanResult = this.scanTicketQuery.data()?.registration;
    if (!scanResult) {
      return 0;
    }
    return (
      (scanResult.attendeeCheckedIn ? 0 : 1) + this.selectedGuestCheckInCount()
    );
  });
  protected readonly checkInCompleted = computed(
    () => this.checkInState() === 'confirmed',
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly pendingAddonId = signal<string | undefined>(undefined);
  protected readonly registrationAddonCancellationBlockedMessage =
    registrationAddonCancellationBlockedMessage;
  protected readonly registrationAddonQuantitySummary =
    registrationAddonQuantitySummary;
  protected readonly registrationAddonRefundStatusLabel =
    registrationAddonRefundStatusLabel;
  protected readonly scanCheckInActionDisabled = scanCheckInActionDisabled;
  protected readonly scanCheckInButtonLabel = scanCheckInButtonLabel;
  protected readonly guestInputLocked = computed(() =>
    scanGuestInputLocked(this.checkInState()),
  );
  protected readonly scanCheckInTimingIssueCopy = scanCheckInTimingIssueCopy;
  protected readonly scanRegistrationStatusIssueCopy =
    scanRegistrationStatusIssueCopy;
  protected readonly scanSpotCountLabel = scanSpotCountLabel;
  private readonly dialog = inject(MatDialog);
  private readonly queryClient = inject(QueryClient);
  private readonly redeemIntentStore = new RegistrationAddonRedeemIntentStore();

  canLeaveTicket(): boolean {
    if (this.checkInMutation.isPending()) return false;
    if (this.checkInState() !== 'notConfirmed') return true;
    return (
      globalThis.confirm?.(
        'This check-in is still unconfirmed. Leave the ticket without checking its result?',
      ) ?? false
    );
  }

  checkIn() {
    const state = this.checkInState();
    const resendPayload = scanCheckInRetryPayload(
      state,
      this.checkInMutation.variables(),
    );
    if (resendPayload) {
      // Resend the original request unchanged. The ticket may already show the
      // committed count after a reconnect refetch.
      if (!this.checkInMutation.isPending()) {
        this.sendCheckIn(resendPayload);
      }
      return;
    }

    const scanResult = this.scanTicketQuery.data()?.registration;
    if (
      !scanResult ||
      scanCheckInActionDisabled({
        allowCheckin: scanResult.allowCheckin,
        completed: this.checkInCompleted(),
        mutationPending: this.checkInMutation.isPending(),
        spotCount: this.selectedSpotCheckInCount(),
      })
    )
      return;

    // The expected count stays the one the helper saw.
    this.sendCheckIn(
      scanCheckInPayload({
        expectedAttendeeCheckedIn: scanResult.attendeeCheckedIn,
        expectedCheckedInGuestCount: scanResult.checkedInGuestCount,
        guestCheckInCount: this.selectedGuestCheckInCount(),
        registrationId: this.registrationId(),
      }),
    );
  }

  updateGuestCheckInCount(event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const remainingGuestCount =
      this.scanTicketQuery.data()?.registration.remainingGuestCount ?? 0;
    this.guestCheckInCount.set(
      scanGuestCheckInCountFromInput({
        inputValue: input.value,
        remainingGuestCount,
      }),
    );
  }

  protected cancelAddon(addOn: EventsRegistrationAddonFulfillmentRecord): void {
    if (
      !addOn.cancellationAvailable ||
      addOn.cancellableQuantity < 1 ||
      this.addonMutationPending()
    ) {
      return;
    }

    this.dialog
      .open<
        RegistrationAddonCancellationDialogComponent,
        {
          addOnTitle: string;
          cancellablePurchasedQuantity: number;
          cancellableQuantity: number;
          refundAvailability: EventsRegistrationAddonFulfillmentRecord['refundAvailability'];
        },
        RegistrationAddonCancellationDialogResult
      >(RegistrationAddonCancellationDialogComponent, {
        data: {
          addOnTitle: addOn.title,
          cancellablePurchasedQuantity: addOn.cancellablePurchasedQuantity,
          cancellableQuantity: addOn.cancellableQuantity,
          refundAvailability: addOn.refundAvailability,
        },
      })
      .afterClosed()
      .subscribe((result) => {
        if (!result) {
          return;
        }

        this.beginAddonAction(addOn.registrationAddonId);
        this.cancelAddonMutation.mutate(
          {
            operationKey: registrationAddonOperationKey({
              action: 'cancel',
              latestFulfillmentEventId: addOn.latestFulfillmentEventId,
              quantity: result.quantity,
              refundRequested: result.refundRequested,
              registrationAddonId: addOn.registrationAddonId,
            }),
            quantity: result.quantity,
            reason: result.reason,
            refundRequested: result.refundRequested,
            registrationAddonId: addOn.registrationAddonId,
            registrationId: this.registrationId(),
          },
          {
            onError: (error) => this.addonActionFailed(error),
            onSuccess: async (outcome) => {
              await this.addonActionSucceeded(
                registrationAddonCancellationSuccessMessage(
                  outcome.refundStatus,
                ),
              );
            },
          },
        );
      });
  }

  protected errorMessage(error: unknown, fallback: string): string {
    return scannerRegistrationErrorMessage(error, fallback);
  }

  protected redeemAddon(addOn: EventsRegistrationAddonFulfillmentRecord): void {
    if (!addOn.redemptionAvailable || this.addonMutationPending()) {
      return;
    }

    const intent = this.redeemIntentStore.forSnapshot({
      latestFulfillmentEventId: addOn.latestFulfillmentEventId,
      registrationAddonId: addOn.registrationAddonId,
    });
    this.beginAddonAction(addOn.registrationAddonId);
    this.redeemAddonMutation.mutate(
      {
        operationKey: registrationAddonOperationKey(intent),
        registrationAddonId: addOn.registrationAddonId,
        registrationId: this.registrationId(),
      },
      {
        onError: (error) => this.addonActionFailed(error),
        onSuccess: async () => {
          this.redeemIntentStore.complete(addOn.registrationAddonId);
          await this.addonActionSucceeded(`${addOn.title} handed out.`);
        },
      },
    );
  }

  protected retryRegistration(): void {
    void this.scanTicketQuery.refetch();
  }

  protected undoAddonRedemption(
    addOn: EventsRegistrationAddonFulfillmentRecord,
  ): void {
    const redemptionEventId = addOn.latestRedemptionEventId;
    if (
      !addOn.undoAvailable ||
      !redemptionEventId ||
      this.addonMutationPending()
    ) {
      return;
    }

    this.beginAddonAction(addOn.registrationAddonId);
    this.undoAddonMutation.mutate(
      {
        operationKey: registrationAddonOperationKey({
          action: 'undo',
          redemptionEventId,
        }),
        redemptionEventId,
        registrationAddonId: addOn.registrationAddonId,
        registrationId: this.registrationId(),
      },
      {
        onError: (error) => this.addonActionFailed(error),
        onSuccess: async () => {
          await this.addonActionSucceeded(
            `Last ${addOn.title} handout undone.`,
          );
        },
      },
    );
  }

  private sendCheckIn(payload: ScanCheckInPayload): void {
    const queryKey = this.scanTicketKey(payload.registrationId);
    const initialDataUpdateCount =
      this.queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0;
    this.checkInMutation.mutate(payload, {
      onError: async (error) => {
        if (hasErrorTag(error, 'EventRegistrationConflictError')) {
          await this.queryClient.invalidateQueries({ exact: true, queryKey });
        }
      },
      onSuccess: async (result) => {
        await applyScanCheckInResult(
          this.queryClient,
          queryKey,
          result,
          initialDataUpdateCount,
        );
      },
    });
  }

  private scanTicketKey(registrationId: string): QueryKey {
    return this.rpc.events.scanTicket.queryKey({ registrationId });
  }

  private addonActionFailed(error: unknown): void {
    this.addonActionMessage.set('');
    this.addonActionError.set(error);
    this.pendingAddonId.set(undefined);
  }

  private async addonActionSucceeded(message: string): Promise<void> {
    await this.queryClient.invalidateQueries({
      exact: true,
      queryKey: this.scanTicketKey(this.registrationId()),
    });
    this.addonActionError.set(undefined);
    this.addonActionMessage.set(message);
    this.pendingAddonId.set(undefined);
  }

  private beginAddonAction(registrationAddonId: string): void {
    this.addonActionError.set(undefined);
    this.addonActionMessage.set('');
    this.pendingAddonId.set(registrationAddonId);
  }
}
