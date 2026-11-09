import { asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';
import * as Rpc from 'effect/rpc/Rpc';
import * as RpcGroup from 'effect/rpc/RpcGroup';

import { ForbiddenOrUnauthorizedRpcError } from '../../errors/rpc-errors';

export const TaxRatesRpcError = ForbiddenOrUnauthorizedRpcError;

export type TaxRatesRpcError = ForbiddenOrUnauthorizedRpcError;

export const TaxRatesListActiveRecord = Schema.Struct({
  country: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  percentage: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
  stripeTaxRateId: Schema.NonEmptyString,
});

export type TaxRatesListActiveRecord = Schema.Schema.Type<
  typeof TaxRatesListActiveRecord
>;

export const TaxRatesListActive = asRpcQuery(
  Rpc.make('taxRates.listActive', {
    error: TaxRatesRpcError,
    payload: Schema.Void,
    success: Schema.Array(TaxRatesListActiveRecord),
  }),
);

export class TaxRatesRpcs extends RpcGroup.make(TaxRatesListActive) {}
