export interface RegistrationTransferDiscount<DiscountType extends string> {
  readonly discountedPrice: number;
  readonly discountType: DiscountType;
}

export interface RegistrationTransferDiscountCard {
  readonly type: string;
  readonly validTo: Date | null;
}

export interface RegistrationTransferPrice<DiscountType extends string> {
  readonly appliedDiscountedPrice: null | number;
  readonly appliedDiscountType: DiscountType | null;
  readonly discountAmount: null | number;
  readonly effectivePrice: number;
}

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

export const registrationTransferTotalPrice = ({
  addOnTotal,
  effectivePrice,
  guestCount,
  guestUnitPrice,
}: {
  addOnTotal: number;
  effectivePrice: number;
  guestCount: number;
  guestUnitPrice: number;
}): number => effectivePrice + guestCount * guestUnitPrice + addOnTotal;
