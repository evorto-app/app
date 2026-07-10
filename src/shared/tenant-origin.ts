const loopbackHostnames = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

const containsForbiddenRawUrlSyntax = (value: string): boolean =>
  value.includes('@') || value.includes('?') || value.includes('#');

const parseOrigin = (value: string, label: string): URL => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error(`${label} is required`);
  }
  if (containsForbiddenRawUrlSyntax(trimmedValue)) {
    throw new Error(`${label} must be an origin without credentials or a path`);
  }

  const url = new URL(trimmedValue);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !url.hostname ||
    url.hostname.endsWith('.') ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(`${label} must be an origin without credentials or a path`);
  }

  return url;
};

export const normalizeTenantDomain = (value: string): string => {
  const trimmedValue = value.trim().toLowerCase();
  if (!trimmedValue) {
    throw new Error('Domain is required');
  }
  if (containsForbiddenRawUrlSyntax(trimmedValue)) {
    throw new Error('Domain must be a single host name');
  }

  const url = new URL(
    trimmedValue.includes('://') ? trimmedValue : `https://${trimmedValue}`,
  );
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !url.hostname ||
    url.hostname.endsWith('.') ||
    url.pathname !== '/' ||
    url.port ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error('Domain must be a single host name');
  }

  return url.hostname;
};

export const normalizeTenantCanonicalRootUrl = (
  value: string,
  primaryDomain: string,
): string => {
  const normalizedDomain = normalizeTenantDomain(primaryDomain);
  const url = parseOrigin(value, 'Canonical root URL');

  if (url.protocol !== 'https:') {
    throw new Error('Canonical root URL must use HTTPS');
  }
  if (url.port) {
    throw new Error('Canonical root URL must not use a non-default port');
  }
  if (url.hostname !== normalizedDomain) {
    throw new Error('Canonical root URL must match the primary domain');
  }

  return url.origin;
};

const normalizeLoopbackDevelopmentOrigin = (value: string): null | string => {
  try {
    const url = parseOrigin(value, 'BASE_URL');
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !loopbackHostnames.has(url.hostname.toLowerCase())
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
};

export const resolveTenantPublicOrigin = ({
  baseUrl,
  canonicalRootUrl,
  nodeEnvironment,
  primaryDomain,
}: {
  baseUrl: string | undefined;
  canonicalRootUrl: string;
  nodeEnvironment: string | undefined;
  primaryDomain: string;
}): string => {
  const canonicalOrigin = normalizeTenantCanonicalRootUrl(
    canonicalRootUrl,
    primaryDomain,
  );
  const normalizedEnvironment = nodeEnvironment?.trim().toLowerCase();
  const canUseDevelopmentOverride =
    normalizedEnvironment === 'development' || normalizedEnvironment === 'test';

  if (canUseDevelopmentOverride && baseUrl) {
    return normalizeLoopbackDevelopmentOrigin(baseUrl) ?? canonicalOrigin;
  }

  return canonicalOrigin;
};
