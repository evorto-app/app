import { describe, expect, it } from 'vitest';

import {
  forwardLoginPath,
  relativeRedirectPathFromRequest,
  sanitizeRelativeRedirectPath,
} from './auth-redirect';

describe('authentication redirect paths', () => {
  it('preserves the generic transfer entry path', () => {
    const request = new Request(
      'https://tenant.example/registration-transfers',
    );

    const redirectPath = relativeRedirectPathFromRequest(request);
    const loginPath = forwardLoginPath(redirectPath);

    expect(redirectPath).toBe('/registration-transfers');
    expect(loginPath).toBe(
      '/forward-login?redirectUrl=%2Fregistration-transfers',
    );
    expect(
      new URL(loginPath, 'https://tenant.example').searchParams.get(
        'redirectUrl',
      ),
    ).toBe(redirectPath);
  });

  it.each([
    'https://attacker.example/steal',
    '//attacker.example/steal',
    '/%2e%2e//attacker.example/steal',
    '/safe/%2e%2e//attacker.example/steal',
    '/.%2e//attacker.example/steal',
    String.raw`/\\attacker.example/steal`,
    String.raw`\\attacker.example\steal`,
    'javascript:alert(1)',
    '/safe\nunsafe',
  ])('rejects unsafe redirect input %s', (value) => {
    expect(sanitizeRelativeRedirectPath(value)).toBeUndefined();
    expect(forwardLoginPath(value)).toBe('/forward-login?redirectUrl=%2F');
  });

  it('keeps a double-encoded logout redirect on the requesting origin', () => {
    const requestUrl = new URL(
      'https://tenant.example/logout?redirectUrl=/%252e%252e//attacker.example/steal',
    );
    const returnPath =
      sanitizeRelativeRedirectPath(
        requestUrl.searchParams.get('redirectUrl'),
      ) ?? '/';

    expect(returnPath).toBe('/');
    expect(new URL(returnPath, requestUrl.origin).origin).toBe(
      requestUrl.origin,
    );
  });
});
