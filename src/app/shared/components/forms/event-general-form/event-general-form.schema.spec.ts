import { describe, expect, it } from 'vitest';

import { createEventGeneralFormModel } from './event-general-form.schema';

describe('createEventGeneralFormModel', () => {
  it('creates scheduling defaults in tenant business time', () => {
    const model = createEventGeneralFormModel({}, 'Australia/Brisbane');

    expect(model.start.zoneName).toBe('Australia/Brisbane');
    expect(model.end.zoneName).toBe('Australia/Brisbane');
  });
});
