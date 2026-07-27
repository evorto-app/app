import type { DiscountCardRecord } from '@shared/rpc-contracts/app-rpcs/discounts.rpcs';

type EsnCardMutationAction = 'refresh' | 'remove' | 'save';

const esnCardFallbackMessages = {
  refresh: "We couldn't refresh this ESN card. Try again.",
  remove: "We couldn't remove this ESN card. Try again.",
  save: "We couldn't check this ESN card. Check the number and try again.",
} as const satisfies Record<EsnCardMutationAction, string>;

const taggedErrorField = (
  error: unknown,
  field: '_tag' | 'reason',
): string | undefined => {
  if (!error || typeof error !== 'object') return;
  const value = Reflect.get(error, field);
  return typeof value === 'string' ? value : undefined;
};

export const esnCardMutationErrorMessage = (
  action: EsnCardMutationAction,
  error: unknown,
): string => {
  const tag = taggedErrorField(error, '_tag');

  switch (tag) {
    case 'DiscountCardConflictError': {
      return 'This ESN card is already linked to another account in this organization.';
    }
    case 'DiscountCardNotFoundError': {
      return 'This ESN card is no longer saved. Reload the page to see your current cards.';
    }
    case 'RpcBadRequestError': {
      return taggedErrorField(error, 'reason')?.startsWith('provider-')
        ? 'ESN card verification is temporarily unavailable. Try again later.'
        : esnCardFallbackMessages[action];
    }
    case 'RpcForbiddenError': {
      return 'ESN card discounts are not available for this organization.';
    }
    case 'RpcInternalServerError': {
      return 'ESN card verification is temporarily unavailable. Try again later.';
    }
    case 'RpcUnauthorizedError': {
      return 'Your session expired. Sign in again to manage your ESN card.';
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
      return pending ? 'Refreshing...' : 'Refresh';
    }
    case 'remove': {
      return pending ? 'Removing...' : 'Remove';
    }
    case 'save': {
      return pending ? 'Checking ESN card...' : 'Save ESN card';
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
