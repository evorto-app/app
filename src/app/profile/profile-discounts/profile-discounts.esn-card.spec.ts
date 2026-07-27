import { describe, expect, it } from 'vitest';

import {
  esnCardActionDisabled,
  esnCardActionLabel,
  esnCardMutationErrorMessage,
  esnCardSaveDisabled,
  esnCardStatusLabel,
  esnCardSubmitPayloadFromIdentifier,
} from './profile-discounts.esn-card';

describe('profile ESN card messages', () => {
  it('keeps ESN card action labels aligned with pending states', () => {
    expect(esnCardActionLabel('refresh', false)).toBe('Refresh');
    expect(esnCardActionLabel('refresh', true)).toBe('Refreshing...');
    expect(esnCardActionLabel('remove', false)).toBe('Remove');
    expect(esnCardActionLabel('remove', true)).toBe('Removing...');
    expect(esnCardActionLabel('save', false)).toBe('Save ESN card');
    expect(esnCardActionLabel('save', true)).toBe('Checking ESN card...');
  });

  it('keeps ESN card save disabled while invalid, submitting, or validating', () => {
    expect(
      esnCardSaveDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      esnCardSaveDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      esnCardSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      esnCardSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
  });

  it('blocks ESN card actions while any card write is pending', () => {
    expect(
      esnCardActionDisabled({
        deletePending: true,
        refreshPending: false,
        upsertPending: false,
      }),
    ).toBe(true);
    expect(
      esnCardActionDisabled({
        deletePending: false,
        refreshPending: true,
        upsertPending: false,
      }),
    ).toBe(true);
    expect(
      esnCardActionDisabled({
        deletePending: false,
        refreshPending: false,
        upsertPending: true,
      }),
    ).toBe(true);
    expect(
      esnCardActionDisabled({
        deletePending: false,
        refreshPending: false,
        upsertPending: false,
      }),
    ).toBe(false);
  });

  it('keeps persisted ESN card statuses readable in profile cards', () => {
    expect(esnCardStatusLabel('expired')).toBe('Expired');
    expect(esnCardStatusLabel('invalid')).toBe('Invalid');
    expect(esnCardStatusLabel('unverified')).toBe('Needs verification');
    expect(esnCardStatusLabel('verified')).toBe('Verified');
  });

  it('trims the ESN card identifier before submitting the upsert mutation', () => {
    expect(esnCardSubmitPayloadFromIdentifier('  ABCD1234  ')).toEqual({
      identifier: 'ABCD1234',
      type: 'esnCard',
    });
  });

  it('uses readable fallback messages for save, refresh, and remove failures', () => {
    expect(esnCardMutationErrorMessage('save', null)).toBe(
      "We couldn't check this ESN card. Check the number and try again.",
    );
    expect(esnCardMutationErrorMessage('refresh', null)).toBe(
      "We couldn't refresh this ESN card. Try again.",
    );
    expect(esnCardMutationErrorMessage('remove', null)).toBe(
      "We couldn't remove this ESN card. Try again.",
    );
  });

  it('maps provider and RPC failures to product language', () => {
    expect(
      esnCardMutationErrorMessage('save', {
        message: 'ESNcard validation provider is unavailable',
      }),
    ).toBe("We couldn't check this ESN card. Check the number and try again.");
    expect(
      esnCardMutationErrorMessage('refresh', {
        _tag: 'RpcBadRequestError',
        reason: 'provider-timeout',
      }),
    ).toBe(
      'ESN card verification is temporarily unavailable. Try again later.',
    );
    expect(
      esnCardMutationErrorMessage('save', {
        _tag: 'DiscountCardConflictError',
      }),
    ).toBe(
      'This ESN card is already linked to another account in this organization.',
    );
    expect(
      esnCardMutationErrorMessage('refresh', {
        _tag: 'DiscountCardNotFoundError',
      }),
    ).toBe(
      'This ESN card is no longer saved. Reload the page to see your current cards.',
    );
    expect(
      esnCardMutationErrorMessage('save', { _tag: 'RpcForbiddenError' }),
    ).toBe('ESN card discounts are not available for this organization.');
    expect(
      esnCardMutationErrorMessage('refresh', {
        _tag: 'RpcInternalServerError',
      }),
    ).toBe(
      'ESN card verification is temporarily unavailable. Try again later.',
    );
    expect(
      esnCardMutationErrorMessage('remove', {
        _tag: 'RpcUnauthorizedError',
      }),
    ).toBe('Your session expired. Sign in again to manage your ESN card.');
  });
});
