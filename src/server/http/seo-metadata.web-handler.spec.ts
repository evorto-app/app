import { describe, expect, it } from 'vitest';

import {
  createRobotsWebResponse,
  createSitemapWebResponse,
} from './seo-metadata.web-handler';

describe('SEO metadata responses', () => {
  it('derives robots metadata from the configured canonical origin', async () => {
    const response = createRobotsWebResponse(
      'https://events.example.test/ignored-path',
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

  it('derives every sitemap URL from the configured canonical origin', async () => {
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
