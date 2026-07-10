import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { ConfigPermissions } from '../../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { PlatformAdministratorAuthority } from '../../../../types/custom/platform-authority';
import { Tenant } from '../../../../types/custom/tenant';
import { getPublicConfigEffect } from '../../config/public-config.effect';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';

const decodeHeaderJson = <S extends Schema.ConstraintDecoder<unknown>>(
  value: string | undefined,
  schema: S,
): S['Type'] =>
  Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const decodeHeaderJsonEffect = <S extends Schema.ConstraintDecoder<unknown>>(
  headerName: string,
  value: string | undefined,
  schema: S,
) =>
  Effect.try({
    catch: (error) =>
      new RpcBadRequestError({
        message: `Invalid RPC header: ${headerName}`,
        reason: error instanceof Error ? error.message : String(error),
      }),
    try: () => decodeHeaderJson(value, schema),
  });

export const configHandlers = {
  'config.isAuthenticated': (_payload, options) =>
    Effect.succeed(
      options.headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true',
    ),
  'config.permissions': (_payload, options) =>
    decodeHeaderJsonEffect(
      RPC_CONTEXT_HEADERS.PERMISSIONS,
      options.headers[RPC_CONTEXT_HEADERS.PERMISSIONS],
      ConfigPermissions,
    ),
  'config.platformAuthority': (_payload, options) =>
    decodeHeaderJsonEffect(
      RPC_CONTEXT_HEADERS.PLATFORM_AUTHORITY,
      options.headers[RPC_CONTEXT_HEADERS.PLATFORM_AUTHORITY],
      Schema.NullOr(PlatformAdministratorAuthority),
    ),
  'config.public': () => getPublicConfigEffect,
  'config.tenant': (_payload, options) =>
    decodeHeaderJsonEffect(
      RPC_CONTEXT_HEADERS.TENANT,
      options.headers[RPC_CONTEXT_HEADERS.TENANT],
      Tenant,
    ),
} satisfies Partial<AppRpcHandlers>;
