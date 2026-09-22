import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import * as PgClient from '@effect/sql-pg/PgClient';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { getTableColumns } from 'drizzle-orm';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Cause, ConfigProvider, Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';
import { ConnectionError, SqlError } from 'effect/unstable/sql/SqlError';

import { Database } from '../../db';
import { relations } from '../../db/relations';
import { tenantPrivacyPolicyVersions, tenants } from '../../db/schema';
import { localTestTenantDomainHeader } from '../../shared/request-routing';
import * as authSession from '../auth/auth-session';
import { RuntimeConfig } from '../config/runtime-config';
import { resolveRequestBoundary } from './request-boundary';
import {
  createRobotsWebResponse,
  createSitemapWebResponse,
  seoMetadataRouteLayer,
} from './seo-metadata.web-handler';

describe('SEO metadata responses', () => {
  it.each(['tenant-one.example.test', 'tenant-two.example.test'])(
    'formats both discovery documents with the resolved tenant origin %s',
    async (host) => {
      const robots = await createRobotsWebResponse(`https://${host}`).text();
      const sitemap = await createSitemapWebResponse(`https://${host}`).text();
      expect(robots).toContain(`Sitemap: https://${host}/sitemap.xml`);
      expect(sitemap).toContain(`<loc>https://${host}/events</loc>`);
      expect(robots + sitemap).not.toContain('attacker.example');
    },
  );

  it('formats the configured local development origin', async () => {
    const response = createSitemapWebResponse('http://localhost:4321');
    expect(await response.text()).toContain(
      '<loc>http://localhost:4321/events</loc>',
    );
  });

  it('formats robots metadata from the resolved public origin', async () => {
    const response = createRobotsWebResponse('https://events.example.test');

    await expect(response.text()).resolves.toBe(
      [
        'User-agent: *',
        'Allow: /',
        '',
        'Sitemap: https://events.example.test/sitemap.xml',
        '',
      ].join('\n'),
    );
    expect(response.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8',
    );
  });

  it('formats every sitemap URL from the resolved public origin', async () => {
    const response = createSitemapWebResponse('https://events.example.test');
    const sitemap = await response.text();

    expect(sitemap).toContain('<loc>https://events.example.test/</loc>');
    expect(sitemap).toContain('<loc>https://events.example.test/events</loc>');
    expect(sitemap).not.toContain('alpha.evorto.app');
    expect(response.headers.get('content-type')).toBe(
      'application/xml; charset=utf-8',
    );
  });
});

it.effect.each(['/robots.txt', '/sitemap.xml'])(
  'serves HEAD metadata even with the application catch-all: %s',
  (path) =>
    Effect.gen(function* () {
      const handler = makeSeoHandler({
        findTenant: (domain) =>
          Effect.succeed(
            domain === 'tenant.example.test' ? createTenant(domain) : undefined,
          ),
      });
      yield* Effect.addFinalizer(() => Effect.promise(handler.dispose));
      const request = (method: string) =>
        new Request(`https://tenant.example.test${path}`, {
          headers: {
            host: 'tenant.example.test',
            'x-forwarded-proto': 'https',
          },
          method,
        });
      const get = yield* Effect.promise(() => handler.handler(request('GET')));
      const head = yield* Effect.promise(() =>
        handler.handler(request('HEAD')),
      );
      expect(get.status).toBe(200);
      expect(head.status).toBe(get.status);
      expect(head.headers.get('content-type')).toBe(
        get.headers.get('content-type'),
      );
      expect(head.headers.get('cache-control')).toBe(
        get.headers.get('cache-control'),
      );
      expect(yield* Effect.promise(() => head.text())).toBe('');
      expect(yield* Effect.promise(() => get.text())).toContain(
        'https://tenant.example.test',
      );
    }),
);

type TenantReadResult = typeof tenants.$inferSelect & {
  privacyPolicyVersions: Pick<
    typeof tenantPrivacyPolicyVersions.$inferSelect,
    'privacyPolicyText' | 'privacyPolicyUrl'
  >[];
};

const createTenant = (domain: string) =>
  ({
    cancellationDeadlineHoursBeforeStart: 120,
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    currency: 'EUR',
    defaultLocation: null,
    discountProviders: { esnCard: { config: {}, status: 'disabled' } },
    domain,
    emailSenderEmail: null,
    emailSenderName: null,
    faviconUrl: null,
    id: 'tenant-fixture',
    legalNoticeText: null,
    legalNoticeUrl: null,
    logoUrl: null,
    maxActiveRegistrationsPerUser: 0,
    name: domain,
    privacyPolicyVersions: [
      {
        privacyPolicyText: 'Current organization privacy policy',
        privacyPolicyUrl: null,
      },
    ],
    receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
    refundFeesOnCancellation: true,
    seoDescription: null,
    seoTitle: null,
    stripeAccountId: null,
    termsText: null,
    termsUrl: null,
    theme: 'evorto',
    timezone: 'Europe/Berlin',
    transferDeadlineHoursBeforeStart: 0,
    updatedAt: new Date('2026-07-01T12:00:00.000Z'),
  }) satisfies TenantReadResult;

const tenantDatabaseLayer = (
  findTenant: (
    domain: string,
  ) => Effect.Effect<TenantReadResult | undefined, SqlError>,
) => {
  const unexpected = Effect.die(
    new Error(
      'SEO must not access users, sessions, or other database operations',
    ),
  );
  const executeValues: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.gen(function* () {
      expect(statement).toContain('from "tenants"');
      expect(statement).toContain('tenant_privacy_policy_versions');
      expect(statement).toContain('"version" desc');
      const domainBinding = statement.match(/"d0"\."domain" = \$(\d+)/u)?.[1];
      expect(domainBinding).toBeDefined();
      const domain = domainBinding
        ? parameters[Number(domainBinding) - 1]
        : undefined;
      if (typeof domain !== 'string')
        return yield* Effect.die(new Error('Expected tenant domain parameter'));
      const tenant = yield* findTenant(domain);
      if (!tenant) return [];
      const { privacyPolicyVersions, ...tenantFields } = tenant;
      expect(Object.keys(tenantFields)).toEqual(
        Object.keys(getTableColumns(tenants)),
      );
      return [
        [
          ...Object.values(tenantFields).map((value) =>
            value instanceof Date
              ? value.toISOString().replace('Z', '')
              : value,
          ),
          privacyPolicyVersions.map((policy) => ({ ...policy })),
        ],
      ];
    });
  const connection = {
    execute: () => unexpected,
    executeRaw: () => unexpected,
    executeStream: () => Stream.die(new Error('Unexpected SEO SQL stream')),
    executeUnprepared: () => unexpected,
    executeValues,
    executeValuesUnprepared: () => unexpected,
  } satisfies SqlConnection.Connection;
  return Layer.effect(Database, PgDrizzle.makeWithDefaults({ relations })).pipe(
    Layer.provide(
      PgClient.layerFrom(
        PgClient.makeWith({
          acquirer: Effect.succeed(connection),
          config: {},
          listenAcquirer: unexpected,
          transactionAcquirer: unexpected,
        }),
      ),
    ),
  );
};

const makeSeoHandler = (input: {
  applicationEnvironment?: 'local' | 'production' | 'staging';
  baseUrl?: string;
  findTenant: (
    domain: string,
  ) => Effect.Effect<TenantReadResult | undefined, SqlError>;
  nodeEnvironment?: string;
  onFailure?: (cause: Cause.Cause<unknown>) => void;
  tenantDomain?: string;
}) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: {
        APP_ENVIRONMENT: input.applicationEnvironment ?? 'production',
        APP_ROLE: 'web',
        BASE_URL: input.baseUrl ?? 'https://root.example.test',
        CLIENT_ID: 'seo-client',
        CLIENT_SECRET: 'seo-secret',
        DATABASE_TLS_REQUIRED: 'false',
        DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/unused',
        ISSUER_BASE_URL: 'https://auth.example.test',
        NODE_ENV: input.nodeEnvironment ?? 'production',
        SECRET: 'seo-fixture-session-secret-at-least-32-bytes',
        WORKER_TRIGGER_MODE: 'poll',
        ...(input.tenantDomain !== undefined && {
          TENANT_DOMAIN: input.tenantDomain,
        }),
      },
    }),
  );
  const services = Layer.mergeAll(
    config,
    RuntimeConfig.Default.pipe(Layer.provide(config)),
    tenantDatabaseLayer(input.findTenant),
  );
  return HttpRouter.toWebHandler(
    Layer.mergeAll(
      seoMetadataRouteLayer,
      HttpRouter.add('*', '*', HttpServerResponse.empty({ status: 404 })),
    ).pipe(HttpRouter.provideRequest(services)),
    {
      disableLogger: true,
      middleware: (effect) =>
        effect.pipe(
          Effect.tapCause((cause) =>
            Effect.sync(() => input.onFailure?.(cause)),
          ),
        ),
    },
  );
};

const seoRequest = (
  host: string,
  path: string,
  method: 'GET' | 'HEAD',
  extraHeaders: Record<string, string> = {},
) => {
  const boundary = resolveRequestBoundary({
    headers: new Headers({
      cookie: 'appSession=untrusted-cookie',
      host,
      'x-forwarded-host': 'attacker.example',
      'x-forwarded-proto': 'http',
      ...extraHeaders,
    }),
    requestTarget: path,
    transportProtocol: 'http',
    trustPlatformProxy: false,
  });
  if (!boundary) throw new Error('Expected a syntactically valid SEO request');
  return new Request(boundary.url, { headers: boundary.headers, method });
};

afterEach(() => vi.restoreAllMocks());

describe('SEO metadata tenant boundary', () => {
  for (const path of ['/robots.txt', '/sitemap.xml']) {
    it.effect.each(['tenant-one.example.test', 'tenant-two.example.test'])(
      'resolves known %s for GET and HEAD ' + path,
      (domain) =>
        Effect.gen(function* () {
          const session = vi
            .spyOn(authSession, 'loadAuthSession')
            .mockImplementation(() =>
              Effect.die(
                new Error('SEO must not load an authentication session'),
              ),
            );
          const lookedUp: string[] = [];
          const handler = makeSeoHandler({
            findTenant: (input) =>
              Effect.sync(() => {
                lookedUp.push(input);
                return input === domain ? createTenant(domain) : undefined;
              }),
          });
          yield* Effect.addFinalizer(() => Effect.promise(handler.dispose));
          for (const method of ['GET', 'HEAD'] as const) {
            const response = yield* Effect.promise(() =>
              handler.handler(seoRequest(domain + ':8080', path, method)),
            );
            expect(response.status).toBe(200);
            expect(response.headers.get('cache-control')).toBe(
              'public, max-age=3600',
            );
            expect(response.headers.get('content-type')).toBe(
              path === '/robots.txt'
                ? 'text/plain; charset=utf-8'
                : 'application/xml; charset=utf-8',
            );
            const body = yield* Effect.promise(() => response.text());
            if (method === 'HEAD') expect(body).toBe('');
            else {
              expect(body).toContain('https://' + domain + '/');
              expect(body).not.toContain(':8080');
              expect(body).not.toContain('attacker.example');
              expect(body).not.toContain('root.example.test');
            }
          }
          expect(lookedUp).toEqual([domain, domain]);
          expect(session).not.toHaveBeenCalled();
        }),
    );

    it.effect.each([
      'missing.example.test',
      'root.example.test',
      'alias.example.test',
    ])('rejects unknown %s for GET and HEAD ' + path, (domain) =>
      Effect.gen(function* () {
        const session = vi
          .spyOn(authSession, 'loadAuthSession')
          .mockImplementation(() =>
            Effect.die(
              new Error('SEO must not load an authentication session'),
            ),
          );
        const lookedUp: string[] = [];
        const handler = makeSeoHandler({
          findTenant: (input) =>
            Effect.sync(() => {
              lookedUp.push(input);
              return input === 'tenant-one.example.test'
                ? createTenant(input)
                : undefined;
            }),
        });
        yield* Effect.addFinalizer(() => Effect.promise(handler.dispose));
        for (const method of ['GET', 'HEAD'] as const) {
          const response = yield* Effect.promise(() =>
            handler.handler(
              seoRequest(domain, path, method, {
                [localTestTenantDomainHeader]: 'tenant-one.example.test',
                'x-forwarded-host': 'tenant-one.example.test',
                'x-tenant-domain': 'tenant-one.example.test',
              }),
            ),
          );
          expect(response.status).toBe(404);
          expect(response.headers.get('cache-control')).toBe('no-store');
          expect(response.headers.get('x-robots-tag')).toBe(
            'noindex, nofollow',
          );
          const body = yield* Effect.promise(() => response.text());
          if (method === 'HEAD') expect(body).toBe('');
          else
            expect(body).toContain(
              'This link does not match an Evorto organization',
            );
          expect(body).not.toContain(domain);
        }
        expect(lookedUp).toEqual([domain, domain]);
        expect(session).not.toHaveBeenCalled();
      }),
    );

    it.effect.each(['header', 'configuration'] as const)(
      'keeps explicit local %s routing and configured loopback origin ' + path,
      (source) =>
        Effect.gen(function* () {
          const domain = 'local-tenant.example.test';
          const lookedUp: string[] = [];
          const handler = makeSeoHandler({
            applicationEnvironment: 'local',
            baseUrl: 'http://127.0.0.1:4321',
            nodeEnvironment: 'development',
            ...(source === 'configuration' && { tenantDomain: domain }),
            findTenant: (input) =>
              Effect.sync(() => {
                lookedUp.push(input);
                return input === domain ? createTenant(domain) : undefined;
              }),
          });
          yield* Effect.addFinalizer(() => Effect.promise(handler.dispose));
          for (const method of ['GET', 'HEAD'] as const) {
            const response = yield* Effect.promise(() =>
              handler.handler(
                seoRequest(
                  'localhost:9876',
                  path,
                  method,
                  source === 'header'
                    ? { [localTestTenantDomainHeader]: domain }
                    : {},
                ),
              ),
            );
            expect(response.status).toBe(200);
            const body = yield* Effect.promise(() => response.text());
            if (method === 'HEAD') expect(body).toBe('');
            else {
              expect(body).toContain('http://127.0.0.1:4321/');
              expect(body).not.toContain('localhost:9876');
              expect(body).not.toContain(domain);
            }
          }
          expect(lookedUp).toEqual([domain, domain]);
        }),
    );

    it.effect.each(['failure', 'defect'] as const)(
      'does not turn a database %s into a tenant404 ' + path,
      (kind) =>
        Effect.gen(function* () {
          const sentinel = new Error('SEO database failure sentinel');
          const failures: Cause.Cause<unknown>[] = [];
          const handler = makeSeoHandler({
            findTenant: () =>
              kind === 'defect'
                ? Effect.die(sentinel)
                : Effect.fail(
                    new SqlError({
                      reason: new ConnectionError({ cause: sentinel }),
                    }),
                  ),
            onFailure: (cause) => {
              failures.push(cause);
            },
          });
          yield* Effect.addFinalizer(() => Effect.promise(handler.dispose));
          for (const method of ['GET', 'HEAD'] as const) {
            const response = yield* Effect.promise(() =>
              handler.handler(
                seoRequest('tenant-one.example.test', path, method),
              ),
            );
            expect(response.status).toBe(500);
            expect(response.headers.get('cache-control')).not.toBe(
              'public, max-age=3600',
            );
          }
          expect(failures).toHaveLength(2);
          expect(
            failures.map((cause) => Cause.pretty(cause)).join(' '),
          ).toContain(sentinel.message);
        }),
    );
  }
});
