import { describe, expect, it } from 'vitest';

import {
  esnCardActionDisabled,
  esnCardActionLabel,
  esnCardMutationErrorMessage,
  esnCardSaveDisabled,
  esnCardStatusLabel,
  esnCardSubmitPayloadFromIdentifier,
  isEsnCardNotFoundError,
} from './profile-discounts.esn-card';

describe('profile ESNcard messages', () => {
  it('keeps ESNcard action labels aligned with pending states', () => {
    expect(esnCardActionLabel('refresh', false)).toBe('Check again');
    expect(esnCardActionLabel('refresh', true)).toBe('Checking…');
    expect(esnCardActionLabel('remove', false)).toBe('Remove');
    expect(esnCardActionLabel('remove', true)).toBe('Removing…');
    expect(esnCardActionLabel('save', false)).toBe('Save ESNcard');
    expect(esnCardActionLabel('save', true)).toBe('Checking ESNcard…');
  });

  it('keeps ESNcard save disabled while invalid, submitting, or validating', () => {
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

  it('blocks ESNcard actions while any card write is pending', () => {
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

  it('keeps persisted ESNcard statuses readable in profile cards', () => {
    expect(esnCardStatusLabel('expired')).toBe('Expired');
    expect(esnCardStatusLabel('invalid')).toBe('Invalid');
    expect(esnCardStatusLabel('unverified')).toBe('Needs verification');
    expect(esnCardStatusLabel('verified')).toBe('Verified');
  });

  it('trims the ESNcard identifier before submitting the upsert mutation', () => {
    expect(esnCardSubmitPayloadFromIdentifier('  ABCD1234  ')).toEqual({
      identifier: 'ABCD1234',
      type: 'esnCard',
    });
  });

  it('uses readable fallback messages for save, refresh, and remove failures', () => {
    expect(esnCardMutationErrorMessage('save', null)).toBe(
      "We couldn't check this ESNcard, so it was not saved. Check the number, then select Save ESNcard to try again.",
    );
    expect(esnCardMutationErrorMessage('refresh', null)).toBe(
      "We couldn't check this ESNcard again, so it was not changed. Select Check again to try again.",
    );
    expect(esnCardMutationErrorMessage('remove', null)).toBe(
      "We couldn't remove this ESNcard, so it is still saved. Select Remove to try again.",
    );
  });

  it('maps provider and RPC failures to product language', () => {
    expect(
      esnCardMutationErrorMessage('save', {
        message: 'ESNcard validation provider is unavailable',
      }),
    ).toBe(
      "We couldn't check this ESNcard, so it was not saved. Check the number, then select Save ESNcard to try again.",
    );
    expect(
      esnCardMutationErrorMessage('refresh', {
        _tag: 'RpcBadRequestError',
        reason: 'provider-timeout',
      }),
    ).toBe(
      "We couldn't check this ESNcard again, so it was not changed. Select Check again to try again.",
    );
    expect(
      esnCardMutationErrorMessage('save', {
        _tag: 'DiscountCardConflictError',
      }),
    ).toBe(
      'This ESNcard is already linked to another account in this organization, so it was not saved.',
    );
    expect(
      esnCardMutationErrorMessage('refresh', {
        _tag: 'DiscountCardNotFoundError',
      }),
    ).toBe('This ESNcard is no longer saved. Checking your current cards…');
    expect(
      esnCardMutationErrorMessage('save', { _tag: 'RpcForbiddenError' }),
    ).toBe(
      'ESNcard discounts are not available for this organization, so no card was changed.',
    );
    expect(
      esnCardMutationErrorMessage('refresh', {
        _tag: 'RpcInternalServerError',
      }),
    ).toBe(
      "We couldn't check this ESNcard again, so it was not changed. Select Check again to try again.",
    );
    expect(
      esnCardMutationErrorMessage('remove', {
        _tag: 'RpcUnauthorizedError',
      }),
    ).toBe(
      'You were signed out, so no ESNcard was changed. Sign in again to manage it.',
    );
  });

  it('identifies a missing saved card without treating other failures as missing', () => {
    expect(isEsnCardNotFoundError({ _tag: 'DiscountCardNotFoundError' })).toBe(
      true,
    );
    expect(isEsnCardNotFoundError({ _tag: 'RpcInternalServerError' })).toBe(
      false,
    );
    expect(isEsnCardNotFoundError(null)).toBe(false);
  });
});
