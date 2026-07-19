export const protectedEnvironmentVariables = [
  'E2E_DEFAULT_USER_PASSWORD',
  'E2E_ADMIN_USER_PASSWORD',
  'E2E_GLOBAL_ADMIN_USER_PASSWORD',
  'E2E_REGULAR_USER_PASSWORD',
  'E2E_ORGANIZER_USER_PASSWORD',
  'E2E_EMPTY_USER_PASSWORD',
  'E2E_LIVE_ESN_CARD_IDENTIFIER',
  'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER',
  'E2E_TRANSIENT_AUTH0_USER_PASSWORD',
  // Used only by the fail-closed regression fixture.
  'PROTECTED_INPUT_SENTINEL',
] as const;

export type ProtectedEnvironmentVariable =
  (typeof protectedEnvironmentVariables)[number];

export const readProtectedEnvironmentValue = (
  name: ProtectedEnvironmentVariable,
  options: Readonly<{ trim?: boolean }> = {},
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const rawValue = environment[name];
  const value = options.trim ? rawValue?.trim() : rawValue;
  if (!value) {
    throw new Error(`Missing required protected environment variable ${name}`);
  }
  return value;
};
