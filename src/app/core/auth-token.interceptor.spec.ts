import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { PLATFORM_ID, REQUEST, REQUEST_CONTEXT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authTokenInterceptor } from './auth-token.interceptor';
import { resolveServerRpcOrigin } from './effect-rpc-angular-client';

const trustedTenantDomain = 'tenant.example.com';
const sessionCookies = [
  '__a0_session.0=chunk-zero',
  'evorto-tenant=stale.example.com',
  '__a0_session.1=chunk-one',
].join('; ');
const trustedSessionCookies = [
  '__a0_session.0=chunk-zero',
  '__a0_session.1=chunk-one',
  `evorto-tenant=${trustedTenantDomain}`,
].join('; ');

class ServerRequest extends Request {
  override readonly headers: Headers;
  override readonly url: string;

  constructor(
    url: string,
    cookieHeader: null | string = sessionCookies,
    headers?: HeadersInit,
  ) {
    super('http://localhost');
    this.url = url;
    this.headers = new ServerRequestHeaders(cookieHeader, headers);
  }
}

class ServerRequestHeaders extends Headers {
  constructor(
    private readonly cookieHeader: null | string,
    init?: HeadersInit,
  ) {
    super(init);
  }

  override get(name: string): null | string {
    return name.toLowerCase() === 'cookie'
      ? this.cookieHeader
      : super.get(name);
  }
}

const incomingRequest = new ServerRequest(
  'https://tenant.example.com/events/event-1/edit',
);

const configureServerHttp = (serverRequest = incomingRequest) => {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authTokenInterceptor])),
      provideHttpClientTesting(),
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: REQUEST, useValue: serverRequest },
      {
        provide: REQUEST_CONTEXT,
        useValue: {
          authentication: { isAuthenticated: true },
          permissions: ['events:editAll'],
          tenant: {
            domain: trustedTenantDomain,
            id: 'tenant-1',
          },
        },
      },
    ],
  });

  return {
    http: TestBed.inject(HttpClient),
    httpTesting: TestBed.inject(HttpTestingController),
  };
};

describe('authTokenInterceptor', () => {
  const originalSsrRpcOrigin = process.env['SSR_RPC_ORIGIN'];

  beforeEach(() => {
    delete process.env['SSR_RPC_ORIGIN'];
  });

  afterEach(() => {
    if (originalSsrRpcOrigin === undefined) {
      delete process.env['SSR_RPC_ORIGIN'];
    } else {
      process.env['SSR_RPC_ORIGIN'] = originalSsrRpcOrigin;
    }
  });

  it.each(['/rpc', '/rpc/'])(
    'forwards every Auth0 session chunk with a trusted tenant cookie to the configured internal SSR request at %s',
    (path) => {
      process.env['SSR_RPC_ORIGIN'] = 'http://localhost:4200';
      const { http, httpTesting } = configureServerHttp();
      const rpcUrl = `${resolveServerRpcOrigin(incomingRequest)}${path}`;

      http.post(rpcUrl, {}).subscribe();

      const rpcRequest = httpTesting.expectOne(rpcUrl);
      expect(rpcRequest.request.headers.get('Cookie')).toBe(
        trustedSessionCookies,
      );
      expect(rpcRequest.request.headers.get('Cookie')).not.toContain(
        'stale.example.com',
      );
      expect(rpcRequest.request.headers.get('x-forwarded-from')).toBe('ssr');
      expect(rpcRequest.request.headers.get('x-tenant-id')).toBe('tenant-1');
      rpcRequest.flush({});
      httpTesting.verify();
    },
  );

  it('adds the trusted tenant cookie to an internal SSR RPC request without incoming cookies', () => {
    process.env['SSR_RPC_ORIGIN'] = 'http://127.0.0.1:4200';
    const anonymousRequest = new ServerRequest(
      'https://tenant.example.com/events',
      null,
    );
    const { http, httpTesting } = configureServerHttp(anonymousRequest);
    const rpcUrl = `${resolveServerRpcOrigin(anonymousRequest)}/rpc`;

    http.post(rpcUrl, {}).subscribe();

    const rpcRequest = httpTesting.expectOne(rpcUrl);
    expect(rpcRequest.request.headers.get('Cookie')).toBe(
      `evorto-tenant=${trustedTenantDomain}`,
    );
    expect(rpcRequest.request.headers.get('x-forwarded-from')).toBe('ssr');
    expect(rpcRequest.request.headers.get('x-tenant-id')).toBe('tenant-1');
    rpcRequest.flush({});
    httpTesting.verify();
  });

  it.each([
    {
      incoming: new ServerRequest('https://attacker.example.net/events'),
      outgoingUrl: 'https://attacker.example.net/rpc',
      source: 'request URL',
    },
    {
      incoming: new ServerRequest('/events', sessionCookies, {
        'x-forwarded-host': 'attacker.example.net',
        'x-forwarded-proto': 'https',
      }),
      outgoingUrl: 'https://attacker.example.net/rpc',
      source: 'forwarded Host header',
    },
  ])(
    'does not authorize cookie forwarding from the incoming $source when SSR_RPC_ORIGIN is absent',
    ({ incoming, outgoingUrl }) => {
      const { http, httpTesting } = configureServerHttp(incoming);

      http.post(outgoingUrl, {}).subscribe();

      const rpcRequest = httpTesting.expectOne(outgoingUrl);
      expect(rpcRequest.request.headers.has('Cookie')).toBe(false);
      expect(rpcRequest.request.headers.has('x-forwarded-from')).toBe(false);
      expect(rpcRequest.request.headers.has('x-tenant-id')).toBe(false);
      rpcRequest.flush({});
      httpTesting.verify();
    },
  );

  it.each([
    'https://api.example.net/rpc',
    `${resolveServerRpcOrigin(incomingRequest)}/healthz`,
    `${resolveServerRpcOrigin(incomingRequest)}/rpc/other`,
    `${resolveServerRpcOrigin(incomingRequest)}/rpc?operation=events.findOne`,
  ])('does not forward server cookies to %s', (url) => {
    const { http, httpTesting } = configureServerHttp();

    http.get(url).subscribe();

    const outgoingRequest = httpTesting.expectOne(url);
    expect(outgoingRequest.request.headers.has('Cookie')).toBe(false);
    outgoingRequest.flush({});
    httpTesting.verify();
  });
});
