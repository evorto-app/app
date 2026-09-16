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
      }),
    ).toThrow(SyntaxError);
  });

  it.each([
    { label: 'empty object', state: {} },
    { label: 'unrecognized properties', state: { foo: 1 } },
    { label: 'null origin', state: { origins: [null] } },
    { label: 'array origin', state: { origins: [[]] } },
    {
      label: 'missing origin name',
      state: { origins: [{ localStorage: [] }] },
    },
    {
      label: 'non-string origin name',
      state: { origins: [{ localStorage: [], origin: 123 }] },
    },
    {
      label: 'missing local storage',
      state: { origins: [{ origin: 'https://evorto.example' }] },
    },
    {
      label: 'non-array local storage',
      state: {
        origins: [{ localStorage: {}, origin: 'https://evorto.example' }],
      },
    },
    ...[
      { label: 'null local-storage entry', entry: null },
      { label: 'array local-storage entry', entry: [] },
      { label: 'missing local-storage name', entry: { value: 'value' } },
      { label: 'missing local-storage value', entry: { name: 'key' } },
      {
        label: 'non-string local-storage name',
        entry: { name: 123, value: 'value' },
      },
      {
        label: 'non-string local-storage value',
        entry: { name: 'key', value: 123 },
      },
    ].map(({ entry, label }) => ({
      label,
      state: {
        origins: [{ localStorage: [entry], origin: 'https://evorto.example' }],
      },
    })),
  ])('rejects $label instead of reusing recent state', ({ state }) => {
    const statePath = createFixturePath();
    writeFileSync(statePath, JSON.stringify(state));

    expect(() => readStorageState(statePath)).toThrow('is invalid');
    expect(() =>
      isStorageStateFresh({
        maxAgeMs: 60_000,
        pathname: statePath,
      }),
    ).toThrow('is invalid');
  });

  it.each([
    { label: 'empty cookies', state: { cookies: [] } },
    { label: 'empty origins', state: { origins: [] } },
    {
      label: 'cookie-only fixtures',
      state: { cookies: [{ name: 'appSession', value: 'session' }] },
    },
    {
      label: 'origin-only fixtures with empty local storage',
      state: {
        origins: [{ localStorage: [], origin: 'https://evorto.example' }],
      },
    },
    {
      label:
        'combined fixtures with local storage and additional captured state',
      state: {
        cookies: [{ name: 'appSession', value: 'session' }],
        origins: [
          {
            indexedDB: [],
            localStorage: [
              { name: 'theme', value: 'dark' },
              { name: '', value: '' },
            ],
            origin: 'https://evorto.example',
          },
        ],
      },
    },
  ])('accepts $label as recognized state', ({ state }) => {
    const statePath = createFixturePath();
    writeFileSync(statePath, JSON.stringify(state));

    expect(readStorageState(statePath)).toEqual(state);
    expect(
      isStorageStateFresh({
        maxAgeMs: 60_000,
        pathname: statePath,
      }),
    ).toBe(true);
  });

  it('requires valid current storage state', () => {
    const statePath = createFixturePath();
    writeFileSync(statePath, JSON.stringify({ cookies: [{}] }));
    expect(() => readStorageState(statePath)).toThrow('is invalid');

    writeFileSync(
      statePath,
      JSON.stringify({
        cookies: [{ name: 'appSession', value: 'session' }],
        origins: [],
      }),
    );
    expect(
      isStorageStateFresh({
        maxAgeMs: 60_000,
        pathname: statePath,
      }),
    ).toBe(true);
  });
});
