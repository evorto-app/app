import { readFileSync } from 'node:fs';

export interface E2eRuntimeState {
  readonly tenantDomain: string;
}

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

export const readOptionalE2eRuntimeState = (
  pathname: string,
): E2eRuntimeState | undefined => {
  let raw: string;
  try {
    raw = readFileSync(pathname, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('tenantDomain' in parsed) ||
    typeof parsed.tenantDomain !== 'string' ||
    parsed.tenantDomain.trim() === '' ||
    parsed.tenantDomain.trim() !== parsed.tenantDomain
  ) {
    throw new Error(
      `E2E runtime state ${pathname} must contain a non-empty tenantDomain`,
    );
  }

  return { tenantDomain: parsed.tenantDomain };
};
