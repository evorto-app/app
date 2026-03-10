import { Layer, Logger, LogLevel } from 'effect';

const resolveServerLogLevel = (
  input: NodeJS.ProcessEnv = process.env,
): LogLevel.LogLevel => {
  const configuredLevel = input['SERVER_LOG_LEVEL']?.trim().toLowerCase();
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
      if (input['ACTIONS_STEP_DEBUG'] === 'true') {
        return LogLevel.Debug;
      }
      if (input['CI'] === 'true') {
        return LogLevel.Warning;
      }
      return LogLevel.Info;
    }
  }
};

export const serverLoggerLayer = Layer.mergeAll(
  Logger.replace(Logger.defaultLogger, Logger.prettyLoggerDefault),
  Logger.minimumLogLevel(resolveServerLogLevel()),
);
