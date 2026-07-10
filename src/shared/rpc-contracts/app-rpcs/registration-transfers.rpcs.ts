import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import {
  RegistrationTransferStatus,
  registrationTransferStatuses,
} from '@shared/registration-transfer';
import { nonNegativeNumber } from '@shared/schema-utilities';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { Tenant } from '../../../types/custom/tenant';
import { RegistrationTransfersRpcError } from './registration-transfers.errors';

export const RegistrationTransferCredential = Schema.NonEmptyString.check(
  Schema.isMaxLength(512),
);

const NonNegativeQuantity = nonNegativeNumber.check(Schema.isInt());

export class RegistrationTransferAddonInput extends Schema.Class<RegistrationTransferAddonInput>(
  'RegistrationTransferAddonInput',
)({
  addOnId: Schema.NonEmptyString,
  quantity: NonNegativeQuantity,
}) {}

export class RegistrationTransferAddonRecord extends Schema.Class<RegistrationTransferAddonRecord>(
  'RegistrationTransferAddonRecord',
)({
  allowMultiple: Schema.Boolean,
  availableQuantity: NonNegativeQuantity,
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  maxQuantityPerUser: NonNegativeQuantity,
  title: Schema.NonEmptyString,
  unitPrice: nonNegativeNumber,
}) {}

export class RegistrationTransferAnswerInput extends Schema.Class<RegistrationTransferAnswerInput>(
  'RegistrationTransferAnswerInput',
)({
  answer: Schema.String,
  questionId: Schema.NonEmptyString,
}) {}

export class RegistrationTransferClaimInput extends Schema.Class<RegistrationTransferClaimInput>(
  'RegistrationTransferClaimInput',
)({
  addOns: Schema.Array(RegistrationTransferAddonInput),
  answers: Schema.Array(RegistrationTransferAnswerInput),
  credential: RegistrationTransferCredential,
  guestCount: NonNegativeQuantity,
}) {}

export class RegistrationTransferEventRecord extends Schema.Class<RegistrationTransferEventRecord>(
  'RegistrationTransferEventRecord',
)({
  end: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  start: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
}) {}

export class RegistrationTransferGuestAllowance extends Schema.Class<RegistrationTransferGuestAllowance>(
  'RegistrationTransferGuestAllowance',
)({
  allowed: Schema.Boolean,
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
  addOns: Schema.Array(RegistrationTransferAddonRecord),
  currency: Tenant.fields.currency,
  currentPrice: nonNegativeNumber,
  description: Schema.NullOr(Schema.String),
  guestAllowance: RegistrationTransferGuestAllowance,
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  questions: Schema.Array(RegistrationTransferQuestionRecord),
  title: Schema.NonEmptyString,
}) {}

export class RegistrationTransferClaimRecord extends Schema.Class<RegistrationTransferClaimRecord>(
  'RegistrationTransferClaimRecord',
)({
  event: RegistrationTransferEventRecord,
  expiresAt: Schema.NonEmptyString,
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
