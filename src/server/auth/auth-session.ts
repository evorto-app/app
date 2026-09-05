import {
  type CookieHandler,
  type CookieSerializeOptions,
  CookieTransactionStore,
  MissingTransactionError,
  ServerClient,
  type ServerClientOptions,
  StatelessStateStore,
} from '@auth0/auth0-server-js';
import { Duration, Effect, Option, Redacted, Schema } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/unstable/http/HttpServerResponse';

import { sanitizeRelativeRedirectPath } from '../../shared/auth-redirect';
import { UsersAuthData } from '../../shared/rpc-contracts/app-rpcs/users.rpcs';
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

export class InvalidAuthSessionError extends Schema.TaggedErrorClass<InvalidAuthSessionError>()(
  'InvalidAuthSessionError',
  {
    message: Schema.String,
    reason: Schema.Literals([
      'missing-primary-token-set',
      'missing-subject',
      'missing-user',
      'unusable-session-cookie',
    ]),
  },
) {}

// Auth0's server SDK manages encrypted session and transaction cookies via
// pluggable stores. We bridge those mutations back into Effect Platform
// responses so the rest of the server stays framework-agnostic.
// Reference: https://github.com/auth0/auth0-auth-js/tree/main/packages/auth0-server-js
const getHeaderValue = (headers: Headers.Headers, key: string) =>
  Option.getOrUndefined(Headers.get(headers, key));

const asString = (value: unknown) =>
  typeof value === 'string' ? value : undefined;

const toRecord = (value: unknown) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
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

const isAuthSessionCookieName = (name: string) => {
  const chunkPrefix = `${AUTH_SESSION_COOKIE_IDENTIFIER}.`;
  return (
    name === AUTH_SESSION_COOKIE_IDENTIFIER ||
    (name.startsWith(chunkPrefix) &&
      /^\d+$/u.test(name.slice(chunkPrefix.length)))
  );
};

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
  // The SDK matches any identifier prefix. Restrict session enumeration to
  // owned raw/numeric chunk names so unrelated prefix cookies cannot corrupt it.
  getCookies: (storeOptions) =>
    Object.fromEntries(
      Object.entries(storeOptions?.cookies ?? {}).filter(([name]) =>
        isAuthSessionCookieName(name),
      ),
    ),
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

const invalidAuthSession = (
  reason: InvalidAuthSessionError['reason'],
  message: string,
) => new InvalidAuthSessionError({ message, reason });

const isPrimaryTokenSet = Schema.is(
  Schema.Struct({
    accessToken: Schema.NonEmptyString,
    audience: Schema.String,
    expiresAt: Schema.Finite,
    scope: Schema.optional(Schema.String),
  }),
);

export const decodeAuthSessionProfile = (authData: Record<string, unknown>) =>
  Schema.decodeUnknownEffect(UsersAuthData)(authData).pipe(
    Effect.mapError(() =>
      invalidAuthSession(
        'unusable-session-cookie',
        'Auth0 session profile claims do not match the application contract',
      ),
    ),
  );

export const toAuthSession = (
  sessionData: unknown,
): Effect.Effect<AuthSession | undefined, InvalidAuthSessionError> => {
  if (sessionData === undefined) {
    return Effect.succeed(undefined);
  }

  const session = toRecord(sessionData);
  const tokenSets = session?.['tokenSets'];
  const primaryTokenSet: unknown = Array.isArray(tokenSets)
    ? tokenSets[0]
    : undefined;
  if (!isPrimaryTokenSet(primaryTokenSet)) {
    return Effect.fail(
      invalidAuthSession(
        'missing-primary-token-set',
        'Auth0 returned a session without a valid primary token set',
      ),
    );
  }

  const authData = toRecord(session?.['user']);
  if (!authData) {
    return Effect.fail(
      invalidAuthSession(
        'missing-user',
        'Auth0 returned a session without user data',
      ),
    );
  }

  const subject = asString(authData['sub']);
  if (!subject?.trim()) {
    return Effect.fail(
      invalidAuthSession(
        'missing-subject',
        'Auth0 returned a session without a user subject',
      ),
    );
  }

  // Validate before SSR or RPC handling, while retaining custom claims for
  // server-side authority resolution rather than serializing them to clients.
  return decodeAuthSessionProfile(authData).pipe(Effect.as({ authData }));
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

export const invalidAuthSessionRecoveryResponse = Effect.fn(
  'invalidAuthSessionRecoveryResponse',
)(function* (
  request: HttpServerRequest.HttpServerRequest,
  applicationEnvironment: Parameters<
    typeof shouldSecureAuthCookies
  >[0] = 'production',
) {
  const storeOptions = createAuthStoreOptions(
    toCookieRecord(request.cookies),
    shouldSecureAuthCookies(
      applicationEnvironment,
      resolveRequestOrigin(request).isSecure,
    ),
  );
  for (const name of Object.keys(storeOptions.cookies)) {
    if (isAuthSessionCookieName(name)) {
      cookieHandler.deleteCookie(name, storeOptions);
    }
  }

  const headers = { 'Cache-Control': 'no-store' };
  const response = request.headers['accept']?.includes('text/html')
    ? HttpServerResponse.text(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign in again</title></head><body><main><h1>Sign in again</h1><p>Your sign-in session is no longer valid.</p><p><a href="/login">Sign in again to continue</a></p></main></body></html>',
        { contentType: 'text/html', headers, status: 401 },
      )
    : HttpServerResponse.jsonUnsafe(
        {
          error: 'Unauthorized',
          message:
            'Your sign-in session is no longer valid. Sign in again to continue.',
        },
        { headers, status: 401 },
      );
  return yield* applyCookieMutations(response, storeOptions.mutations).pipe(
    Effect.orDie,
  );
});

export const loadAuthSession = Effect.fn('Server.loadAuthSession')(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const { auth0Client, storeOptions } =
    yield* createAuth0RequestRuntime(request);

  // Capture presence before the SDK can remove expired cookie state.
  const hasSessionCookie = Object.keys(storeOptions.cookies).some((name) =>
    isAuthSessionCookieName(name),
  );
  const sessionData = yield* runAuth0SdkOperation('loadAuthSession', () =>
    auth0Client.getSession(storeOptions),
  );
  if (sessionData === undefined && hasSessionCookie) {
    return yield* invalidAuthSession(
      'unusable-session-cookie',
      'Auth0 could not load the supplied application session cookie',
    );
  }

  // The SDK has already validated the encrypted application session here.
  // OAuth access-token expiry is independent of that session lifetime; use
  // ServerClient.getAccessToken() if a downstream integration needs a token.
  return yield* toAuthSession(sessionData);
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

const callbackRecoveryResponse = () =>
  HttpServerResponse.text(
    'Sign-in could not be completed. Return to Evorto and try again.',
    { headers: { 'Cache-Control': 'no-store' }, status: 400 },
  );

export const handleCallbackRequest = (
  request: HttpServerRequest.HttpServerRequest,
) =>
  Effect.gen(function* () {
    const requestUrl = toAbsoluteRequestUrl(request);

    if (!requestUrl.searchParams.get('code')) {
      return callbackRecoveryResponse();
    }

    const { auth0Client, storeOptions } =
      yield* createAuth0RequestRuntime(request);

    const completedLogin = yield* runAuth0SdkOperation(
      'handleCallbackRequest',
      async () => {
        try {
          return Option.some(
            await auth0Client.completeInteractiveLogin<LoginAppState>(
              requestUrl,
              storeOptions,
            ),
          );
        } catch (error) {
          if (error instanceof MissingTransactionError) return Option.none();
          throw error;
        }
      },
    );
    if (Option.isNone(completedLogin)) return callbackRecoveryResponse();

    const redirectUrl =
      sanitizeRelativeRedirectPath(
        asString(completedLogin.value.appState?.redirectUrl),
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
