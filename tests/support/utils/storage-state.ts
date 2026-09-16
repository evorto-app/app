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
const isStringArray = (value: unknown): boolean =>
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
  (value['keyPathArray'] === undefined || isStringArray(value['keyPathArray']));

const isIndexedDbIndex = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value['name']) &&
  hasValidKeyPath(value) &&
  typeof value['multiEntry'] === 'boolean' &&
  typeof value['unique'] === 'boolean';

const isIndexedDbStore = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value['name']) &&
  typeof value['autoIncrement'] === 'boolean' &&
  hasValidKeyPath(value) &&
  Array.isArray(value['records']) &&
  everyStorageEntry(value['records'], isRecord) &&
  Array.isArray(value['indexes']) &&
  everyStorageEntry(value['indexes'], isIndexedDbIndex);

const isIndexedDbDatabase = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value['name']) &&
  typeof value['version'] === 'number' &&
  Number.isInteger(value['version']) &&
  Array.isArray(value['stores']) &&
  everyStorageEntry(value['stores'], isIndexedDbStore);

const isOpfsEntry = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value['path']) &&
  (value['type'] === 'file' || value['type'] === 'directory') &&
  isOptionalString(value['base64']);

const isStorageOrigin = (
  value: unknown,
): value is StorageState['origins'][number] =>
  isRecord(value) &&
  isCanonicalHttpOrigin(value['origin']) &&
  Array.isArray(value['localStorage']) &&
  everyStorageEntry(value['localStorage'], isLocalStorageEntry) &&
  (value['indexedDB'] === undefined ||
    (Array.isArray(value['indexedDB']) &&
      everyStorageEntry(value['indexedDB'], isIndexedDbDatabase))) &&
  (value['opfs'] === undefined ||
    (Array.isArray(value['opfs']) &&
      everyStorageEntry(value['opfs'], isOpfsEntry)));

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
