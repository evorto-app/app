import { Schema } from 'effect';

export const registrationTransferStatuses = [
  'open',
  'checkout_pending',
  'refund_pending',
  'refund_failed',
  'compensation_pending',
  'compensation_failed',
  'compensated',
  'completed',
  'cancelled',
  'expired',
] as const;

export const RegistrationTransferStatus = Schema.Literals(
  registrationTransferStatuses,
);
export type RegistrationTransferStatus = Schema.Schema.Type<
  typeof RegistrationTransferStatus
>;

export const activeRegistrationTransferStatuses = [
  'open',
  'checkout_pending',
  'refund_pending',
  'refund_failed',
] as const satisfies readonly RegistrationTransferStatus[];
export type ActiveRegistrationTransferStatus =
  (typeof activeRegistrationTransferStatuses)[number];

export const isActiveRegistrationTransferStatus = (
  status: RegistrationTransferStatus,
): status is ActiveRegistrationTransferStatus => {
  switch (status) {
    case 'checkout_pending':
    case 'open':
    case 'refund_failed':
    case 'refund_pending': {
      return true;
    }
    default: {
      return false;
    }
  }
};

export const terminalRegistrationTransferStatuses =
  new Set<RegistrationTransferStatus>([
    'cancelled',
    'compensated',
    'completed',
    'expired',
  ]);
