import { describe, expect, it } from '@effect/vitest';

import { traceSamplingRatio } from './server-telemetry.layer';

describe('server telemetry', () => {
  it('samples all local and staging traces', () => {
    expect(traceSamplingRatio('local')).toBe(1);
    expect(traceSamplingRatio('staging')).toBe(1);
  });

  it('samples ten percent of production traces', () => {
    expect(traceSamplingRatio('production')).toBe(0.1);
  });
});
