import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { Database } from '../../../../../db';
import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../../rpc-context-headers';
import { userHandlers } from './users.handlers';

const createTenant = () => ({
  currency: 'EUR' as const,
  defaultLocation: null,
  discountProviders: {
    esnCard: {
      config: {},
      status: 'disabled' as const,
    },
  },
  domain: 'tenant.example.com',
  id: 'tenant-1',
  locale: 'en',
  name: 'Tenant',
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['NL'],
  },
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Amsterdam',
});

const createUser = () => ({
  attributes: [],
  auth0Id: 'auth0|user-1',
  email: 'alice@example.com',
  firstName: 'Alice',
  iban: null,
  id: 'user-1',
  lastName: 'Doe',
  paypalEmail: null,
  permissions: [] as string[],
  roleIds: [],
});

describe('userHandlers', () => {
  it('users.events returns only events from user registrations', async () => {
    const tenant = createTenant();
    const user = createUser();
    const headers = {
      [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
      [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson(tenant),
      [RPC_CONTEXT_HEADERS.USER]: encodeRpcContextHeaderJson(user),
    };
    const mockDatabase = {
      query: {
        eventRegistrations: {
          findMany: () =>
            Effect.succeed([
              {
                event: {
                  description: 'later',
                  end: new Date('2026-03-01T11:00:00.000Z'),
                  id: 'event-2',
                  start: new Date('2026-03-01T10:00:00.000Z'),
                  title: 'Later Event',
                },
                eventId: 'event-2',
              },
              {
                event: {
                  description: 'earlier',
                  end: new Date('2026-02-01T11:00:00.000Z'),
                  id: 'event-1',
                  start: new Date('2026-02-01T10:00:00.000Z'),
                  title: 'Earlier Event',
                },
                eventId: 'event-1',
              },
              {
                event: null,
                eventId: 'event-missing',
              },
            ]),
        },
      },
    };

    const result = await Effect.runPromise(
      userHandlers['users.events'](undefined as never, {
        headers,
      } as never).pipe(
        Effect.provide(Layer.succeed(Database, mockDatabase as never)),
      ),
    );

    expect(result.map((event) => event.id)).toEqual(['event-1', 'event-2']);
  });

  it('users.findMany uses distinct tenant users count with role-join rows', async () => {
    const tenant = createTenant();
    const headers = {
      [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
      [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson([
        'users:viewAll',
      ]),
      [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson(tenant),
    };
    const select = vi
      .fn()
      .mockImplementationOnce(() => ({
        from: () => ({
          where: () => Effect.succeed([{ count: 2 }]),
        }),
      }))
      .mockImplementationOnce(() => ({
        from: () => ({
          orderBy: () => ({
            offset: () => ({
              limit: () => ({
                innerJoin: () => ({
                  leftJoin: () => ({
                    leftJoin: () =>
                      Effect.succeed([
                        {
                          email: 'a@example.com',
                          firstName: 'Alice',
                          id: 'user-1',
                          lastName: 'One',
                          role: 'Admin',
                        },
                        {
                          email: 'a@example.com',
                          firstName: 'Alice',
                          id: 'user-1',
                          lastName: 'One',
                          role: 'Editor',
                        },
                        {
                          email: 'b@example.com',
                          firstName: 'Bob',
                          id: 'user-2',
                          lastName: 'Two',
                          role: null,
                        },
                      ]),
                  }),
                }),
              }),
            }),
          }),
        }),
      }));
    const mockDatabase = { select };

    const result = await Effect.runPromise(
      userHandlers['users.findMany'](
        {
          limit: 25,
          offset: 0,
        },
        { headers } as never,
      ).pipe(Effect.provide(Layer.succeed(Database, mockDatabase as never))),
    );

    expect(result.usersCount).toBe(2);
    expect(result.users).toEqual([
      {
        email: 'a@example.com',
        firstName: 'Alice',
        id: 'user-1',
        lastName: 'One',
        role: 'Admin',
        roles: ['Admin', 'Editor'],
      },
      {
        email: 'b@example.com',
        firstName: 'Bob',
        id: 'user-2',
        lastName: 'Two',
        role: null,
        roles: [],
      },
    ]);
  });
});
