import { HttpServerRequest } from 'effect/unstable/http';
import { describe, expect, it } from 'vitest';

import { resolveRequestBoundary } from './request-boundary';
import {
  createRobotsWebResponse,
  createSitemapWebResponse,
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
