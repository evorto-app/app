import type { Headers } from '@effect/platform';
import { RpcMiddleware } from '@effect/rpc';
import { Context } from 'effect';

import { type Permission } from '../../permissions/permissions';
import { Tenant } from '../../../types/custom/tenant';
import { User } from '../../../types/custom/user';
import { UsersAuthData } from './definitions';

export interface RpcRequestContextShape {
  authData: Record<string, unknown> | UsersAuthData;
  authenticated: boolean;
  permissions: readonly Permission[];
  tenant: Tenant;
  user: null | User;
  userAssigned: boolean;
}

export class RpcRequestContext extends Context.Tag(
  '@shared/rpc-contracts/app-rpcs/RpcRequestContext',
)<RpcRequestContext, RpcRequestContextShape>() {}

export class RpcRequestContextMiddleware extends RpcMiddleware.Tag<RpcRequestContextMiddleware>()(
  '@shared/rpc-contracts/app-rpcs/RpcRequestContextMiddleware',
  {
    provides: RpcRequestContext,
  },
) {}

export type RpcHeaders = Headers.Headers;
