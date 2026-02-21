import * as RpcGroup from '@effect/rpc/RpcGroup';

import { DiscountsGetTenantProviders, DiscountsGetMyCards, DiscountsDeleteMyCard, DiscountsRefreshMyCard, DiscountsUpsertMyCard } from './definitions';

export class DiscountsRpcs extends RpcGroup.make(
  DiscountsGetTenantProviders,
  DiscountsGetMyCards,
  DiscountsDeleteMyCard,
  DiscountsRefreshMyCard,
  DiscountsUpsertMyCard,
) {}
