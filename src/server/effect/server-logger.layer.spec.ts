import { describe, expect, it } from '@effect/vitest';
import { LogLevel, Option } from 'effect';

import { resolveServerLogLevel } from './server-logger.layer';

describe('server-logger.layer', () => {
  it('prefers an explicit server log level', () => {
    expect(
      resolveServerLogLevel({
        ACTIONS_STEP_DEBUG: false,
        CI: false,
        SERVER_LOG_LEVEL: Option.some(LogLevel.fromLiteral('Error')),
      }),
    ).toBe(LogLevel.Error);
  });

  it('elevates CI to warning when no explicit log level is configured', () => {
    expect(
      resolveServerLogLevel({
        ACTIONS_STEP_DEBUG: false,
        CI: true,
        SERVER_LOG_LEVEL: Option.none(),
      }),
    ).toBe(LogLevel.Warning);
  });

  it('elevates GitHub step debug to debug when no explicit log level is configured', () => {
    expect(
      resolveServerLogLevel({
        ACTIONS_STEP_DEBUG: true,
        CI: false,
        SERVER_LOG_LEVEL: Option.none(),
      }),
    ).toBe(LogLevel.Debug);
  });

  it('defaults to info when no explicit log level or CI debug flags are set', () => {
    expect(
      resolveServerLogLevel({
        ACTIONS_STEP_DEBUG: false,
        CI: false,
        SERVER_LOG_LEVEL: Option.none(),
      }),
    ).toBe(LogLevel.Info);
  });
});
