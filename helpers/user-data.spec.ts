import { describe, expect, it } from 'vitest';

import {
  e2eTestUserPasswordVariables,
  readRequiredE2ETestUserPassword,
  usersToAuthenticate,
} from './user-data';

describe('authenticated E2E user credentials', () => {
  it('fails closed when a required account password is absent or blank', () => {
    for (const variable of e2eTestUserPasswordVariables) {
      expect(() => readRequiredE2ETestUserPassword(variable, {})).toThrow(
        `Missing required ${variable}`,
      );
      expect(() =>
        readRequiredE2ETestUserPassword(variable, { [variable]: '   ' }),
      ).toThrow(`Missing required ${variable}`);
    }
  });

  it('reads every test account password from its dedicated environment variable', () => {
    const environment = Object.fromEntries(
      e2eTestUserPasswordVariables.map((variable) => [variable, variable]),
    );

    expect(
      usersToAuthenticate.map((user) =>
        readRequiredE2ETestUserPassword(user.passwordVariable, environment),
      ),
    ).toEqual(e2eTestUserPasswordVariables);
    expect(usersToAuthenticate.map((user) => user.passwordVariable)).toEqual(
      e2eTestUserPasswordVariables,
    );
    expect(new Set(e2eTestUserPasswordVariables).size).toBe(
      usersToAuthenticate.length,
    );
    for (const user of usersToAuthenticate)
      expect(user).not.toHaveProperty('password');
  });

  it('uses an explicit platform fixture without tenant roles', () => {
    expect(usersToAuthenticate.map((user) => user.roles)).not.toContain('all');
    expect(
      usersToAuthenticate.find(
        (user) => user.passwordVariable === 'E2E_DEFAULT_USER_PASSWORD',
      )?.roles,
    ).toBe('profile');
    expect(
      usersToAuthenticate.filter((user) => user.platformAdministrator),
    ).toEqual([
      expect.objectContaining({
        passwordVariable: 'E2E_GLOBAL_ADMIN_USER_PASSWORD',
        roles: 'none',
      }),
    ]);
  });

  it('preserves significant leading and trailing password characters', () => {
    expect(
      readRequiredE2ETestUserPassword('E2E_DEFAULT_USER_PASSWORD', {
        E2E_DEFAULT_USER_PASSWORD: ' password-with-significant-spaces ',
      }),
    ).toBe(' password-with-significant-spaces ');
  });
});
