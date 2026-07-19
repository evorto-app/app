import { Config, ConfigProvider, Effect, Option } from 'effect';

import { optionalTrimmedString } from './config-string';

export type RegistrationRefundWorkerRuntimeMode =
  'disabledForPlaywright' | 'enabled';

const configFailure = (message: string) =>
  new Config.ConfigError(new ConfigProvider.SourceError({ message }));

const enabledMode: RegistrationRefundWorkerRuntimeMode = 'enabled';
const disabledForPlaywrightMode: RegistrationRefundWorkerRuntimeMode =
  'disabledForPlaywright';

export const registrationRefundWorkerRuntimeModeConfig = Config.all({
  E2E_NOW_ISO: optionalTrimmedString('E2E_NOW_ISO'),
  E2E_RUNTIME_MODE: Config.option(
    Config.literal('playwright', 'E2E_RUNTIME_MODE'),
  ),
  LOCAL_DATABASE: Config.boolean('LOCAL_DATABASE').pipe(
    Config.withDefault(false),
  ),
  NODE_ENV: optionalTrimmedString('NODE_ENV'),
}).pipe(
  Config.mapOrFail(
    ({ E2E_NOW_ISO, E2E_RUNTIME_MODE, LOCAL_DATABASE, NODE_ENV }) => {
      if (Option.isNone(E2E_RUNTIME_MODE)) {
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
