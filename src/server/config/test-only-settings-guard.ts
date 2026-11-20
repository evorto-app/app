import { Config, ConfigProvider, Effect, Option } from 'effect';

import { optionalTrimmedString } from './config-string';
import { applicationEnvironmentConfig } from './deployment-config';

/**
 * Test-only settings that are honored only with `APP_ENVIRONMENT=local`.
 * Outside local they are ignored by their config readers; this guard makes the
 * misconfiguration visible without failing startup.
 */
export const testOnlySettingNames = [
  'E2E_NOW_ISO',
  'E2E_RUNTIME_MODE',
  'TENANT_DOMAIN',
] as const;

const testOnlySettingsConfig = Config.all({
  APP_ENVIRONMENT: Config.option(applicationEnvironmentConfig),
  E2E_NOW_ISO: optionalTrimmedString('E2E_NOW_ISO'),
  E2E_RUNTIME_MODE: optionalTrimmedString('E2E_RUNTIME_MODE'),
  TENANT_DOMAIN: optionalTrimmedString('TENANT_DOMAIN'),
});

export const findIgnoredTestOnlySettings = (
  provider: ConfigProvider.ConfigProvider,
) =>
  testOnlySettingsConfig
    .parse(provider)
    .pipe(
      Effect.map(({ APP_ENVIRONMENT, ...settings }) =>
        Option.getOrUndefined(APP_ENVIRONMENT) === 'local'
          ? []
          : testOnlySettingNames.filter((name) =>
              Option.isSome(settings[name]),
            ),
      ),
    );

export const logIgnoredTestOnlySettings = (
  provider: ConfigProvider.ConfigProvider,
) =>
  findIgnoredTestOnlySettings(provider).pipe(
    Effect.flatMap((ignoredSettings) =>
      Effect.forEach(
        ignoredSettings,
        (name) =>
          Effect.logError(
            `Misconfiguration: test-only setting ${name} is set outside APP_ENVIRONMENT=local. It is ignored; the real clock and normal configuration apply. Remove it from this environment.`,
          ),
        { discard: true },
      ),
    ),
    // A malformed environment is reported by the regular config validation.
    Effect.catch(() => Effect.void),
  );
