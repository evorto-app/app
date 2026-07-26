import {
  MissingSessionError,
  MissingTransactionError,
  type SessionData,
  type StateData,
  type TransactionData,
} from '@auth0/auth0-server-js';
import { Cause, Effect, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  AUTH_SESSION_COOKIE_IDENTIFIER,
  AUTH_TRANSACTION_COOKIE_IDENTIFIER,
  createAuth0ServerClientOptions,
  createAuthStoreOptions,
  isAuthenticated,
  runAuth0SdkOperation,
  shouldSecureAuthCookies,
  toAuthSession,
} from './auth-session';

const sessionData = (expiresAt: number): SessionData => ({
  idToken: 'test-id-token',
  refreshToken: undefined,
  tokenSets: [
    {
      accessToken: 'test-access-token',
      audience: 'default',
      expiresAt,
      scope: 'openid profile email',
    },
  ],
  user: {
    email: 'user@example.test',
    sub: 'auth0|test-user',
  },
});

const storedStateData = (): StateData => ({
  ...sessionData(Date.now() / 1000 + 3600),
  internal: {
    createdAt: Math.floor(Date.now() / 1000),
    sid: 'test-session-id',
  },
});

const transactionData: TransactionData = {
  audience: 'default',
  codeVerifier: 'test-code-verifier',
};

const clientOptions = (secureCookies: boolean) =>
  createAuth0ServerClientOptions({
    audience: Option.none(),
    baseUrl: 'https://app.example',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    issuerBaseUrl: 'https://issuer.example',
    secret: 's'.repeat(32),
    secureCookies,
  });

describe('Auth0 application sessions', () => {
  it('remains authenticated after the unused OAuth access token expires', () => {
    const authSession = toAuthSession(sessionData(0));

    expect(isAuthenticated(authSession)).toBe(true);
    expect(authSession).toMatchObject({
      authData: {
        sub: 'auth0|test-user',
      },
    });
  });

  it('requires an identity-bearing SDK session with a primary token set', () => {
    expect(toAuthSession(undefined)).toBeUndefined();
    expect(
      toAuthSession({
        ...sessionData(0),
        tokenSets: [],
      }),
    ).toBeUndefined();
    expect(
      toAuthSession({
        ...sessionData(0),
        user: {
          email: 'missing-subject@example.test',
        },
      }),
    ).toBeUndefined();
  });

  it('configures explicit session and transaction cookie identifiers', () => {
    const options = clientOptions(true);

    expect(options.stateIdentifier).toBe(AUTH_SESSION_COOKIE_IDENTIFIER);
    expect(options.transactionIdentifier).toBe(
      AUTH_TRANSACTION_COOKIE_IDENTIFIER,
    );
  });

  it('emits and deletes the exact hosted session cookie with hardened flags', async () => {
    const options = clientOptions(true);
    const storeOptions = createAuthStoreOptions({}, true);

    await options.stateStore.set(
      AUTH_SESSION_COOKIE_IDENTIFIER,
      storedStateData(),
      false,
      storeOptions,
    );

    expect(storeOptions.mutations).toContainEqual(
      expect.objectContaining({
        name: `${AUTH_SESSION_COOKIE_IDENTIFIER}.0`,
        options: expect.objectContaining({
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: true,
        }),
        type: 'set',
      }),
    );

    await options.stateStore.delete(
      AUTH_SESSION_COOKIE_IDENTIFIER,
      storeOptions,
    );

    expect(storeOptions.mutations).toContainEqual({
      name: `${AUTH_SESSION_COOKIE_IDENTIFIER}.0`,
      options: {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: true,
      },
      type: 'delete',
    });
  });

  it('emits and deletes the exact hosted transaction cookie with hardened flags', async () => {
    const options = clientOptions(true);
    const storeOptions = createAuthStoreOptions({}, true);

    await options.transactionStore.set(
      AUTH_TRANSACTION_COOKIE_IDENTIFIER,
      transactionData,
      false,
      storeOptions,
    );

    expect(storeOptions.mutations).toContainEqual(
      expect.objectContaining({
        name: AUTH_TRANSACTION_COOKIE_IDENTIFIER,
        options: expect.objectContaining({
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: true,
        }),
        type: 'set',
      }),
    );

    await options.transactionStore.delete(
      AUTH_TRANSACTION_COOKIE_IDENTIFIER,
      storeOptions,
    );

    expect(storeOptions.mutations).toContainEqual({
      name: AUTH_TRANSACTION_COOKIE_IDENTIFIER,
      options: {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: true,
      },
      type: 'delete',
    });
  });

  it('forces secure cookies when hosted and only follows the request protocol locally', async () => {
    expect(shouldSecureAuthCookies('staging', false)).toBe(true);
    expect(shouldSecureAuthCookies('production', false)).toBe(true);
    expect(shouldSecureAuthCookies('local', true)).toBe(true);
    expect(shouldSecureAuthCookies('local', false)).toBe(false);

    const options = clientOptions(false);
    const storeOptions = createAuthStoreOptions({}, false);
    await options.transactionStore.set(
      AUTH_TRANSACTION_COOKIE_IDENTIFIER,
      transactionData,
      false,
      storeOptions,
    );

    expect(storeOptions.mutations).toContainEqual(
      expect.objectContaining({
        name: AUTH_TRANSACTION_COOKIE_IDENTIFIER,
        options: expect.objectContaining({
          secure: false,
        }),
        type: 'set',
      }),
    );
  });

  it('keeps an absent SDK session explicit and surfaces every rejected SDK operation', async () => {
    const noSession = await Effect.runPromise(
      runAuth0SdkOperation('no-session', () =>
        Promise.resolve<SessionData | undefined>(undefined),
      ),
    );
    expect(noSession).toBeUndefined();

    const failures = [
      new MissingSessionError('session decoding failed'),
      new MissingTransactionError('transaction decoding failed'),
      new Error('provider unavailable'),
    ];

    for (const failure of failures) {
      const exit = await Effect.runPromiseExit(
        runAuth0SdkOperation('test-failure', () => Promise.reject(failure)),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toBe(failure);
      }
    }
  });
});
