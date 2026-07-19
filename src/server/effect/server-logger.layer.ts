import { Effect, Formatter, Logger, LogLevel, Option } from 'effect';

import {
  deploymentConfig,
  type DeploymentConfig,
} from '../config/deployment-config';
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

export const resolveServerLogFormat = (
  environment: 'local' | 'production' | 'staging',
) => (environment === 'local' ? 'pretty' : 'json');

export const serverReleaseLogAnnotations = (
  deployment: Pick<
    DeploymentConfig,
    'APP_ENVIRONMENT' | 'APP_IMAGE_DIGEST' | 'APP_REVISION' | 'APP_ROLE'
  >,
) => ({
  environment: deployment.APP_ENVIRONMENT,
  imageDigest: Option.getOrElse(deployment.APP_IMAGE_DIGEST, () => 'unknown'),
  revision: Option.getOrElse(deployment.APP_REVISION, () => 'unknown'),
  role: deployment.APP_ROLE,
});

const releaseJsonLogger = (
  releaseAnnotations: ReturnType<typeof serverReleaseLogAnnotations>,
) =>
  Logger.withConsoleLog(
    Logger.formatStructured.pipe(
      Logger.map((entry) =>
        Formatter.formatJson({
          ...entry,
          annotations: {
            ...entry.annotations,
            ...releaseAnnotations,
          },
        }),
      ),
    ),
  );

const configuredServerLogger = Effect.gen(function* () {
  const configuredServerConfig = yield* serverLoggingConfig;
  const deployment = yield* deploymentConfig;
  const minimumLogLevel = resolveServerLogLevel(configuredServerConfig);
  const configuredLogger =
    resolveServerLogFormat(deployment.APP_ENVIRONMENT) === 'pretty'
      ? Logger.consolePretty()
      : releaseJsonLogger(serverReleaseLogAnnotations(deployment));

  return Logger.make((options) => {
    if (LogLevel.isGreaterThanOrEqualTo(options.logLevel, minimumLogLevel)) {
      configuredLogger.log(options);
    }
  });
});

export const serverLoggerLayer = Logger.layer([configuredServerLogger]);
