const canonicalOrigin = (baseUrl: string): string => new URL(baseUrl).origin;

export const createRobotsWebResponse = (baseUrl: string): Response => {
  const origin = canonicalOrigin(baseUrl);
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

export const createSitemapWebResponse = (baseUrl: string): Response => {
  const origin = canonicalOrigin(baseUrl);
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
