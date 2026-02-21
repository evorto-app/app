import * as RpcGroup from '@effect/rpc/RpcGroup';

import { IconsAdd, IconsSearch } from './definitions';

export class IconsRpcs extends RpcGroup.make(
  IconsSearch,
  IconsAdd,
) {}
