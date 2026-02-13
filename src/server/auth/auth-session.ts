import * as Headers from '@effect/platform/Headers';
import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import * as HttpServerResponse from '@effect/platform/HttpServerResponse';
import * as KeyValueStore from '@effect/platform/KeyValueStore';
import { AuthenticationClient, UserInfoClient } from 'auth0';
import { Duration, Effect, Option } from 'effect';

import { getOidcEnvironment } from '../config/environment';

const SESSION_COOKIE_NAME = 'appSession';
const SESSION_STORE_PREFIX = 'auth0:session:';
const TRANSACTION_STORE_PREFIX = 'auth0:transaction:';
const TRANSACTION_TTL_SECONDS = 10 * 60;
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60;

const oidcEnvironment = getOidcEnvironment();

export interface AuthSession {
  accessToken: string;
  authData: Record<string, unknown>;
  expiresAt: number;
  idToken?: string;
  refreshToken?: string;
}

interface AuthTransaction {
  codeVerifier: string;
  createdAt: number;
  redirectUrl: string;
}

const getHeaderValue = (
  headers: Headers.Headers,
  key: string,
): string | undefined => Option.getOrUndefined(Headers.get(headers, key));

const normalizeOrigin = (value: string): string =>
  value.endsWith('/') ? value.slice(0, -1) : value;

const toRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null) {
    return;
  }

  return value as Record<string, unknown>;
};

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const parseAuthSession = (value: string): AuthSession | undefined => {
  const parsed = toRecord(parseJson(value));
  if (!parsed) {
    return;
  }

  const accessToken = parsed['accessToken'];
  const authData = toRecord(parsed['authData']);
  const expiresAt = parsed['expiresAt'];

  if (
    typeof accessToken !== 'string' ||
    !authData ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt)
  ) {
    return;
  }

  const session: AuthSession = {
    accessToken,
    authData,
    expiresAt,
  };

  const idToken = parsed['idToken'];
  if (typeof idToken === 'string') {
    session.idToken = idToken;
  }

  const refreshToken = parsed['refreshToken'];
  if (typeof refreshToken === 'string') {
    session.refreshToken = refreshToken;
  }

  return session;
};

const parseAuthTransaction = (value: string): AuthTransaction | undefined => {
  const parsed = toRecord(parseJson(value));
  if (!parsed) {
    return;
  }

  const codeVerifier = parsed['codeVerifier'];
  const createdAt = parsed['createdAt'];
  const redirectUrl = parsed['redirectUrl'];

  if (
    typeof codeVerifier !== 'string' ||
    typeof redirectUrl !== 'string' ||
    typeof createdAt !== 'number' ||
    !Number.isFinite(createdAt)
  ) {
    return;
  }

  return {
    codeVerifier,
    createdAt,
    redirectUrl,
  };
};

const createRandomString = (length: number): string => {
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  return Buffer.from(randomBytes).toString('base64url');
};

const createCodeChallenge = (codeVerifier: string) =>
  Effect.tryPromise(async () => {
    const codeVerifierBytes = new TextEncoder().encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', codeVerifierBytes);
    return Buffer.from(digest).toString('base64url');
  });

const decodeJwtPayload = (token: string): Record<string, unknown> | undefined => {
  const parts = token.split('.');
  if (parts.length < 2) {
    return;
  }

  const payloadSegment = parts[1];
  if (!payloadSegment) {
    return;
  }

  try {
    const payload = Buffer.from(payloadSegment, 'base64url').toString('utf8');
    return toRecord(JSON.parse(payload));
  } catch {
    return;
  }
};

const getSessionStore = (store: KeyValueStore.KeyValueStore) =>
  KeyValueStore.prefix(store, SESSION_STORE_PREFIX);

const getTransactionStore = (store: KeyValueStore.KeyValueStore) =>
  KeyValueStore.prefix(store, TRANSACTION_STORE_PREFIX);

const resolveSessionTtlSeconds = (expiresInSeconds: number | undefined): number => {
  if (
    typeof expiresInSeconds === 'number' &&
    Number.isFinite(expiresInSeconds) &&
    expiresInSeconds > 0
  ) {
    return Math.floor(expiresInSeconds);
  }

  return DEFAULT_SESSION_TTL_SECONDS;
};

const buildSessionCookieOptions = (isSecure: boolean, sessionTtlSeconds: number) => ({
  httpOnly: true,
  maxAge: Duration.seconds(sessionTtlSeconds),
  path: '/',
  sameSite: 'lax' as const,
  secure: isSecure,
});

const sanitizeReturnPath = (
  value: null | string,
): string | undefined => {
  if (!value) {
    return;
  }

  if (!value.startsWith('/') || value.startsWith('//') || value.includes('://')) {
    return;
  }

  return value;
};

const getAuthClients = () => {
  const issuerBaseUrl = new URL(oidcEnvironment.ISSUER_BASE_URL);
  const domain = issuerBaseUrl.hostname;

  return {
    authClient: new AuthenticationClient({
      clientId: oidcEnvironment.CLIENT_ID,
      clientSecret: oidcEnvironment.CLIENT_SECRET,
      domain,
    }),
    userInfoClient: new UserInfoClient({
      domain,
    }),
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

export const isAuthenticated = (authSession: AuthSession | undefined): boolean =>
  authSession !== undefined;

export const loadAuthSession = (
  request: HttpServerRequest.HttpServerRequest,
) =>
  Effect.gen(function* () {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionId) {
      return;
    }

    const store = yield* KeyValueStore.KeyValueStore;
    const sessions = getSessionStore(store);
    const sessionJson = yield* sessions.get(sessionId);

    if (Option.isNone(sessionJson)) {
      return;
    }

    const session = parseAuthSession(sessionJson.value);
    if (!session) {
      yield* sessions.remove(sessionId);
      return;
    }

    if (session.expiresAt <= Date.now()) {
      yield* sessions.remove(sessionId);
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

    const state = createRandomString(16);
    const codeVerifier = createRandomString(32);
    const codeChallenge = yield* createCodeChallenge(codeVerifier).pipe(
      Effect.catchAll(() => Effect.succeed(createRandomString(32))),
    );

    const transaction: AuthTransaction = {
      codeVerifier,
      createdAt: Date.now(),
      redirectUrl,
    };

    const store = yield* KeyValueStore.KeyValueStore;
    const transactions = getTransactionStore(store);
    yield* transactions.set(state, JSON.stringify(transaction));

    const { origin } = resolveRequestOrigin(request);
    const callbackUrl = new URL('/callback', origin).toString();
    const authorizationUrl = new URL('/authorize', oidcEnvironment.ISSUER_BASE_URL);

    authorizationUrl.searchParams.set('client_id', oidcEnvironment.CLIENT_ID);
    authorizationUrl.searchParams.set('code_challenge', codeChallenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    authorizationUrl.searchParams.set('redirect_uri', callbackUrl);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', 'openid profile email');
    authorizationUrl.searchParams.set('state', state);

    if (oidcEnvironment.AUDIENCE) {
      authorizationUrl.searchParams.set('audience', oidcEnvironment.AUDIENCE);
    }

    return HttpServerResponse.redirect(authorizationUrl.toString());
  });

export const handleCallbackRequest = (
  request: HttpServerRequest.HttpServerRequest,
) =>
  Effect.gen(function* () {
    const requestUrl = toAbsoluteRequestUrl(request);
    const code = requestUrl.searchParams.get('code');
    const state = requestUrl.searchParams.get('state');

    if (!code || !state) {
      return HttpServerResponse.text('Missing code or state.', { status: 400 });
    }

    const store = yield* KeyValueStore.KeyValueStore;
    const transactions = getTransactionStore(store);
    const transactionJson = yield* transactions.get(state);

    if (Option.isNone(transactionJson)) {
      return HttpServerResponse.text('Invalid state.', { status: 400 });
    }

    const transaction = parseAuthTransaction(transactionJson.value);
    if (!transaction) {
      yield* transactions.remove(state);
      return HttpServerResponse.text('Invalid state.', { status: 400 });
    }

    if (Date.now() - transaction.createdAt > TRANSACTION_TTL_SECONDS * 1000) {
      yield* transactions.remove(state);
      return HttpServerResponse.text('State expired.', { status: 400 });
    }

    yield* transactions.remove(state);

    const { authClient, userInfoClient } = getAuthClients();
    const { isSecure, origin } = resolveRequestOrigin(request);
    const callbackUrl = new URL('/callback', origin).toString();

    const tokenResponse = yield* Effect.tryPromise(() =>
      authClient.oauth.authorizationCodeGrantWithPKCE({
        audience: oidcEnvironment.AUDIENCE,
        code,
        code_verifier: transaction.codeVerifier,
        redirect_uri: callbackUrl,
      }),
    ).pipe(
      Effect.catchAll(() =>
        Effect.succeed({
          data: {
            access_token: undefined,
            expires_in: undefined,
            id_token: undefined,
            refresh_token: undefined,
          },
        }),
      ),
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      return HttpServerResponse.text('Missing access token.', { status: 400 });
    }

    const userInfoResponse = yield* Effect.tryPromise(() =>
      userInfoClient.getUserInfo(accessToken),
    ).pipe(
      Effect.catchAll(() => Effect.succeed({ data: {} })),
    );

    const authDataFromUserInfo = toRecord(userInfoResponse.data) ?? {};
    const idTokenClaims =
      typeof tokenResponse.data.id_token === 'string'
        ? decodeJwtPayload(tokenResponse.data.id_token)
        : undefined;
    const authData: Record<string, unknown> = idTokenClaims
      ? {
          ...authDataFromUserInfo,
          ...idTokenClaims,
        }
      : authDataFromUserInfo;

    const sessionTtlSeconds = resolveSessionTtlSeconds(tokenResponse.data.expires_in);
    const session: AuthSession = {
      accessToken,
      authData,
      expiresAt: Date.now() + sessionTtlSeconds * 1000,
      ...(tokenResponse.data.id_token
        ? { idToken: tokenResponse.data.id_token }
        : {}),
      ...(tokenResponse.data.refresh_token
        ? { refreshToken: tokenResponse.data.refresh_token }
        : {}),
    };

    const sessionId = createRandomString(32);
    const sessions = getSessionStore(store);
    yield* sessions.set(sessionId, JSON.stringify(session));

    const redirectResponse = HttpServerResponse.redirect(transaction.redirectUrl);

    return yield* HttpServerResponse.setCookie(
      redirectResponse,
      SESSION_COOKIE_NAME,
      sessionId,
      buildSessionCookieOptions(isSecure, sessionTtlSeconds),
    ).pipe(
      Effect.catchAll(() => Effect.succeed(redirectResponse)),
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

    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (sessionId) {
      const store = yield* KeyValueStore.KeyValueStore;
      const sessions = getSessionStore(store);
      yield* sessions.remove(sessionId);
    }

    const { isSecure, origin } = resolveRequestOrigin(request);
    const logoutUrl = new URL('/v2/logout', oidcEnvironment.ISSUER_BASE_URL);
    logoutUrl.searchParams.set('client_id', oidcEnvironment.CLIENT_ID);
    logoutUrl.searchParams.set('returnTo', new URL(returnPath, origin).toString());

    const response = HttpServerResponse.redirect(logoutUrl.toString());
    return HttpServerResponse.expireCookie(response, SESSION_COOKIE_NAME, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: isSecure,
    });
  });
