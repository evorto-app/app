import * as RpcGroup from '@effect/rpc/RpcGroup';

import { IconsSearch, IconsAdd } from './definitions';

export class IconsRpcs extends RpcGroup.make(
  IconsSearch,
  IconsAdd,
) {}
