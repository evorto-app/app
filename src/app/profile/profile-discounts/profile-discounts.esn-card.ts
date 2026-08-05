import type { DiscountCardRecord } from '@shared/rpc-contracts/app-rpcs/discounts.rpcs';

export type EsnCardMutationAction = 'refresh' | 'remove' | 'save';

const esnCardFallbackMessages = {
  refresh:
    "We couldn't check this ESNcard again, so it was not changed. Select Check again to try again.",
  remove:
    "We couldn't remove this ESNcard, so it is still saved. Select Remove to try again.",
  save: "We couldn't check this ESNcard, so it was not saved. Check the number, then select Save ESNcard to try again.",
} as const satisfies Record<EsnCardMutationAction, string>;

const taggedErrorName = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return;
  const value = Reflect.get(error, '_tag');
  return typeof value === 'string' ? value : undefined;
};

export const isEsnCardNotFoundError = (error: unknown): boolean =>
  taggedErrorName(error) === 'DiscountCardNotFoundError';

export const esnCardMutationErrorMessage = (
  action: EsnCardMutationAction,
  error: unknown,
): string => {
  const tag = taggedErrorName(error);

  switch (tag) {
    case 'DiscountCardConflictError': {
      return 'This ESNcard is already linked to another account in this organization, so it was not saved.';
    }
    case 'DiscountCardNotFoundError': {
      return 'This ESNcard is no longer saved. Checking your current cards…';
    }
    case 'RpcBadRequestError': {
      return esnCardFallbackMessages[action];
    }
    case 'RpcForbiddenError': {
      return 'ESNcard discounts are not available for this organization, so no card was changed.';
    }
    case 'RpcInternalServerError': {
      return esnCardFallbackMessages[action];
    }
    case 'RpcUnauthorizedError': {
      return 'You were signed out, so no ESNcard was changed. Sign in again to manage it.';
    }
    default: {
      return esnCardFallbackMessages[action];
    }
  }
};

export const esnCardActionLabel = (
  action: EsnCardMutationAction,
  pending: boolean,
): string => {
  switch (action) {
    case 'refresh': {
      return pending ? 'Checking…' : 'Check again';
    }
    case 'remove': {
      return pending ? 'Removing…' : 'Remove';
    }
    case 'save': {
      return pending ? 'Checking ESNcard…' : 'Save ESNcard';
    }
  }
};

export const esnCardSaveDisabled = ({
  formInvalid,
  formSubmitting,
  mutationPending,
}: {
  formInvalid: boolean;
  formSubmitting: boolean;
  mutationPending: boolean;
}): boolean => formInvalid || formSubmitting || mutationPending;

export const esnCardActionDisabled = ({
  deletePending,
  refreshPending,
  upsertPending,
}: {
  deletePending: boolean;
  refreshPending: boolean;
  upsertPending: boolean;
}): boolean => deletePending || refreshPending || upsertPending;

export const esnCardStatusLabel = (
  status: DiscountCardRecord['status'],
): string => {
  switch (status) {
    case 'expired': {
      return 'Expired';
    }
    case 'invalid': {
      return 'Invalid';
    }
    case 'unverified': {
      return 'Needs verification';
    }
    case 'verified': {
      return 'Verified';
    }
  }
};

export const esnCardSubmitPayloadFromIdentifier = (
  identifier: string,
): { identifier: string; type: 'esnCard' } => ({
  identifier: identifier.trim(),
  type: 'esnCard',
});
