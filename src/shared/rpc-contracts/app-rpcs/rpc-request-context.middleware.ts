import type { Headers } from 'effect/unstable/http';

import { Context } from 'effect';
import { RpcMiddleware } from 'effect/unstable/rpc';

import { Tenant } from '../../../types/custom/tenant';
import { User } from '../../../types/custom/user';
import { type Permission } from '../../permissions/permissions';
import { UsersAuthData } from './users.rpcs';

export type RpcHeaders = Headers.Headers;

export interface RpcRequestContextShape {
  authData: Record<string, unknown> | UsersAuthData;
  authenticated: boolean;
  permissions: readonly Permission[];
  tenant: Tenant;
  user: null | User;
  userAssigned: boolean;
}

export class RpcRequestContext extends Context.Service<
  RpcRequestContext,
  RpcRequestContextShape
>()('@shared/rpc-contracts/app-rpcs/RpcRequestContext') {}

export class RpcRequestContextMiddleware extends RpcMiddleware.Service<
  RpcRequestContextMiddleware,
  { provides: RpcRequestContext }
>()('@shared/rpc-contracts/app-rpcs/RpcRequestContextMiddleware') {}
