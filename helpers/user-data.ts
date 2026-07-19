export const defaultStateFile = 'tests/.auth/default.json';
export const adminStateFile = 'tests/.auth/admin-user.json';
export const gaStateFile = 'tests/.auth/global-admin-user.json';
export const userStateFile = 'tests/.auth/regular-user.json';
export const organizerStateFile = 'tests/.auth/organizer-user.json';
export const emptyStateFile = 'tests/.auth/empty-user.json';

export const e2eTestUserPasswordVariables = [
  'E2E_DEFAULT_USER_PASSWORD',
  'E2E_ADMIN_USER_PASSWORD',
  'E2E_GLOBAL_ADMIN_USER_PASSWORD',
  'E2E_REGULAR_USER_PASSWORD',
  'E2E_ORGANIZER_USER_PASSWORD',
  'E2E_EMPTY_USER_PASSWORD',
] as const;

export type E2ETestUserPasswordVariable =
  (typeof e2eTestUserPasswordVariables)[number];

export const readRequiredE2ETestUserPassword = (
  name: E2ETestUserPasswordVariable,
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const password = environment[name];
  if (!password?.trim()) {
    throw new Error(
      `Missing required ${name}. Add a rotated value to the ignored .env file before authenticated Playwright runs.`,
    );
  }
  return password;
};

/**
 * Canonical test users and role scope matrix.
 *
 * Intended usage in tests:
 * - `all`: broad legacy fallback user; avoid for new specs.
 * - `admin`: finance/admin capabilities (tax rates, receipts approval, role admin).
 * - `user`: regular attendee flows (registration, profile, discounts).
 * - `organizer`: template/event creation and organizer-level event management.
 * - `none`: negative-permission checks (no tenant app permissions).
 *
 * Keep specs least-privileged by default and only elevate via `permissionOverride`
 * when a test explicitly validates permission transitions. The account records
 * retain only environment-variable names; authenticated execution resolves each
 * password fail-closed immediately before submitting the Auth0 login form.
 */
export const usersToAuthenticate = [
  {
    addToDb: true,
    addToTenant: true,
    authId: 'auth0|6775a3a47369b902878fdc74',
    email: 'testuser1@evorto.app',
    id: 'e24014d5fac33d92e11b',
    passwordVariable: 'E2E_DEFAULT_USER_PASSWORD',
    roles: 'all' as const,
    stateFile: defaultStateFile,
  },
  {
    addToDb: true,
    addToTenant: true,
    authId: 'auth0|67af71761ad244799704e26f',
    email: 'admin@evorto.app',
    id: '76574ab75657293de6d3',
    passwordVariable: 'E2E_ADMIN_USER_PASSWORD',
    roles: 'admin' as const,
    stateFile: adminStateFile,
  },
  {
    addToDb: true,
    addToTenant: true,
    authId: 'auth0|67bb679215c6fbc625ca098f',
    email: 'global-admin@evorto.app',
    id: 'e1ba85116cb02927cc5e',
    passwordVariable: 'E2E_GLOBAL_ADMIN_USER_PASSWORD',
    roles: 'none' as const,
    stateFile: gaStateFile,
  },
  {
    addToDb: true,
    addToTenant: true,
    authId: 'auth0|67af71f31ad244799704e318',
    email: 'user@evorto.app',
    id: '334967d7626fbd6ad449',
    passwordVariable: 'E2E_REGULAR_USER_PASSWORD',
    roles: 'user' as const,
    stateFile: userStateFile,
  },
  {
    addToDb: true,
    addToTenant: true,
    authId: 'auth0|67af78dea8b5cb7c1a20d2e3',
    email: 'organizer@evorto.app',
    id: 'ef7d925a3b3d9a50831a',
    passwordVariable: 'E2E_ORGANIZER_USER_PASSWORD',
    roles: 'organizer' as const,
    stateFile: organizerStateFile,
  },
  {
    addToDb: true,
    addToTenant: true,
    authId: 'auth0|678e76939778438786fff634',
    email: 'testuser2@evorto.app',
    id: '93d8637ad0a1ef21b1ba',
    passwordVariable: 'E2E_EMPTY_USER_PASSWORD',
    roles: 'none' as const,
    stateFile: emptyStateFile,
  },
] as const satisfies readonly {
  readonly addToDb: boolean;
  readonly addToTenant: boolean;
  readonly authId: string;
  readonly email: string;
  readonly id: string;
  readonly passwordVariable: E2ETestUserPasswordVariable;
  readonly roles: 'admin' | 'all' | 'none' | 'organizer' | 'user';
  readonly stateFile: string;
}[];
