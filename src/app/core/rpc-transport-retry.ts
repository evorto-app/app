/** How often a request is repeated after the connection failed. */
export const RPC_TRANSPORT_MAX_RETRIES = 3;

const RPC_TRANSPORT_RETRY_BASE_DELAY_MS = 500;
const RPC_TRANSPORT_RETRY_MAX_DELAY_MS = 4000;

/**
 * True only for failures where no typed answer from the server arrived (the
 * HTTP request failed, returned a non-RPC response such as a proxy error page,
 * or could not be decoded). Typed domain errors and every other failure are not
 * transport errors. Retrying these is safe because check-in replays are
 * recognized by the server and lookups are reads.
 */
export const isRpcTransportError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  '_tag' in error &&
  error._tag === 'RpcClientError';

/**
 * TanStack Query `retry` option. `failureCount` is the number of failures so
 * far minus the current one (0 for the first failure).
 */
export const rpcTransportRetry = (
  failureCount: number,
  error: unknown,
): boolean =>
  failureCount < RPC_TRANSPORT_MAX_RETRIES && isRpcTransportError(error);

/** TanStack Query `retryDelay` option: 500 ms, 1 s, 2 s, then capped at 4 s. */
export const rpcTransportRetryDelay = (attemptIndex: number): number =>
  Math.min(
    RPC_TRANSPORT_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attemptIndex),
    RPC_TRANSPORT_RETRY_MAX_DELAY_MS,
  );
