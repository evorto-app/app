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

export const deriveTenantPublicOrigin = (primaryDomain: string): string =>
  `https://${normalizeTenantDomain(primaryDomain)}`;

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
  nodeEnvironment,
  primaryDomain,
}: {
  baseUrl: string | undefined;
  nodeEnvironment: string | undefined;
  primaryDomain: string;
}): string => {
  const tenantOrigin = deriveTenantPublicOrigin(primaryDomain);
  const normalizedEnvironment = nodeEnvironment?.trim().toLowerCase();
  const canUseDevelopmentOverride =
    normalizedEnvironment === 'development' || normalizedEnvironment === 'test';

  if (canUseDevelopmentOverride && baseUrl) {
    return normalizeLoopbackDevelopmentOrigin(baseUrl) ?? tenantOrigin;
  }

  return tenantOrigin;
};
