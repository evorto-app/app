import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

export const TaxRatesRpcError = Schema.Literal('FORBIDDEN');

export type TaxRatesRpcError = Schema.Schema.Type<typeof TaxRatesRpcError>;

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

export class TaxRatesRpcs extends RpcGroup.make(
  TaxRatesListActive,
) {}
