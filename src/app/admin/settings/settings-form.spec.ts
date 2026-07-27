import { describe, expect, it, vi } from 'vitest';

import {
  optionalTrimmed,
  tenantSettingsCanDeactivate,
  tenantSettingsSaveDisabled,
  tenantSettingsShouldHydrate,
} from './settings-form';

describe('tenantSettingsSaveDisabled', () => {
  it('blocks saves before hydration or while a form is invalid, submitting, or mutation-pending', () => {
    expect(
      tenantSettingsSaveDisabled({
        formInvalid: true,
        formSubmitting: false,
        interactionReady: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      tenantSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: true,
        interactionReady: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      tenantSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        interactionReady: true,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      tenantSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        interactionReady: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      tenantSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        interactionReady: true,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});

describe('optionalTrimmed', () => {
  it('trims non-empty values and maps blank values to undefined', () => {
    expect(optionalTrimmed(' value ')).toBe('value');
    expect(optionalTrimmed(' '.repeat(3))).toBeUndefined();
  });
});

describe('tenant settings dirty-state protection', () => {
  it('hydrates pristine models without replacing dirty edits', () => {
    expect(tenantSettingsShouldHydrate(false)).toBe(true);
    expect(tenantSettingsShouldHydrate(true)).toBe(false);
  });

  it('requires explicit confirmation before discarding dirty settings', () => {
    const confirmDiscard = vi.fn(() => false);
    const dirtyComponent = {
      hasUnsavedSettingsChanges: () => true,
    };

    expect(tenantSettingsCanDeactivate(dirtyComponent, confirmDiscard)).toBe(
      false,
    );
    expect(confirmDiscard).toHaveBeenCalledWith(
      'You have unsaved settings changes. Leave this page and discard them?',
    );

    confirmDiscard.mockReturnValue(true);
    expect(tenantSettingsCanDeactivate(dirtyComponent, confirmDiscard)).toBe(
      true,
    );
    expect(
      tenantSettingsCanDeactivate(
        { hasUnsavedSettingsChanges: () => false },
        confirmDiscard,
      ),
    ).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledTimes(2);
  });

  it('fails closed when confirmation is unavailable for dirty settings', () => {
    expect(
      tenantSettingsCanDeactivate(
        { hasUnsavedSettingsChanges: () => true },
        undefined,
      ),
    ).toBe(false);
  });
});
