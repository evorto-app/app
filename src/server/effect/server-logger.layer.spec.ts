import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';

import { resolveServerLogLevel } from './server-logger.layer';

describe('server-logger.layer', () => {
  it('prefers an explicit server log level', () => {
    expect(
      resolveServerLogLevel({
        ACTIONS_STEP_DEBUG: false,
        CI: false,
        SERVER_LOG_LEVEL: Option.some('Error'),
      }),
    ).toBe('Error');
  });

  it('elevates CI to warning when no explicit log level is configured', () => {
    expect(
      resolveServerLogLevel({
        ACTIONS_STEP_DEBUG: false,
        CI: true,
        SERVER_LOG_LEVEL: Option.none(),
      }),
    ).toBe('Warn');
  });

  it('elevates GitHub step debug to debug when no explicit log level is configured', () => {
    expect(
      resolveServerLogLevel({
        ACTIONS_STEP_DEBUG: true,
        CI: false,
        SERVER_LOG_LEVEL: Option.none(),
      }),
    ).toBe('Debug');
  });

  it('defaults to info when no explicit log level or CI debug flags are set', () => {
    expect(
      resolveServerLogLevel({
        ACTIONS_STEP_DEBUG: false,
        CI: false,
        SERVER_LOG_LEVEL: Option.none(),
      }),
    ).toBe('Info');
  });
});
