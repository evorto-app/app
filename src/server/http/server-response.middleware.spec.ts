import { describe, expect, it } from '@effect/vitest';
import {
  createDefaultTenantDiscountProviders,
  DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
  DEFAULT_TENANT_RECEIPT_COUNTRIES,
} from '@shared/tenant-config';
import { Cause, Effect, Exit, Layer, Schema, Tracer } from 'effect';
import {
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

import type { DeploymentConfig } from '../config/deployment-config';

import { Context as RequestContext } from '../../types/custom/context';
import { runAuth0SdkOperation, toAuthSession } from '../auth/auth-session';
import { toRpcRequestContext } from '../effect/rpc/app-rpcs.request-handler';
import {
  makeServerResponseMiddleware,
  safeServerRequestRoute,
} from './server-response.middleware';

const execFileAsync = promisify(execFile);

const authenticatedRpcContext = Schema.decodeUnknownSync(RequestContext)({
  authentication: { isAuthenticated: true },
  permissions: [],
  tenant: {
    cancellationDeadlineHoursBeforeStart: 120,
    currency: 'EUR',
    discountProviders: createDefaultTenantDiscountProviders(),
    domain: 'tenant.example.com',
    id: 'tenant-1',
    locale: 'de-DE',
    maxActiveRegistrationsPerUser: 0,
    name: 'Tenant',
    receiptSettings: {
      allowOther: DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
      receiptCountries: [...DEFAULT_TENANT_RECEIPT_COUNTRIES],
    },
    refundFeesOnCancellation: true,
    theme: 'evorto',
    timezone: 'Europe/Berlin',
    transferDeadlineHoursBeforeStart: 0,
  },
});

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
                    connection: 'close',
                    cookie:
                      'appSession=unusable; appSession.0=first-fragment; appSession.1=second-fragment; appSession.preference=keep; appTransaction=keep-transaction; unrelated=keep',
                    host: new URL(url).host,
                    'x-forwarded-proto': new URL(url).protocol.slice(0, -1),
                  },
                }),
              ),
            );
            expect(response.status).toBe(401);
            expect(response.headers.get('connection')).toBe('close');
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
                connection: 'close',
                'content-type': 'application/json',
                cookie: 'appSession.0=unusable',
                host: 'localhost',
                'x-forwarded-proto': 'http',
              },
              method: 'POST',
            }),
          ),
        );
        expect(response.status).toBe(401);
        expect(response.headers.get('connection')).toBe('close');
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
    'recovers malformed optional profile claims before running the RPC handler',
    () =>
      Effect.gen(function* () {
        for (const profile of [
          { email: 123 },
          { email_verified: 'true' },
          { given_name: false },
          { family_name: ['private-profile-value'] },
        ]) {
          let rpcHandlingReached = false;
          const { handler } = yield* makeTestHandler(
            HttpRouter.add(
              'POST',
              '/rpc',
              Effect.gen(function* () {
                const session = yield* toAuthSession({
                  tokenSets: [
                    {
                      accessToken: 'fixture-token',
                      audience: 'default',
                      expiresAt: 0,
                    },
                  ],
                  user: { sub: 'auth0|fixture-user', ...profile },
                });
                if (!session)
                  throw new Error('Expected the decoded session fixture');

                yield* toRpcRequestContext(
                  authenticatedRpcContext,
                  session.authData,
                );
                rpcHandlingReached = true;
                return HttpServerResponse.empty();
              }),
            ),
          );
          const response = yield* Effect.promise(() =>
            handler(
              new Request('http://localhost/rpc', {
                headers: {
                  connection: 'close',
                  'content-type': 'application/json',
                  cookie:
                    'appSession=unusable; appSession.0=fragment; appSession.preference=keep; unrelated=keep',
                  host: 'localhost',
                  'x-forwarded-proto': 'http',
                },
                method: 'POST',
              }),
            ),
          );
          expect(response.status).toBe(401);
          expect(rpcHandlingReached).toBe(false);
          expect(response.headers.get('cache-control')).toBe('no-store');
          expect(response.headers.get('connection')).toBe('close');
          expect(response.headers.get('location')).toBeNull();
          expect(yield* Effect.promise(() => response.json())).toEqual({
            error: 'Unauthorized',
            message:
              'Your sign-in session is no longer valid. Sign in again to continue.',
          });
          const cookies = response.headers.getSetCookie();
          expect(
            cookies.map((cookie) => cookie.split('=', 1)[0]).toSorted(),
          ).toEqual(['appSession', 'appSession.0']);
          for (const cookie of cookies) {
            expect(cookie).toContain('Max-Age=0');
            expect(cookie).toContain('HttpOnly');
            expect(cookie).toContain('SameSite=Lax');
            expect(cookie).not.toContain('fragment');
          }
        }
      }),
  );

  it.effect(
    'preserves unexpected profile access defects without clearing session cookies',
    () =>
      Effect.gen(function* () {
        const { handler } = yield* makeTestHandler(
          HttpRouter.add(
            'POST',
            '/rpc',
            Effect.gen(function* () {
              yield* toRpcRequestContext(authenticatedRpcContext, {
                get email() {
                  throw new Error('private profile access defect');
                },
                sub: 'auth0|fixture-user',
              });
              return HttpServerResponse.empty();
            }),
          ),
        );
        const response = yield* Effect.promise(() =>
          handler(
            new Request('http://localhost/rpc', {
              headers: {
                'content-type': 'application/json',
                cookie: 'appSession=valid',
                host: 'localhost',
                'x-forwarded-proto': 'http',
              },
              method: 'POST',
            }),
          ),
        );
        expect(response.status).toBe(500);
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(yield* Effect.promise(() => response.json())).toEqual({
          error: 'Internal Server Error',
        });
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

  it.effect.each(['close', 'Close', 'keep-alive, CLOSE', ' close , upgrade '])(
    'explicitly closes the response for the request connection option %s',
    (connection) =>
      Effect.gen(function* () {
        const { handler } = yield* makeTestHandler(
          HttpRouter.add(
            'GET',
            '/asset',
            Effect.succeed(
              HttpServerResponse.text('asset body', {
                headers: {
                  'cache-control': 'public, max-age=3600',
                  connection: 'keep-alive',
                },
                status: 202,
              }),
            ),
          ),
        );
        const response = yield* Effect.promise(() =>
          handler(
            new Request('http://localhost/asset', {
              headers: { connection, 'x-request-id': 'close-request-1' },
            }),
          ),
        );

        expect(response.headers.get('connection')).toBe('close');
        expect(response.status).toBe(202);
        expect(yield* Effect.promise(() => response.text())).toBe('asset body');
        expect(response.headers.get('cache-control')).toBe(
          'public, max-age=3600',
        );
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('x-request-id')).toBe('close-request-1');
      }),
  );

  it.effect.each([undefined, '', 'keep-alive', 'x-close', 'disclose'])(
    'preserves the response connection policy for request option %s',
    (connection) =>
      Effect.gen(function* () {
        const { handler } = yield* makeTestHandler(
          HttpRouter.add(
            'GET',
            '/ok',
            Effect.succeed(HttpServerResponse.text('ok')),
          ),
        );
        const headers = new Headers();
        if (connection !== undefined) headers.set('connection', connection);
        const response = yield* Effect.promise(() =>
          handler(new Request('http://localhost/ok', { headers })),
        );

        expect(response.headers.has('connection')).toBe(false);
        expect(yield* Effect.promise(() => response.text())).toBe('ok');
      }),
  );

  it.effect('closes redirects and handled error responses when requested', () =>
    Effect.gen(function* () {
      const { handler } = yield* makeTestHandler(
        Layer.mergeAll(
          HttpRouter.add(
            'GET',
            '/redirect',
            Effect.succeed(HttpServerResponse.redirect('/done')),
          ),
          HttpRouter.add(
            'GET',
            '/defect',
            Effect.die(new Error('test defect')),
          ),
        ),
      );
      for (const [pathname, status] of [
        ['/redirect', 302],
        ['/missing', 404],
        ['/defect', 500],
      ] satisfies readonly (readonly [string, number])[]) {
        const response = yield* Effect.promise(() =>
          handler(
            new Request(`http://localhost${pathname}`, {
              headers: { connection: 'close' },
            }),
          ),
        );
        expect(response.status).toBe(status);
        expect(response.headers.get('connection')).toBe('close');
        if (pathname === '/redirect')
          expect(response.headers.get('location')).toBe('/done');
        yield* Effect.promise(() => response.arrayBuffer());
      }
    }),
  );

  it('retires pooled Node client sockets through the real Bun HTTP server', async ({
    signal,
  }) => {
    const { stderr, stdout } = await execFileAsync(
      'bun',
      ['helpers/testing/response-connection-bun-regression.ts'],
      { cwd: process.cwd(), signal, timeout: 10_000 },
    );

    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual({
      requests: 12,
      responsesWithCloseHeader: 12,
      reusedSockets: 0,
      sockets: 12,
    });
  }, 15_000);

  it('derives stable trace routes without query values or sensitive identifiers', () => {
    const callbackCode = 'callback-code-sentinel';

    expect(
      safeServerRequestRoute(
        `https://tenant.example.com/callback?code=${callbackCode}`,
      ),
    ).toBe('/callback');
    expect(
      safeServerRequestRoute('/qr/registration/sensitive-registration-id'),
    ).toBe('/qr/registration/:registrationId');
    expect(
      safeServerRequestRoute('/tenant-assets/tenant-1/logo/file-name.png'),
    ).toBe('/tenant-assets/:tenantId/:kind/:fileName');
  });

  it.effect(
    'records a sanitized request trace while handlers keep the original URL',
    () =>
      Effect.gen(function* () {
        const callbackCode = 'callback-code-sentinel';
        let serverSpan: Tracer.NativeSpan | undefined;
        const tracer = Tracer.make({
          span(options) {
            serverSpan = new Tracer.NativeSpan(options);
            return serverSpan;
          },
        });
        const request = HttpServerRequest.fromWeb(
          new Request(
            `https://tenant.example.com/registration-transfers?code=${callbackCode}`,
            {
              headers: {
                host: 'tenant.example.com',
                'x-forwarded-proto': 'https',
              },
            },
          ),
        );
        let routeRequestUrl: string | undefined;

        yield* makeServerResponseMiddleware(
          HttpServerRequest.HttpServerRequest.pipe(
            Effect.tap((routeRequest) =>
              Effect.sync(() => {
                routeRequestUrl = routeRequest.url;
              }),
            ),
            Effect.as(HttpServerResponse.empty({ status: 204 })),
          ),
        ).pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request),
          Effect.provideService(Tracer.Tracer, tracer),
        );
        yield* Effect.yieldNow;

        expect(routeRequestUrl).toContain(callbackCode);
        expect(serverSpan).toBeDefined();
        expect(serverSpan?.attributes.get('http.route')).toBe(
          '/registration-transfers',
        );
        expect(serverSpan?.attributes.get('url.path')).toBe(
          '/registration-transfers',
        );
        expect(serverSpan?.attributes.has('url.query')).toBe(false);
        expect(serverSpan?.attributes.get('url.full')).not.toContain(
          callbackCode,
        );
      }),
  );

  it('disables raw request logging at every server boundary', () => {
    const serverSource = readFileSync(
      new URL('../../server.ts', import.meta.url),
      'utf8',
    );

    expect(serverSource).toMatch(
      /HttpLayerRouter\.toWebHandler\(\s*handlerAppLayer,\s*\{ disableLogger: true \},\s*\)/u,
    );
    expect(serverSource).toContain(
      'const bunServeOptions = { disableLogger: true } as const;',
    );
    expect(serverSource).toContain(
      'HttpLayerRouter.serve(bootstrapRoutesLayer, bunServeOptions)',
    );
    expect(serverSource).toContain(
      'HttpLayerRouter.serve(webRoutesLayer, bunServeOptions)',
    );
    expect(serverSource).toMatch(
      /HttpLayerRouter\.serve\(\s*configuredWorkerRoutesLayer,\s*bunServeOptions,\s*\)/u,
    );
    expect(serverSource).toContain(
      'HttpLayerRouter.serve(opsRoutesLayer, bunServeOptions)',
    );
  });

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
