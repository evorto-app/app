import * as RpcGroup from '@effect/rpc/RpcGroup';

import { TaxRatesListActive } from './definitions';

export class TaxRatesRpcs extends RpcGroup.make(
  TaxRatesListActive,
) {}
