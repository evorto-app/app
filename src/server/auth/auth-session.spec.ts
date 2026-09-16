import {
  MissingSessionError,
  MissingTransactionError,
  ServerClient,
  type SessionData,
  type StateData,
  type TransactionData,
} from '@auth0/auth0-server-js';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { Cause, ConfigProvider, Effect, Exit, Option } from 'effect';
import * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/unstable/http/HttpServerResponse';

import { RuntimeConfig } from '../config/runtime-config';
import {
  AUTH_SESSION_COOKIE_IDENTIFIER,
  AUTH_TRANSACTION_COOKIE_IDENTIFIER,
  createAuth0ServerClientOptions,
  createAuthStoreOptions,
  handleCallbackRequest,
  InvalidAuthSessionError,
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
  it.effect(
    'remains authenticated after the unused OAuth access token expires',
    () =>
      Effect.gen(function* () {
        const authSession = yield* toAuthSession(sessionData(0));

        expect(isAuthenticated(authSession)).toBe(true);
        expect(authSession).toMatchObject({
          authData: {
            sub: 'auth0|test-user',
          },
        });
      }),
  );

  it.effect('treats only an absent SDK session as anonymous', () =>
    Effect.gen(function* () {
      const authSession = yield* toAuthSession(undefined);

      expect(authSession).toBeUndefined();
      expect(isAuthenticated(authSession)).toBe(false);
    }),
  );

  it.effect(
    'fails before incomplete SDK sessions can reach request handling',
    () =>
      Effect.gen(function* () {
        const incompleteSessions = [
          {
            expectedReason: 'missing-primary-token-set',
            session: {
              ...sessionData(0),
              tokenSets: [],
            },
          },
          {
            expectedReason: 'missing-user',
            session: {
              ...sessionData(0),
              user: undefined,
            },
          },
          {
            expectedReason: 'missing-subject',
            session: {
              ...sessionData(0),
              user: {
                email: 'missing-subject@example.test',
                sub: '',
              },
            },
          },
        ] satisfies {
          expectedReason: InvalidAuthSessionError['reason'];
          session: SessionData;
        }[];

        for (const { expectedReason, session } of incompleteSessions) {
          let requestHandlingReached = false;
          const error = yield* Effect.gen(function* () {
            const authSession = yield* toAuthSession(session);
            requestHandlingReached = true;
            return isAuthenticated(authSession);
          }).pipe(Effect.flip);

          expect(error).toBeInstanceOf(InvalidAuthSessionError);
          expect(error.reason).toBe(expectedReason);
          expect(requestHandlingReached).toBe(false);
        }
      }),
  );

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
    const stateStore = options.stateStore;
    if (!stateStore) throw new Error('Expected an Auth0 state store');

    await stateStore.set(
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

    await stateStore.delete(AUTH_SESSION_COOKIE_IDENTIFIER, storeOptions);

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

const callbackRuntimeConfig = RuntimeConfig.make.pipe(
  Effect.provideService(
    ConfigProvider.ConfigProvider,
    ConfigProvider.fromEnv({
      env: {
        APP_ENVIRONMENT: 'production',
        APP_ROLE: 'web',
        BASE_URL: 'https://app.example',
        CLIENT_ID: 'fixture-client',
        CLIENT_SECRET: 'fixture-secret',
        DATABASE_TLS_REQUIRED: 'false',
        DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/unused',
        ISSUER_BASE_URL: 'https://issuer.example',
        SECRET: 's'.repeat(32),
        WORKER_TRIGGER_MODE: 'http',
      },
    }),
  ),
);
const callbackRequest = () =>
  HttpServerRequest.fromWeb(
    new Request(
      'https://app.example/callback?code=stale-code&state=stale-state',
      { headers: { host: 'app.example', 'x-forwarded-proto': 'https' } },
    ),
  );

describe('Auth0 callback recovery', () => {
  afterEach(() => vi.restoreAllMocks());

  it.effect(
    'recovers stale or replayed callbacks without contacting the provider',
    () =>
      Effect.gen(function* () {
        const fetch = vi
          .spyOn(globalThis, 'fetch')
          .mockRejectedValue(new Error('Network is forbidden in this test'));
        const runtime = yield* callbackRuntimeConfig;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = yield* handleCallbackRequest(callbackRequest()).pipe(
            Effect.provideService(RuntimeConfig, runtime),
          );
          const webResponse = HttpServerResponse.toWeb(response);
          expect(webResponse.status).toBe(400);
          expect(webResponse.headers.get('Cache-Control')).toBe('no-store');
          expect(yield* Effect.promise(() => webResponse.text())).toBe(
            'Sign-in could not be completed. Return to Evorto and try again.',
          );
        }
        expect(fetch).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'preserves defects for unexpected or merely named callback failures',
    () =>
      Effect.gen(function* () {
        const runtime = yield* callbackRuntimeConfig;
        const complete = vi.spyOn(
          ServerClient.prototype,
          'completeInteractiveLogin',
        );
        for (const failure of [
          new Error('provider unavailable'),
          new MissingSessionError('missing session'),
          { message: 'spoofed failure', name: 'MissingTransactionError' },
        ]) {
          complete.mockRejectedValueOnce(failure);
          const exit = yield* Effect.exit(
            handleCallbackRequest(callbackRequest()).pipe(
              Effect.provideService(RuntimeConfig, runtime),
            ),
          );
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit))
            expect(Cause.squash(exit.cause)).toBe(failure);
        }
      }),
  );

  it.effect('keeps successful callback redirects sanitized', () =>
    Effect.gen(function* () {
      const runtime = yield* callbackRuntimeConfig;
      const complete = vi.spyOn(
        ServerClient.prototype,
        'completeInteractiveLogin',
      );
      for (const [redirectUrl, expected] of [
        ['/events', '/events'],
        ['https://attacker.example', '/'],
      ] as const) {
        complete.mockResolvedValueOnce({ appState: { redirectUrl } });
        const response = yield* handleCallbackRequest(callbackRequest()).pipe(
          Effect.provideService(RuntimeConfig, runtime),
        );
        expect(HttpServerResponse.toWeb(response).headers.get('Location')).toBe(
          expected,
        );
      }
    }),
  );
});
