import { Injectable } from '@angular/core';
import { FetchHttpClient } from '@effect/platform';
import * as RpcClient from '@effect/rpc/RpcClient';
import * as RpcSerialization from '@effect/rpc/RpcSerialization';
import { Effect, Layer } from 'effect';

import {
  AppRpcs,
  type ConfigPermissions,
  type PublicConfig,
} from '../../shared/rpc-contracts/app-rpcs';
import { Tenant } from '../../types/custom/tenant';

const rpcLayer = RpcClient.layerProtocolHttp({ url: '/rpc' }).pipe(
  Layer.provide([RpcSerialization.layerJson, FetchHttpClient.layer]),
);

type AppRpcContractClient = RpcClient.FromGroup<typeof AppRpcs>;

const runRpc = <A>(
  call: (client: AppRpcContractClient) => Effect.Effect<A, never, never>,
) =>
  Effect.flatMap(RpcClient.make(AppRpcs), call).pipe(
    Effect.provide(rpcLayer),
    Effect.scoped,
    Effect.runPromise,
  );

@Injectable({
  providedIn: 'root',
})
export class EffectRpcClient {
  public getPermissions(): Promise<ConfigPermissions> {
    return runRpc((client) => client.config.permissions());
  }

  public getPublicConfig(): Promise<PublicConfig> {
    return runRpc((client) => client.config.public());
  }

  public getTenant(): Promise<Tenant> {
    return runRpc((client) => client.config.tenant());
  }

  public isAuthenticated(): Promise<boolean> {
    return runRpc((client) => client.config.isAuthenticated());
  }
}
