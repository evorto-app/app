import type { HttpServerRequest } from 'effect/unstable/http/HttpServerRequest';

import { Effect } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';

import { resolveHttpRequestContext } from '../context/http-request-context';
import { tenantOutboundRootUrl } from '../tenant-outbound-url';
import { createUnknownTenantResponse } from './unknown-tenant-response';

export const createRobotsWebResponse = (origin: string): Response => {
  return new Response(
    [
      'User-agent: *',
      'Allow: /',
      '',
      `Sitemap: ${origin}/sitemap.xml`,
      '',
    ].join('\n'),
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    },
  );
};

export const createSitemapWebResponse = (origin: string): Response => {
  return new Response(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url>',
      `    <loc>${origin}/</loc>`,
      '    <changefreq>daily</changefreq>',
      '    <priority>0.8</priority>',
      '  </url>',
      '  <url>',
      `    <loc>${origin}/events</loc>`,
      '    <changefreq>hourly</changefreq>',
      '    <priority>0.9</priority>',
      '  </url>',
      '</urlset>',
      '',
    ].join('\n'),
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'application/xml; charset=utf-8',
      },
    },
  );
};

const resolveSeoMetadataResponse = (
  request: HttpServerRequest,
  render: (origin: string) => Response,
) =>
  resolveHttpRequestContext(request, undefined).pipe(
    Effect.flatMap(({ tenant }) => tenantOutboundRootUrl(tenant)),
    Effect.map((origin) => HttpServerResponse.fromWeb(render(origin))),
    Effect.catchTag('HttpRequestTenantNotFoundError', () =>
      Effect.succeed(createUnknownTenantResponse(request.method)),
    ),
  );

export const seoMetadataRouteLayer = HttpRouter.addAll(
  (['GET', 'HEAD'] as const).flatMap((method) => [
    HttpRouter.route(method, '/robots.txt', (request) =>
      resolveSeoMetadataResponse(request, createRobotsWebResponse),
    ),
    HttpRouter.route(method, '/sitemap.xml', (request) =>
      resolveSeoMetadataResponse(request, createSitemapWebResponse),
    ),
  ]),
);
