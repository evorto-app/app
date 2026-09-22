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

import {
  attachSsrRpcCapability,
  readSsrRpcCapability,
  trustedSsrSourceHeader,
  trustedSsrSourceValue,
  trustedTenantDomainHeader,
} from '../../shared/request-routing';
import { authTokenInterceptor } from './auth-token.interceptor';
import { resolveServerRpcOrigin } from './effect-rpc-angular-client';

const ssrRpcCapability = 'server-generated-test-capability';
const trustedTenantDomain = 'tenant.example.com';
const sessionCookies = [
  'appSession.0=chunk-zero',
  'evorto-tenant=stale.example.com',
  'appSession.1=chunk-one',
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

const configureServerHttp = (
  serverRequest = incomingRequest,
  capability: null | string = ssrRpcCapability,
  platformId = 'server',
) => {
  const context = {
    authentication: { isAuthenticated: true },
    permissions: ['events:editAll'],
    tenant: { domain: trustedTenantDomain, id: 'tenant-1' },
  };
  if (capability !== null) attachSsrRpcCapability(context, capability);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authTokenInterceptor])),
      provideHttpClientTesting(),
      { provide: PLATFORM_ID, useValue: platformId },
      { provide: REQUEST, useValue: serverRequest },
      {
        provide: REQUEST_CONTEXT,
        useValue: context,
      },
    ],
  });

  return {
    http: TestBed.inject(HttpClient),
    httpTesting: TestBed.inject(HttpTestingController),
  };
};

describe('authTokenInterceptor', () => {
  it('keeps the runtime capability out of serialized and copied context', () => {
    const context = attachSsrRpcCapability(
      { tenant: { domain: trustedTenantDomain } },
      ssrRpcCapability,
    );
    expect(readSsrRpcCapability(context)).toBe(ssrRpcCapability);
    expect(readSsrRpcCapability({ ...context })).toBeUndefined();
    expect(JSON.stringify(context)).toBe(
      JSON.stringify({ tenant: { domain: trustedTenantDomain } }),
    );
    expect(JSON.stringify(context)).not.toContain(ssrRpcCapability);
  });

  it.each([null, ''])(
    'does not forward cookies or tenant authority without a runtime-issued context capability (%s)',
    (capability) => {
      process.env['SSR_RPC_ORIGIN'] = 'http://localhost:4200';
      const forgedIncoming = new ServerRequest(
        'http://localhost:4200/events',
        sessionCookies,
        {
          Authorization: `Bearer ${ssrRpcCapability}`,
          [trustedSsrSourceHeader]: trustedSsrSourceValue,
          [trustedTenantDomainHeader]: trustedTenantDomain,
        },
      );
      const { http, httpTesting } = configureServerHttp(
        forgedIncoming,
        capability,
      );
      http.post('http://localhost:4200/rpc', {}).subscribe();
      const outgoing = httpTesting.expectOne('http://localhost:4200/rpc');
      expect(outgoing.request.headers.has('Authorization')).toBe(false);
      expect(outgoing.request.headers.has('Cookie')).toBe(false);
      expect(outgoing.request.headers.has(trustedTenantDomainHeader)).toBe(
        false,
      );
      outgoing.flush({});
      httpTesting.verify();
    },
  );

  it('never sends the capability from a browser context', () => {
    process.env['SSR_RPC_ORIGIN'] = 'http://localhost:4200';
    const { http, httpTesting } = configureServerHttp(
      incomingRequest,
      ssrRpcCapability,
      'browser',
    );
    http.post('http://localhost:4200/rpc', {}).subscribe();
    const outgoing = httpTesting.expectOne('http://localhost:4200/rpc');
    expect(outgoing.request.headers.has('Authorization')).toBe(false);
    expect(outgoing.request.headers.has('Cookie')).toBe(false);
    outgoing.flush({});
    httpTesting.verify();
  });

  it('does not attach the capability to non-POST requests', () => {
    process.env['SSR_RPC_ORIGIN'] = 'http://localhost:4200';
    const { http, httpTesting } = configureServerHttp();
    http.get('http://localhost:4200/rpc').subscribe();
    const outgoing = httpTesting.expectOne('http://localhost:4200/rpc');
    expect(outgoing.request.headers.has('Authorization')).toBe(false);
    expect(outgoing.request.headers.has('Cookie')).toBe(false);
    outgoing.flush({});
    httpTesting.verify();
  });

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
    'routes accepted SSR path %s to the canonical credential-bearing endpoint',
    (path) => {
      process.env['SSR_RPC_ORIGIN'] = 'http://localhost:4200';
      const { http, httpTesting } = configureServerHttp();
      const rpcUrl = `${resolveServerRpcOrigin()}${path}`;

      http.post(rpcUrl, {}).subscribe();

      const rpcRequest = httpTesting.expectOne(
        `${resolveServerRpcOrigin()}/rpc`,
      );
      expect(rpcRequest.request.urlWithParams).toBe(
        `${resolveServerRpcOrigin()}/rpc`,
      );
      expect(rpcRequest.request.headers.get('Cookie')).toBe(sessionCookies);
      expect(rpcRequest.request.headers.get('Authorization')).toBe(
        `Bearer ${ssrRpcCapability}`,
      );
      expect(rpcRequest.request.headers.get(trustedSsrSourceHeader)).toBe(
        trustedSsrSourceValue,
      );
      expect(rpcRequest.request.headers.get(trustedTenantDomainHeader)).toBe(
        trustedTenantDomain,
      );
      rpcRequest.flush({});
      httpTesting.verify();
    },
  );

  it('routes anonymous internal SSR without inventing a tenant cookie', () => {
    process.env['SSR_RPC_ORIGIN'] = 'http://127.0.0.1:4200';
    const anonymousRequest = new ServerRequest(
      'https://tenant.example.com/events',
      null,
    );
    const { http, httpTesting } = configureServerHttp(anonymousRequest);
    const rpcUrl = `${resolveServerRpcOrigin()}/rpc`;

    http.post(rpcUrl, {}).subscribe();

    const rpcRequest = httpTesting.expectOne(rpcUrl);
    expect(rpcRequest.request.headers.has('Cookie')).toBe(false);
    expect(rpcRequest.request.headers.get(trustedSsrSourceHeader)).toBe(
      trustedSsrSourceValue,
    );
    expect(rpcRequest.request.headers.get(trustedTenantDomainHeader)).toBe(
      trustedTenantDomain,
    );
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
      expect(rpcRequest.request.headers.has(trustedSsrSourceHeader)).toBe(
        false,
      );
      expect(rpcRequest.request.headers.has(trustedTenantDomainHeader)).toBe(
        false,
      );
      rpcRequest.flush({});
      httpTesting.verify();
    },
  );

  it('does not attach SSR credentials when HttpClient adds query parameters', () => {
    process.env['SSR_RPC_ORIGIN'] = 'http://localhost:4200';
    const { http, httpTesting } = configureServerHttp();
    const rpcUrl = `${resolveServerRpcOrigin()}/rpc/`;

    http
      .post(rpcUrl, {}, { params: { operation: 'events.findOne' } })
      .subscribe();

    const outgoingRequest = httpTesting.expectOne(
      `${rpcUrl}?operation=events.findOne`,
    );
    expect(outgoingRequest.request.headers.has('Cookie')).toBe(false);
    expect(outgoingRequest.request.headers.has('Authorization')).toBe(false);
    expect(outgoingRequest.request.headers.has(trustedSsrSourceHeader)).toBe(
      false,
    );
    expect(outgoingRequest.request.headers.has(trustedTenantDomainHeader)).toBe(
      false,
    );
    outgoingRequest.flush({});
    httpTesting.verify();
  });

  it.each([
    'https://api.example.net/rpc',
    'http://user:password@localhost:4200/rpc',
    'http://localhost:4200/healthz',
    'http://localhost:4200/rpc/other',
    'http://localhost:4200/rpc?operation=events.findOne',
  ])('does not forward server cookies to %s', (url) => {
    process.env['SSR_RPC_ORIGIN'] = 'http://localhost:4200';
    const { http, httpTesting } = configureServerHttp();

    http.post(url, {}).subscribe();

    const outgoingRequest = httpTesting.expectOne(url);
    expect(outgoingRequest.request.headers.has('Cookie')).toBe(false);
    expect(outgoingRequest.request.headers.has('Authorization')).toBe(false);
    outgoingRequest.flush({});
    httpTesting.verify();
  });
});
