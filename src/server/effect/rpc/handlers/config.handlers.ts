import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { ConfigPermissions } from '../../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { Tenant } from '../../../../types/custom/tenant';
import { getPublicConfigEffect } from '../../config/public-config.effect';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const decodeHeaderJsonEffect = <A, I>(
  headerName: string,
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
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
  'config.public': () => getPublicConfigEffect,
  'config.tenant': (_payload, options) =>
    decodeHeaderJsonEffect(
      RPC_CONTEXT_HEADERS.TENANT,
      options.headers[RPC_CONTEXT_HEADERS.TENANT],
      Tenant,
    ),
} satisfies Partial<AppRpcHandlers>;
