import { REQUEST, REQUEST_CONTEXT, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  RedirectCommand,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { describe, expect, it } from 'vitest';

import { authGuard } from './auth.guard';

const route = {} as ActivatedRouteSnapshot;

const configureServerGuard = ({
  isAuthenticated,
  request,
  response,
}: {
  isAuthenticated: boolean;
  request: Request;
  response: ResponseInit;
}) =>
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: REQUEST, useValue: request },
      {
        provide: REQUEST_CONTEXT,
        useValue: { authentication: { isAuthenticated } },
      },
      { provide: RESPONSE_INIT, useValue: response },
    ],
  });

describe('authGuard', () => {
  it('turns an anonymous SSR deep link into a same-origin forward-login redirect', async () => {
    const request = new Request(
      'https://tenant.example/registration-transfers/private%2Fcredential?from=email&label=two%20words',
    );
    const response: ResponseInit = {};
    configureServerGuard({ isAuthenticated: false, request, response });

    const result = await TestBed.runInInjectionContext(() =>
      authGuard(route, {
        url: '/registration-transfers/private%2Fcredential?from=email&label=two%20words',
      } as RouterStateSnapshot),
    );

    expect(result).toBeInstanceOf(RedirectCommand);
    if (!(result instanceof RedirectCommand)) {
      throw new TypeError(
        'Expected the SSR guard to return a redirect command',
      );
    }

    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result.redirectTo)).toBe('/404');
    const browserUrl = result.navigationBehaviorOptions?.browserUrl;
    expect(browserUrl).toBeInstanceOf(UrlTree);
    if (!(browserUrl instanceof UrlTree)) {
      throw new TypeError('Expected a parsed same-origin browser redirect URL');
    }
    expect(router.serializeUrl(browserUrl)).toBe(
      '/forward-login?redirectUrl=%2Fregistration-transfers%2Fprivate%252Fcredential%3Ffrom%3Demail%26label%3Dtwo%2520words',
    );
    expect(response.status).toBe(303);
  });

  it('allows an authenticated SSR request without changing its response', async () => {
    const request = new Request('https://tenant.example/profile');
    const response: ResponseInit = {};
    configureServerGuard({ isAuthenticated: true, request, response });

    expect(
      await TestBed.runInInjectionContext(() =>
        authGuard(route, { url: '/profile' } as RouterStateSnapshot),
      ),
    ).toBe(true);
    expect(response.status).toBeUndefined();
  });
});
