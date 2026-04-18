import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

import {
  DiscountsCardMutationError,
  DiscountsRpcError,
} from './discounts.errors';

export const DiscountProviderRecord = Schema.Struct({
  config: Schema.Struct({
    buyEsnCardUrl: Schema.optional(Schema.NonEmptyString),
  }),
  status: Schema.Literal('disabled', 'enabled'),
  type: Schema.Literal('esnCard'),
});

export type DiscountProviderRecord = Schema.Schema.Type<
  typeof DiscountProviderRecord
>;

export const DiscountCardRecord = Schema.Struct({
  id: Schema.NonEmptyString,
  identifier: Schema.NonEmptyString,
  status: Schema.Literal('expired', 'invalid', 'unverified', 'verified'),
  type: Schema.Literal('esnCard'),
  validTo: Schema.NullOr(Schema.String),
});

export type DiscountCardRecord = Schema.Schema.Type<typeof DiscountCardRecord>;

export const DiscountsGetTenantProviders = asRpcQuery(
  Rpc.make('discounts.getTenantProviders', {
    error: DiscountsRpcError,
    payload: Schema.Void,
    success: Schema.Array(DiscountProviderRecord),
  }),
);

export const DiscountsGetMyCards = asRpcQuery(
  Rpc.make('discounts.getMyCards', {
    error: DiscountsRpcError,
    payload: Schema.Void,
    success: Schema.Array(DiscountCardRecord),
  }),
);

const DiscountsCardTypeInput = Schema.Struct({
  type: Schema.Literal('esnCard'),
});

export const DiscountsDeleteMyCard = asRpcMutation(
  Rpc.make('discounts.deleteMyCard', {
    error: DiscountsCardMutationError,
    payload: DiscountsCardTypeInput,
    success: Schema.Void,
  }),
);

export const DiscountsRefreshMyCard = asRpcMutation(
  Rpc.make('discounts.refreshMyCard', {
    error: DiscountsCardMutationError,
    payload: DiscountsCardTypeInput,
    success: DiscountCardRecord,
  }),
);

export const DiscountsUpsertMyCard = asRpcMutation(
  Rpc.make('discounts.upsertMyCard', {
    error: DiscountsCardMutationError,
    payload: Schema.Struct({
      identifier: Schema.NonEmptyString,
      type: Schema.Literal('esnCard'),
    }),
    success: DiscountCardRecord,
  }),
);

export class DiscountsRpcs extends RpcGroup.make(
  DiscountsGetTenantProviders,
  DiscountsGetMyCards,
  DiscountsDeleteMyCard,
  DiscountsRefreshMyCard,
  DiscountsUpsertMyCard,
) {}
