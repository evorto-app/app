const stripeCheckoutHostname = 'checkout.stripe.com';

const parseStripeCheckoutUrl = (
  value: null | string | undefined,
): null | URL => {
  if (!value) return null;

  // Browsers ship this helper too; Safari before 17 has no URL.canParse.
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== stripeCheckoutHostname ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    return null;
  }
  return url;
};

export const normalizeStripeCheckoutUrl = (
  value: null | string | undefined,
): null | string => {
  const url = parseStripeCheckoutUrl(value);
  return url === null ? null : url.toString();
};

export const stripeCheckoutUrlMatchesSession = (
  value: string,
  sessionId: string,
): boolean => {
  const url = parseStripeCheckoutUrl(value);
  if (!url || sessionId.length === 0) return false;

  const pathSegments = url.pathname.split('/');
  return pathSegments.at(-1) === sessionId;
};
