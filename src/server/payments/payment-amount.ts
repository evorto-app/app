/** PostgreSQL `integer` upper bound used by persisted transaction amounts. */
export const maximumPersistedPaymentAmount = 2_147_483_647;

export const isPersistableNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= maximumPersistedPaymentAmount;
