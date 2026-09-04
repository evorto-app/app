export interface RegistrationPriceSnapshot {
  readonly appliedDiscountedPrice: null | number;
  readonly appliedDiscountType: 'esnCard' | null;
  readonly basePriceAtRegistration: null | number;
  readonly discountAmount: null | number;
}

export const readRegistrationPriceSnapshot = (
  input: RegistrationPriceSnapshot & {
    readonly paymentPending: boolean;
    readonly registrationId: string;
    readonly status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
  },
): RegistrationPriceSnapshot => {
  const snapshotRequired = input.status === 'CONFIRMED' || input.paymentPending;
  const baseSnapshotComplete =
    input.basePriceAtRegistration !== null && input.discountAmount !== null;
  const discountPairComplete =
    (input.appliedDiscountedPrice === null) ===
    (input.appliedDiscountType === null);

  if (
    (snapshotRequired && !baseSnapshotComplete) ||
    (!baseSnapshotComplete &&
      (input.basePriceAtRegistration !== null ||
        input.discountAmount !== null ||
        input.appliedDiscountedPrice !== null ||
        input.appliedDiscountType !== null)) ||
    !discountPairComplete
  ) {
    throw new Error(
      `Registration ${input.registrationId} has an incomplete price snapshot`,
    );
  }

  if (baseSnapshotComplete) {
    const expectedDiscountAmount =
      input.appliedDiscountedPrice === null
        ? 0
        : Math.max(
            0,
            input.basePriceAtRegistration - input.appliedDiscountedPrice,
          );
    if (input.discountAmount !== expectedDiscountAmount) {
      throw new Error(
        `Registration ${input.registrationId} has an inconsistent price snapshot`,
      );
    }
  }

  return {
    appliedDiscountedPrice: input.appliedDiscountedPrice,
    appliedDiscountType: input.appliedDiscountType,
    basePriceAtRegistration: input.basePriceAtRegistration,
    discountAmount: input.discountAmount,
  };
};
