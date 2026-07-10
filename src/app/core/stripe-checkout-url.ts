const stripeCheckoutHostname = 'checkout.stripe.com';

export const normalizeStripeCheckoutUrl = (
  value: null | string | undefined,
): null | string => {
  if (!value) {
    return null;
  }

  try {
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

    return url.toString();
  } catch {
    return null;
  }
};
