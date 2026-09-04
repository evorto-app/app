import { type EsnCardProviderConfig } from '@shared/tenant-config';

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
  buyEsnCardUrl: null | string | undefined,
): EsnCardProviderConfig => {
  const trimmedBuyUrl = buyEsnCardUrl?.trim() ?? '';
  if (trimmedBuyUrl.length === 0) {
    return {};
  }

  const normalizedBuyUrl = parseBuyEsnCardUrl(trimmedBuyUrl);
  if (!normalizedBuyUrl) throw new InvalidDiscountProviderConfigError();

  return { buyEsnCardUrl: normalizedBuyUrl };
};
