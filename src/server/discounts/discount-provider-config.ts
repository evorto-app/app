import { type EsnCardProviderConfig } from '@shared/tenant-config';
import consola from 'consola';

const ALLOWED_BUY_ESN_CARD_PROTOCOLS = new Set(['https:']);
const INVALID_BUY_CARD_URL_MESSAGE = 'buyEsnCardUrl must be a valid HTTPS URL';

class InvalidDiscountProviderConfigError extends Error {
  constructor() {
    super(INVALID_BUY_CARD_URL_MESSAGE);
    this.name = 'InvalidDiscountProviderConfigError';
  }
}

const parseBuyEsnCardUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (!ALLOWED_BUY_ESN_CARD_PROTOCOLS.has(url.protocol)) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

export const normalizeEsnCardConfig = (
  config: unknown,
  options?: { rejectInvalidUrl?: boolean },
): EsnCardProviderConfig => {
  if (!config || typeof config !== 'object') {
    return {};
  }

  const maybeBuyUrl = (
    config as {
      buyEsnCardUrl?: unknown;
    }
  ).buyEsnCardUrl;
  if (maybeBuyUrl === undefined || maybeBuyUrl === null) {
    return {};
  }

  const rejectInvalidUrl = options?.rejectInvalidUrl ?? false;
  if (typeof maybeBuyUrl !== 'string') {
    if (rejectInvalidUrl) {
      throw new InvalidDiscountProviderConfigError();
    }
    consola.warn('Ignoring invalid ESN buy card URL in tenant config');
    return {};
  }

  const trimmedBuyUrl = maybeBuyUrl.trim();
  if (trimmedBuyUrl.length === 0) {
    return {};
  }

  const normalizedBuyUrl = parseBuyEsnCardUrl(trimmedBuyUrl);
  if (!normalizedBuyUrl) {
    if (rejectInvalidUrl) {
      throw new InvalidDiscountProviderConfigError();
    }
    consola.warn('Ignoring invalid ESN buy card URL in tenant config');
    return {};
  }

  return { buyEsnCardUrl: normalizedBuyUrl };
};
