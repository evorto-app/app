import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (path: string): string =>
  readFileSync(join(repositoryRoot, path), 'utf8');

const serverAuthorizationSources = [
  'src/server/effect/rpc/handlers',
  'src/server/http',
] as const;

describe('server authorization source', () => {
  it('routes permission checks through the shared evaluator instead of raw array includes', () => {
    const commandOutput = Bun.spawnSync({
      cmd: [
        'rg',
        '--files-with-matches',
        'permissions\\.includes\\(|currentPermissions\\.includes\\(|user\\.permissions\\.includes\\(',
        ...serverAuthorizationSources,
      ],
      cwd: repositoryRoot,
      stderr: 'pipe',
      stdout: 'pipe',
    });

    const stdout = commandOutput.stdout.toString().trim();
    const stderr = commandOutput.stderr.toString().trim();

    expect(commandOutput.exitCode, stderr || stdout).toBe(1);
    expect(stdout).toBe('');
  });

  it('keeps role lookup results free of permission-bearing admin role fields', () => {
    const source = readSource(
      'src/shared/rpc-contracts/app-rpcs/roles.rpcs.ts',
    );

    expect(source).toContain('export const RoleLookupRecord = Schema.Struct');
    expect(source).toContain('defaultOrganizerRole');
    expect(source).toContain('defaultUserRole');
    expect(source).not.toContain('permissions');
    expect(source).not.toContain('displayInHub');
    expect(source).not.toContain('collapseMembersInHub');
  });
});
