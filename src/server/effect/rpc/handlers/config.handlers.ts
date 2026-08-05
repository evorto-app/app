import { Effect } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { toClientTenantConfig } from '../../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { getPublicConfigEffect } from '../../config/public-config.effect';
import { RpcAccess } from './shared/rpc-access.service';

export const configHandlers = {
  'config.isAuthenticated': (_payload, _options) =>
    RpcAccess.current().pipe(Effect.map((context) => context.authenticated)),
  'config.permissions': (_payload, _options) =>
    RpcAccess.current().pipe(Effect.map((context) => [...context.permissions])),
  'config.platformAuthority': (_payload, _options) =>
    RpcAccess.current().pipe(
      Effect.map((context) => context.platformAuthority ?? null),
    ),
  'config.public': (_payload, _options) => getPublicConfigEffect,
  'config.tenant': (_payload, _options) =>
    RpcAccess.current().pipe(
      Effect.map((context) => toClientTenantConfig(context.tenant)),
    ),
} satisfies Partial<AppRpcHandlers>;
