export interface AddOnPaymentFields<TaxRateId extends null | string> {
  isPaid: boolean;
  price: number;
  stripeTaxRateId: TaxRateId;
}

export interface RegistrationPaymentFields<
  TaxRateId extends null | string,
  DiscountedPrice extends '' | null | number,
> extends AddOnPaymentFields<TaxRateId> {
  esnCardDiscountedPrice: DiscountedPrice;
}

export const resetAddOnPayment = <
  TaxRateId extends null | string,
  AddOn extends AddOnPaymentFields<TaxRateId>,
>(
  addOn: AddOn,
  emptyTaxRateId: NoInfer<TaxRateId>,
): AddOn => {
  if (
    !addOn.isPaid &&
    addOn.price === 0 &&
    addOn.stripeTaxRateId === emptyTaxRateId
  ) {
    return addOn;
  }

  return {
    ...addOn,
    isPaid: false,
    price: 0,
    stripeTaxRateId: emptyTaxRateId,
  };
};

export const resetRegistrationPayment = <
  TaxRateId extends null | string,
  DiscountedPrice extends '' | null | number,
  Registration extends RegistrationPaymentFields<TaxRateId, DiscountedPrice>,
>(
  registration: Registration,
  emptyTaxRateId: NoInfer<TaxRateId>,
  emptyDiscountedPrice: NoInfer<DiscountedPrice>,
): Registration => {
  if (
    !registration.isPaid &&
    registration.price === 0 &&
    registration.stripeTaxRateId === emptyTaxRateId &&
    registration.esnCardDiscountedPrice === emptyDiscountedPrice
  ) {
    return registration;
  }

  return {
    ...registration,
    esnCardDiscountedPrice: emptyDiscountedPrice,
    isPaid: false,
    price: 0,
    stripeTaxRateId: emptyTaxRateId,
  };
};
