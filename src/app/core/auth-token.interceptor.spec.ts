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
import { describe, expect, it } from 'vitest';

import { authTokenInterceptor } from './auth-token.interceptor';
import { resolveServerRpcOrigin } from './effect-rpc-angular-client';

const sessionCookies =
  '__a0_session.0=chunk-zero; __a0_session.1=chunk-one; evorto-tenant=tenant.example.com';

class ServerRequestHeaders extends Headers {
  override get(name: string): null | string {
    return name.toLowerCase() === 'cookie' ? sessionCookies : super.get(name);
  }
}

class ServerRequest extends Request {
  override readonly headers = new ServerRequestHeaders();
}

const incomingRequest = new ServerRequest(
  'https://tenant.example.com/events/event-1/edit',
);

const configureServerHttp = () => {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authTokenInterceptor])),
      provideHttpClientTesting(),
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: REQUEST, useValue: incomingRequest },
      {
        provide: REQUEST_CONTEXT,
        useValue: {
          authentication: { isAuthenticated: true },
          permissions: ['events:editAll'],
          tenant: {
            domain: 'tenant.example.com',
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
  it.each(['/rpc', '/rpc/'])(
    'forwards the complete incoming cookie header to the internal SSR request at %s',
    (path) => {
      const { http, httpTesting } = configureServerHttp();
      const rpcUrl = `${resolveServerRpcOrigin(incomingRequest)}${path}`;

      http.post(rpcUrl, {}).subscribe();

      const rpcRequest = httpTesting.expectOne(rpcUrl);
      expect(rpcRequest.request.headers.get('Cookie')).toBe(sessionCookies);
      expect(rpcRequest.request.headers.get('x-forwarded-from')).toBe('ssr');
      expect(rpcRequest.request.headers.get('x-tenant-id')).toBe('tenant-1');
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
