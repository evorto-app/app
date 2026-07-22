import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';

import { traceSamplingRatio } from './server-telemetry.layer';

describe('server telemetry', () => {
  it('samples all local traces and ten percent of hosted traces by default', () => {
    expect(traceSamplingRatio('local', Option.none())).toBe(1);
    expect(traceSamplingRatio('staging', Option.none())).toBe(0.1);
    expect(traceSamplingRatio('production', Option.none())).toBe(0.1);
  });

  it('honors an explicit temporary sampling override', () => {
    expect(traceSamplingRatio('staging', Option.some(1))).toBe(1);
    expect(traceSamplingRatio('staging', Option.some(0))).toBe(0);
  });
});
