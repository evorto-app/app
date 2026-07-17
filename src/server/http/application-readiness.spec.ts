import { describe, expect, it } from 'vitest';

import {
  createApplicationReadinessResponse,
  createApplicationReadinessSsrRequest,
} from './application-readiness';

const healthySsrResponse = () =>
  new Response(
    '<!doctype html><html><body><app-root><app-event-list></app-event-list></app-root></body></html>',
    {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    },
  );

describe('application readiness', () => {
  it.each([
    ['local', 'http://localhost:4200/readyz', 'http://localhost:4200/events'],
    [
      'CI tenant domain',
      'https://section.example.test/readyz',
      'https://section.example.test/events',
    ],
  ])(
    'targets the public SSR route on the incoming %s origin',
    (_, readinessUrl, expectedSsrUrl) => {
      const request = createApplicationReadinessSsrRequest(
        new Request(readinessUrl, {
          headers: {
            Authorization: 'Bearer must-not-be-forwarded',
            Cookie: 'appSession=must-not-be-forwarded',
            'X-Forwarded-Host': 'tenant.forwarded.example.test',
          },
        }),
      );

      expect(request.url).toBe(expectedSsrUrl);
      expect(request.method).toBe('GET');
      expect(request.redirect).toBe('manual');
      expect(request.headers.get('accept')).toBe('text/html');
      expect(request.headers.has('authorization')).toBe(false);
      expect(request.headers.has('cookie')).toBe(false);
      expect(request.headers.has('x-forwarded-host')).toBe(false);
    },
  );

  it('uses the configured tenant host instead of the probe hostname', () => {
    const request = createApplicationReadinessSsrRequest(
      new Request('https://generated.functions.fnc.fr-par.scw.cloud/readyz'),
      'staging.evorto.app',
    );

    expect(request.url).toBe('https://staging.evorto.app/events');
    expect(request.headers.get('host')).toBe('staging.evorto.app');
  });

  it('returns the one exact success status for the expected SSR document', async () => {
    const response =
      await createApplicationReadinessResponse(healthySsrResponse());

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it.each([
    ['no renderer response', null],
    [
      'authentication redirect',
      new Response(null, { headers: { Location: '/login' }, status: 303 }),
    ],
    [
      'error redirect',
      new Response(null, { headers: { Location: '/500' }, status: 302 }),
    ],
    [
      'final authentication page',
      new Response('<html><body>Sign in</body></html>', {
        headers: { 'Content-Type': 'text/html' },
        status: 200,
      }),
    ],
    [
      'final error page',
      new Response('<html><body><app-error></app-error></body></html>', {
        headers: { 'Content-Type': 'text/html' },
        status: 200,
      }),
    ],
    ['non-HTML response', Response.json({ status: 'ok' }, { status: 200 })],
    [
      'server error',
      new Response('Unavailable', {
        headers: { 'Content-Type': 'text/html' },
        status: 500,
      }),
    ],
  ])('returns unavailable for %s', async (_, ssrResponse) => {
    const response = await createApplicationReadinessResponse(ssrResponse);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'not-ready' });
  });

  it('returns unavailable when the SSR response stream fails', async () => {
    const response = await createApplicationReadinessResponse(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('SSR stream failed'));
          },
        }),
        {
          headers: { 'Content-Type': 'text/html' },
          status: 200,
        },
      ),
    );

    expect(response.status).toBe(503);
  });
});
