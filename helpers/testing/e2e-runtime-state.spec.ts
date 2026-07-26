import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readOptionalE2eRuntimeState } from './e2e-runtime-state';

const temporaryDirectories: string[] = [];

const createFixturePath = (): string => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'evorto-e2e-runtime-state-'),
  );
  temporaryDirectories.push(directory);
  return path.join(directory, '.e2e-runtime.json');
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('E2E runtime state', () => {
  it('treats only a missing file as absent', () => {
    const runtimePath = createFixturePath();

    expect(readOptionalE2eRuntimeState(runtimePath)).toBeUndefined();
    expect(() =>
      readOptionalE2eRuntimeState(path.dirname(runtimePath)),
    ).toThrow();
  });

  it('returns a required tenant domain from valid state', () => {
    const runtimePath = createFixturePath();
    writeFileSync(
      runtimePath,
      JSON.stringify({ runId: 'run-1', tenantDomain: 'localhost' }),
    );

    expect(readOptionalE2eRuntimeState(runtimePath)).toEqual({
      tenantDomain: 'localhost',
    });
  });

  it('surfaces malformed JSON and missing tenant state', () => {
    const runtimePath = createFixturePath();
    writeFileSync(runtimePath, '{not-json');
    expect(() => readOptionalE2eRuntimeState(runtimePath)).toThrow(SyntaxError);

    writeFileSync(runtimePath, JSON.stringify({ runId: 'run-1' }));
    expect(() => readOptionalE2eRuntimeState(runtimePath)).toThrow(
      'must contain a non-empty tenantDomain',
    );
  });
});
