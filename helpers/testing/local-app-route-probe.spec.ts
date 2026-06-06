import { describe, expect, it } from '@effect/vitest';

import { runLocalAppRouteProbe } from './local-app-route-probe';

const originalBaseUrl = process.env['BASE_URL'];
const originalComposeProjectName = process.env['COMPOSE_PROJECT_NAME'];
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

  if (originalComposeProjectName === undefined) {
    delete process.env['COMPOSE_PROJECT_NAME'];
  } else {
    process.env['COMPOSE_PROJECT_NAME'] = originalComposeProjectName;
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
      runCommand: () => ({ status: 0, stderr: '', stdout: '' }),
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
      runCommand: () => ({ status: 0, stderr: '', stdout: '' }),
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
    process.env['COMPOSE_PROJECT_NAME'] = 'evorto-current';

    const errors: string[] = [];
    const passed = await runLocalAppRouteProbe({
      fetchImplementation: async (input) => {
        expect(String(input)).toBe('http://localhost:4200/events');
        return new Response('', { status: 500 });
      },
      runCommand: () => ({
        status: 0,
        stderr: '',
        stdout: [
          JSON.stringify({
            Labels: 'com.docker.compose.project=evorto-current',
            Names: 'evorto-current-evorto-1',
            Ports: '0.0.0.0:4200->4200/tcp',
          }),
          JSON.stringify({
            Labels: 'com.docker.compose.project=other-project',
            Names: 'other-project-app-1',
            Ports: '0.0.0.0:4200->4200/tcp',
          }),
        ].join('\n'),
      }),
      writeError: (message) => errors.push(message),
    });

    expect(passed).toBe(false);
    expect(errors).toContain(
      'App route probe failed: http://localhost:4200/events returned HTTP 500. Run bun run docker:check to confirm whether another Evorto stack owns the selected port before using this app for Browser evidence.',
    );
    restoreEnvironment();
  });

  it('skips route probing when another Evorto checkout owns the local port', async () => {
    process.env['BASE_URL'] = 'http://localhost:4200';
    process.env['COMPOSE_PROJECT_NAME'] = 'evorto-current';

    const output: string[] = [];
    const errors: string[] = [];
    const passed = await runLocalAppRouteProbe({
      fetchImplementation: async () => {
        throw new Error('should not fetch another checkout app');
      },
      runCommand: (command, commandArguments) => {
        expect([command, ...commandArguments].join(' ')).toBe(
          'docker ps --format {{json .}} --filter label=com.docker.compose.project',
        );
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify({
            Labels: 'com.docker.compose.project=evorto-other',
            Names: 'evorto-other-evorto-1',
            Ports: '0.0.0.0:4200->4200/tcp',
          }),
        };
      },
      writeError: (message) => errors.push(message),
      writeOutput: (message) => output.push(message),
    });

    expect(passed).toBe(true);
    expect(output.join('\n')).toContain(
      'Skipping app route probe for http://localhost:4200/legal/terms because another Evorto Compose project is publishing that port.',
    );
    expect(output.join('\n')).toContain(
      'COMPOSE_PROJECT_NAME=evorto-other docker compose down',
    );
    expect(errors).toEqual([]);
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
