interface CurrentAcquisitionPayment {
  readonly id: string;
  readonly transactionId: string;
}

interface RefundPlanAcquisitionLink {
  readonly sourceAcquisitionId: string;
  readonly sourceAcquisitionPaymentId: null | string;
  readonly sourceTransactionId: string;
}

export const refundPlansExactlyCoverCurrentAcquisitionPayments = (input: {
  readonly currentAcquisitionId: string;
  readonly currentPayments: readonly CurrentAcquisitionPayment[];
  readonly refundPlans: readonly RefundPlanAcquisitionLink[];
}): boolean => {
  if (input.currentPayments.length !== input.refundPlans.length) {
    return false;
  }

  const currentTransactionIdByPaymentId = new Map(
    input.currentPayments.map((payment) => [payment.id, payment.transactionId]),
  );
  const coveredPaymentIds = new Set<string>();
  const coveredTransactionIds = new Set<string>();

  for (const plan of input.refundPlans) {
    if (
      plan.sourceAcquisitionId !== input.currentAcquisitionId ||
      !plan.sourceAcquisitionPaymentId ||
      currentTransactionIdByPaymentId.get(plan.sourceAcquisitionPaymentId) !==
        plan.sourceTransactionId ||
      coveredPaymentIds.has(plan.sourceAcquisitionPaymentId) ||
      coveredTransactionIds.has(plan.sourceTransactionId)
    ) {
      return false;
    }
    coveredPaymentIds.add(plan.sourceAcquisitionPaymentId);
    coveredTransactionIds.add(plan.sourceTransactionId);
  }

  return input.currentPayments.every(
    (payment) =>
      coveredPaymentIds.has(payment.id) &&
      coveredTransactionIds.has(payment.transactionId),
  );
};
