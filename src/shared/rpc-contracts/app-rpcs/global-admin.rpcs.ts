import * as RpcGroup from '@effect/rpc/RpcGroup';

import { GlobalAdminTenantsFindMany } from './definitions';

export class GlobalAdminRpcs extends RpcGroup.make(
  GlobalAdminTenantsFindMany,
) {}
