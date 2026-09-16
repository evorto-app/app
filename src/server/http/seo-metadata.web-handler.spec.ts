import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';

import { resolveRequestBoundary } from './request-boundary';
import {
  createRobotsWebResponse,
  createSitemapWebResponse,
  seoMetadataRouteLayer,
} from './seo-metadata.web-handler';

const normalizedRequest = (
  host: string,
  path: string,
  trustPlatformProxy = true,
) => {
  const boundary = resolveRequestBoundary({
    headers: new Headers({
      host,
      'x-forwarded-host': 'attacker.example',
      'x-forwarded-proto': 'https',
    }),
    requestTarget: path,
    transportProtocol: 'http',
    trustPlatformProxy,
  });
  if (!boundary) throw new Error('Expected a valid tenant request');
  return HttpServerRequest.fromWeb(
    new Request(boundary.url, { headers: boundary.headers }),
  );
};

describe('SEO metadata responses', () => {
  it.each(['tenant-one.example.test', 'tenant-two.example.test'])(
    'keeps both discovery documents on the requested tenant %s',
    async (host) => {
      const robots = await createRobotsWebResponse(
        normalizedRequest(host, '/robots.txt'),
      ).text();
      const sitemap = await createSitemapWebResponse(
        normalizedRequest(host, '/sitemap.xml'),
      ).text();
      expect(robots).toContain(`Sitemap: https://${host}/sitemap.xml`);
      expect(sitemap).toContain(`<loc>https://${host}/events</loc>`);
      expect(robots + sitemap).not.toContain('attacker.example');
    },
  );

  it('uses the normalized local protocol when forwarded protocol is untrusted', async () => {
    const response = createSitemapWebResponse(
      normalizedRequest('localhost:4321', '/sitemap.xml', false),
    );
    expect(await response.text()).toContain(
      '<loc>http://localhost:4321/events</loc>',
    );
  });

  it('derives robots metadata from the normalized tenant request origin', async () => {
    const response = createRobotsWebResponse(
      normalizedRequest('events.example.test', '/robots.txt'),
    );

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

  it('derives every sitemap URL from the normalized tenant request origin', async () => {
    const response = createSitemapWebResponse(
      normalizedRequest('events.example.test', '/sitemap.xml'),
    );
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
      const handler = HttpRouter.toWebHandler(
        Layer.mergeAll(
          seoMetadataRouteLayer,
          HttpRouter.add('*', '*', HttpServerResponse.empty({ status: 404 })),
        ),
        { disableLogger: true },
      );
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
