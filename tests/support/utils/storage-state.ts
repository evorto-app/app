import fs from 'node:fs';

export type StorageState = {
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }>;
  origins?: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
};

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStorageCookie = (
  value: unknown,
): value is Record<string, unknown> & { name: string; value: string } =>
  isRecord(value) &&
  typeof value['name'] === 'string' &&
  typeof value['value'] === 'string' &&
  (value['domain'] === undefined || typeof value['domain'] === 'string') &&
  (value['path'] === undefined || typeof value['path'] === 'string');

const isLocalStorageEntry = (
  value: unknown,
): value is { name: string; value: string } =>
  isRecord(value) &&
  typeof value['name'] === 'string' &&
  typeof value['value'] === 'string';

const isStorageOrigin = (
  value: unknown,
): value is NonNullable<StorageState['origins']>[number] =>
  isRecord(value) &&
  typeof value['origin'] === 'string' &&
  Array.isArray(value['localStorage']) &&
  value['localStorage'].every(isLocalStorageEntry);

const isStorageState = (value: unknown): value is StorageState => {
  if (!isRecord(value)) return false;
  const cookies = value['cookies'];
  const origins = value['origins'];
  return (
    (cookies !== undefined || origins !== undefined) &&
    (cookies === undefined ||
      (Array.isArray(cookies) && cookies.every(isStorageCookie))) &&
    (origins === undefined ||
      (Array.isArray(origins) && origins.every(isStorageOrigin)))
  );
};

export function readStorageState(pathname: string): StorageState | null {
  let raw: string;
  try {
    raw = fs.readFileSync(pathname, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isStorageState(parsed)) {
    throw new Error(`Playwright storage state ${pathname} is invalid`);
  }
  return parsed;
}

export function isFreshByMtime(pathname: string, maxAgeMs: number): boolean {
  try {
    const stat = fs.statSync(pathname);
    return stat.mtimeMs > Date.now() - maxAgeMs;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

export function isStorageStateFresh(params: {
  pathname: string;
  maxAgeMs: number;
}): boolean {
  const { pathname, maxAgeMs } = params;
  const state = readStorageState(pathname);
  if (!state) return false;
  return isFreshByMtime(pathname, maxAgeMs);
}
