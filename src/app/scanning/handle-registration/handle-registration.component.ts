import type { EventCheckInTimingIssue } from '@shared/event-check-in';
import type {
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
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import {
  RegistrationAddonCancellationDialogComponent,
  RegistrationAddonCancellationDialogResult,
} from './registration-addon-cancellation-dialog.component';

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

export const scanCheckInButtonLabel = ({
  completed,
  pending,
  spotCount,
}: {
  completed: boolean;
  pending: boolean;
  spotCount: number;
}): string => {
  if (pending) {
    return 'Checking in…';
  }

  if (completed) {
    return 'Checked in';
  }

  return spotCount > 1 ? `Confirm ${spotCount} check-ins` : 'Confirm check-in';
};

export const scanSpotCountLabel = (spotCount: number): string =>
  spotCount === 1 ? '1 place now' : `${spotCount} places now`;

export const scanCheckInActionDisabled = ({
  allowCheckin,
  completed,
  mutationPending,
  spotCount,
}: {
  allowCheckin: boolean;
  completed: boolean;
  mutationPending: boolean;
  spotCount: number;
}): boolean => !allowCheckin || completed || mutationPending || spotCount < 1;

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
  protected readonly addonFulfillmentQuery = injectQuery(() =>
    this.rpc.events.getRegistrationAddonFulfillment.queryOptions({
      registrationId: this.registrationId(),
    }),
  );
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
  protected readonly checkInMutation = injectMutation(() =>
    this.rpc.events.checkInRegistration.mutationOptions(),
  );
  protected readonly scanResultQuery = injectQuery(() =>
    this.rpc.events.registrationScanned.queryOptions({
      registrationId: this.registrationId(),
    }),
  );
  protected readonly guestCheckInCount = signal(0);
  protected readonly selectedGuestCheckInCount = computed(() => {
    const scanResult = this.scanResultQuery.data();
    if (!scanResult) {
      return 0;
    }
    return Math.min(this.guestCheckInCount(), scanResult.remainingGuestCount);
  });
  protected readonly selectedSpotCheckInCount = computed(() => {
    const scanResult = this.scanResultQuery.data();
    if (!scanResult) {
      return 0;
    }
    return (
      (scanResult.attendeeCheckedIn ? 0 : 1) + this.selectedGuestCheckInCount()
    );
  });
  private readonly localCheckInCompleted = signal(false);
  protected readonly checkInCompleted = computed(
    () =>
      this.localCheckInCompleted() ||
      (this.checkInMutation.isSuccess() &&
        this.selectedSpotCheckInCount() === 0),
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
  protected readonly scanCheckInTimingIssueCopy = scanCheckInTimingIssueCopy;
  protected readonly scanRegistrationStatusIssueCopy =
    scanRegistrationStatusIssueCopy;
  protected readonly scanSpotCountLabel = scanSpotCountLabel;
  private readonly dialog = inject(MatDialog);
  private readonly queryClient = inject(QueryClient);
  private readonly redeemIntentStore = new RegistrationAddonRedeemIntentStore();

  checkIn() {
    const scanResult = this.scanResultQuery.data();
    if (
      scanCheckInActionDisabled({
        allowCheckin: scanResult?.allowCheckin ?? false,
        completed: this.checkInCompleted(),
        mutationPending: this.checkInMutation.isPending(),
        spotCount: this.selectedSpotCheckInCount(),
      })
    )
      return;

    this.checkInMutation.mutate(
      {
        guestCheckInCount: this.selectedGuestCheckInCount(),
        registrationId: this.registrationId(),
      },
      {
        onSuccess: async () => {
          this.localCheckInCompleted.set(true);
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['events', 'registrationScanned']),
          );
        },
      },
    );
  }

  updateGuestCheckInCount(event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const remainingGuestCount =
      this.scanResultQuery.data()?.remainingGuestCount ?? 0;
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

  protected retryAddonFulfillment(): void {
    void this.addonFulfillmentQuery.refetch();
  }

  protected retryRegistration(): void {
    void this.scanResultQuery.refetch();
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

  private addonActionFailed(error: unknown): void {
    this.addonActionMessage.set('');
    this.addonActionError.set(error);
    this.pendingAddonId.set(undefined);
  }

  private async addonActionSucceeded(message: string): Promise<void> {
    await this.queryClient.invalidateQueries(
      this.rpc.queryFilter(['events', 'getRegistrationAddonFulfillment']),
    );
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
