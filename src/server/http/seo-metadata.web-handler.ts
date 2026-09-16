import type { HttpServerRequest } from 'effect/unstable/http/HttpServerRequest';

import { Effect } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';

import { resolveRequestOrigin } from '../auth/auth-session';

export const createRobotsWebResponse = (
  request: HttpServerRequest,
): Response => {
  const { origin } = resolveRequestOrigin(request);
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

export const createSitemapWebResponse = (
  request: HttpServerRequest,
): Response => {
  const { origin } = resolveRequestOrigin(request);
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

export const seoMetadataRouteLayer = HttpRouter.addAll(
  (['GET', 'HEAD'] as const).flatMap((method) => [
    HttpRouter.route(method, '/robots.txt', (request) =>
      Effect.sync(() =>
        HttpServerResponse.fromWeb(createRobotsWebResponse(request)),
      ),
    ),
    HttpRouter.route(method, '/sitemap.xml', (request) =>
      Effect.sync(() =>
        HttpServerResponse.fromWeb(createSitemapWebResponse(request)),
      ),
    ),
  ]),
);
