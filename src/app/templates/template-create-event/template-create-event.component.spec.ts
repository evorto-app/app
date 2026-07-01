import { describe, expect, it } from 'vitest';

import {
  templateAddOnCopyNotice,
  templateCreateEventSubmitDisabled,
} from './template-create-event.component';

describe('templateCreateEventSubmitDisabled', () => {
  it('blocks template event creation while invalid, submitting, or awaiting the mutation', () => {
    expect(
      templateCreateEventSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
    expect(
      templateCreateEventSubmitDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      templateCreateEventSubmitDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      templateCreateEventSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
  });
});

describe('templateAddOnCopyNotice', () => {
  it('stays hidden when a template has no reusable add-ons', () => {
    expect(templateAddOnCopyNotice(0)).toBeNull();
  });

  it('keeps the create-event add-on boundary explicit', () => {
    expect(templateAddOnCopyNotice(1)).toContain(
      'This template has 1 reusable add-on.',
    );
    expect(templateAddOnCopyNotice(2)).toContain(
      'Event creation copies them to event registration cards',
    );
    expect(templateAddOnCopyNotice(2)).toContain('registration-time purchase');
  });
});
