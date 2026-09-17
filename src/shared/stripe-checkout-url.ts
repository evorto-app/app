const stripeCheckoutHostname = 'checkout.stripe.com';

const parseStripeCheckoutUrl = (
  value: null | string | undefined,
): null | URL => {
  if (!value || !URL.canParse(value)) return null;

  const url = new URL(value);
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
