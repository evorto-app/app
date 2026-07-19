import { REQUEST_CONTEXT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { describe, expect, it } from 'vitest';

import {
  requiresTenantOnboarding,
  resolveOnboardingGuardState,
  userAccountGuard,
} from './user-account.guard';

const route = {} as ActivatedRouteSnapshot;
const state = { url: '/admin' } as RouterStateSnapshot;

const configureRequestContext = (requestContext: {
  readonly authentication: { readonly isAuthenticated: boolean };
  readonly user?: object | undefined;
}) =>
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: REQUEST_CONTEXT, useValue: requestContext },
    ],
  });

describe('requiresTenantOnboarding', () => {
  it('redirects authenticated users until current tenant requirements are complete', () => {
    expect(
      requiresTenantOnboarding({
        isAuthenticated: true,
        onboardingComplete: false,
      }),
    ).toBe(true);
    expect(
      requiresTenantOnboarding({
        isAuthenticated: true,
        onboardingComplete: true,
      }),
    ).toBe(false);
  });

  it('does not redirect public visitors into authenticated setup', () => {
    expect(
      requiresTenantOnboarding({
        isAuthenticated: false,
        onboardingComplete: false,
      }),
    ).toBe(false);
  });

  it('redirects an authenticated SSR request with incomplete onboarding', async () => {
    configureRequestContext({
      authentication: { isAuthenticated: true },
    });

    const result = await TestBed.runInInjectionContext(() =>
      userAccountGuard(route, state),
    );

    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      '/create-account',
    );
  });

  it.each([
    {
      name: 'completed authenticated',
      requestContext: {
        authentication: { isAuthenticated: true },
        user: {},
      },
    },
    {
      name: 'public',
      requestContext: {
        authentication: { isAuthenticated: false },
      },
    },
  ])('allows a $name SSR request', async ({ requestContext }) => {
    configureRequestContext(requestContext);

    expect(
      await TestBed.runInInjectionContext(() => userAccountGuard(route, state)),
    ).toBe(true);
  });

  it('uses the browser RPC fallback only when no request context exists', async () => {
    const expected = { isAuthenticated: true, onboardingComplete: false };
    let fallbackCalls = 0;

    expect(
      await resolveOnboardingGuardState(null, async () => {
        fallbackCalls += 1;
        return expected;
      }),
    ).toEqual(expected);
    expect(fallbackCalls).toBe(1);
  });
});
