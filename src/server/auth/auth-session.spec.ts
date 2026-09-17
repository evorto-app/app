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
import { makeServerResponseMiddleware } from '../http/server-response.middleware';
import {
  AUTH_SESSION_COOKIE_IDENTIFIER,
  AUTH_TRANSACTION_COOKIE_IDENTIFIER,
  createAuth0ServerClientOptions,
  createAuthStoreOptions,
  handleCallbackRequest,
  InvalidAuthSessionError,
  isAuthenticated,
  loadAuthSession,
  resolveRequestOrigin,
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

const requestWithHeaders = (headers: HeadersInit) =>
  HttpServerRequest.fromWeb(
    new Request('https://request.invalid/login', { headers }),
  );

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

  it('uses only the normalized request protocol and required Host', () => {
    expect(
      resolveRequestOrigin(
        requestWithHeaders({
          host: 'tenant.example.test',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toEqual({
      isSecure: true,
      origin: 'https://tenant.example.test',
      protocol: 'https',
    });
    expect(
      resolveRequestOrigin(
        requestWithHeaders({
          host: 'localhost:4100',
          'x-forwarded-proto': 'http',
        }),
      ),
    ).toEqual({
      isSecure: false,
      origin: 'http://localhost:4100',
      protocol: 'http',
    });
  });

  it('fails visibly without normalized origin headers', () => {
    expect(() =>
      resolveRequestOrigin(
        requestWithHeaders({
          host: 'tenant.example.test',
          'x-forwarded-protocol': 'https',
        }),
      ),
    ).toThrow('Normalized request protocol is missing or invalid');
    expect(() =>
      resolveRequestOrigin(
        requestWithHeaders({
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toThrow('Normalized request Host is missing');
    expect(() =>
      resolveRequestOrigin(
        requestWithHeaders({
          host: 'tenant.example.test',
          'x-forwarded-proto': 'ftp',
        }),
      ),
    ).toThrow('Normalized request protocol is missing or invalid');
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

const sessionRequest = (
  cookies: Record<string, string>,
  accept = 'text/html',
) =>
  HttpServerRequest.fromWeb(
    new Request('https://app.example/events', {
      headers: {
        accept,
        cookie: Object.entries(cookies)
          .map(([name, value]) => `${name}=${value}`)
          .join('; '),
        host: 'app.example',
        'x-forwarded-proto': 'https',
      },
    }),
  );

const unrelatedCookies = {
  'appSession.0suffix': 'keep',
  'appSession.preference': 'keep',
  appSessionBackup: 'keep',
  appTransaction: 'keep',
  unrelated: 'keep',
};

describe('real Auth0 session-cookie loading and recovery', () => {
  afterEach(() => vi.restoreAllMocks());

  for (const style of ['raw', 'chunked'] as const) {
    it.effect.each([
      { claim: 'email', value: 123 },
      { claim: 'email_verified', value: 'true' },
      { claim: 'given_name', value: false },
      { claim: 'family_name', value: ['private-profile-value'] },
    ])(
      `recovers a malformed $claim in ${style} cookies before HTML request handling`,
      ({ claim, value }) =>
        Effect.gen(function* () {
          const fetch = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValue(new Error('Network is forbidden in this test'));
          const runtime = yield* callbackRuntimeConfig;
          const options = clientOptions(true);
          const stateStore = options.stateStore;
          if (!stateStore) throw new Error('Expected an Auth0 state store');
          const state = storedStateData();
          if (!state.user) throw new Error('Expected a fixture user');
          // The encrypted cookie can be authentic while its profile violates
          // the application's stricter claim contract.
          Reflect.set(state.user, claim, value);
          state.user['syntheticPadding'] = 'x'.repeat(7000);
          const storeOptions = createAuthStoreOptions({}, true);
          yield* Effect.promise(() =>
            stateStore.set(
              AUTH_SESSION_COOKIE_IDENTIFIER,
              state,
              false,
              storeOptions,
            ),
          );
          const chunks = Object.entries(storeOptions.cookies).filter(([name]) =>
            /^appSession\.\d+$/u.test(name),
          );
          expect(chunks.length).toBeGreaterThan(1);
          const cookies =
            style === 'raw'
              ? { appSession: chunks.map(([, contents]) => contents).join('') }
              : Object.fromEntries(chunks);
          const sdk = new ServerClient(options);
          const loaded = yield* Effect.promise(() =>
            sdk.getSession(createAuthStoreOptions(cookies, true)),
          );
          expect(loaded?.user?.[claim]).toEqual(value);

          const request = sessionRequest({ ...unrelatedCookies, ...cookies });
          let requestHandlingReached = false;
          const response = yield* makeServerResponseMiddleware(
            loadAuthSession(request).pipe(
              Effect.map(() => {
                requestHandlingReached = true;
                return HttpServerResponse.empty();
              }),
            ),
            { applicationEnvironment: 'production' },
          ).pipe(
            Effect.provideService(RuntimeConfig, runtime),
            Effect.provideService(HttpServerRequest.HttpServerRequest, request),
          );
          const web = HttpServerResponse.toWeb(response);
          expect(requestHandlingReached).toBe(false);
          expect(web.status).toBe(401);
          expect(web.headers.get('cache-control')).toBe('no-store');
          expect(web.headers.get('location')).toBeNull();
          const cleared = web.headers.getSetCookie();
          expect(
            cleared.map((cookie) => cookie.split('=', 1)[0]).toSorted(),
          ).toEqual(Object.keys(cookies).toSorted());
          for (const cookie of cleared) {
            expect(cookie).toContain('Max-Age=0');
            expect(cookie).toContain('HttpOnly');
            expect(cookie).toContain('Secure');
            expect(cookie).toContain('SameSite=Lax');
          }
          const html = yield* Effect.promise(() => web.text());
          expect(html).toContain('Sign in again');
          expect(html).toContain('href="/login"');
          expect(html).not.toContain('private-profile-value');
          expect(html).not.toContain('test-access-token');
          expect(fetch).not.toHaveBeenCalled();
        }),
    );
  }

  for (const cookies of [
    { appSession: 'not-encrypted' },
    { appSession: '' },
    { 'appSession.0': 'not-encrypted' },
    { 'appSession.2': 'orphan-fragment' },
    { 'appSession.0': 'partial', 'appSession.1': 'fragments' },
  ] satisfies Record<string, string>[]) {
    it.effect(
      `recovers unreadable present cookies ${Object.keys(cookies).join(',')} with ${Object.values(cookies).join('') ? 'nonempty' : 'empty'} values`,
      () =>
        Effect.gen(function* () {
          const fetch = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValue(new Error('Network is forbidden in this test'));
          const runtime = yield* callbackRuntimeConfig;
          const sdk = new ServerClient(clientOptions(true));
          const sdkSession = yield* Effect.promise(() =>
            sdk.getSession(createAuthStoreOptions(cookies, true)),
          );
          expect(sdkSession).toBeUndefined();
          const request = sessionRequest({ ...unrelatedCookies, ...cookies });
          let routeReached = false;
          const response = yield* makeServerResponseMiddleware(
            loadAuthSession(request).pipe(
              Effect.map(() => {
                routeReached = true;
                return HttpServerResponse.empty();
              }),
            ),
            { applicationEnvironment: 'production' },
          ).pipe(
            Effect.provideService(RuntimeConfig, runtime),
            Effect.provideService(HttpServerRequest.HttpServerRequest, request),
          );
          const web = HttpServerResponse.toWeb(response);
          expect(web.status).toBe(401);
          expect(routeReached).toBe(false);
          expect(web.headers.get('cache-control')).toBe('no-store');
          const cleared = web.headers.getSetCookie();
          expect(
            cleared.map((cookie) => cookie.split('=', 1)[0]).toSorted(),
          ).toEqual(Object.keys(cookies).toSorted());
          for (const cookie of cleared) {
            expect(cookie).toContain('Max-Age=0');
            expect(cookie).toContain('HttpOnly');
            expect(cookie).toContain('Secure');
          }
          expect(yield* Effect.promise(() => web.text())).toContain(
            'Sign in again',
          );
          expect(fetch).not.toHaveBeenCalled();
        }),
    );
  }

  for (const cookies of [{}, unrelatedCookies]) {
    it.effect(
      `keeps ${Object.keys(cookies).length > 0 ? 'unrelated cookies' : 'absent cookies'} anonymous without clearing them`,
      () =>
        Effect.gen(function* () {
          const fetch = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValue(new Error('Network is forbidden in this test'));
          const runtime = yield* callbackRuntimeConfig;
          const session = yield* loadAuthSession(sessionRequest(cookies)).pipe(
            Effect.provideService(RuntimeConfig, runtime),
          );
          expect(session).toBeUndefined();
          expect(fetch).not.toHaveBeenCalled();
        }),
    );
  }

  for (const style of ['chunks', 'raw'] as const) {
    it.effect(
      `loads a real encrypted ${style} session with an expired unused access token and ignores unrelated prefix cookies`,
      () =>
        Effect.gen(function* () {
          const fetch = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValue(new Error('Network is forbidden in this test'));
          const runtime = yield* callbackRuntimeConfig;
          const options = clientOptions(true);
          const stateStore = options.stateStore;
          if (!stateStore) throw new Error('Expected an Auth0 state store');
          const storeOptions = createAuthStoreOptions(
            { ...unrelatedCookies },
            true,
          );
          const expiredTokenSession = sessionData(0);
          if (!expiredTokenSession.user)
            throw new Error('Expected a fixture user');
          const state: StateData = {
            ...storedStateData(),
            ...expiredTokenSession,
            user: {
              ...expiredTokenSession.user,
              syntheticPadding: 'x'.repeat(7000),
            },
          };
          yield* Effect.promise(() =>
            stateStore.set(
              AUTH_SESSION_COOKIE_IDENTIFIER,
              state,
              false,
              storeOptions,
            ),
          );
          for (const [name, value] of Object.entries(unrelatedCookies)) {
            expect(storeOptions.cookies[name]).toBe(value);
          }
          const chunks = Object.entries(storeOptions.cookies).filter(([name]) =>
            /^appSession\.\d+$/u.test(name),
          );
          expect(chunks.length).toBeGreaterThan(1);
          // Numeric names are emitted in ascending insertion order by the real SDK.
          const cookies =
            style === 'raw'
              ? { appSession: chunks.map(([, value]) => value).join('') }
              : Object.fromEntries(chunks);
          const request = sessionRequest({ ...unrelatedCookies, ...cookies });
          const session = yield* loadAuthSession(request).pipe(
            Effect.provideService(RuntimeConfig, runtime),
          );
          expect(isAuthenticated(session)).toBe(true);
          expect(session?.authData['sub']).toBe('auth0|test-user');
          expect(fetch).not.toHaveBeenCalled();
        }),
    );
  }

  it.effect(
    'preserves an unexpected profile access defect before request handling',
    () =>
      Effect.gen(function* () {
        const failure = new Error('unexpected profile access defect');
        const exit = yield* toAuthSession({
          ...sessionData(0),
          user: {
            get email() {
              throw failure;
            },
            sub: 'auth0|test-user',
          },
        }).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.hasDies(exit.cause)).toBe(true);
          expect(Cause.squash(exit.cause)).toBe(failure);
        }
      }),
  );

  it.effect(
    'preserves an unexpected SDK rejection as a defect even when a session cookie is present',
    () =>
      Effect.gen(function* () {
        const failure = new Error('unexpected SDK failure');
        vi.spyOn(ServerClient.prototype, 'getSession').mockRejectedValueOnce(
          failure,
        );
        const runtime = yield* callbackRuntimeConfig;
        const exit = yield* loadAuthSession(
          sessionRequest({ 'appSession.0': 'synthetic' }),
        ).pipe(Effect.provideService(RuntimeConfig, runtime), Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit))
          expect(Cause.squash(exit.cause)).toBe(failure);
      }),
  );
});
