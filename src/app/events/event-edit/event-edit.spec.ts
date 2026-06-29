import { describe, expect, it } from 'vitest';

import { eventEditSubmitDisabled } from './event-edit';

describe('eventEditSubmitDisabled', () => {
  it('blocks event edit submits while invalid, submitting, or awaiting the mutation', () => {
    expect(
      eventEditSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
    expect(
      eventEditSubmitDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      eventEditSubmitDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      eventEditSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
  });
});
