import type { SessionData } from '@auth0/auth0-server-js';

import { describe, expect, it } from 'vitest';

import { isAuthenticated, toAuthSession } from './auth-session';

const sessionData = (expiresAt: number): SessionData => ({
  idToken: 'test-id-token',
  refreshToken: undefined,
  tokenSets: [
    {
      accessToken: 'test-access-token',
      audience: 'default',
      expiresAt,
      scope: 'openid profile email',
    },
  ],
  user: {
    email: 'user@example.test',
    sub: 'auth0|test-user',
  },
});

describe('Auth0 application sessions', () => {
  it('remains authenticated after the unused OAuth access token expires', () => {
    const authSession = toAuthSession(sessionData(0));

    expect(isAuthenticated(authSession)).toBe(true);
    expect(authSession).toMatchObject({
      authData: {
        sub: 'auth0|test-user',
      },
    });
  });

  it('requires an identity-bearing SDK session with a primary token set', () => {
    expect(toAuthSession(undefined)).toBeUndefined();
    expect(
      toAuthSession({
        ...sessionData(0),
        tokenSets: [],
      }),
    ).toBeUndefined();
    expect(
      toAuthSession({
        ...sessionData(0),
        user: {
          email: 'missing-subject@example.test',
        },
      }),
    ).toBeUndefined();
  });
});
