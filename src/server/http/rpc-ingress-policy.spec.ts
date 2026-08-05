import { describe, expect, it, vi } from 'vitest';

import {
  type RpcIngressPolicyOptions,
  runRpcIngressPolicy,
} from './rpc-ingress-policy';

interface RequestOptions {
  readonly contentType?: string;
  readonly cookie?: string;
  readonly headers?: HeadersInit;
  readonly origin?: string;
  readonly url?: string;
}

const makeRequest = ({
  contentType = 'application/json',
  cookie,
  headers,
  origin,
  url = 'https://tenant.example.com/rpc',
}: RequestOptions = {}): Request => {
  const requestHeaders = new Headers(headers);
  if (contentType) {
    requestHeaders.set('Content-Type', contentType);
  }
  if (cookie !== undefined) {
    requestHeaders.set('Cookie', cookie);
  }
  if (origin !== undefined) {
    requestHeaders.set('Origin', origin);
  }

  return new Request(url, {
    body: '{}',
    headers: requestHeaders,
    method: 'POST',
  });
};

const applyPolicy = (
  request: Request,
  options: RpcIngressPolicyOptions = {},
) => {
  const handler = vi.fn(() => 'handled');
  const result = runRpcIngressPolicy(request, handler, options);

  return { handler, result };
};

describe('runRpcIngressPolicy', () => {
  it('passes same-origin JSON to the RPC handler', () => {
    const { handler, result } = applyPolicy(
      makeRequest({
        cookie: 'appSession=session',
        origin: 'https://tenant.example.com',
      }),
    );

    expect(result).toEqual({ accepted: true, value: 'handled' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('uses the externally visible application origin behind its TLS proxy', () => {
    const { handler, result } = applyPolicy(
      makeRequest({
        cookie: 'appSession=session',
        origin: 'https://tenant.example.com',
        url: 'http://tenant.example.com/rpc',
      }),
      { applicationOrigin: 'https://tenant.example.com' },
    );

    expect(result).toEqual({ accepted: true, value: 'handled' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it.each([
    { contentType: '', label: 'missing' },
    { contentType: 'text/plain', label: 'text' },
    {
      contentType: 'application/json; charset=utf-8',
      label: 'parameterized',
    },
    { contentType: 'application/json-rpc', label: 'similar' },
  ])(
    'rejects $label content type before reaching the RPC handler',
    ({ contentType }) => {
      const request = makeRequest({
        contentType,
        cookie: 'appSession=session',
        origin: 'https://tenant.example.com',
      });
      const { handler, result } = applyPolicy(request);

      expect(result.accepted).toBe(false);
      if (!result.accepted) {
        expect(result.response.status).toBe(415);
        expect(result.response.headers.get('Cache-Control')).toBe('no-store');
      }
      expect(request.bodyUsed).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it.each([
    'https://sibling.example.com',
    'https://foreign.example.net',
    'null',
  ])(
    'rejects cookie-authenticated origin %s before reaching the RPC handler',
    (origin) => {
      const { handler, result } = applyPolicy(
        makeRequest({
          cookie: 'appSession=session',
          origin,
        }),
      );

      expect(result.accepted).toBe(false);
      if (!result.accepted) {
        expect(result.response.status).toBe(403);
      }
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('rejects a cookie-authenticated browser request without Origin', () => {
    const { handler, result } = applyPolicy(
      makeRequest({ cookie: 'appSession=session' }),
    );

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.response.status).toBe(403);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows the proven no-Origin SSR caller on its configured loopback origin', () => {
    const { handler, result } = applyPolicy(
      makeRequest({
        cookie: 'appSession=session; evorto-tenant=tenant.example.com',
        headers: {
          'x-forwarded-from': 'ssr',
          'x-tenant-id': 'tenant-id',
        },
        url: 'http://127.0.0.1:4200/rpc',
      }),
      {
        applicationOrigin: 'http://127.0.0.1:4200',
        ssrRpcOrigin: 'http://127.0.0.1:4200',
      },
    );

    expect(result).toEqual({ accepted: true, value: 'handled' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it.each([
    {
      configuredOrigin: 'http://127.0.0.1:4200',
      label: 'public request origin',
      url: 'https://tenant.example.com/rpc',
    },
    {
      configuredOrigin: 'http://127.0.0.1:4200',
      label: 'mismatched loopback origin',
      url: 'http://localhost:4200/rpc',
    },
    {
      configuredOrigin: 'https://tenant.example.com',
      label: 'non-loopback configured origin',
      url: 'https://tenant.example.com/rpc',
    },
  ])(
    'does not let forged SSR headers bypass the policy for a $label',
    ({ configuredOrigin, url }) => {
      const { handler, result } = applyPolicy(
        makeRequest({
          cookie: 'appSession=session',
          headers: {
            'x-forwarded-from': 'ssr',
            'x-tenant-id': 'tenant-id',
          },
          url,
        }),
        {
          applicationOrigin: new URL(url).origin,
          ssrRpcOrigin: configuredOrigin,
        },
      );

      expect(result.accepted).toBe(false);
      if (!result.accepted) {
        expect(result.response.status).toBe(403);
      }
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('allows no-Origin JSON without cookies because it has no ambient authority', () => {
    const { handler, result } = applyPolicy(makeRequest());

    expect(result).toEqual({ accepted: true, value: 'handled' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('rejects a foreign Origin even when the request has no cookies', () => {
    const { handler, result } = applyPolicy(
      makeRequest({ origin: 'https://foreign.example.net' }),
    );

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.response.status).toBe(403);
    }
    expect(handler).not.toHaveBeenCalled();
  });
});
