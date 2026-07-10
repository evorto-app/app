import type {
  EventsRegistrationAddonRecord,
  EventsRegistrationStatusRecord,
} from '@shared/rpc-contracts/app-rpcs/events.rpcs';

export type CanonicalPendingRegistrationAddon =
  EventsRegistrationAddonRecord & {
    readonly pendingOperationKey: string;
  };

export interface RegistrationAddonPurchaseAttempt {
  readonly operationKey: string;
  readonly quantity: number;
  readonly source: 'canonical' | 'local';
}

export const registrationAddonKey = (
  registrationId: string,
  addOnId: string,
): string => `${registrationId}:${addOnId}`;

export const clampRegistrationAddonQuantity = (
  quantity: number,
  maxQuantity: number,
): number => {
  const normalizedMax = Math.max(1, Math.trunc(maxQuantity));
  const normalizedQuantity = Number.isFinite(quantity)
    ? Math.trunc(quantity)
    : 1;
  return Math.min(normalizedMax, Math.max(1, normalizedQuantity));
};

export const registrationAddonPurchaseBlockedCopy = (
  reason: EventsRegistrationAddonRecord['purchaseBlockedReason'],
): null | string => {
  switch (reason) {
    case 'activeTransfer': {
      return 'Resolve or cancel the active transfer before buying add-ons.';
    }
    case 'beforeEventDisabled': {
      return 'This add-on is not sold before the event.';
    }
    case 'duringEventDisabled': {
      return 'This add-on is not sold during the event.';
    }
    case 'eventEnded': {
      return 'The event has ended, so this add-on is no longer for sale.';
    }
    case 'eventUnavailable': {
      return 'This event is not available for add-on purchases.';
    }
    case 'multipleNotAllowed': {
      return 'This add-on can be purchased only once per registration.';
    }
    case 'none': {
      return null;
    }
    case 'optionLimitReached': {
      return "You have reached this registration option's add-on limit.";
    }
    case 'outOfStock': {
      return 'This add-on is sold out.';
    }
    case 'paymentPending': {
      return 'Another add-on payment is already in progress for this registration.';
    }
    case 'paymentUnavailable': {
      return 'Online payment is not available for this add-on. Contact an organizer.';
    }
    case 'registrationStatus': {
      return 'Add-ons can be purchased only for a confirmed registration.';
    }
    case 'taxUnavailable': {
      return "Payment is blocked because this add-on's tax setup is incomplete. Contact an organizer.";
    }
    case 'userLimitReached': {
      return 'You have reached the per-person limit for this add-on.';
    }
  }
};

export const registrationAddonHasCanonicalPendingOrder = (
  addOn: EventsRegistrationAddonRecord,
): addOn is CanonicalPendingRegistrationAddon =>
  addOn.purchaseStatus === 'paymentPending' &&
  addOn.pendingOperationKey !== null &&
  addOn.pendingQuantity > 0;

export const registrationHasPendingAddonPayment = (registration: {
  registrationAddOns: readonly EventsRegistrationAddonRecord[];
}): boolean =>
  registration.registrationAddOns.some(
    (addOn) => addOn.purchaseStatus === 'paymentPending',
  );

export const resolveRegistrationAddonPurchaseAttempt = (input: {
  addOn: EventsRegistrationAddonRecord;
  createOperationKey: () => string;
  existingAttempt: RegistrationAddonPurchaseAttempt | undefined;
  quantity: number;
}): null | RegistrationAddonPurchaseAttempt => {
  if (registrationAddonHasCanonicalPendingOrder(input.addOn)) {
    return {
      operationKey: input.addOn.pendingOperationKey,
      quantity: input.addOn.pendingQuantity,
      source: 'canonical',
    };
  }

  if (
    !input.addOn.purchaseAvailable ||
    input.quantity < 1 ||
    input.quantity > input.addOn.maxPurchasableQuantity
  ) {
    return null;
  }

  if (input.existingAttempt?.quantity === input.quantity) {
    return input.existingAttempt;
  }

  return {
    operationKey: input.createOperationKey(),
    quantity: input.quantity,
    source: 'local',
  };
};

export const reconcileRegistrationAddonPurchaseAttempts = (
  existingAttempts: Readonly<Record<string, RegistrationAddonPurchaseAttempt>>,
  registrations: readonly EventsRegistrationStatusRecord[],
): Readonly<Record<string, RegistrationAddonPurchaseAttempt>> => {
  const attempts: Record<string, RegistrationAddonPurchaseAttempt> = {};
  for (const [key, attempt] of Object.entries(existingAttempts)) {
    if (attempt.source === 'local') {
      attempts[key] = attempt;
    }
  }

  for (const registration of registrations) {
    for (const addOn of registration.registrationAddOns) {
      if (!registrationAddonHasCanonicalPendingOrder(addOn)) {
        continue;
      }
      attempts[registrationAddonKey(registration.id, addOn.addOnId)] = {
        operationKey: addOn.pendingOperationKey,
        quantity: addOn.pendingQuantity,
        source: 'canonical',
      };
    }
  }
  return attempts;
};
