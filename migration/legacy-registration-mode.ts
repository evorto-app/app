export const legacyParticipantRegistrationMode = ({
  deferredPayment,
  registrationMode,
}: {
  readonly deferredPayment: boolean;
  readonly registrationMode: 'EXTERNAL' | 'ONLINE' | 'STRIPE';
}): 'application' | 'fcfs' => {
  if (registrationMode === 'EXTERNAL') {
    throw new Error(
      'Legacy external registration has no target representation; migration is blocked.',
    );
  }
  if (!deferredPayment) return 'fcfs';
  if (registrationMode !== 'STRIPE') {
    throw new Error(
      'Legacy deferred payment is only representable for Stripe registration; migration is blocked.',
    );
  }
  return 'application';
};
