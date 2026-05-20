import { describe, expect, it } from 'vitest';

import { generalSettingsSaveDisabled } from './general-settings.component';

describe('generalSettingsSaveDisabled', () => {
  it('blocks tenant settings saves while invalid, submitting, or mutation-pending', () => {
    expect(
      generalSettingsSaveDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      generalSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      generalSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      generalSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});
