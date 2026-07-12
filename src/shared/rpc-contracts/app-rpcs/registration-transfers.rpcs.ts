import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import {
  RegistrationTransferRefundLifecycle,
  RegistrationTransferStatus,
  registrationTransferStatuses,
} from '@shared/registration-transfer';
import { nonNegativeNumber, positiveNumber } from '@shared/schema-utilities';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { Tenant } from '../../../types/custom/tenant';
import { RegistrationTransfersRpcError } from './registration-transfers.errors';

export const RegistrationTransferCredential = Schema.NonEmptyString.check(
  Schema.isMaxLength(512),
);

const NonNegativeQuantity = nonNegativeNumber.check(Schema.isInt());
const PositiveQuantity = positiveNumber.check(Schema.isInt());

export class RegistrationTransferAnswerInput extends Schema.Class<RegistrationTransferAnswerInput>(
  'RegistrationTransferAnswerInput',
)({
  answer: Schema.String,
  questionId: Schema.NonEmptyString,
}) {}

export class RegistrationTransferBundleAddonRecord extends Schema.Class<RegistrationTransferBundleAddonRecord>(
  'RegistrationTransferBundleAddonRecord',
)({
  cancelledQuantity: NonNegativeQuantity,
  currentUnitPrice: nonNegativeNumber,
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  includedQuantity: NonNegativeQuantity,
  purchasedQuantity: NonNegativeQuantity,
  quantity: PositiveQuantity,
  redeemedQuantity: NonNegativeQuantity,
  remainingQuantity: NonNegativeQuantity,
  title: Schema.NonEmptyString,
}) {}

export class RegistrationTransferBundleRecord extends Schema.Class<RegistrationTransferBundleRecord>(
  'RegistrationTransferBundleRecord',
)({
  addOns: Schema.Array(RegistrationTransferBundleAddonRecord),
  checkedInGuestCount: NonNegativeQuantity,
  checkInTime: Schema.NullOr(Schema.NonEmptyString),
  guestCount: NonNegativeQuantity,
  guestUnitPrice: nonNegativeNumber,
}) {}

export class RegistrationTransferClaimInput extends Schema.Class<RegistrationTransferClaimInput>(
  'RegistrationTransferClaimInput',
)({
  answers: Schema.Array(RegistrationTransferAnswerInput),
  credential: RegistrationTransferCredential,
}) {}

export class RegistrationTransferEventRecord extends Schema.Class<RegistrationTransferEventRecord>(
  'RegistrationTransferEventRecord',
)({
  end: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  start: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
}) {}

export class RegistrationTransferQuestionRecord extends Schema.Class<RegistrationTransferQuestionRecord>(
  'RegistrationTransferQuestionRecord',
)({
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  required: Schema.Boolean,
  title: Schema.NonEmptyString,
}) {}

export class RegistrationTransferOptionRecord extends Schema.Class<RegistrationTransferOptionRecord>(
  'RegistrationTransferOptionRecord',
)({
  currency: Tenant.fields.currency,
  currentPrice: nonNegativeNumber,
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  questions: Schema.Array(RegistrationTransferQuestionRecord),
  title: Schema.NonEmptyString,
}) {}

export class RegistrationTransferClaimRecord extends Schema.Class<RegistrationTransferClaimRecord>(
  'RegistrationTransferClaimRecord',
)({
  bundle: RegistrationTransferBundleRecord,
  event: RegistrationTransferEventRecord,
  expiresAt: Schema.NonEmptyString,
  refundLifecycle: Schema.NullOr(RegistrationTransferRefundLifecycle),
  registrationOption: RegistrationTransferOptionRecord,
  status: RegistrationTransferStatus,
  transferId: Schema.NonEmptyString,
}) {}

export class RegistrationTransferOfferResult extends Schema.Class<RegistrationTransferOfferResult>(
  'RegistrationTransferOfferResult',
)({
  claimCode: RegistrationTransferCredential,
  claimUrl: Schema.NonEmptyString,
  expiresAt: Schema.NonEmptyString,
  status: Schema.Literal(registrationTransferStatuses[0]),
}) {}

export const RegistrationTransferClaimStatus = Schema.Literals([
  'confirmed',
  'paymentPending',
]);

export class RegistrationTransferClaimResult extends Schema.Class<RegistrationTransferClaimResult>(
  'RegistrationTransferClaimResult',
)({
  checkoutUrl: Schema.optional(Schema.NonEmptyString),
  eventId: Schema.NonEmptyString,
  registrationId: Schema.NonEmptyString,
  status: RegistrationTransferClaimStatus,
}) {}

export class RegistrationTransferRetryCheckoutResult extends Schema.Class<RegistrationTransferRetryCheckoutResult>(
  'RegistrationTransferRetryCheckoutResult',
)({
  checkoutUrl: Schema.optional(Schema.NonEmptyString),
  status: Schema.Literals(['paymentPending', 'reconciled']),
}) {}

export const RegistrationTransfersCreateOffer = asRpcMutation(
  Rpc.make('registrationTransfers.createOffer', {
    error: RegistrationTransfersRpcError,
    payload: Schema.Struct({
      registrationId: Schema.NonEmptyString,
    }),
    success: RegistrationTransferOfferResult,
  }),
);

export const RegistrationTransfersGetClaim = asRpcQuery(
  Rpc.make('registrationTransfers.getClaim', {
    error: RegistrationTransfersRpcError,
    payload: Schema.Struct({
      credential: RegistrationTransferCredential,
    }),
    success: RegistrationTransferClaimRecord,
  }),
);

export const RegistrationTransfersClaim = asRpcMutation(
  Rpc.make('registrationTransfers.claim', {
    error: RegistrationTransfersRpcError,
    payload: RegistrationTransferClaimInput,
    success: RegistrationTransferClaimResult,
  }),
);

export const RegistrationTransfersCancel = asRpcMutation(
  Rpc.make('registrationTransfers.cancel', {
    error: RegistrationTransfersRpcError,
    payload: Schema.Struct({
      transferId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const RegistrationTransfersRetryCheckout = asRpcMutation(
  Rpc.make('registrationTransfers.retryCheckout', {
    error: RegistrationTransfersRpcError,
    payload: Schema.Struct({
      transferId: Schema.NonEmptyString,
    }),
    success: RegistrationTransferRetryCheckoutResult,
  }),
);

export class RegistrationTransfersRpcs extends RpcGroup.make(
  RegistrationTransfersCreateOffer,
  RegistrationTransfersGetClaim,
  RegistrationTransfersClaim,
  RegistrationTransfersCancel,
  RegistrationTransfersRetryCheckout,
) {}
