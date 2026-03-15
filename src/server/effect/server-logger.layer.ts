import { Effect, Layer, Logger, LogLevel, Option } from 'effect';

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
    return LogLevel.Debug;
  }
  if (input.CI) {
    return LogLevel.Warning;
  }
  return LogLevel.Info;
};

export const serverLoggerLayer = Layer.mergeAll(
  Logger.replace(Logger.defaultLogger, Logger.prettyLoggerDefault),
  Layer.unwrapEffect(
    serverLoggingConfig.pipe(
      Effect.map((configuredServerConfig) =>
        Logger.minimumLogLevel(resolveServerLogLevel(configuredServerConfig)),
      ),
    ),
  ),
);
