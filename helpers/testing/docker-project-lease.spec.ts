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
    }
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
});
