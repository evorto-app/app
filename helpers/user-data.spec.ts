import fs from 'node:fs';
import path from 'node:path';
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
  });

  it('preserves significant leading and trailing password characters', () => {
    expect(
      readRequiredE2ETestUserPassword('E2E_DEFAULT_USER_PASSWORD', {
        E2E_DEFAULT_USER_PASSWORD: ' password-with-significant-spaces ',
      }),
    ).toBe(' password-with-significant-spaces ');
  });

  it('keeps password values out of tracked test-user configuration', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'helpers/user-data.ts'),
      'utf8',
    );
    const authenticationSetup = fs.readFileSync(
      path.join(process.cwd(), 'tests/setup/authentication.setup.ts'),
      'utf8',
    );
    const exampleEnvironment = fs.readFileSync(
      path.join(process.cwd(), '.env.example'),
      'utf8',
    );
    const trackedDevelopmentEnvironment = fs.readFileSync(
      path.join(process.cwd(), '.env.dev.local'),
      'utf8',
    );
    const playwrightConfig = fs.readFileSync(
      path.join(process.cwd(), 'playwright.config.ts'),
      'utf8',
    );
    const authenticationProject = playwrightConfig.slice(
      playwrightConfig.indexOf("name: 'setup'"),
      playwrightConfig.indexOf("name: 'local-chrome-live-esncard'"),
    );

    expect(source).not.toMatch(/\bpassword\s*:\s*['"`]/u);
    expect(source).not.toMatch(/(?:const|let|var)\s+password\s*=\s*['"`]/u);
    expect(source).toContain('const password = environment[name];');
    expect(source).toContain('if (!password?.trim())');
    expect(authenticationSetup).toContain('fillProtectedValue(');
    expect(authenticationSetup).toContain('userData.passwordVariable,');
    expect(authenticationProject).toContain("screenshot: 'off'");
    expect(authenticationProject).toContain("trace: 'off'");
    expect(authenticationProject).toContain("video: 'off'");
    expect(new Set(e2eTestUserPasswordVariables).size).toBe(
      usersToAuthenticate.length,
    );
    for (const variable of e2eTestUserPasswordVariables) {
      expect(exampleEnvironment).toMatch(
        new RegExp(String.raw`^${variable}=$`, 'mu'),
      );
      expect(trackedDevelopmentEnvironment).not.toMatch(
        new RegExp(String.raw`^${variable}=`, 'mu'),
      );
    }
  });
});
