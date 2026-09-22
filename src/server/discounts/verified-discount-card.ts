export interface VerifiedDiscountCardWindow {
  readonly validFrom: Date | null;
  readonly validTo: Date | null;
}

export const verifiedDiscountCardCoversEvent = (
  card: VerifiedDiscountCardWindow,
  eventStart: Date,
): boolean => {
  if (!card.validFrom || !card.validTo) {
    throw new TypeError(
      'Verified discount card is missing its validity window',
    );
  }

  if (card.validFrom > card.validTo) {
    throw new TypeError(
      'Verified discount card has an invalid validity window',
    );
  }

  return card.validFrom <= eventStart && card.validTo > eventStart;
};
