import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  isFreshByMtime,
  isStorageStateFresh,
  readStorageState,
} from '../../tests/support/utils/storage-state';

const temporaryDirectories: string[] = [];

const createFixturePath = (): string => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'evorto-playwright-storage-state-'),
  );
  temporaryDirectories.push(directory);
  return path.join(directory, 'state.json');
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Playwright storage state', () => {
  it('treats only a missing file as absent', () => {
    const statePath = createFixturePath();

    expect(readStorageState(statePath)).toBeNull();
    expect(isFreshByMtime(statePath, 60_000)).toBe(false);
    expect(() => readStorageState(path.dirname(statePath))).toThrow();
  });

  it('surfaces corrupt JSON instead of requesting fresh authentication', () => {
    const statePath = createFixturePath();
    writeFileSync(statePath, '{not-json');
    const stale = new Date(Date.now() - 86_400_000);
    utimesSync(statePath, stale, stale);

    expect(() => readStorageState(statePath)).toThrow(SyntaxError);
    expect(() =>
      isStorageStateFresh({
        maxAgeMs: 60_000,
        pathname: statePath,
        tenantDomain: 'localhost',
      }),
    ).toThrow(SyntaxError);
  });

  it('requires valid cookies and the exact tenant cookie', () => {
    const statePath = createFixturePath();
    writeFileSync(statePath, JSON.stringify({ cookies: [{}] }));
    expect(() => readStorageState(statePath)).toThrow('is invalid');

    writeFileSync(
      statePath,
      JSON.stringify({
        cookies: [{ name: 'evorto-tenant', value: 'localhost' }],
        origins: [],
      }),
    );
    expect(
      isStorageStateFresh({
        maxAgeMs: 60_000,
        pathname: statePath,
        tenantDomain: 'localhost',
      }),
    ).toBe(true);
  });
});
