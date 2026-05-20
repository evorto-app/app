import { describe, expect, it } from 'vitest';

import { templateWriteSubmitDisabled } from './template-form.utilities';

describe('templateWriteSubmitDisabled', () => {
  it('disables template writes while the form is invalid', () => {
    expect(
      templateWriteSubmitDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
  });

  it('disables template writes while the form is submitting', () => {
    expect(
      templateWriteSubmitDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
  });

  it('disables template writes while the create or update mutation is pending', () => {
    expect(
      templateWriteSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
  });

  it('allows template writes only when the form and mutation are idle', () => {
    expect(
      templateWriteSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});
