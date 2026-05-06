import { Effect, Logger, LogLevel, Option } from 'effect';

import {
  serverLoggingConfig,
  type ServerLoggingConfig,
} from '../config/server-config';

export const resolveServerLogLevel = (
  input: Pick<
    ServerLoggingConfig,
    'ACTIONS_STEP_DEBUG' | 'CI' | 'SERVER_LOG_LEVEL'
  >,
): LogLevel.LogLevel => {
  const configuredLevel = Option.getOrUndefined(input.SERVER_LOG_LEVEL);
  if (configuredLevel) {
    return configuredLevel;
  }

  if (input.ACTIONS_STEP_DEBUG) {
    return 'Debug';
  }
  if (input.CI) {
    return 'Warn';
  }
  return 'Info';
};

const configuredPrettyLogger = Effect.gen(function* () {
  const configuredServerConfig = yield* serverLoggingConfig;
  const minimumLogLevel = resolveServerLogLevel(configuredServerConfig);
  const prettyLogger = Logger.consolePretty();

  return Logger.make((options) => {
    if (LogLevel.isGreaterThanOrEqualTo(options.logLevel, minimumLogLevel)) {
      prettyLogger.log(options);
    }
  });
});

export const serverLoggerLayer = Logger.layer([configuredPrettyLogger]);
