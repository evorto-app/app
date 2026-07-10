const localRuntimeHostnames = new Set(['127.0.0.1', '[::1]', 'localhost']);
const localRuntimeNodeEnvironments = new Set(['development', 'test']);

const parseAbsoluteHttpUrl = (value: string, fieldName: string): URL => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error(`${fieldName} is required`);
  }

  const url = new URL(trimmedValue);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${fieldName} must use http or https`);
  }
  if (url.username || url.password) {
    throw new Error(`${fieldName} must not contain credentials`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      `${fieldName} must be an origin without a path, query, or fragment`,
    );
  }

  return url;
};

export const isLocalRuntimeHostname = (hostname: string): boolean =>
  localRuntimeHostnames.has(hostname.toLowerCase());

export const normalizeTenantDomain = (value: string): string => {
  const trimmedValue = value.trim().toLowerCase();
  if (!trimmedValue) {
    throw new Error('Domain is required');
  }

  const url = new URL(
    trimmedValue.includes('://') ? trimmedValue : `https://${trimmedValue}`,
  );
  if (
    !url.hostname ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error('Domain must be a single host name');
  }

  return url.hostname.toLowerCase();
};

export const defaultTenantCanonicalRootUrl = (domain: string): string => {
  const normalizedDomain = normalizeTenantDomain(domain);
  const protocol = isLocalRuntimeHostname(normalizedDomain)
    ? 'http:'
    : 'https:';
  return `${protocol}//${normalizedDomain}`;
};

export const normalizeTenantCanonicalRootUrl = (
  value: string,
  domain: string,
): string => {
  const normalizedDomain = normalizeTenantDomain(domain);
  const url = parseAbsoluteHttpUrl(value, 'Canonical root URL');

  if (url.hostname.toLowerCase() !== normalizedDomain) {
    throw new Error('Canonical root URL host must match the primary domain');
  }
  if (url.port) {
    throw new Error('Canonical root URL must not contain a port');
  }
  if (url.protocol === 'http:' && !isLocalRuntimeHostname(url.hostname)) {
    throw new Error(
      'Canonical root URL must use https outside local development',
    );
  }

  return url.origin;
};

export const normalizeLocalRuntimeOrigin = (value: string): string => {
  const url = parseAbsoluteHttpUrl(value, 'Local runtime origin');
  if (!isLocalRuntimeHostname(url.hostname)) {
    throw new Error('Local runtime origin must use a loopback host');
  }

  return url.origin;
};

export interface TenantOutboundRootUrlInput {
  readonly canonicalRootUrl: string;
  readonly domain: string;
  readonly localRuntimeOrigin?: string | undefined;
  readonly nodeEnvironment?: string | undefined;
}

export const resolveTenantOutboundRootUrl = (
  input: TenantOutboundRootUrlInput,
): string => {
  const canonicalRootUrl = normalizeTenantCanonicalRootUrl(
    input.canonicalRootUrl,
    input.domain,
  );
  const nodeEnvironment = input.nodeEnvironment?.trim().toLowerCase();
  if (
    !input.localRuntimeOrigin ||
    !nodeEnvironment ||
    !localRuntimeNodeEnvironments.has(nodeEnvironment)
  ) {
    return canonicalRootUrl;
  }

  return normalizeLocalRuntimeOrigin(input.localRuntimeOrigin);
};

export const buildTenantOutboundUrl = (
  input: TenantOutboundRootUrlInput & { readonly path: string },
): string => {
  const rootUrl = resolveTenantOutboundRootUrl(input);
  const url = new URL(input.path, `${rootUrl}/`);
  if (url.origin !== rootUrl) {
    throw new Error('Tenant outbound path must stay on the tenant root URL');
  }

  return url.toString();
};
