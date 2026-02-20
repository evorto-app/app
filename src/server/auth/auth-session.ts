import {
  type CookieHandler,
  type CookieSerializeOptions,
  CookieTransactionStore,
  ServerClient,
  type SessionData,
  StatelessStateStore,
} from '@auth0/auth0-server-js';
import * as Headers from '@effect/platform/Headers';
import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import * as HttpServerResponse from '@effect/platform/HttpServerResponse';
import { Duration, Effect, Option } from 'effect';

import { getOidcEnvironment } from '../config/environment';

const SESSION_COOKIE_NAME = 'appSession';

const oidcEnvironment = getOidcEnvironment();
const auth0Domain = new URL(oidcEnvironment.ISSUER_BASE_URL).hostname;

export interface AuthSession {
  accessToken: string;
  authData: Record<string, unknown>;
  expiresAt: number;
  idToken?: string;
  refreshToken?: string;
}

interface AuthStoreOptions {
  cookies: Record<string, string>;
  mutations: CookieMutation[];
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

const getHeaderValue = (
  headers: Headers.Headers,
  key: string,
): string | undefined => Option.getOrUndefined(Headers.get(headers, key));

const normalizeOrigin = (value: string): string =>
  value.endsWith('/') ? value.slice(0, -1) : value;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const toRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null) {
    return;
  }

  return value as Record<string, unknown>;
};

const toCookieRecord = (
  cookies: Record<string, unknown>,
): Record<string, string> => {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(cookies)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    }
  }

  return normalized;
};

const sanitizeReturnPath = (
  value: null | string | undefined,
): string | undefined => {
  if (!value) {
    return;
  }

  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('://')
  ) {
    return;
  }

  return value;
};

const cookieHandler: CookieHandler<AuthStoreOptions> = {
  deleteCookie: (name, storeOptions, options) => {
    if (!storeOptions) {
      return;
    }

    const nextCookies = { ...storeOptions.cookies };
    Reflect.deleteProperty(nextCookies, name);
    storeOptions.cookies = nextCookies;
    storeOptions.mutations.push(
      options
        ? {
            name,
            options,
            type: 'delete',
          }
        : {
            name,
            type: 'delete',
          },
    );
  },
  getCookie: (name, storeOptions) => storeOptions?.cookies[name],
  getCookies: (storeOptions) => storeOptions?.cookies ?? {},
  setCookie: (name, value, options, storeOptions) => {
    if (!storeOptions) {
      return;
    }

    storeOptions.cookies[name] = value;
    storeOptions.mutations.push(
      options
        ? {
            name,
            options,
            type: 'set',
            value,
          }
        : {
            name,
            type: 'set',
            value,
          },
    );
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
): Effect.Effect<HttpServerResponse.HttpServerResponse> =>
  Effect.gen(function* () {
    let nextResponse = response;

    for (const mutation of mutations) {
      if (mutation.type === 'set') {
        nextResponse = yield* HttpServerResponse.setCookie(
          nextResponse,
          mutation.name,
          mutation.value,
          toSetCookieOptions(mutation.options),
        ).pipe(Effect.catchAll(() => Effect.succeed(nextResponse)));
        continue;
      }

      nextResponse = HttpServerResponse.expireCookie(
        nextResponse,
        mutation.name,
        toExpireCookieOptions(mutation.options),
      );
    }

    return nextResponse;
  });

const runPromiseOrUndefined = <T>(
  thunk: () => Promise<T>,
): Effect.Effect<T | undefined> =>
  Effect.promise(() =>
    thunk().catch(() => undefined as T | undefined),
  );

const createStoreOptions = (
  request: HttpServerRequest.HttpServerRequest,
): AuthStoreOptions => ({
  cookies: toCookieRecord(request.cookies as Record<string, unknown>),
  mutations: [],
});

const createAuth0Client = (
  request: HttpServerRequest.HttpServerRequest,
): ServerClient<AuthStoreOptions> => {
  const { isSecure, origin } = resolveRequestOrigin(request);
  const callbackUrl = new URL('/callback', origin).toString();
  const authorizationParameters = {
    ...(oidcEnvironment.AUDIENCE ? { audience: oidcEnvironment.AUDIENCE } : {}),
    redirect_uri: callbackUrl,
    scope: 'openid profile email',
  };

  return new ServerClient<AuthStoreOptions>({
    authorizationParams: authorizationParameters,
    clientId: oidcEnvironment.CLIENT_ID,
    clientSecret: oidcEnvironment.CLIENT_SECRET,
    domain: auth0Domain,
    stateStore: new StatelessStateStore<AuthStoreOptions>(
      {
        cookie: {
          name: SESSION_COOKIE_NAME,
          path: '/',
          sameSite: 'lax',
          secure: isSecure,
        },
        rolling: false,
        secret: oidcEnvironment.SECRET,
      },
      cookieHandler,
    ),
    transactionStore: new CookieTransactionStore<AuthStoreOptions>(
      {
        secret: oidcEnvironment.SECRET,
      },
      cookieHandler,
    ),
  });
};

const toAuthSession = (
  sessionData: SessionData | undefined,
): AuthSession | undefined => {
  if (!sessionData) {
    return;
  }

  const primaryTokenSet = sessionData.tokenSets[0];
  if (!primaryTokenSet) {
    return;
  }

  const authData = toRecord(sessionData.user) ?? {};

  return {
    accessToken: primaryTokenSet.accessToken,
    authData,
    expiresAt: primaryTokenSet.expiresAt * 1000,
    ...(sessionData.idToken ? { idToken: sessionData.idToken } : {}),
    ...(sessionData.refreshToken
      ? { refreshToken: sessionData.refreshToken }
      : {}),
  };
};

export const resolveRequestOrigin = (
  request: HttpServerRequest.HttpServerRequest,
): {
  isSecure: boolean;
  origin: string;
  protocol: string;
} => {
  if (oidcEnvironment.BASE_URL) {
    const origin = normalizeOrigin(oidcEnvironment.BASE_URL);
    return {
      isSecure: origin.startsWith('https://'),
      origin,
      protocol: origin.startsWith('https://') ? 'https' : 'http',
    };
  }

  const protocol =
    getHeaderValue(request.headers, 'x-forwarded-proto') ??
    getHeaderValue(request.headers, 'x-forwarded-protocol') ??
    'http';
  const host =
    getHeaderValue(request.headers, 'x-forwarded-host') ??
    getHeaderValue(request.headers, 'host') ??
    'localhost:4000';

  return {
    isSecure: protocol === 'https',
    origin: `${protocol}://${host}`,
    protocol,
  };
};

export const toAbsoluteRequestUrl = (
  request: HttpServerRequest.HttpServerRequest,
): URL => {
  const { origin } = resolveRequestOrigin(request);
  return new URL(request.url, origin);
};

export const getRequestAuthData = (
  authSession: AuthSession | undefined,
): Record<string, unknown> => authSession?.authData ?? {};

export const isAuthenticated = (
  authSession: AuthSession | undefined,
): boolean => authSession !== undefined;

export const loadAuthSession = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const storeOptions = createStoreOptions(request);
    const auth0Client = createAuth0Client(request);

    const sessionData = yield* runPromiseOrUndefined(() =>
      auth0Client.getSession(storeOptions),
    );

    const session = toAuthSession(sessionData);
    if (!session || session.expiresAt <= Date.now()) {
      return;
    }

    return session;
  });

export const handleLoginRequest = (
  request: HttpServerRequest.HttpServerRequest,
) =>
  Effect.gen(function* () {
    const requestUrl = toAbsoluteRequestUrl(request);
    const redirectUrl =
      sanitizeReturnPath(
        requestUrl.searchParams.get('redirectUrl') ??
          requestUrl.searchParams.get('returnTo'),
      ) ?? '/';

    const storeOptions = createStoreOptions(request);
    const auth0Client = createAuth0Client(request);

    const authorizationUrl = yield* runPromiseOrUndefined(() =>
      auth0Client.startInteractiveLogin(
        {
          appState: {
            redirectUrl,
          },
        },
        storeOptions,
      ),
    );

    if (!authorizationUrl) {
      return HttpServerResponse.text('Unable to start login.', { status: 500 });
    }

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

    const storeOptions = createStoreOptions(request);
    const auth0Client = createAuth0Client(request);

    const completedLogin = yield* runPromiseOrUndefined(() =>
      auth0Client.completeInteractiveLogin<LoginAppState>(
        requestUrl,
        storeOptions,
      ),
    );

    if (!completedLogin) {
      return HttpServerResponse.text('Unable to complete login.', {
        status: 400,
      });
    }

    const redirectUrl =
      sanitizeReturnPath(asString(completedLogin.appState?.redirectUrl)) ?? '/';

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
      sanitizeReturnPath(
        requestUrl.searchParams.get('redirectUrl') ??
          requestUrl.searchParams.get('returnTo'),
      ) ?? '/';

    const { isSecure, origin } = resolveRequestOrigin(request);
    const storeOptions = createStoreOptions(request);
    const auth0Client = createAuth0Client(request);

    const logoutUrl = yield* runPromiseOrUndefined(() =>
      auth0Client.logout(
        {
          returnTo: new URL(returnPath, origin).toString(),
        },
        storeOptions,
      ),
    );

    if (!logoutUrl) {
      const fallbackResponse = HttpServerResponse.expireCookie(
        HttpServerResponse.redirect(returnPath),
        SESSION_COOKIE_NAME,
        {
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: isSecure,
        },
      );

      return fallbackResponse;
    }

    const redirectResponse = HttpServerResponse.redirect(logoutUrl.toString());
    return yield* applyCookieMutations(
      redirectResponse,
      storeOptions.mutations,
    );
  });
