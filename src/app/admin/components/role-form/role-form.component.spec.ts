import { describe, expect, it } from 'vitest';

import { roleFormSubmitDisabled } from './role-form.component';

describe('roleFormSubmitDisabled', () => {
  it('blocks role submits while invalid, submitting, or mutation-pending', () => {
    expect(
      roleFormSubmitDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      roleFormSubmitDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      roleFormSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      roleFormSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});
