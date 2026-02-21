import * as RpcGroup from '@effect/rpc/RpcGroup';

import { ConfigPublic, ConfigIsAuthenticated, ConfigPermissionList, ConfigTenant } from './definitions';

export class ConfigRpcs extends RpcGroup.make(
  ConfigPublic,
  ConfigIsAuthenticated,
  ConfigPermissionList,
  ConfigTenant,
) {}
