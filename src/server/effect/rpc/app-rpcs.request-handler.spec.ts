import { describe, expect, it } from 'vitest';

import { buildRpcUser } from './app-rpcs.request-handler';

describe('buildRpcUser', () => {
  it('keeps profile fields needed by users.self in the RPC context header', () => {
    const context = {
      user: {
        attributes: [],
        auth0Id: 'auth0|profile-user',
        communicationEmail: 'notify@example.com',
        email: 'login@example.com',
        firstName: 'Profile',
        homeTenantId: 'home-tenant',
        iban: undefined,
        id: 'user-1',
        lastName: 'User',
        paypalEmail: undefined,
        permissions: [],
        roleIds: [],
      },
    };

    expect(buildRpcUser(context)).toEqual({
      attributes: [],
      auth0Id: 'auth0|profile-user',
      communicationEmail: 'notify@example.com',
      email: 'login@example.com',
      firstName: 'Profile',
      homeTenantId: 'home-tenant',
      iban: undefined,
      id: 'user-1',
      lastName: 'User',
      paypalEmail: undefined,
      permissions: [],
      roleIds: [],
    });
  });
});
