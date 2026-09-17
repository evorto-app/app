import type { Browser, Cookie } from '@playwright/test';

import { DateTime } from 'luxon';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openAuthenticatedTestPage } from '../../tests/support/utils/authenticated-test-page';
import {
  readStorageState,
  resolveStorageState,
  validateStorageStateBeforeUse,
} from '../../tests/support/utils/storage-state';

const temporaryDirectories: string[] = [];
const createFixturePath = (): string => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'evorto-playwright-storage-state-'),
  );
  temporaryDirectories.push(directory);
  return path.join(directory, 'state.json');
};
const cookie = {
  domain: 'storage-state.example.test',
  expires: -1,
  httpOnly: true,
  name: 'synthetic-session',
  path: '/',
  sameSite: 'Lax',
  secure: true,
  value: 'synthetic-value',
} satisfies Cookie;
const state = {
  cookies: [cookie],
  origins: [
    {
      localStorage: [{ name: 'synthetic-key', value: 'synthetic-value' }],
      origin: 'https://storage-state.example.test',
    },
  ],
};
const stateWithCookie = (value: unknown) => ({ cookies: [value], origins: [] });
const stateWithOrigin = (value: unknown) => ({ cookies: [], origins: [value] });
const writeState = (value: unknown): string => {
  const pathname = createFixturePath();
  writeFileSync(pathname, JSON.stringify(value));
  return pathname;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('serialized Playwright storage state', () => {
  it('treats only a missing file as absent, and requires a selected file to exist', () => {
    const pathname = createFixturePath();
    expect(readStorageState(pathname)).toBeNull();
    expect(() => resolveStorageState(pathname)).toThrow(Error);
    expect(() => readStorageState(path.dirname(pathname))).toThrow(Error);
  });

  it('reports corrupt JSON without exposing its contents', () => {
    const pathname = createFixturePath();
    const marker = 'synthetic-private-value-do-not-print';
    writeFileSync(pathname, `{"cookies": "${marker}", "origins": invalid}`);
    let failure: unknown;
    try {
      readStorageState(pathname);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error))
      throw new Error('Expected invalid JSON to fail');
    expect(failure.message).not.toContain(marker);
    expect(() => resolveStorageState(pathname)).toThrow(Error);
  });

  it.each([
    { name: 'null', value: null },
    { name: 'array', value: [] },
    { name: 'number', value: 1 },
    { name: 'empty object', value: {} },
    { name: 'missing cookies', value: { origins: [] } },
    { name: 'missing origins', value: { cookies: [] } },
    { name: 'non-array cookies', value: { cookies: {}, origins: [] } },
    { name: 'non-array origins', value: { cookies: [], origins: {} } },
    { name: 'null cookie', value: stateWithCookie(null) },
    { name: 'array cookie', value: stateWithCookie([]) },
    { name: 'null origin', value: stateWithOrigin(null) },
    { name: 'array origin', value: stateWithOrigin([]) },
    { name: 'missing origin', value: stateWithOrigin({ localStorage: [] }) },
    {
      name: 'non-string origin',
      value: stateWithOrigin({ localStorage: [], origin: 1 }),
    },
    {
      name: 'missing localStorage',
      value: stateWithOrigin({ origin: 'https://storage-state.example.test' }),
    },
    {
      name: 'non-array localStorage',
      value: stateWithOrigin({
        localStorage: {},
        origin: 'https://storage-state.example.test',
      }),
    },
    ...[
      null,
      [],
      { value: 'synthetic-value' },
      { name: 'synthetic-key' },
      { name: 1, value: 'synthetic-value' },
      { name: 'synthetic-key', value: 1 },
    ].map((entry, index) => ({
      name: `invalid localStorage entry ${index}`,
      value: stateWithOrigin({
        localStorage: [entry],
        origin: 'https://storage-state.example.test',
      }),
    })),
  ])('rejects $name from a file and inline', ({ value }) => {
    expect(() => resolveStorageState(value)).toThrow(Error);
    expect(() => readStorageState(writeState(value))).toThrow(Error);
  });

  it.each(Object.keys(cookie))(
    'requires serialized cookie field %s',
    (field) => {
      const incomplete = Object.fromEntries(
        Object.entries(cookie).filter(([key]) => key !== field),
      );
      expect(() => resolveStorageState(stateWithCookie(incomplete))).toThrow(
        Error,
      );
    },
  );

  it.each([
    { name: 'non-string name', value: { ...cookie, name: 1 } },
    { name: 'non-string value', value: { ...cookie, value: false } },
    { name: 'non-string domain', value: { ...cookie, domain: 1 } },
    { name: 'empty domain', value: { ...cookie, domain: '' } },
    { name: 'non-string path', value: { ...cookie, path: null } },
    { name: 'empty path', value: { ...cookie, path: '' } },
    { name: 'string expiry', value: { ...cookie, expires: '123' } },
    { name: 'negative expiry', value: { ...cookie, expires: -2 } },
    {
      name: 'expiry beyond Playwright maximum',
      value: { ...cookie, expires: 253_402_300_800 },
    },
    {
      name: 'infinite expiry',
      value: { ...cookie, expires: Number.POSITIVE_INFINITY },
    },
    { name: 'NaN expiry', value: { ...cookie, expires: Number.NaN } },
    { name: 'non-boolean httpOnly', value: { ...cookie, httpOnly: 'true' } },
    { name: 'non-boolean secure', value: { ...cookie, secure: 1 } },
    { name: 'unrecognized sameSite', value: { ...cookie, sameSite: 'lax' } },
    { name: 'non-string partition key', value: { ...cookie, partitionKey: 1 } },
    {
      name: 'non-boolean Chromium partition flag',
      value: { ...cookie, _crHasCrossSiteAncestor: 'false' },
    },
    {
      name: 'url together with serialized domain/path',
      value: { ...cookie, url: 'https://storage-state.example.test/' },
    },
  ])('rejects $name', ({ value }) => {
    expect(() => resolveStorageState(stateWithCookie(value))).toThrow(Error);
  });

  it.each([
    { ...cookie, name: '', value: '' },
    { ...cookie, expires: 0 },
    { ...cookie, expires: 1.5 },
    { ...cookie, expires: 253_402_300_799 },
    { ...cookie, httpOnly: false, secure: false, sameSite: 'None' },
    { ...cookie, sameSite: 'Strict' },
    { ...cookie, domain: '.storage-state.example.test' },
    {
      ...cookie,
      partitionKey: 'https://top-level.example.test',
      _crHasCrossSiteAncestor: false,
    },
  ])('preserves accepted serialized cookie fields %#', (value) => {
    const input = stateWithCookie(value);
    expect(resolveStorageState(input)).toBe(input);
    expect(readStorageState(writeState(input))).toEqual(input);
  });

  // This is the application's canonical saved-origin policy, not Playwright's generic URL input contract.
  it.each([
    '',
    'null',
    'storage-state.example.test',
    '/relative',
    'file:///tmp/synthetic-state',
    'data:text/html,synthetic',
    'ftp://storage-state.example.test',
    'https://storage-state.example.test/',
    'https://storage-state.example.test/path',
    'https://storage-state.example.test?query=1',
    'https://storage-state.example.test#fragment',
    'https://user:password@storage-state.example.test',
    'https://storage-state.example.test:443',
    'http://storage-state.example.test:80',
    'https://STORAGE-STATE.example.test',
    'HTTPS://storage-state.example.test',
    'https://storage-state.example.test:',
    'http://127.1',
    'http://0x7f000001',
    'http://127.000.000.001',
    ' https://storage-state.example.test',
    'https://storage-state.example.test ',
    'https:\\storage-state.example.test',
  ])('rejects noncanonical saved origin %j', (origin) => {
    expect(() =>
      resolveStorageState(stateWithOrigin({ localStorage: [], origin })),
    ).toThrow(Error);
  });

  it.each([
    'https://storage-state.example.test',
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    'http://[::1]:4200',
    'https://storage-state.example.test:8443',
  ])(
    'preserves canonical saved origin %s and empty storage values',
    (origin) => {
      const input = stateWithOrigin({
        localStorage: [{ name: '', value: '' }],
        origin,
      });
      expect(resolveStorageState(input)).toBe(input);
      expect(readStorageState(writeState(input))).toEqual(input);
    },
  );

  it('preserves empty state and valid inline object identity', () => {
    const empty = { cookies: [], origins: [] };
    expect(resolveStorageState(undefined)).toBeUndefined();
    expect(resolveStorageState(empty)).toBe(empty);
    expect(resolveStorageState(state)).toBe(state);
    expect(resolveStorageState(writeState(state))).toEqual(state);
  });
});

const database = {
  name: 'synthetic-database',
  stores: [
    {
      autoIncrement: false,
      indexes: [
        {
          keyPath: 'label',
          multiEntry: false,
          name: 'by-label',
          unique: false,
        },
      ],
      keyPath: 'id',
      name: 'records',
      records: [{ value: { id: 1, label: 'synthetic-value' } }],
    },
    {
      autoIncrement: false,
      indexes: [
        {
          keyPathArray: ['group', 'id'],
          multiEntry: false,
          name: 'compound',
          unique: true,
        },
      ],
      keyPathArray: ['group', 'id'],
      name: 'compound-records',
      records: [],
    },
    {
      autoIncrement: true,
      indexes: [],
      name: 'encoded-records',
      records: [
        { keyEncoded: { n: 1 }, valueEncoded: { s: 'synthetic-value' } },
      ],
    },
  ],
  version: 1,
};
const credential = {
  id: 'synthetic-credential-id',
  privateKey: 'synthetic-private-key',
  publicKey: 'synthetic-public-key',
  rpId: 'storage-state.example.test',
  userHandle: 'synthetic-user-handle',
};

const indexedDbOrigin = (fields: Record<string, unknown>) =>
  stateWithOrigin({
    ...state.origins[0],
    indexedDB: [{ ...database, ...fields }],
  });
const indexedDbStore = (fields: Record<string, unknown>) =>
  indexedDbOrigin({ stores: [{ ...database.stores[0], ...fields }] });
const indexedDbIndex = (fields: Record<string, unknown>) =>
  indexedDbStore({
    indexes: [{ name: 'index', multiEntry: false, unique: false, ...fields }],
  });

describe('optional Playwright storage structures', () => {
  it.each([
    ...[0, -1, 2 ** 64].map((version) => ({
      name: `database version ${version}`,
      input: indexedDbOrigin({ version }),
    })),
    {
      name: 'ambiguous store key path',
      input: indexedDbStore({ keyPathArray: ['id'] }),
    },
    {
      name: 'auto-increment compound key',
      input: indexedDbStore({
        autoIncrement: true,
        keyPath: undefined,
        keyPathArray: ['id'],
      }),
    },
    {
      name: 'auto-increment empty key path',
      input: indexedDbStore({ autoIncrement: true, keyPath: '' }),
    },
    {
      name: 'empty store key path array',
      input: indexedDbStore({ keyPath: undefined, keyPathArray: [] }),
    },
    {
      name: 'empty index key path array',
      input: indexedDbIndex({ keyPathArray: [] }),
    },
    {
      name: 'duplicate databases',
      input: stateWithOrigin({
        ...state.origins[0],
        indexedDB: [database, database],
      }),
    },
    {
      name: 'duplicate stores',
      input: indexedDbOrigin({
        stores: [database.stores[0], database.stores[0]],
      }),
    },
    {
      name: 'duplicate indexes',
      input: indexedDbStore({
        indexes: [
          {
            name: 'duplicate',
            keyPath: 'id',
            unique: false,
            multiEntry: false,
          },
          {
            name: 'duplicate',
            keyPath: 'other',
            unique: false,
            multiEntry: false,
          },
        ],
      }),
    },
    {
      name: 'OPFS file used as a directory',
      input: stateWithOrigin({
        ...state.origins[0],
        opfs: [
          { path: 'file/child', type: 'directory' },
          { path: 'file', type: 'file', base64: '' },
        ],
      }),
    },
    {
      name: 'duplicate OPFS paths',
      input: stateWithOrigin({
        ...state.origins[0],
        opfs: [
          { path: 'file', type: 'directory' },
          { path: 'file', type: 'file', base64: '' },
        ],
      }),
    },
    { name: 'missing index key path', input: indexedDbIndex({}) },
    {
      name: 'ambiguous index key path',
      input: indexedDbIndex({ keyPath: 'id', keyPathArray: ['id'] }),
    },
    {
      name: 'multi-entry compound index',
      input: indexedDbIndex({ keyPathArray: ['id'], multiEntry: true }),
    },
    { name: 'missing record value', input: indexedDbStore({ records: [{}] }) },
    {
      name: 'undefined raw record value',
      input: indexedDbStore({ records: [{ value: undefined }] }),
    },
    {
      name: 'null raw record value lost by restore',
      input: indexedDbStore({ records: [{ value: null }] }),
    },
    {
      name: 'ambiguous record value',
      input: indexedDbStore({
        records: [{ value: { id: 1 }, valueEncoded: { v: 'null' } }],
      }),
    },
    {
      name: 'ambiguous record key',
      input: indexedDbStore({
        keyPath: undefined,
        records: [{ key: 1, keyEncoded: 2, value: '' }],
      }),
    },
    {
      name: 'explicit key in inline store',
      input: indexedDbStore({ records: [{ key: 1, value: { id: 1 } }] }),
    },
    {
      name: 'missing key in non-generating out-of-line store',
      input: indexedDbStore({ keyPath: undefined, records: [{ value: '' }] }),
    },
    {
      name: 'null raw key',
      input: indexedDbStore({
        keyPath: undefined,
        records: [{ key: null, value: '' }],
      }),
    },
    {
      name: 'null encoded key',
      input: indexedDbStore({
        keyPath: undefined,
        records: [{ keyEncoded: null, value: '' }],
      }),
    },
    ...[
      '',
      '/',
      '/file',
      'file/',
      'a//b',
      '.',
      '..',
      'a/../b',
      'a/./b',
      'a\0b',
    ].map((path) => ({
      name: `invalid OPFS path ${JSON.stringify(path)}`,
      input: stateWithOrigin({
        ...state.origins[0],
        opfs: [{ path, type: 'directory' }],
      }),
    })),
    {
      name: 'missing OPFS file bytes',
      input: stateWithOrigin({
        ...state.origins[0],
        opfs: [{ path: 'file', type: 'file' }],
      }),
    },
    ...['!', 'a', '====', '💾'].map((base64) => ({
      name: `invalid OPFS base64 ${JSON.stringify(base64)}`,
      input: stateWithOrigin({
        ...state.origins[0],
        opfs: [{ path: 'file', type: 'file', base64 }],
      }),
    })),
  ])('rejects $name before any context consumer', async ({ input }) => {
    const use = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    expect(() => resolveStorageState(input)).toThrow('is invalid');
    const pathname = writeState(input);
    expect(() => readStorageState(pathname)).toThrow('is invalid');
    await expect(
      validateStorageStateBeforeUse({ storageState: pathname }, use),
    ).rejects.toThrow('is invalid');
    expect(use).not.toHaveBeenCalled();
  });

  it.each([
    indexedDbStore({
      keyPath: undefined,
      autoIncrement: true,
      records: [
        { value: '' },
        { value: false },
        { value: 0 },
        { valueEncoded: { v: 'null' } },
        { valueEncoded: null },
        { valueEncoded: { v: 'undefined' } },
      ],
    }),
    indexedDbStore({
      keyPath: undefined,
      records: [
        { key: '', value: '' },
        { key: 0, value: false },
        { keyEncoded: [1, 2], valueEncoded: { v: 'null' } },
      ],
    }),
    indexedDbStore({ keyPath: '', records: [{ value: 'primary-key' }] }),
    indexedDbStore({ keyPath: undefined, keyPathArray: [''], records: [] }),
    indexedDbIndex({ keyPath: '' }),
    indexedDbIndex({ keyPathArray: [''] }),
    stateWithOrigin({
      ...state.origins[0],
      opfs: [
        { path: 'empty file', type: 'file', base64: '' },
        { path: 'nested', type: 'directory' },
        { path: 'nested/💾.txt', type: 'file', base64: 'YQ==' },
      ],
    }),
  ])('preserves valid empty and encoded values %#', (input) => {
    expect(resolveStorageState(input)).toBe(input);
    expect(readStorageState(writeState(input))).toEqual(input);
  });

  it('preserves protocol-shaped IndexedDB, OPFS and credential fields', () => {
    const input = {
      ...state,
      credentials: [credential],
      origins: [
        {
          ...state.origins[0],
          indexedDB: [database],
          opfs: [
            { path: 'synthetic', type: 'directory' },
            {
              base64: 'c3ludGhldGlj',
              path: 'synthetic/file.txt',
              type: 'file',
            },
          ],
        },
      ],
    };
    expect(resolveStorageState(input)).toBe(input);
    expect(readStorageState(writeState(input))).toEqual(input);
  });

  it('does not impose a Windows-only restriction on OPFS filenames', () => {
    const input = stateWithOrigin({
      ...state.origins[0],
      opfs: [{ path: 'back\\slash', type: 'file', base64: '' }],
    });
    expect(resolveStorageState(input)).toBe(input);
  });

  it('retains explicitly empty optional arrays', () => {
    const input = {
      ...state,
      credentials: [],
      origins: [{ ...state.origins[0], indexedDB: [], opfs: [] }],
    };
    expect(resolveStorageState(input)).toBe(input);
  });

  it.each([
    { indexedDB: null },
    { indexedDB: {} },
    { indexedDB: [null] },
    { indexedDB: [{ ...database, name: 1 }] },
    { indexedDB: [{ ...database, version: 1.5 }] },
    { indexedDB: [{ ...database, stores: {} }] },
    { indexedDB: [{ ...database, stores: [null] }] },
    {
      indexedDB: [
        {
          ...database,
          stores: [{ ...database.stores[0], autoIncrement: 'false' }],
        },
      ],
    },
    {
      indexedDB: [
        { ...database, stores: [{ ...database.stores[0], keyPath: 1 }] },
      ],
    },
    {
      indexedDB: [
        { ...database, stores: [{ ...database.stores[0], keyPathArray: [1] }] },
      ],
    },
    {
      indexedDB: [
        { ...database, stores: [{ ...database.stores[0], records: [null] }] },
      ],
    },
    {
      indexedDB: [
        {
          ...database,
          stores: [
            {
              ...database.stores[0],
              indexes: [{ name: 'index', multiEntry: 1, unique: false }],
            },
          ],
        },
      ],
    },
    { opfs: null },
    { opfs: [null] },
    { opfs: [{ path: 1, type: 'directory' }] },
    { opfs: [{ path: 'file', type: 'other' }] },
    { opfs: [{ path: 'file', type: 'file', base64: 1 }] },
  ])('rejects malformed optional origin structure %#', (fields) => {
    expect(() =>
      resolveStorageState(stateWithOrigin({ ...state.origins[0], ...fields })),
    ).toThrow(Error);
  });

  it.each([
    null,
    {},
    [null],
    [{ ...credential, privateKey: 1 }],
    [{ id: 'missing-key-fields' }],
  ])('rejects malformed credential collection %#', (credentials) => {
    expect(() => resolveStorageState({ ...state, credentials })).toThrow(Error);
  });
});

describe('storage-state use boundary', () => {
  it('inspects indexed OPFS entries even when an inline array overrides iteration', async () => {
    const opfs: { path: string; type: 'directory' }[] = [
      { path: '../invalid', type: 'directory' },
    ];
    opfs[Symbol.iterator] = () => [][Symbol.iterator]();
    const storageState = {
      cookies: [],
      origins: [
        {
          localStorage: [],
          origin: 'https://storage-state.example.test',
          opfs,
        },
      ],
    };
    const use = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    expect(() => resolveStorageState(storageState)).toThrow('is invalid');
    await expect(
      validateStorageStateBeforeUse({ storageState }, use),
    ).rejects.toThrow('is invalid');
    expect(use).not.toHaveBeenCalled();
  });

  it('rejects a sparse cookie array before invoking use', async () => {
    const cookies: Cookie[] = [];
    cookies.length = 1;
    const storageState = { cookies, origins: [] };
    const use = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    expect(() => resolveStorageState(storageState)).toThrow(Error);
    await expect(
      validateStorageStateBeforeUse({ storageState }, use),
    ).rejects.toBeInstanceOf(Error);
    expect(use).not.toHaveBeenCalled();
  });

  it('rejects sparse origin localStorage before invoking use', async () => {
    const localStorage: { name: string; value: string }[] = [];
    localStorage.length = 1;
    const storageState = {
      cookies: [],
      origins: [{ localStorage, origin: 'https://storage-state.example.test' }],
    };
    const use = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    expect(() => resolveStorageState(storageState)).toThrow(Error);
    await expect(
      validateStorageStateBeforeUse({ storageState }, use),
    ).rejects.toBeInstanceOf(Error);
    expect(use).not.toHaveBeenCalled();
  });

  it.each(['file', 'inline', 'missing file', 'corrupt JSON'])(
    'rejects invalid %s state before invoking the context-use callback',
    async (kind) => {
      const invalid = { ...state, cookies: [{ ...cookie, expires: -2 }] };
      const pathname = createFixturePath();
      if (kind === 'file') writeFileSync(pathname, JSON.stringify(invalid));
      if (kind === 'corrupt JSON') writeFileSync(pathname, '{invalid');
      const use = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      await expect(
        validateStorageStateBeforeUse(
          { storageState: kind === 'inline' ? invalid : pathname },
          use,
        ),
      ).rejects.toBeInstanceOf(Error);
      expect(use).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, state])(
    'allows valid inline or absent state %#',
    async (storageState) => {
      const use = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      await validateStorageStateBeforeUse({ storageState }, use);
      expect(use).toHaveBeenCalledExactlyOnceWith();
      expect(resolveStorageState(storageState)).toBe(storageState);
    },
  );

  it('checks a valid selected file before entering use and preserves callback failure', async () => {
    const callbackFailure = new Error('Synthetic use callback failure');
    const use = vi.fn<() => Promise<void>>().mockRejectedValue(callbackFailure);
    await expect(
      validateStorageStateBeforeUse({ storageState: writeState(state) }, use),
    ).rejects.toBe(callbackFailure);
    expect(use).toHaveBeenCalledOnce();
  });

  it.each(['invalid', 'missing', 'valid'])(
    'validates the authenticated-page %s file before browser.newContext',
    async (kind) => {
      const pathname = createFixturePath();
      if (kind !== 'missing')
        writeFileSync(
          pathname,
          JSON.stringify(
            kind === 'valid' ? state : { cookies: [{}], origins: [] },
          ),
        );
      const sentinel = new Error('Synthetic context creation reached');
      const newContext = vi
        .fn<Browser['newContext']>()
        .mockRejectedValue(sentinel);
      const result = openAuthenticatedTestPage({
        baseUrl: 'http://127.0.0.1:4200/events',
        browser: { newContext },
        storageState: pathname,
        tenantDomain: 'storage-state.example.test',
        testClock: DateTime.fromISO('2030-01-01T00:00:00.000Z'),
      });
      if (kind === 'valid') {
        await expect(result).rejects.toBe(sentinel);
        expect(newContext).toHaveBeenCalledExactlyOnceWith({
          baseURL: 'http://127.0.0.1:4200',
          colorScheme: 'light',
          ignoreHTTPSErrors: true,
          storageState: state,
        });
        expect(newContext.mock.calls[0]?.[0]?.storageState).not.toBe(pathname);
      } else {
        await expect(result).rejects.not.toBe(sentinel);
        expect(newContext).not.toHaveBeenCalled();
      }
    },
  );
});
