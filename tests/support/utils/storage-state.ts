import type {
  BrowserContextOptions,
  PlaywrightTestOptions,
} from '@playwright/test';

import fs from 'node:fs';

export type StorageState = Exclude<
  NonNullable<BrowserContextOptions['storageState']>,
  string
>;

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const everyStorageEntry = (
  values: readonly unknown[],
  predicate: (value: unknown) => boolean,
): boolean => {
  // Inspect holes as undefined; Array.every skips them in inline state.
  for (let index = 0; index < values.length; index += 1) {
    if (!predicate(values[index])) return false;
  }
  return true;
};

const isString = (value: unknown): value is string => typeof value === 'string';
const isOptionalString = (value: unknown): boolean =>
  value === undefined || isString(value);
const isOptionalBoolean = (value: unknown): boolean =>
  value === undefined || typeof value === 'boolean';
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && everyStorageEntry(value, isString);

const isCanonicalHttpOrigin = (value: unknown): value is string => {
  if (!isString(value)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      value === url.origin
    );
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
};

const isStorageCookie = (
  value: unknown,
): value is StorageState['cookies'][number] =>
  isRecord(value) &&
  isString(value['name']) &&
  isString(value['value']) &&
  isString(value['domain']) &&
  value['domain'].length > 0 &&
  isString(value['path']) &&
  value['path'].length > 0 &&
  isOptionalString(value['url']) &&
  !value['url'] &&
  typeof value['expires'] === 'number' &&
  Number.isFinite(value['expires']) &&
  (value['expires'] === -1 ||
    (value['expires'] >= 0 && value['expires'] <= 253_402_300_799)) &&
  typeof value['httpOnly'] === 'boolean' &&
  typeof value['secure'] === 'boolean' &&
  (value['sameSite'] === 'Strict' ||
    value['sameSite'] === 'Lax' ||
    value['sameSite'] === 'None') &&
  isOptionalString(value['partitionKey']) &&
  isOptionalBoolean(value['_crHasCrossSiteAncestor']);

const isLocalStorageEntry = (
  value: unknown,
): value is { name: string; value: string } =>
  isRecord(value) && isString(value['name']) && isString(value['value']);

const hasValidKeyPath = (value: Record<string, unknown>): boolean =>
  isOptionalString(value['keyPath']) &&
  (value['keyPathArray'] === undefined ||
    (isStringArray(value['keyPathArray']) &&
      value['keyPathArray'].length > 0)) &&
  (value['keyPath'] === undefined || value['keyPathArray'] === undefined);

const haveDistinctNames = (values: readonly unknown[]): boolean => {
  const names = new Set<string>();
  return everyStorageEntry(values, (value) => {
    if (
      !isRecord(value) ||
      !isString(value['name']) ||
      names.has(value['name'])
    )
      return false;
    names.add(value['name']);
    return true;
  });
};

const isIndexedDbIndex = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value['name']) &&
  hasValidKeyPath(value) &&
  (value['keyPath'] !== undefined || value['keyPathArray'] !== undefined) &&
  !(value['multiEntry'] === true && value['keyPathArray'] !== undefined) &&
  typeof value['multiEntry'] === 'boolean' &&
  typeof value['unique'] === 'boolean';

const isIndexedDbRecord = (
  value: unknown,
  store: Record<string, unknown>,
): boolean => {
  if (!isRecord(value)) return false;
  // Restore chooses the raw value with ??, so null/undefined must be encoded.
  if (value['value'] === null || value['key'] === null) return false;
  const hasValue = value['value'] !== undefined;
  const hasEncodedValue = value['valueEncoded'] !== undefined;
  if (hasValue === hasEncodedValue) return false;
  const hasKey = value['key'] !== undefined;
  const hasEncodedKey = value['keyEncoded'] !== undefined;
  if (hasKey && hasEncodedKey) return false;
  const hasInlineKey =
    store['keyPath'] !== undefined || store['keyPathArray'] !== undefined;
  return hasInlineKey
    ? !hasKey && !hasEncodedKey
    : store['autoIncrement'] === true || hasKey || hasEncodedKey;
};

const isIndexedDbStore = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value['name']) &&
  typeof value['autoIncrement'] === 'boolean' &&
  hasValidKeyPath(value) &&
  !(
    value['autoIncrement'] === true &&
    (value['keyPath'] === '' || value['keyPathArray'] !== undefined)
  ) &&
  Array.isArray(value['records']) &&
  everyStorageEntry(value['records'], (record) =>
    isIndexedDbRecord(record, value),
  ) &&
  Array.isArray(value['indexes']) &&
  everyStorageEntry(value['indexes'], isIndexedDbIndex) &&
  haveDistinctNames(value['indexes']);

const isIndexedDbDatabase = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value['name']) &&
  typeof value['version'] === 'number' &&
  Number.isInteger(value['version']) &&
  value['version'] > 0 &&
  value['version'] < 2 ** 64 &&
  Array.isArray(value['stores']) &&
  everyStorageEntry(value['stores'], isIndexedDbStore) &&
  haveDistinctNames(value['stores']);

const isOpfsPath = (value: unknown): value is string =>
  isString(value) &&
  value
    .split('/')
    .every(
      (segment) =>
        segment.length > 0 &&
        segment !== '.' &&
        segment !== '..' &&
        !segment.includes('\0'),
    );

const isBase64 = (value: unknown): value is string => {
  if (!isString(value)) return false;
  try {
    atob(value);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'InvalidCharacterError')
      return false;
    throw error;
  }
};

const isOpfsEntry = (
  value: unknown,
): value is { path: string; type: 'directory' | 'file' } =>
  isRecord(value) &&
  isOpfsPath(value['path']) &&
  (value['type'] === 'file'
    ? isBase64(value['base64'])
    : value['type'] === 'directory' && isOptionalString(value['base64']));

const isOpfs = (value: unknown): boolean => {
  if (!Array.isArray(value)) return false;
  const paths = new Set<string>();
  const files = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (!isOpfsEntry(entry) || paths.has(entry.path)) return false;
    paths.add(entry.path);
    if (entry.type === 'file') files.add(entry.path);
  }
  // Restore creates each ancestor as a directory, regardless of entry order.
  return [...paths].every((pathname) => {
    const segments = pathname.split('/');
    return segments.every(
      (_, index) =>
        index === 0 || !files.has(segments.slice(0, index).join('/')),
    );
  });
};

const isStorageOrigin = (
  value: unknown,
): value is StorageState['origins'][number] =>
  isRecord(value) &&
  isCanonicalHttpOrigin(value['origin']) &&
  Array.isArray(value['localStorage']) &&
  everyStorageEntry(value['localStorage'], isLocalStorageEntry) &&
  (value['indexedDB'] === undefined ||
    (Array.isArray(value['indexedDB']) &&
      everyStorageEntry(value['indexedDB'], isIndexedDbDatabase) &&
      haveDistinctNames(value['indexedDB']))) &&
  (value['opfs'] === undefined || isOpfs(value['opfs']));

const isVirtualCredential = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value['id']) &&
  isString(value['rpId']) &&
  isString(value['userHandle']) &&
  isString(value['privateKey']) &&
  isString(value['publicKey']);

const isStorageState = (value: unknown): value is StorageState =>
  isRecord(value) &&
  Array.isArray(value['cookies']) &&
  everyStorageEntry(value['cookies'], isStorageCookie) &&
  Array.isArray(value['origins']) &&
  everyStorageEntry(value['origins'], isStorageOrigin) &&
  (value['credentials'] === undefined ||
    (Array.isArray(value['credentials']) &&
      everyStorageEntry(value['credentials'], isVirtualCredential)));

const invalidState = (location: string): Error =>
  new Error(
    `Playwright storage state ${location} is invalid. Regenerate authentication state with the normal setup before running authenticated tests.`,
  );

export function readStorageState(pathname: string): StorageState | null {
  let raw: string;
  try {
    raw = fs.readFileSync(pathname, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // JSON parser diagnostics can contain fragments of credentials or cookies.
    if (error instanceof SyntaxError) throw invalidState(pathname);
    throw error;
  }
  if (!isStorageState(parsed)) throw invalidState(pathname);
  return parsed;
}

export function resolveStorageState(value: string | StorageState): StorageState;
export function resolveStorageState(value: undefined): undefined;
export function resolveStorageState(value: unknown): StorageState | undefined;
export function resolveStorageState(value: unknown): StorageState | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    const state = readStorageState(value);
    if (state === null) {
      throw new Error(
        `Playwright storage state ${value} is missing. Run the normal authentication setup before authenticated tests.`,
      );
    }
    return state;
  }
  if (!isStorageState(value)) throw invalidState('provided in memory');
  return value;
}

export async function validateStorageStateBeforeUse(
  { storageState }: Pick<PlaywrightTestOptions, 'storageState'>,
  use: () => Promise<void>,
): Promise<void> {
  resolveStorageState(storageState);
  await use();
}
