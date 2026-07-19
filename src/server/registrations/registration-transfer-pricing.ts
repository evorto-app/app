import { Effect, Schema } from 'effect';

import {
  isPersistableNonNegativeInteger,
  maximumPersistedPaymentAmount,
} from '../payments/payment-amount';

export type RegistrationTransferClaimPricing<DiscountType extends string> =
  RegistrationTransferPrice<DiscountType> & {
    readonly basePrice: number;
    readonly sealed: boolean;
  };

export type RegistrationTransferClaimPricingInput<DiscountType extends string> =
  | {
      readonly appliedDiscountedPrice: null | number;
      readonly appliedDiscountType: DiscountType | null;
      readonly basePrice: number;
      readonly discountAmount: null | number;
      readonly mode: 'sealed';
    }
  | {
      readonly basePrice: number;
      readonly mode: 'current';
      readonly pricing: RegistrationTransferPrice<DiscountType>;
    };

export interface RegistrationTransferDiscount<DiscountType extends string> {
  readonly discountedPrice: number;
  readonly discountType: DiscountType;
}

export interface RegistrationTransferDiscountCard {
  readonly type: string;
  readonly validFrom: Date | null;
  readonly validTo: Date | null;
}

export interface RegistrationTransferPrice<DiscountType extends string> {
  readonly appliedDiscountedPrice: null | number;
  readonly appliedDiscountType: DiscountType | null;
  readonly discountAmount: null | number;
  readonly effectivePrice: number;
}

export class RegistrationTransferPricingError extends Schema.TaggedErrorClass<RegistrationTransferPricingError>()(
  'RegistrationTransferPricingError',
  { message: Schema.String },
) {}

export const registrationTransferBasePrice = (input: {
  readonly isPaid: boolean;
  readonly price: number;
}): number => (input.isPaid ? input.price : 0);

export const resolveRegistrationTransferClaimPricing = <
  DiscountType extends string,
>(
  input: RegistrationTransferClaimPricingInput<DiscountType>,
): RegistrationTransferClaimPricing<DiscountType> =>
  input.mode === 'current'
    ? {
        ...input.pricing,
        basePrice: input.basePrice,
        sealed: false,
      }
    : {
        appliedDiscountedPrice: input.appliedDiscountedPrice,
        appliedDiscountType: input.appliedDiscountType,
        basePrice: input.basePrice,
        discountAmount: input.discountAmount,
        effectivePrice: input.appliedDiscountedPrice ?? input.basePrice,
        sealed: true,
      };

export const resolveRegistrationTransferPrice = <DiscountType extends string>({
  basePrice,
  cards,
  discounts,
  enabledDiscountTypes,
  eventStart,
}: {
  basePrice: number;
  cards: readonly RegistrationTransferDiscountCard[];
  discounts: readonly RegistrationTransferDiscount<DiscountType>[];
  enabledDiscountTypes: ReadonlySet<string>;
  eventStart: Date;
}): RegistrationTransferPrice<DiscountType> => {
  let bestDiscount: RegistrationTransferDiscount<DiscountType> | undefined;
  for (const discount of discounts) {
    const eligible = cards.some(
      (card) =>
        card.type === discount.discountType &&
        enabledDiscountTypes.has(card.type) &&
        (!card.validFrom || card.validFrom <= eventStart) &&
        (!card.validTo || card.validTo > eventStart),
    );
    if (
      eligible &&
      (!bestDiscount || discount.discountedPrice < bestDiscount.discountedPrice)
    ) {
      bestDiscount = discount;
    }
  }

  if (!bestDiscount) {
    return {
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      discountAmount: null,
      effectivePrice: basePrice,
    };
  }

  return {
    appliedDiscountedPrice: bestDiscount.discountedPrice,
    appliedDiscountType: bestDiscount.discountType,
    discountAmount: Math.max(0, basePrice - bestDiscount.discountedPrice),
    effectivePrice: bestDiscount.discountedPrice,
  };
};

export const registrationTransferTotalPrice = Effect.fn(
  'registrationTransferTotalPrice',
)(function* ({
  addOns,
  effectivePrice,
  guestCount,
  guestUnitPrice,
}: {
  addOns: readonly { quantity: number; unitPrice: number }[];
  effectivePrice: number;
  guestCount: number;
  guestUnitPrice: number;
}) {
  const scalarValues = [effectivePrice, guestCount, guestUnitPrice];
  if (
    scalarValues.some((value) => !isPersistableNonNegativeInteger(value)) ||
    addOns.some(
      ({ quantity, unitPrice }) =>
        !isPersistableNonNegativeInteger(quantity) ||
        !isPersistableNonNegativeInteger(unitPrice),
    )
  ) {
    return yield* RegistrationTransferPricingError.make({
      message: 'Registration transfer pricing contains an invalid amount',
    });
  }

  const totalPrice =
    BigInt(effectivePrice) +
    BigInt(guestCount) * BigInt(guestUnitPrice) +
    addOns.reduce(
      (total, addOn) =>
        total + BigInt(addOn.quantity) * BigInt(addOn.unitPrice),
      0n,
    );
  if (totalPrice > BigInt(maximumPersistedPaymentAmount)) {
    return yield* RegistrationTransferPricingError.make({
      message: 'Registration transfer price exceeds supported payment limits',
    });
  }

  return Number(totalPrice);
});
