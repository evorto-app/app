import { MAX_STRIPE_CHECKOUT_LINE_ITEMS } from '@shared/registration-quantity-limits';

export const registrationCheckoutHasTooManyLines = (
  lineItems: readonly unknown[],
): boolean => lineItems.length > MAX_STRIPE_CHECKOUT_LINE_ITEMS;
