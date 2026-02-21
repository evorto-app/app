import * as RpcGroup from '@effect/rpc/RpcGroup';

import { UsersAuthDataFind, UsersCreateAccount, UsersEventsFindMany, UsersFindMany, UsersMaybeSelf, UsersSelf, UsersUpdateProfile, UsersUserAssigned } from './definitions';

export class UsersRpcs extends RpcGroup.make(
  UsersAuthDataFind,
  UsersCreateAccount,
  UsersFindMany,
  UsersEventsFindMany,
  UsersMaybeSelf,
  UsersSelf,
  UsersUpdateProfile,
  UsersUserAssigned,
) {}
