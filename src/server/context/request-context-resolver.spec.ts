import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../db';
import {
  resolveRequestPermissions,
  resolveUserContext,
} from './request-context-resolver';

const createPreparedDatabase = ({
  attributesExecute = vi.fn(() => Effect.succeed([])),
  userExecute,
}: {
  attributesExecute?: ReturnType<typeof vi.fn>;
  userExecute: ReturnType<typeof vi.fn>;
}) => ({
  query: {
    tenants: {
      findFirst: () => ({
        prepare: () => ({
          execute: () => Effect.succeed(),
        }),
      }),
    },
    users: {
      findFirst: () => ({
        prepare: () => ({
          execute: userExecute,
        }),
      }),
    },
  },
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => ({
          prepare: () => ({
            execute: attributesExecute,
          }),
        }),
      }),
    }),
  }),
});

describe('request-context-resolver', () => {
  it('resolves global-admin permissions without a tenant user assignment', () => {
    expect(
      resolveRequestPermissions({
        oidcUser: {
          'evorto.app/app_metadata': {
            globalAdmin: true,
          },
        },
        user: undefined,
      }),
    ).toContain('globalAdmin:manageTenants');
  });

  it.effect('does not resolve a tenant user without a tenant assignment', () =>
    Effect.gen(function* () {
      const attributesExecute = vi.fn(() => Effect.succeed([]));
      const database = createPreparedDatabase({
        attributesExecute,
        userExecute: vi.fn(() =>
          Effect.succeed({
            auth0Id: 'auth0|global',
            communicationEmail: null,
            email: 'global@example.com',
            firstName: 'Global',
            iban: null,
            id: 'user-1',
            lastName: 'Admin',
            paypalEmail: null,
            tenantAssignments: [],
          }),
        ),
      });

      const user = yield* resolveUserContext({
        isAuthenticated: true,
        oidcUser: {
          sub: 'auth0|global',
        },
        tenantId: 'tenant-1',
      }).pipe(Effect.provide(Layer.succeed(Database, database as never)));

      expect(user).toBeUndefined();
      expect(attributesExecute).not.toHaveBeenCalled();
    }),
  );
});
