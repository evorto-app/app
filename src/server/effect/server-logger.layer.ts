import { Effect, Layer, Logger, LogLevel, Option } from 'effect';

import { serverConfig, type ServerConfig } from '../config/server-config';

export const resolveServerLogLevel = (
  input: Pick<
    ServerConfig,
    'ACTIONS_STEP_DEBUG' | 'CI' | 'SERVER_LOG_LEVEL'
  >,
): LogLevel.LogLevel => {
  const configuredLevel = Option.getOrUndefined(input.SERVER_LOG_LEVEL)
    ?.trim()
    .toLowerCase();
  switch (configuredLevel) {
    case 'all': {
      return LogLevel.All;
    }
    case 'debug': {
      return LogLevel.Debug;
    }
    case 'error': {
      return LogLevel.Error;
    }
    case 'fatal': {
      return LogLevel.Fatal;
    }
    case 'info': {
      return LogLevel.Info;
    }
    case 'none':
    case 'off': {
      return LogLevel.None;
    }
    case 'trace': {
      return LogLevel.Trace;
    }
    case 'warn':
    case 'warning': {
      return LogLevel.Warning;
    }
    default: {
      if (input.ACTIONS_STEP_DEBUG) {
        return LogLevel.Debug;
      }
      if (input.CI) {
        return LogLevel.Warning;
      }
      return LogLevel.Info;
    }
  }
};

export const serverLoggerLayer = Layer.mergeAll(
  Logger.replace(Logger.defaultLogger, Logger.prettyLoggerDefault),
  Layer.unwrapEffect(
    serverConfig.pipe(
      Effect.map((configuredServerConfig) =>
        Logger.minimumLogLevel(resolveServerLogLevel(configuredServerConfig)),
      ),
    ),
  ),
);
