import { Config, ConfigProvider, Effect, Option } from 'effect';

import { optionalTrimmedString } from './config-string';
import { applicationEnvironmentConfig } from './deployment-config';

export type RegistrationRefundWorkerRuntimeMode =
  'disabledForPlaywright' | 'enabled';

const configFailure = (message: string) =>
  new Config.ConfigError(new ConfigProvider.SourceError({ message }));

const enabledMode: RegistrationRefundWorkerRuntimeMode = 'enabled';
const disabledForPlaywrightMode: RegistrationRefundWorkerRuntimeMode =
  'disabledForPlaywright';

export const registrationRefundWorkerRuntimeModeConfig = Config.all({
  APP_ENVIRONMENT: Config.option(applicationEnvironmentConfig),
  E2E_NOW_ISO: optionalTrimmedString('E2E_NOW_ISO'),
  E2E_RUNTIME_MODE: Config.option(
    Config.Literal('playwright', 'E2E_RUNTIME_MODE'),
  ),
  LOCAL_DATABASE: Config.Boolean('LOCAL_DATABASE').pipe(
    Config.withDefault(false),
  ),
  NODE_ENV: optionalTrimmedString('NODE_ENV'),
}).pipe(
  Config.mapEffect(
    ({
      APP_ENVIRONMENT,
      E2E_NOW_ISO,
      E2E_RUNTIME_MODE,
      LOCAL_DATABASE,
      NODE_ENV,
    }) => {
      // Test-only runtime mode is ignored outside APP_ENVIRONMENT=local; the
      // startup guard logs the misconfiguration.
      if (
        Option.isNone(E2E_RUNTIME_MODE) ||
        Option.getOrUndefined(APP_ENVIRONMENT) !== 'local'
      ) {
        return Effect.succeed(enabledMode);
      }

      const validatedLocalPlaywrightRuntime =
        Option.getOrUndefined(NODE_ENV) === 'development' &&
        LOCAL_DATABASE &&
        Option.isSome(E2E_NOW_ISO);
      return validatedLocalPlaywrightRuntime
        ? Effect.succeed(disabledForPlaywrightMode)
        : Effect.fail(
            configFailure(
              'E2E_RUNTIME_MODE=playwright may disable the registration refund worker only with NODE_ENV=development, LOCAL_DATABASE=true, and E2E_NOW_ISO configured',
            ),
          );
    },
  ),
);
