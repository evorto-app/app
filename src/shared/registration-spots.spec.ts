import { describe, expect, it } from 'vitest';

import { registrationSpotCount } from './registration-spots';

describe('registrationSpotCount', () => {
  it('counts the buyer plus selected guests for capacity updates', () => {
    expect(registrationSpotCount(0)).toBe(1);
    expect(registrationSpotCount(2)).toBe(3);
  });
});
