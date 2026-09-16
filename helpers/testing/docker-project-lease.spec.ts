import { afterEach, describe, expect, it } from '@effect/vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const leaseScript = path.join(
  process.cwd(),
  'helpers/testing/with-docker-project-lease.sh',
);
const temporaryDirectories: string[] = [];

const createEnvironment = (projectName: string) => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-docker-project-lease-'),
  );
  temporaryDirectories.push(temporaryDirectory);
  return {
    ...process.env,
    COMPOSE_PROJECT_NAME: projectName,
    TMPDIR: temporaryDirectory,
  };
};

const createStudioEnvironment = (projectName: string) => {
  const environment = createEnvironment(projectName);
  const binDirectory = path.join(environment.TMPDIR, 'bin');
  fs.mkdirSync(binDirectory);
  fs.writeFileSync(
    path.join(binDirectory, 'drizzle-kit'),
    `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.slice(2).join(' ') !== 'studio') process.exit(64);
if (process.env.STUDIO_EXIT_CODE !== undefined) {
  process.stdout.write('studio output\\n');
  process.stderr.write('studio diagnostic\\n');
  process.exit(Number(process.env.STUDIO_EXIT_CODE));
}
fs.writeFileSync(process.env.STUDIO_READY_FILE, 'ready');
setInterval(() => {}, 1000);
`,
    { mode: 0o700 },
  );
  return {
    ...environment,
    PATH: `${binDirectory}${path.delimiter}${process.env['PATH'] ?? ''}`,
    STUDIO_READY_FILE: path.join(environment.TMPDIR, 'studio-ready'),
  };
};

const waitForFile = async (filePath: string): Promise<void> => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
};

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories.length = 0;
});

describe('Docker project lifecycle lease', () => {
  it('protects every local command that mutates the shared project', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    for (const scriptName of [
      'db:push',
      'db:reset',
      'db:studio',
      'docker:resume',
      'docker:start',
      'docker:start:foreground',
      'docker:start:watch',
      'docker:stop',
      'docker:webserver',
      'test:integration:postgres:local',
    ]) {
      expect(packageJson.scripts[scriptName], scriptName).toContain(
        'helpers/testing/with-docker-project-lease.sh',
      );
      const script = packageJson.scripts[scriptName];
      expect(script, scriptName).toContain('env:run');
      expect(script.indexOf('env:run'), scriptName).toBeLessThan(
        script.indexOf('helpers/testing/with-docker-project-lease.sh'),
      );
    }
    expect(packageJson.scripts['db:studio']).toContain(
      'helpers/testing/with-docker-project-lease.sh database-studio -- drizzle-kit studio',
    );
  });

  it('requires an explicit project and command', () => {
    const result = spawnSync(
      'bash',
      [leaseScript, 'docker-start', '--', 'true'],
      {
        encoding: 'utf8',
        env: { ...process.env, COMPOSE_PROJECT_NAME: '' },
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('COMPOSE_PROJECT_NAME is required');
  });

  it.each([
    'Evorto',
    'evortoTest',
    'evorto.test',
    '-evorto',
    '_evorto',
    'evorto test',
  ])(
    'rejects invalid project %s before ownership or command execution',
    (projectName) => {
      const environment = createEnvironment(projectName);
      const payloadPath = path.join(environment.TMPDIR, 'payload');
      const result = spawnSync(
        'bash',
        [
          leaseScript,
          'docker-start',
          '--',
          process.execPath,
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(payloadPath)}, 'started');`,
        ],
        { encoding: 'utf8', env: environment, timeout: 3000 },
      );

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain('Invalid COMPOSE_PROJECT_NAME');
      expect(fs.existsSync(payloadPath)).toBe(false);
      expect(
        fs.existsSync(
          path.join(environment.TMPDIR, 'evorto-docker-project-leases'),
        ),
      ).toBe(false);
    },
  );

  it.each(['a', '0', 'evorto-lease_test', '0evorto-lease_test'])(
    'runs the command under ownership for valid project %s',
    (projectName) => {
      const environment = createEnvironment(projectName);
      const result = spawnSync(
        'bash',
        [
          leaseScript,
          'docker-start',
          '--',
          process.execPath,
          '-e',
          'process.stdout.write(process.env.EVORTO_DOCKER_PROJECT_LEASE_HELD);',
        ],
        { encoding: 'utf8', env: environment, timeout: 3000 },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe('true');
      expect(
        fs.readFileSync(
          path.join(
            environment.TMPDIR,
            'evorto-docker-project-leases',
            `${projectName}.owner`,
          ),
          'utf8',
        ),
      ).toContain('operation=docker-start');
    },
  );

  it('fails fast for the same project without blocking another project', async () => {
    const environment = createEnvironment('evorto-lease-test');
    const readyPath = path.join(environment.TMPDIR, 'ready');
    const owner = spawn(
      'bash',
      [
        leaseScript,
        'docker-start',
        '--',
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(readyPath)}, 'ready'); setInterval(() => {}, 1000);`,
      ],
      { env: environment, stdio: 'ignore' },
    );
    const ownerExited = new Promise<void>((resolve) =>
      owner.once('exit', () => resolve()),
    );

    try {
      await waitForFile(readyPath);

      const conflictStartedAt = Date.now();
      const conflict = spawnSync(
        'bash',
        [leaseScript, 'postgres-integration', '--', 'true'],
        { encoding: 'utf8', env: environment },
      );
      expect(Date.now() - conflictStartedAt).toBeLessThan(1000);
      expect(conflict.status).toBe(75);
      expect(conflict.stderr).toContain(
        'another command is already modifying Docker project evorto-lease-test',
      );
      expect(conflict.stderr).toContain('operation=docker-start');

      const otherProject = spawnSync(
        'bash',
        [leaseScript, 'docker-start', '--', 'true'],
        {
          encoding: 'utf8',
          env: {
            ...environment,
            COMPOSE_PROJECT_NAME: 'evorto-other-project',
          },
        },
      );
      expect(otherProject.status, otherProject.stderr).toBe(0);
    } finally {
      owner.kill('SIGTERM');
      await ownerExited;
    }
  });

  it('does not let stale owner details keep a project locked', () => {
    const environment = createEnvironment('evorto-stale-owner-test');
    const leaseDirectory = path.join(
      environment.TMPDIR,
      'evorto-docker-project-leases',
    );
    fs.mkdirSync(leaseDirectory, { recursive: true });
    const ownerPath = path.join(
      leaseDirectory,
      'evorto-stale-owner-test.owner',
    );
    fs.writeFileSync(ownerPath, 'operation=stale-operation\npid=1\n');

    const result = spawnSync(
      'bash',
      [leaseScript, 'docker-resume', '--', 'true'],
      { encoding: 'utf8', env: environment },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(ownerPath, 'utf8')).toContain(
      'operation=docker-resume',
    );
  });

  it.each([0, 37])(
    'preserves Studio exit status %i and releases its lease',
    (status) => {
      const environment = createStudioEnvironment('evorto-studio-exit-test');
      const result = spawnSync(
        'bash',
        [leaseScript, 'database-studio', '--', 'drizzle-kit', 'studio'],
        {
          encoding: 'utf8',
          env: { ...environment, STUDIO_EXIT_CODE: String(status) },
          timeout: 3000,
        },
      );

      expect(result.status, result.stderr).toBe(status);
      expect(result.stdout).toBe('studio output\n');
      expect(result.stderr).toBe('studio diagnostic\n');
      const nextCommand = spawnSync(
        'bash',
        [leaseScript, 'database-reset', '--', 'true'],
        { encoding: 'utf8', env: environment, timeout: 3000 },
      );
      expect(nextCommand.status, nextCommand.stderr).toBe(0);
    },
  );

  it.each(['SIGTERM', 'SIGKILL'] as const)(
    'holds the Studio lease until %s termination without blocking another project',
    async (signal) => {
      const environment = createStudioEnvironment(
        'evorto-studio-lifetime-test',
      );
      const studio = spawn(
        'bash',
        [leaseScript, 'database-studio', '--', 'drizzle-kit', 'studio'],
        { env: environment, stdio: 'ignore' },
      );
      const studioExited = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        studio.once('exit', (code, exitSignal) =>
          resolve({ code, signal: exitSignal }),
        );
      });

      try {
        await waitForFile(environment.STUDIO_READY_FILE);

        for (const operation of ['database-reset', 'docker-stop']) {
          const conflict = spawnSync(
            'bash',
            [leaseScript, operation, '--', 'true'],
            { encoding: 'utf8', env: environment, timeout: 1000 },
          );
          expect(conflict.status, conflict.stderr).toBe(75);
          expect(conflict.stderr).toContain('operation=database-studio');
        }

        const otherProject = spawnSync(
          'bash',
          [leaseScript, 'database-reset', '--', 'true'],
          {
            encoding: 'utf8',
            env: {
              ...environment,
              COMPOSE_PROJECT_NAME: 'evorto-other-project',
            },
            timeout: 3000,
          },
        );
        expect(otherProject.status, otherProject.stderr).toBe(0);
      } finally {
        studio.kill(signal);
        await studioExited;
      }

      expect(await studioExited).toEqual({ code: null, signal });
      const nextCommand = spawnSync(
        'bash',
        [leaseScript, 'database-reset', '--', 'true'],
        { encoding: 'utf8', env: environment, timeout: 3000 },
      );
      expect(nextCommand.status, nextCommand.stderr).toBe(0);
    },
  );
});
