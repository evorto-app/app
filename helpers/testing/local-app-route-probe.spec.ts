import { describe, expect, it } from '@effect/vitest';

import { runLocalAppRouteProbe } from './local-app-route-probe';

const originalBaseUrl = process.env['BASE_URL'];
const originalRouteProbePath = process.env['APP_ROUTE_PROBE_PATH'];

const restoreEnvironment = (): void => {
  if (originalBaseUrl === undefined) {
    delete process.env['BASE_URL'];
  } else {
    process.env['BASE_URL'] = originalBaseUrl;
  }

  if (originalRouteProbePath === undefined) {
    delete process.env['APP_ROUTE_PROBE_PATH'];
  } else {
    process.env['APP_ROUTE_PROBE_PATH'] = originalRouteProbePath;
  }
};

describe('runLocalAppRouteProbe', () => {
  it('passes when the public route returns success', async () => {
    process.env['BASE_URL'] = 'http://localhost:4200';
    delete process.env['APP_ROUTE_PROBE_PATH'];

    const output: string[] = [];
    const errors: string[] = [];
    const passed = await runLocalAppRouteProbe({
      fetchImplementation: async (input) => {
        expect(String(input)).toBe('http://localhost:4200/legal/terms');
        return new Response('', { status: 200 });
      },
      writeError: (message) => errors.push(message),
      writeOutput: (message) => output.push(message),
    });

    expect(passed).toBe(true);
    expect(output).toContain(
      'App route probe passed: http://localhost:4200/legal/terms',
    );
    expect(errors).toEqual([]);
    restoreEnvironment();
  });

  it('does not fail when no app is currently listening', async () => {
    process.env['BASE_URL'] = 'http://localhost:4200';

    const output: string[] = [];
    const passed = await runLocalAppRouteProbe({
      fetchImplementation: async () => {
        throw new Error('fetch failed: ECONNREFUSED');
      },
      writeOutput: (message) => output.push(message),
    });

    expect(passed).toBe(true);
    expect(output).toContain(
      'No app currently serves http://localhost:4200/legal/terms; skipping app route probe.',
    );
    restoreEnvironment();
  });

  it('fails when an already-running local app returns an HTTP error', async () => {
    process.env['BASE_URL'] = 'http://localhost:4200';
    process.env['APP_ROUTE_PROBE_PATH'] = '/events';

    const errors: string[] = [];
    const passed = await runLocalAppRouteProbe({
      fetchImplementation: async (input) => {
        expect(String(input)).toBe('http://localhost:4200/events');
        return new Response('', { status: 500 });
      },
      writeError: (message) => errors.push(message),
    });

    expect(passed).toBe(false);
    expect(errors).toContain(
      'App route probe failed: http://localhost:4200/events returned HTTP 500.',
    );
    restoreEnvironment();
  });

  it('skips when BASE_URL is absent', async () => {
    delete process.env['BASE_URL'];

    const output: string[] = [];
    const passed = await runLocalAppRouteProbe({
      fetchImplementation: async () => {
        throw new Error('should not fetch without BASE_URL');
      },
      writeOutput: (message) => output.push(message),
    });

    expect(passed).toBe(true);
    expect(output).toContain(
      'BASE_URL is missing or invalid; skipping app route probe.',
    );
    restoreEnvironment();
  });
});
