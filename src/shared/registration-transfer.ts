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

export const RegistrationTransferRefundLifecycleState = Schema.Literals([
  'actionRequired',
  'needsAttention',
  'processing',
  'succeeded',
]);

export type RegistrationTransferRefundLifecycleState = Schema.Schema.Type<
  typeof RegistrationTransferRefundLifecycleState
>;

export class RegistrationTransferRefundLifecycle extends Schema.Class<RegistrationTransferRefundLifecycle>(
  'RegistrationTransferRefundLifecycle',
)({
  state: RegistrationTransferRefundLifecycleState,
}) {}

/**
 * A transfer remains the active ownership operation while its source refunds
 * are pending or failed. This intentionally blocks a second transfer offer
 * until the refund succeeds or an operator recovers it; ordinary ticket and
 * add-on use is blocked only during the open/Checkout ownership handoff.
 */
export const activeRegistrationTransferStatuses = [
  'open',
  'checkout_pending',
  'refund_pending',
  'refund_failed',
] as const satisfies readonly RegistrationTransferStatus[];
export type ActiveRegistrationTransferStatus =
  (typeof activeRegistrationTransferStatuses)[number];

export const registrationTransferAddonAllocationKey = (
  transferId: string,
  purchaseId: string,
): string => `registration-transfer-addon:${transferId}:${purchaseId}`;

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
