import { describe, expect, it } from 'vitest';

import { createRegistrationOptionFormModel } from './registration-option-form.schema';

describe('createRegistrationOptionFormModel', () => {
  it('creates registration-window defaults in tenant business time', () => {
    const model = createRegistrationOptionFormModel({}, 'America/New_York');

    expect(model.openRegistrationTime.zoneName).toBe('America/New_York');
    expect(model.closeRegistrationTime.zoneName).toBe('America/New_York');
  });

  it('inherits tenant transfer and cancellation policy by default', () => {
    expect(createRegistrationOptionFormModel()).toMatchObject({
      cancellationDeadlineHoursBeforeStart: null,
      refundFeesOnCancellation: null,
      transferDeadlineHoursBeforeStart: null,
    });
  });
});
