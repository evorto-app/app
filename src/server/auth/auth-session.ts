import {
  type CookieHandler,
  type CookieSerializeOptions,
  CookieTransactionStore,
  ServerClient,
  type ServerClientOptions,
  type SessionData,
  StatelessStateStore,
} from '@auth0/auth0-server-js';
import { Duration, Effect, Option, Redacted } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/unstable/http/HttpServerResponse';

import { sanitizeRelativeRedirectPath } from '../../shared/auth-redirect';
import { RuntimeConfig } from '../config/runtime-config';

export const AUTH_SESSION_COOKIE_IDENTIFIER = 'appSession';
export const AUTH_TRANSACTION_COOKIE_IDENTIFIER = 'appTransaction';

export interface AuthSession {
  authData: Record<string, unknown>;
}

export interface AuthStoreOptions {
  cookies: Record<string, string>;
  mutations: CookieMutation[];
  secureCookies: boolean;
}

type CookieMutation = CookieMutationDelete | CookieMutationSet;

interface CookieMutationDelete {
  name: string;
  options?: CookieSerializeOptions;
  type: 'delete';
}

interface CookieMutationSet {
  name: string;
  options?: CookieSerializeOptions;
  type: 'set';
  value: string;
}

interface LoginAppState {
  redirectUrl: string;
}

// Auth0's server SDK manages encrypted session and transaction cookies via
// pluggable stores. We bridge those mutations back into Effect Platform
// responses so the rest of the server stays framework-agnostic.
// Reference: https://github.com/auth0/auth0-auth-js/tree/main/packages/auth0-server-js
const getHeaderValue = (headers: Headers.Headers, key: string) =>
  Option.getOrUndefined(Headers.get(headers, key));

const asString = (value: unknown) =>
  typeof value === 'string' ? value : undefined;

const toRecord = (value: unknown) => {
  if (typeof value !== 'object' || value === null) {
    return;
  }

  return value as Record<string, unknown>;
};

const toCookieRecord = (cookies: Record<string, unknown>) => {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(cookies)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    }
  }

  return normalized;
};

const authCookieOptions = (
  storeOptions: AuthStoreOptions,
  options?: CookieSerializeOptions,
): CookieSerializeOptions => ({
  ...options,
  httpOnly: true,
  path: '/',
  sameSite: 'lax',
  secure: storeOptions.secureCookies || options?.secure === true,
});

const cookieHandler: CookieHandler<AuthStoreOptions> = {
  deleteCookie: (name, storeOptions, options) => {
    if (!storeOptions) {
      return;
    }

    const cookieOptions = authCookieOptions(storeOptions, options);
    const nextCookies = { ...storeOptions.cookies };
    Reflect.deleteProperty(nextCookies, name);
    storeOptions.cookies = nextCookies;
    storeOptions.mutations.push({
      name,
      options: cookieOptions,
      type: 'delete',
    });
  },
  getCookie: (name, storeOptions) => storeOptions?.cookies[name],
  getCookies: (storeOptions) => storeOptions?.cookies ?? {},
  setCookie: (name, value, options, storeOptions) => {
    if (!storeOptions) {
      return;
    }

    const cookieOptions = authCookieOptions(storeOptions, options);
    storeOptions.cookies[name] = value;
    storeOptions.mutations.push({
      name,
      options: cookieOptions,
      type: 'set',
      value,
    });
  },
};

const toSetCookieOptions = (options?: CookieSerializeOptions) => ({
  domain: options?.domain,
  expires: options?.expires,
  httpOnly: options?.httpOnly,
  maxAge:
    typeof options?.maxAge === 'number'
      ? Duration.seconds(options.maxAge)
      : undefined,
  path: options?.path,
  sameSite: options?.sameSite,
  secure: options?.secure,
});

const toExpireCookieOptions = (options?: CookieSerializeOptions) => ({
  domain: options?.domain,
  httpOnly: options?.httpOnly,
  path: options?.path,
  sameSite: options?.sameSite,
  secure: options?.secure,
});

const applyCookieMutations = (
  response: HttpServerResponse.HttpServerResponse,
  mutations: readonly CookieMutation[],
) =>
  Effect.gen(function* () {
    let nextResponse = response;

    for (const mutation of mutations) {
      if (mutation.type === 'set') {
        nextResponse = yield* HttpServerResponse.setCookie(
          nextResponse,
          mutation.name,
          mutation.value,
          toSetCookieOptions(mutation.options),
        );
        continue;
      }

      nextResponse = yield* HttpServerResponse.expireCookie(
        nextResponse,
        mutation.name,
        toExpireCookieOptions(mutation.options),
      );
    }

    return nextResponse;
  });

export const runAuth0SdkOperation = <T>(
  operation: string,
  thunk: () => Promise<T>,
) =>
  Effect.tryPromise({
    catch: (cause) => cause,
    try: thunk,
  }).pipe(
    Effect.catch((error) =>
      Effect.logError(`Auth0 SDK failure during ${operation}`).pipe(
        Effect.annotateLogs({ error }),
        Effect.andThen(Effect.die(error)),
      ),
    ),
  );

export const createAuthStoreOptions = (
  cookies: Record<string, string>,
  secureCookies: boolean,
): AuthStoreOptions => ({
  cookies: { ...cookies },
  mutations: [],
  secureCookies,
});

export const shouldSecureAuthCookies = (
  applicationEnvironment: 'local' | 'production' | 'staging',
  requestIsSecure: boolean,
) => applicationEnvironment !== 'local' || requestIsSecure;

interface Auth0ServerClientOptionsInput {
  audience: Option.Option<string>;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  issuerBaseUrl: string;
  secret: string;
  secureCookies: boolean;
}

export const createAuth0ServerClientOptions = ({
  audience,
  baseUrl,
  clientId,
  clientSecret,
  issuerBaseUrl,
  secret,
  secureCookies,
}: Auth0ServerClientOptionsInput): ServerClientOptions<AuthStoreOptions> => ({
  authorizationParams: {
    ...Option.match(audience, {
      onNone: () => ({}),
      onSome: (configuredAudience) => ({
        audience: configuredAudience,
      }),
    }),
    redirect_uri: new URL('/callback', baseUrl).href,
    scope: 'openid profile email',
  },
  clientId,
  clientSecret,
  domain: new URL(issuerBaseUrl).hostname,
  stateIdentifier: AUTH_SESSION_COOKIE_IDENTIFIER,
  // StatelessStateStore keeps session state in encrypted cookies.
  stateStore: new StatelessStateStore<AuthStoreOptions>(
    {
      cookie: {
        path: '/',
        sameSite: 'lax',
        secure: secureCookies,
      },
      rolling: false,
      secret,
    },
    cookieHandler,
  ),
  transactionIdentifier: AUTH_TRANSACTION_COOKIE_IDENTIFIER,
  // CookieTransactionStore tracks in-flight OIDC login transactions.
  transactionStore: new CookieTransactionStore<AuthStoreOptions>(
    {
      secret,
    },
    cookieHandler,
  ),
});

const createAuth0RequestRuntime = (
  request: HttpServerRequest.HttpServerRequest,
) =>
  Effect.gen(function* () {
    const { auth, deployment } = yield* RuntimeConfig;
    const { isSecure: requestIsSecure } = resolveRequestOrigin(request);
    const secureCookies = shouldSecureAuthCookies(
      deployment.APP_ENVIRONMENT,
      requestIsSecure,
    );
    const storeOptions = createAuthStoreOptions(
      toCookieRecord(request.cookies as Record<string, unknown>),
      secureCookies,
    );
    const auth0Client = new ServerClient<AuthStoreOptions>(
      createAuth0ServerClientOptions({
        audience: auth.AUDIENCE,
        baseUrl: auth.BASE_URL,
        clientId: auth.CLIENT_ID,
        clientSecret: Redacted.value(auth.CLIENT_SECRET),
        issuerBaseUrl: auth.ISSUER_BASE_URL,
        secret: Redacted.value(auth.SECRET),
        secureCookies,
      }),
    );

    return {
      auth0Client,
      baseUrl: auth.BASE_URL,
      storeOptions,
    };
  });

export const toAuthSession = (sessionData: SessionData | undefined) => {
  if (!sessionData) {
    return;
  }

  const primaryTokenSet = sessionData.tokenSets[0];
  if (!primaryTokenSet) {
    return;
  }

  const authData = toRecord(sessionData.user);
  if (!authData || !asString(authData['sub'])) {
    return;
  }

  return {
    authData,
  };
};

export const resolveRequestOrigin = (
  request: HttpServerRequest.HttpServerRequest,
) => {
  const protocol = getHeaderValue(request.headers, 'x-forwarded-proto');
  if (protocol !== 'http' && protocol !== 'https') {
    throw new Error('Normalized request protocol is missing or invalid');
  }

  const host = getHeaderValue(request.headers, 'host');
  if (!host) {
    throw new Error('Normalized request Host is missing');
  }

  const origin = new URL(`${protocol}://${host}`).origin;

  return {
    isSecure: protocol === 'https',
    origin,
    protocol,
  };
};

export const toAbsoluteRequestUrl = (
  request: HttpServerRequest.HttpServerRequest,
) => {
  const { origin } = resolveRequestOrigin(request);
  return new URL(request.url, origin);
};

export const getRequestAuthData = (authSession: AuthSession | undefined) =>
  authSession?.authData ?? {};

export const isAuthenticated = (authSession: AuthSession | undefined) =>
  authSession !== undefined;

export const loadAuthSession = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { auth0Client, storeOptions } =
      yield* createAuth0RequestRuntime(request);

    const sessionData = yield* runAuth0SdkOperation('loadAuthSession', () =>
      auth0Client.getSession(storeOptions),
    );

    // The SDK has already validated the encrypted application session here.
    // OAuth access-token expiry is independent of that session lifetime; use
    // ServerClient.getAccessToken() if a downstream integration needs a token.
    return toAuthSession(sessionData);
  });

export const handleLoginRequest = (
  request: HttpServerRequest.HttpServerRequest,
) =>
  Effect.gen(function* () {
    const requestUrl = toAbsoluteRequestUrl(request);
    const redirectUrl =
      sanitizeRelativeRedirectPath(
        requestUrl.searchParams.get('redirectUrl') ??
          requestUrl.searchParams.get('returnTo'),
      ) ?? '/';

    const { auth0Client, storeOptions } =
      yield* createAuth0RequestRuntime(request);

    const authorizationUrl = yield* runAuth0SdkOperation(
      'handleLoginRequest',
      () =>
        auth0Client.startInteractiveLogin(
          {
            appState: {
              redirectUrl,
            },
          },
          storeOptions,
        ),
    );

    const redirectResponse = HttpServerResponse.redirect(
      authorizationUrl.toString(),
    );
    return yield* applyCookieMutations(
      redirectResponse,
      storeOptions.mutations,
    );
  });

export const handleCallbackRequest = (
  request: HttpServerRequest.HttpServerRequest,
) =>
  Effect.gen(function* () {
    const requestUrl = toAbsoluteRequestUrl(request);

    if (!requestUrl.searchParams.get('code')) {
      return HttpServerResponse.text('Missing code.', { status: 400 });
    }

    const { auth0Client, storeOptions } =
      yield* createAuth0RequestRuntime(request);

    const completedLogin = yield* runAuth0SdkOperation(
      'handleCallbackRequest',
      () =>
        auth0Client.completeInteractiveLogin<LoginAppState>(
          requestUrl,
          storeOptions,
        ),
    );

    const redirectUrl =
      sanitizeRelativeRedirectPath(
        asString(completedLogin.appState?.redirectUrl),
      ) ?? '/';

    const redirectResponse = HttpServerResponse.redirect(redirectUrl);
    return yield* applyCookieMutations(
      redirectResponse,
      storeOptions.mutations,
    );
  });

export const handleLogoutRequest = (
  request: HttpServerRequest.HttpServerRequest,
) =>
  Effect.gen(function* () {
    const requestUrl = toAbsoluteRequestUrl(request);
    const returnPath =
      sanitizeRelativeRedirectPath(
        requestUrl.searchParams.get('redirectUrl') ??
          requestUrl.searchParams.get('returnTo'),
      ) ?? '/';

    const { auth0Client, baseUrl, storeOptions } =
      yield* createAuth0RequestRuntime(request);

    const logoutUrl = yield* runAuth0SdkOperation('handleLogoutRequest', () =>
      auth0Client.logout(
        {
          returnTo: new URL(returnPath, baseUrl).href,
        },
        storeOptions,
      ),
    );

    const redirectResponse = HttpServerResponse.redirect(logoutUrl.toString());
    return yield* applyCookieMutations(
      redirectResponse,
      storeOptions.mutations,
    );
  });
