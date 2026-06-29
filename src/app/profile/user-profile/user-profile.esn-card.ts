import type { DiscountCardRecord } from '@shared/rpc-contracts/app-rpcs/discounts.rpcs';

import { getErrorMessage } from '../../core/error-message';

type EsnCardMutationAction = 'refresh' | 'remove' | 'save';

const esnCardFallbackMessages = {
  refresh: 'Could not refresh ESN card',
  remove: 'Could not remove ESN card',
  save: 'Could not validate ESN card',
} as const satisfies Record<EsnCardMutationAction, string>;

export const esnCardMutationErrorMessage = (
  action: EsnCardMutationAction,
  error: unknown,
): string => getErrorMessage(error, esnCardFallbackMessages[action]);

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
