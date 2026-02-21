import * as RpcGroup from '@effect/rpc/RpcGroup';

import { ConfigIsAuthenticated, ConfigPermissionList, ConfigPublic, ConfigTenant } from './definitions';

export class ConfigRpcs extends RpcGroup.make(
  ConfigPublic,
  ConfigIsAuthenticated,
  ConfigPermissionList,
  ConfigTenant,
) {}
