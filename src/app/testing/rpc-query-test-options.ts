import {
  createRpcQueryOptions,
  type RpcKeyPrefix,
  type RpcQueryFn,
  type RpcQueryKey,
  type RpcUndefinedQueryOptions,
  type RpcUndefinedQueryOptionsOverrides,
} from '@heddendorp/effect-angular-query';

/**
 * Builds typed RPC query options in unit tests using contextual inference from
 * the expected return type rather than narrowing inline mock literals.
 */
export const createTestRpcQueryOptions = <
  TInput,
  TQueryFnData,
  TError,
  TData = TQueryFnData,
>(config: {
  readonly input?: NoInfer<TInput>;
  readonly keyPrefix?: RpcKeyPrefix;
  readonly overrides?: RpcUndefinedQueryOptionsOverrides<
    NoInfer<TQueryFnData>,
    NoInfer<TError>,
    NoInfer<TData>,
    RpcQueryKey<NoInfer<TInput>>
  >;
  readonly pathSegments: readonly string[];
  readonly queryFn: RpcQueryFn<
    NoInfer<TQueryFnData>,
    RpcQueryKey<NoInfer<TInput>>
  >;
}): RpcUndefinedQueryOptions<TInput, TQueryFnData, TError, TData> =>
  createRpcQueryOptions<TInput, TQueryFnData, TError, TData>({
    type: 'query',
    ...config,
  });
