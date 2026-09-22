import { describe, expect, it } from '@effect/vitest';
import { Cause, Effect, Exit, Layer } from 'effect';
import {
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';

import type { DeploymentConfig } from '../config/deployment-config';

import { runAuth0SdkOperation, toAuthSession } from '../auth/auth-session';
import { makeServerResponseMiddleware } from './server-response.middleware';

const makeTestHandler = Effect.fn('makeTestHandler')(function* (
  routeLayer: Layer.Layer<
    never,
    never,
    HttpRouter.HttpRouter | HttpRouter.Request<'Error', unknown>
  >,
  applicationEnvironment: DeploymentConfig['APP_ENVIRONMENT'] = 'local',
) {
  const responseMiddlewareLayer = HttpRouter.middleware<{
    handles: unknown;
  }>()(
    (effect) =>
      makeServerResponseMiddleware(effect, { applicationEnvironment }),
    { global: true },
  );
  const webHandler = HttpRouter.toWebHandler(
    Layer.mergeAll(routeLayer, responseMiddlewareLayer),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(webHandler.dispose));
  return { handler: webHandler.handler };
});

describe('server response middleware', () => {
  const invalidSessions: readonly unknown[] = [
    null,
    false,
    'invalid-session',
    [],
    {},
    { user: { sub: 'fixture-user' } },
    { tokenSets: null, user: { sub: 'fixture-user' } },
    { tokenSets: 'invalid', user: { sub: 'fixture-user' } },
    { tokenSets: { 0: {} }, user: { sub: 'fixture-user' } },
    { tokenSets: [null], user: { sub: 'fixture-user' } },
    { tokenSets: [[]], user: { sub: 'fixture-user' } },
    { tokenSets: ['invalid'], user: { sub: 'fixture-user' } },
    { tokenSets: [{}], user: { sub: 'fixture-user' } },
    {
      tokenSets: [{ accessToken: '', audience: 'default', expiresAt: 0 }],
      user: { sub: 'fixture-user' },
    },
    {
      tokenSets: [
        { accessToken: 'fixture', audience: 'default', expiresAt: '0' },
      ],
      user: { sub: 'fixture-user' },
    },
    {
      tokenSets: [
        { accessToken: 'fixture', audience: 'default', expiresAt: NaN },
      ],
      user: { sub: 'fixture-user' },
    },
    {
      tokenSets: [
        {
          accessToken: 'fixture',
          audience: 'default',
          expiresAt: 0,
          scope: [],
        },
      ],
      user: { sub: 'fixture-user' },
    },
    {
      idToken: 'fixture-id-token',
      refreshToken: undefined,
      tokenSets: [],
      user: { sub: 'fixture-user' },
    },
    {
      idToken: 'fixture-id-token',
      refreshToken: undefined,
      tokenSets: [
        {
          accessToken: 'fixture-token',
          audience: 'default',
          expiresAt: 0,
          scope: 'openid',
        },
      ],
      user: undefined,
    },
    {
      idToken: 'fixture-id-token',
      refreshToken: undefined,
      tokenSets: [
        {
          accessToken: 'fixture-token',
          audience: 'default',
          expiresAt: 0,
          scope: 'openid',
        },
      ],
      user: { sub: '' },
    },
  ];

  for (const { applicationEnvironment, secure, url } of [
    {
      applicationEnvironment: 'local',
      secure: false,
      url: 'http://localhost/events',
    },
    {
      applicationEnvironment: 'local',
      secure: true,
      url: 'https://localhost/events',
    },
    {
      applicationEnvironment: 'staging',
      secure: true,
      url: 'http://app.example/events',
    },
    {
      applicationEnvironment: 'production',
      secure: true,
      url: 'http://app.example/events',
    },
  ] as const) {
    it.effect(
      `recovers invalid HTML sessions with owned cookie cleanup for ${applicationEnvironment} ${url}`,
      () =>
        Effect.gen(function* () {
          for (const session of invalidSessions) {
            let requestHandlingReached = false;
            const { handler } = yield* makeTestHandler(
              HttpRouter.add(
                'GET',
                '/events',
                toAuthSession(session).pipe(
                  Effect.map(() => {
                    requestHandlingReached = true;
                    return HttpServerResponse.empty();
                  }),
                ),
              ),
              applicationEnvironment,
            );
            const response = yield* Effect.promise(() =>
              handler(
                new Request(url, {
                  headers: {
                    accept: 'text/html',
                    cookie:
                      'appSession=unusable; appSession.0=first-fragment; appSession.1=second-fragment; appSession.preference=keep; appTransaction=keep-transaction; unrelated=keep',
                    'x-forwarded-proto': new URL(url).protocol.slice(0, -1),
                  },
                }),
              ),
            );
            expect(response.status).toBe(401);
            expect(requestHandlingReached).toBe(false);
            expect(response.headers.get('cache-control')).toBe('no-store');
            expect(response.headers.get('location')).toBeNull();
            expect(response.headers.get('x-content-type-options')).toBe(
              'nosniff',
            );
            const html = yield* Effect.promise(() => response.text());
            expect(html).toContain('Your sign-in session is no longer valid.');
            expect(html).toContain('href="/login"');
            expect(html).not.toContain('fixture-token');
            expect(html).not.toContain('missing-');
            const cookies = response.headers.getSetCookie();
            expect(
              cookies.map((cookie) => cookie.split('=', 1)[0]).toSorted(),
            ).toEqual(['appSession', 'appSession.0', 'appSession.1']);
            for (const cookie of cookies) {
              expect(cookie).toContain('Max-Age=0');
              expect(cookie).toContain('Path=/');
              expect(cookie).toContain('HttpOnly');
              expect(cookie).toContain('SameSite=Lax');
              expect(cookie.includes('; Secure')).toBe(secure);
              expect(cookie).not.toContain('fragment');
              expect(cookie).not.toContain('unusable');
            }
          }
        }),
    );
  }

  it.effect(
    'returns a non-cacheable JSON sign-in instruction for an invalid RPC session',
    () =>
      Effect.gen(function* () {
        const session = invalidSessions[0];
        if (session === undefined)
          throw new Error('Expected invalid session fixture');
        const { handler } = yield* makeTestHandler(
          HttpRouter.add(
            'POST',
            '/rpc',
            toAuthSession(session).pipe(Effect.as(HttpServerResponse.empty())),
          ),
        );
        const response = yield* Effect.promise(() =>
          handler(
            new Request('http://localhost/rpc', {
              headers: {
                'content-type': 'application/json',
                cookie: 'appSession.0=unusable',
              },
              method: 'POST',
            }),
          ),
        );
        expect(response.status).toBe(401);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('location')).toBeNull();
        expect(yield* Effect.promise(() => response.json())).toEqual({
          error: 'Unauthorized',
          message:
            'Your sign-in session is no longer valid. Sign in again to continue.',
        });
        expect(response.headers.getSetCookie()).toHaveLength(1);
        expect(response.headers.getSetCookie()[0]).toContain('appSession.0=;');
      }),
  );

  it.effect(
    'keeps an unexpected SDK failure on the generic defect path without clearing session cookies',
    () =>
      Effect.gen(function* () {
        const { handler } = yield* makeTestHandler(
          HttpRouter.add(
            'GET',
            '/sdk-failure',
            runAuth0SdkOperation('session-fixture', () =>
              Promise.reject(new Error('private SDK failure')),
            ).pipe(Effect.as(HttpServerResponse.empty())),
          ),
        );
        const response = yield* Effect.promise(() =>
          handler(
            new Request('http://localhost/sdk-failure', {
              headers: {
                accept: 'text/html',
                cookie: 'appSession.0=valid-cookie',
              },
            }),
          ),
        );
        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe('/500');
        expect(response.headers.getSetCookie()).toEqual([]);
      }),
  );

  it.effect('returns a sanitized JSON response for a route defect', () =>
    Effect.gen(function* () {
      const defect = new Error('sensitive internal failure');
      const { handler } = yield* makeTestHandler(
        HttpRouter.add('GET', '/defect', Effect.die(defect)),
      );

      const response = yield* Effect.promise(() =>
        handler(new Request('http://localhost/defect')),
      );

      expect(response.status).toBe(500);
      expect(yield* Effect.promise(() => response.json())).toEqual({
        error: 'Internal Server Error',
      });
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/u);
    }),
  );

  it.effect(
    'preserves a safe boundary request ID and replaces unsafe input',
    () =>
      Effect.gen(function* () {
        const { handler } = yield* makeTestHandler(
          HttpRouter.add(
            'GET',
            '/ok',
            Effect.succeed(HttpServerResponse.empty()),
          ),
        );
        const preserved = yield* Effect.promise(() =>
          handler(
            new Request('http://localhost/ok', {
              headers: { 'x-request-id': 'platform_request-42' },
            }),
          ),
        );
        const replaced = yield* Effect.promise(() =>
          handler(
            new Request('http://localhost/ok', {
              headers: { 'x-request-id': 'unsafe request value' },
            }),
          ),
        );

        expect(preserved.headers.get('x-request-id')).toBe(
          'platform_request-42',
        );
        expect(replaced.headers.get('x-request-id')).not.toBe(
          'unsafe request value',
        );
      }),
  );

  it.effect('redirects browser navigation defects to the error page', () =>
    Effect.gen(function* () {
      const defect = new Error('render failure');
      const { handler } = yield* makeTestHandler(
        HttpRouter.add('GET', '/defect', Effect.die(defect)),
      );

      const response = yield* Effect.promise(() =>
        handler(
          new Request('http://localhost/defect', {
            headers: { accept: 'text/html' },
          }),
        ),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/500');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }),
  );

  it.effect('preserves a router miss as 404 without defect capture', () =>
    Effect.gen(function* () {
      const { handler } = yield* makeTestHandler(Layer.empty);

      const response = yield* Effect.promise(() =>
        handler(new Request('http://localhost/missing')),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }),
  );

  it.effect('preserves explicit route-not-found as 404 without capture', () =>
    Effect.gen(function* () {
      const { handler } = yield* makeTestHandler(
        HttpRouter.add('*', '*', (request) =>
          Effect.fail(new HttpServerError.RouteNotFound({ request })),
        ),
      );

      const response = yield* Effect.promise(() =>
        handler(new Request('http://localhost/missing')),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }),
  );

  it.effect('marks every staging response as non-indexable', () =>
    Effect.gen(function* () {
      const { handler } = yield* makeTestHandler(
        HttpRouter.add(
          'GET',
          '/event',
          Effect.succeed(HttpServerResponse.text('staging event')),
        ),
        'staging',
      );

      const response = yield* Effect.promise(() =>
        handler(new Request('https://staging.evorto.app/event')),
      );

      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    }),
  );

  it.effect('preserves client aborts as 499 without defect capture', () =>
    Effect.gen(function* () {
      const clientAbortReason = Cause.makeInterruptReason().annotate(
        HttpServerError.ClientAbort.annotation,
      );
      const exit = yield* makeServerResponseMiddleware(
        Effect.failCause(Cause.fromReasons([clientAbortReason])),
      ).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(
            new Request('http://localhost/slow', { method: 'POST' }),
          ),
        ),
        Effect.exit,
      );
      if (Exit.isSuccess(exit)) {
        throw new Error('Expected client abort to remain interrupted');
      }
      const [response] = yield* HttpServerError.causeResponse(exit.cause);

      expect(response.status).toBe(499);
    }),
  );
});
