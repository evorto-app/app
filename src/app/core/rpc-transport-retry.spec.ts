import { describe, expect, it } from 'vitest';

import {
  isRpcTransportError,
  RPC_TRANSPORT_MAX_RETRIES,
  rpcTransportRetry,
  rpcTransportRetryDelay,
} from './rpc-transport-retry';

const transportError = { _tag: 'RpcClientError', reason: {} };

describe('rpc transport retry', () => {
  it('recognizes only client transport failures', () => {
    expect(isRpcTransportError(transportError)).toBe(true);
    expect(
      isRpcTransportError({ _tag: 'EventRegistrationConflictError' }),
    ).toBe(false);
    expect(isRpcTransportError({ _tag: 'EventCheckInUnavailableError' })).toBe(
      false,
    );
    expect(isRpcTransportError({ _tag: 'RpcForbiddenError' })).toBe(false);
    expect(isRpcTransportError(new Error('boom'))).toBe(false);
    expect(isRpcTransportError('RpcClientError')).toBe(false);
    expect(isRpcTransportError(null)).toBe(false);
    expect(isRpcTransportError(undefined)).toBe(false);
  });

  it('retries a transport failure three times and not a fourth time', () => {
    expect(RPC_TRANSPORT_MAX_RETRIES).toBe(3);
    expect(rpcTransportRetry(0, transportError)).toBe(true);
    expect(rpcTransportRetry(1, transportError)).toBe(true);
    expect(rpcTransportRetry(2, transportError)).toBe(true);
    expect(rpcTransportRetry(3, transportError)).toBe(false);
  });

  it('never retries typed domain errors', () => {
    for (const failureCount of [0, 1, 2]) {
      expect(
        rpcTransportRetry(failureCount, {
          _tag: 'EventRegistrationConflictError',
        }),
      ).toBe(false);
      expect(
        rpcTransportRetry(failureCount, {
          _tag: 'EventCheckInUnavailableError',
        }),
      ).toBe(false);
      expect(rpcTransportRetry(failureCount, new Error('boom'))).toBe(false);
    }
  });

  it('backs off from 500 ms and caps at 4 seconds', () => {
    expect(rpcTransportRetryDelay(0)).toBe(500);
    expect(rpcTransportRetryDelay(1)).toBe(1000);
    expect(rpcTransportRetryDelay(2)).toBe(2000);
    expect(rpcTransportRetryDelay(3)).toBe(4000);
    expect(rpcTransportRetryDelay(10)).toBe(4000);
  });
});
