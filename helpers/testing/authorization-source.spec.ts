import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Source guard: server handlers should use shared authorization helpers so
// wildcard/dependency permissions stay consistent across RPC and HTTP paths.
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const readSource = (path: string): string =>
  readFileSync(join(repositoryRoot, path), 'utf8');

const serverAuthorizationSources = [
  'src/server/effect/rpc/handlers',
  'src/server/http',
] as const;

const collectTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectTypeScriptFiles(path);
    }

    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });

const extractRoleLookupRecordSource = (source: string): string => {
  const start = source.indexOf('export const RoleLookupRecord = Schema.Struct');
  if (start === -1) {
    throw new Error('RoleLookupRecord export not found');
  }

  const end = source.indexOf('});', start);
  if (end === -1) {
    throw new Error('RoleLookupRecord struct end not found');
  }

  return source.slice(start, end + '});'.length);
};

describe('server authorization source', () => {
  it('routes permission checks through the shared evaluator instead of raw array includes', () => {
    const directPermissionIncludesPattern =
      /permissions\.includes\(|currentPermissions\.includes\(|user\.permissions\.includes\(/u;
    const matches = serverAuthorizationSources.flatMap((sourceDirectory) =>
      collectTypeScriptFiles(join(repositoryRoot, sourceDirectory)).filter(
        (path) =>
          directPermissionIncludesPattern.test(readFileSync(path, 'utf8')),
      ),
    );

    expect(matches).toEqual([]);
  });

  it('keeps role lookup results free of permission-bearing admin role fields', () => {
    const source = extractRoleLookupRecordSource(
      readSource('src/shared/rpc-contracts/app-rpcs/roles.rpcs.ts'),
    );

    expect(source).toContain('export const RoleLookupRecord = Schema.Struct');
    expect(source).toContain('defaultOrganizerRole');
    expect(source).toContain('defaultUserRole');
    expect(source).not.toContain('permissions');
    expect(source).not.toContain('displayInHub');
    expect(source).not.toContain('collapseMembersInHub');
  });
});
