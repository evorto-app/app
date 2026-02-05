import fs from 'node:fs';

export type StorageState = {
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }>;
  origins?: unknown[];
};

export function readStorageState(pathname: string): StorageState | null {
  try {
    const raw = fs.readFileSync(pathname, 'utf-8');
    return JSON.parse(raw) as StorageState;
  } catch {
    return null;
  }
}

export function hasTenantCookie(
  state: StorageState | null,
  tenantDomain: string | undefined,
): boolean {
  if (!state || !tenantDomain) return false;
  const cookies = state.cookies ?? [];
  return cookies.some(
    (c) => c.name === 'evorto-tenant' && c.value === tenantDomain,
  );
}

export function isFreshByMtime(pathname: string, maxAgeMs: number): boolean {
  try {
    const stat = fs.statSync(pathname);
    return stat.mtimeMs > Date.now() - maxAgeMs;
  } catch {
    return false;
  }
}

export function isStorageStateFresh(params: {
  pathname: string;
  tenantDomain?: string;
  maxAgeMs: number;
}): boolean {
  const { pathname, tenantDomain, maxAgeMs } = params;
  const ageFresh = isFreshByMtime(pathname, maxAgeMs);
  if (!ageFresh) return false;
  const state = readStorageState(pathname);
  return hasTenantCookie(state, tenantDomain);
}
