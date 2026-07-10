import type Stripe from 'stripe';

import { describe, expect, it, vi } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  eventAddons,
  eventRegistrationOptions,
  eventRegistrations,
  rolesToTenantUsers,
  transactions,
  users,
  usersToTenants,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { StripeClient } from '../../../../stripe-client';
import { RpcAccess } from '../shared/rpc-access.service';
import { EventRegistrationService } from './event-registration.service';
import { eventRegistrationHandlers } from './events-registration.handlers';

type StripeClientDouble = Pick<Stripe, 'checkout' | 'refunds'>;

const createStripeClientDouble = ({
  createCheckoutSession = vi.fn(),
  retrieveCheckoutSession = vi.fn(() =>
    Promise.resolve({
      id: 'checkout-unresolved',
      status: 'open',
    } as Stripe.Checkout.Session),
  ),
}: {
  createCheckoutSession?: ReturnType<typeof vi.fn>;
  retrieveCheckoutSession?: ReturnType<typeof vi.fn>;
} = {}): StripeClientDouble =>
  ({
    checkout: {
      sessions: {
        create: createCheckoutSession,
        expire: vi.fn(() =>
          Promise.resolve({ status: 'expired' } as Stripe.Checkout.Session),
        ),
        retrieve: retrieveCheckoutSession,
      },
    },
    refunds: {
      create: vi.fn(),
    },
  }) as StripeClientDouble;

const emptyHandlerOptions = {
  headers: Headers.fromInput({}),
};

const registrationConfigProviderLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: {
      BASE_URL: 'https://deployment.example',
      NODE_ENV: 'production',
      RESEND_API_KEY: 're_test_123',
    },
  }),
);

const tenant = {
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
};

const createUser = ({
  id = 'scanner-1',
  permissions = [],
}: {
  id?: string;
  permissions?: readonly Permission[];
} = {}) => ({
  attributes: [],
  auth0Id: `auth0|${id}`,
  email: `${id}@example.com`,
  firstName: 'Scan',
  iban: null,
  id,
  lastName: 'User',
  paypalEmail: null,
  permissions,
  roleIds: [],
});

const createContextLayer = ({
  database,
  nowIso,
  stripe = createStripeClientDouble(),
  tenant: currentTenant = tenant,
  user = createUser(),
}: {
  database: object;
  nowIso?: string;
  stripe?: StripeClientDouble;
  tenant?: typeof tenant;
  user?: ReturnType<typeof createUser>;
}) => {
  const requestContext = {
    authData: {},
    authenticated: true,
    permissions: user.permissions,
    tenant: currentTenant,
    user,
    userAssigned: true,
  } satisfies RpcRequestContextShape;

  return Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, requestContext),
    Layer.succeed(Database, database as DatabaseClient),
    Layer.succeed(StripeClient, stripe as Stripe),
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: nowIso ? { E2E_NOW_ISO: nowIso } : {},
      }),
    ),
  );
};

const scannedRegistration = {
  appliedDiscountedPrice: null,
  appliedDiscountType: null,
  checkedInGuestCount: 0,
  checkInTime: null,
  event: {
    start: new Date(Date.now() + 30 * 60 * 1000),
    title: 'City tour',
  },
  eventId: 'event-1',
  guestCount: 0,
  registrationOption: {
    price: 0,
    title: 'Participant',
  },
  status: 'CONFIRMED',
  transactions: [],
  user: {
    firstName: 'Alice',
    lastName: 'Doe',
  },
  userId: 'attendee-1',
};

const nonConfirmedRegistrationStatuses = [
  'CANCELLED',
  'PENDING',
  'WAITLIST',
] as const;

const expectCounterDecrement = (
  updateSet: unknown,
  field: 'confirmedSpots' | 'reservedSpots' | 'waitlistSpots',
  amount: number,
) => {
  const sqlUpdate = (
    updateSet as Record<string, { queryChunks?: readonly unknown[] }>
  )[field];

  expect(sqlUpdate).toEqual(
    expect.objectContaining({
      queryChunks: expect.arrayContaining([amount]),
    }),
  );
};

const createCancellationTransactionSelect = ({
  checkInTime = null,
  eventId = 'event-1',
  guestCount = 0,
  id = 'registration-1',
  registrationMode = 'application',
  registrationOptionId = 'option-1',
  status,
  transactions: currentTransactions = [],
  userId = 'attendee-1',
}: {
  checkInTime?: Date | null;
  eventId?: string;
  guestCount?: number;
  id?: string;
  registrationMode?: 'application' | 'fcfs';
  registrationOptionId?: string;
  status: 'CONFIRMED' | 'PENDING' | 'WAITLIST';
  transactions?: readonly object[];
  userId?: string;
}) => ({
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        for: () => {
          if (table === eventRegistrations) {
            return Effect.succeed([
              {
                checkInTime,
                eventId,
                guestCount,
                id,
                registrationOptionId,
                status,
                userId,
              },
            ]);
          }
          if (table === transactions) {
            return Effect.succeed(currentTransactions);
          }
          if (table === eventRegistrationOptions) {
            return Effect.succeed([{ registrationMode }]);
          }
          return Effect.succeed([]);
        },
      }),
    }),
  }),
});

const createGuestCancellationDatabase = ({
  status,
}: {
  status: 'CONFIRMED' | 'PENDING';
}) => {
  const updateSets: unknown[] = [];
  const currentTransactions =
    status === 'PENDING'
      ? [
          {
            amount: 1000,
            id: 'transaction-1',
            method: 'stripe',
            status: 'pending',
            stripeChargeId: null,
            stripeCheckoutCancellationRequestedAt: null as Date | null,
            stripeCheckoutSessionId: 'checkout-guest',
            stripePaymentIntentId: null,
            type: 'registration',
          },
        ]
      : [];
  const tx = {
    ...createCancellationTransactionSelect({
      guestCount: 2,
      status,
      transactions: currentTransactions,
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => {
        if (
          table === transactions &&
          values !== null &&
          typeof values === 'object' &&
          'stripeCheckoutCancellationRequestedAt' in values &&
          values.stripeCheckoutCancellationRequestedAt instanceof Date
        ) {
          const pendingTransaction = currentTransactions[0];
          if (pendingTransaction) {
            pendingTransaction.stripeCheckoutCancellationRequestedAt =
              values.stripeCheckoutCancellationRequestedAt;
          }
        }
        updateSets.push(values);
        return {
          where: () => ({
            returning: () =>
              table === eventRegistrations ||
              table === eventRegistrationOptions ||
              table === transactions
                ? Effect.succeed([{ id: 'updated' }])
                : Effect.succeed([]),
          }),
        };
      },
    }),
  };
  const database = {
    query: {
      eventRegistrations: {
        findFirst: () =>
          Effect.succeed({
            checkedInGuestCount: 0,
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            guestCount: 2,
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status,
            transactions: currentTransactions,
          }),
      },
    },
    transaction: vi.fn((callback: (tx: typeof tx) => unknown) => callback(tx)),
  };

  return { database, updateSets };
};

const createTransferDatabase = ({
  existingTargetRegistration = null,
  organizerRegistrations = [
    {
      id: 'organizer-registration-1',
      registrationOption: {
        organizingRegistration: true,
      },
    },
  ],
  registration = {
    appliedDiscountedPrice: null,
    appliedDiscountType: null,
    checkInTime: null,
    event: {
      start: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    eventId: 'event-1',
    id: 'registration-1',
    registrationOptionId: 'option-1',
    status: 'CONFIRMED',
    transactions: [],
    userId: 'attendee-1',
  },
  registrationOptionRoleIds = ['participant-role-1'],
  targetTenantUser = {
    id: 'target-tenant-user-1',
    roles: [{ id: 'participant-role-1' }],
  },
  targetUser = { id: 'target-user-1' },
}: {
  existingTargetRegistration?: null | { id: string };
  organizerRegistrations?: readonly {
    id: string;
    registrationOption: {
      organizingRegistration: boolean;
    };
  }[];
  registration?: null | {
    appliedDiscountedPrice: null | number;
    appliedDiscountType: 'esnCard' | null;
    checkInTime: Date | null;
    event: null | { start: Date };
    eventId: string;
    id: string;
    registrationOptionId: string;
    status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
    transactions: readonly {
      amount: number;
      status: 'cancelled' | 'pending' | 'successful';
      type: 'other' | 'refund' | 'registration';
    }[];
    userId: string;
  };
  registrationOptionRoleIds?: string[];
  targetTenantUser?: null | { id: string; roles: readonly { id: string }[] };
  targetUser?: null | { id: string };
} = {}) => {
  const updateSets: unknown[] = [];
  const update = (table: unknown) => ({
    set: (values: unknown) => {
      updateSets.push(values);
      return {
        where: () => ({
          returning: () => {
            if (table === eventRegistrations) {
              return Effect.succeed([{ id: 'registration-1' }]);
            }
            return Effect.succeed([]);
          },
        }),
      };
    },
  });
  const transaction = {
    query: {
      eventRegistrations: {
        findMany: () =>
          Effect.succeed(
            existingTargetRegistration ? [existingTargetRegistration] : [],
          ),
      },
    },
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          for: () =>
            table === eventRegistrations
              ? Effect.succeed(
                  registration
                    ? [
                        {
                          id: registration.id,
                          status: registration.status,
                          userId: registration.userId,
                        },
                      ]
                    : [],
                )
              : Effect.succeed(
                  targetTenantUser
                    ? [
                        { userId: registration?.userId ?? 'attendee-1' },
                        { userId: targetUser?.id ?? 'target-user-1' },
                      ]
                    : [],
                ),
          orderBy: () => ({
            for: () =>
              Effect.succeed(
                targetTenantUser
                  ? [
                      { userId: registration?.userId ?? 'attendee-1' },
                      { userId: targetUser?.id ?? 'target-user-1' },
                    ]
                  : [],
              ),
          }),
        }),
      }),
    }),
    update,
  };
  const database = {
    query: {
      eventRegistrationOptions: {
        findFirst: () =>
          Effect.succeed({
            roleIds: registrationOptionRoleIds,
          }),
      },
      eventRegistrations: {
        findFirst: vi
          .fn()
          .mockReturnValueOnce(Effect.succeed(registration))
          .mockReturnValueOnce(Effect.succeed(existingTargetRegistration)),
        findMany: () => Effect.succeed(organizerRegistrations),
      },
      users: {
        findFirst: () => Effect.succeed(targetUser),
      },
      usersToTenants: {
        findFirst: () => Effect.succeed(targetTenantUser),
      },
    },
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => {
            if (table === users) {
              return Effect.succeed(targetUser ? [targetUser] : []);
            }
            return Effect.succeed([]);
          },
        }),
      }),
    }),
    transaction: (
      run: (transactionClient: typeof transaction) => Effect.Effect<unknown>,
    ) => run(transaction),
    update,
  };

  return { database, updateSets };
};

const createTransferTargetsDatabase = ({
  registrationOptionRoleIds = ['participant-role-1'],
}: {
  registrationOptionRoleIds?: string[];
} = {}) => {
  const tenantUserRows = [
    {
      email: 'current@example.com',
      firstName: 'Current',
      id: 'tenant-user-current',
      lastName: 'Owner',
      userId: 'attendee-1',
    },
    {
      email: 'alex@example.com',
      firstName: 'Alex',
      id: 'tenant-user-eligible',
      lastName: 'Able',
      userId: 'target-user-1',
    },
    {
      email: 'registered@example.com',
      firstName: 'Already',
      id: 'tenant-user-active',
      lastName: 'Registered',
      userId: 'already-registered-user',
    },
    {
      email: 'other@example.com',
      firstName: 'Other',
      id: 'tenant-user-ineligible',
      lastName: 'Role',
      userId: 'other-user-1',
    },
  ];
  const database = {
    query: {
      eventRegistrationOptions: {
        findFirst: () =>
          Effect.succeed({
            roleIds: registrationOptionRoleIds,
          }),
      },
      eventRegistrations: {
        findFirst: () =>
          Effect.succeed({
            appliedDiscountedPrice: null,
            appliedDiscountType: null,
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            transactions: [],
            userId: 'attendee-1',
          }),
        findMany: vi
          .fn()
          .mockReturnValueOnce(
            Effect.succeed([
              {
                id: 'organizer-registration-1',
                registrationOption: {
                  organizingRegistration: true,
                },
              },
            ]),
          )
          .mockReturnValueOnce(
            Effect.succeed([
              {
                userId: 'already-registered-user',
              },
            ]),
          ),
      },
      usersToTenants: {
        findMany: () =>
          Effect.succeed([
            {
              id: 'tenant-user-current',
              roles: [{ id: 'participant-role-1' }],
              user: {
                email: 'current@example.com',
                firstName: 'Current',
                id: 'attendee-1',
                lastName: 'Owner',
              },
              userId: 'attendee-1',
            },
            {
              id: 'tenant-user-eligible',
              roles: [{ id: 'participant-role-1' }],
              user: {
                email: 'alex@example.com',
                firstName: 'Alex',
                id: 'target-user-1',
                lastName: 'Able',
              },
              userId: 'target-user-1',
            },
            {
              id: 'tenant-user-active',
              roles: [{ id: 'participant-role-1' }],
              user: {
                email: 'registered@example.com',
                firstName: 'Already',
                id: 'already-registered-user',
                lastName: 'Registered',
              },
              userId: 'already-registered-user',
            },
            {
              id: 'tenant-user-ineligible',
              roles: [{ id: 'other-role-1' }],
              user: {
                email: 'other@example.com',
                firstName: 'Other',
                id: 'other-user-1',
                lastName: 'Role',
              },
              userId: 'other-user-1',
            },
          ]),
      },
    },
    select: () => ({
      from: (table: unknown) => {
        if (table === usersToTenants) {
          return {
            innerJoin: () => ({
              where: () => ({
                limit: () => Effect.succeed(tenantUserRows),
              }),
            }),
          };
        }

        if (table === rolesToTenantUsers) {
          return {
            where: () =>
              Effect.succeed([
                {
                  roleId: 'participant-role-1',
                  userTenantId: 'tenant-user-current',
                },
                {
                  roleId: 'participant-role-1',
                  userTenantId: 'tenant-user-eligible',
                },
                {
                  roleId: 'participant-role-1',
                  userTenantId: 'tenant-user-active',
                },
                {
                  roleId: 'other-role-1',
                  userTenantId: 'tenant-user-ineligible',
                },
              ]),
          };
        }

        throw new Error('Unexpected select table');
      },
    }),
  };

  return database;
};

describe('event registration trusted URLs', () => {
  it.effect(
    'ignores forged request origins when creating Stripe checkout return URLs',
    () =>
      Effect.gen(function* () {
        let boundCheckout: Record<string, unknown> | undefined;
        const operationOrder: string[] = [];
        let pendingClaim: Record<string, unknown> | undefined;
        const createCheckoutSession = vi.fn(() => {
          operationOrder.push('stripe');
          return Promise.resolve({
            id: 'cs_test_123',
            payment_intent: null,
            url: 'https://checkout.stripe.test/cs_test_123',
          });
        });
        const stripe = createStripeClientDouble({ createCheckoutSession });
        const registrationTransaction = {
          insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => {
              if (table === eventRegistrations) {
                return {
                  returning: () => Effect.succeed([{ id: 'registration-1' }]),
                };
              }
              if (table === transactions) {
                operationOrder.push('claim');
                pendingClaim = values;
              }
              return Effect.void;
            },
          }),
          query: {
            eventRegistrations: {
              findMany: () => Effect.succeed([]),
            },
          },
          select: () => ({
            from: (table: unknown) => ({
              where: () => ({
                for: () =>
                  Effect.succeed(
                    table === eventRegistrations
                      ? [{ status: 'PENDING' }]
                      : [{ id: 'tenant-user-1' }],
                  ),
              }),
            }),
          }),
          update: (table: unknown) => ({
            set: (values: Record<string, unknown>) => ({
              where: () => ({
                returning: () => {
                  if (table === transactions) {
                    operationOrder.push('bind');
                    boundCheckout = values;
                  } else if (table === eventRegistrationOptions) {
                    operationOrder.push('reserve');
                  }
                  return Effect.succeed([{ id: 'option-1' }]);
                },
              }),
            }),
          }),
        };
        const database = {
          insert: () => ({
            values: () => Effect.void,
          }),
          query: {
            eventRegistrationOptions: {
              findFirst: () =>
                Effect.succeed({
                  closeRegistrationTime: new Date('2099-01-02T00:00:00.000Z'),
                  confirmedSpots: 0,
                  event: {
                    start: new Date('2099-01-01T12:00:00.000Z'),
                    status: 'APPROVED',
                    tenantId: tenant.id,
                    title: 'Trusted URL event',
                  },
                  eventId: 'event-1',
                  id: 'option-1',
                  isPaid: true,
                  openRegistrationTime: new Date('2000-01-01T00:00:00.000Z'),
                  organizingRegistration: false,
                  price: 1000,
                  questions: [],
                  registrationMode: 'fcfs',
                  reservedSpots: 0,
                  roleIds: [],
                  spots: 10,
                  stripeTaxRateId: null,
                }),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
            userDiscountCards: {
              findMany: () => Effect.succeed([]),
            },
          },
          transaction: (
            run: (
              transaction: typeof registrationTransaction,
            ) => Effect.Effect<unknown>,
          ) => run(registrationTransaction),
          update: () => ({
            set: () => ({
              where: () => Effect.void,
            }),
          }),
        };
        const attackerOptions = {
          headers: Headers.fromInput({
            host: 'attacker.example',
            origin: 'https://attacker.example',
            'x-forwarded-host': 'attacker.example',
            'x-forwarded-proto': 'https',
          }),
        };

        yield* eventRegistrationHandlers['events.registerForEvent'](
          {
            eventId: 'event-1',
            guestCount: 0,
            registrationOptionId: 'option-1',
          },
          attackerOptions,
        ).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(
            createContextLayer({
              database,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
              user: createUser({ id: 'attendee-1' }),
            }),
          ),
          Effect.provide(registrationConfigProviderLayer),
        );

        expect(createCheckoutSession).toHaveBeenCalledOnce();
        expect(operationOrder).toEqual(['reserve', 'claim', 'stripe', 'bind']);
        expect(pendingClaim).toEqual(
          expect.objectContaining({
            amount: 1000,
            eventRegistrationId: 'registration-1',
            method: 'stripe',
            status: 'pending',
            type: 'registration',
          }),
        );
        expect(pendingClaim).not.toHaveProperty('stripeCheckoutSessionId');
        expect(boundCheckout).toEqual(
          expect.objectContaining({
            stripeCheckoutSessionId: 'cs_test_123',
            stripeCheckoutUrl: 'https://checkout.stripe.test/cs_test_123',
          }),
        );
        expect(createCheckoutSession).toHaveBeenCalledWith(
          expect.objectContaining({
            cancel_url:
              'https://tenant.example.com/events/event-1?registrationStatus=cancel',
            metadata: expect.objectContaining({
              registrationId: 'registration-1',
              transactionId: pendingClaim?.['id'],
            }),
            success_url:
              'https://tenant.example.com/events/event-1?registrationStatus=success',
          }),
          expect.objectContaining({
            idempotencyKey: `registration:registration-1:transaction:${String(pendingClaim?.['id'])}`,
            stripeAccount: 'acct_123',
          }),
        );
        expect(JSON.stringify(createCheckoutSession.mock.calls)).not.toContain(
          'attacker.example',
        );
      }),
  );
});

describe('event registration cancellation handlers', () => {
  it.effect(
    'allows event organizers to cancel another confirmed registration',
    () =>
      Effect.gen(function* () {
        const updateSets: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({ status: 'CONFIRMED' }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () => {
                    if (
                      table === eventRegistrations ||
                      table === eventRegistrationOptions
                    ) {
                      return Effect.succeed([{ id: 'updated' }]);
                    }
                    return Effect.succeed([]);
                  },
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
                }),
              findMany: () =>
                Effect.succeed([
                  {
                    id: 'organizer-registration-1',
                    registrationOption: {
                      organizingRegistration: true,
                    },
                  },
                ]),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        yield* eventRegistrationHandlers['events.cancelEventRegistration'](
          { eventId: 'event-1', registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expect(updateSets).toEqual([
          { status: 'CANCELLED' },
          expect.objectContaining({ confirmedSpots: expect.anything() }),
        ]);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'rejects event registration cancellation without organizer access',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
                }),
              findMany: () => Effect.succeed([]),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.cancelEventRegistration'
        ](
          { eventId: 'event-1', registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('RpcForbiddenError');
        expect(database.transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'cancels confirmed registrations and releases a confirmed spot',
    () =>
      Effect.gen(function* () {
        const updateSets: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({ status: 'CONFIRMED' }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () => {
                    if (
                      table === eventRegistrations ||
                      table === eventRegistrationOptions
                    ) {
                      return Effect.succeed([{ id: 'updated' }]);
                    }
                    return Effect.succeed([]);
                  },
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: [],
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { guestCheckInCount: 0, registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expect(updateSets).toEqual([
          { status: 'CANCELLED' },
          expect.objectContaining({ confirmedSpots: expect.anything() }),
        ]);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'cancels confirmed guest registrations and releases buyer plus guest spots',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createGuestCancellationDatabase({
          status: 'CONFIRMED',
        });

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expectCounterDecrement(updateSets[1], 'confirmedSpots', 3);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'records a pending manual refund transaction for paid confirmed cancellation',
    () =>
      Effect.gen(function* () {
        let insertedTransaction: Record<string, unknown> | undefined;
        const updateSets: unknown[] = [];
        const registrationTransactions = [
          {
            amount: 2500,
            id: 'transaction-1',
            method: 'stripe',
            status: 'successful',
            stripeCheckoutSessionId: 'checkout-1',
            type: 'registration',
          },
        ];
        const tx = {
          ...createCancellationTransactionSelect({
            guestCount: 1,
            status: 'CONFIRMED',
            transactions: registrationTransactions,
          }),
          insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => {
              if (table === transactions) {
                insertedTransaction = values;
              }
              return Effect.succeed([]);
            },
          }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () => {
                    if (
                      table === eventRegistrations ||
                      table === eventRegistrationOptions
                    ) {
                      return Effect.succeed([{ id: 'updated' }]);
                    }
                    return Effect.succeed([]);
                  },
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 1,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: registrationTransactions,
                  userId: 'attendee-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expectCounterDecrement(updateSets[1], 'confirmedSpots', 2);
        expect(insertedTransaction).toEqual(
          expect.objectContaining({
            amount: -2500,
            currency: 'EUR',
            eventId: 'event-1',
            eventRegistrationId: 'registration-1',
            manuallyCreated: true,
            method: 'stripe',
            status: 'pending',
            targetUserId: 'attendee-1',
            tenantId: 'tenant-1',
            type: 'refund',
          }),
        );
        expect(insertedTransaction?.['comment']).toContain(
          'Pending registration refund record',
        );
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'creates a Stripe refund for paid confirmed cancellation with a stored Stripe reference',
    () =>
      Effect.gen(function* () {
        let insertedTransaction: Record<string, unknown> | undefined;
        const updateSets: unknown[] = [];
        const registrationTransactions = [
          {
            amount: 2500,
            id: 'transaction-1',
            method: 'stripe',
            status: 'successful',
            stripeChargeId: 'ch_123',
            stripeCheckoutSessionId: 'checkout-1',
            stripePaymentIntentId: 'pi_123',
            type: 'registration',
          },
        ];
        const tx = {
          ...createCancellationTransactionSelect({
            guestCount: 1,
            status: 'CONFIRMED',
            transactions: registrationTransactions,
          }),
          insert: vi.fn(),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () => {
                    if (
                      table === eventRegistrations ||
                      table === eventRegistrationOptions
                    ) {
                      return Effect.succeed([{ id: 'updated' }]);
                    }
                    return Effect.succeed([]);
                  },
                }),
              };
            },
          }),
        };
        const database = {
          insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => {
              if (table === transactions) {
                insertedTransaction = values;
              }
              return Effect.succeed([]);
            },
          }),
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 1,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  transactions: registrationTransactions,
                  userId: 'attendee-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };
        const stripe = {
          checkout: {
            sessions: {
              expire: vi.fn(),
            },
          },
          refunds: {
            create: vi.fn(() =>
              Promise.resolve({ id: 're_123', status: 'succeeded' }),
            ),
          },
        };

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        expectCounterDecrement(updateSets[1], 'confirmedSpots', 2);
        expect(tx.insert).not.toHaveBeenCalled();
        expect(stripe.refunds.create).toHaveBeenCalledWith(
          {
            amount: 2500,
            charge: 'ch_123',
          },
          {
            stripeAccount: 'acct_123',
          },
        );
        expect(insertedTransaction).toEqual(
          expect.objectContaining({
            amount: -2500,
            currency: 'EUR',
            eventId: 'event-1',
            eventRegistrationId: 'registration-1',
            manuallyCreated: false,
            method: 'stripe',
            status: 'successful',
            targetUserId: 'attendee-1',
            tenantId: 'tenant-1',
            type: 'refund',
          }),
        );
        expect(insertedTransaction?.['comment']).toContain('re_123');
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'preserves an unbound pending checkout claim and its reservation',
    () =>
      Effect.gen(function* () {
        const updateSets: unknown[] = [];
        const registrationTransactions = [
          {
            amount: 1000,
            id: 'transaction-1',
            method: 'stripe',
            status: 'pending',
            stripeChargeId: null,
            stripeCheckoutSessionId: null,
            stripePaymentIntentId: null,
            type: 'registration',
          },
        ];
        const tx = {
          ...createCancellationTransactionSelect({
            status: 'PENDING',
            transactions: registrationTransactions,
          }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () =>
                    table === eventRegistrations ||
                    table === eventRegistrationOptions ||
                    table === transactions
                      ? Effect.succeed([{ id: 'updated' }])
                      : Effect.succeed([]),
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'PENDING',
                  transactions: registrationTransactions,
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ](
          { guestCheckInCount: 0, registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain(
          'Payment checkout is still being prepared',
        );
        expect(updateSets).toEqual([]);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    're-reads a payment claim created after preflight and releases its reservations',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const pendingTransaction = {
          amount: 1000,
          id: 'transaction-race',
          method: 'stripe',
          status: 'pending',
          stripeChargeId: null,
          stripeCheckoutCancellationRequestedAt: null as Date | null,
          stripeCheckoutSessionId: 'checkout-race',
          stripePaymentIntentId: null,
          type: 'registration',
        };
        const updatedTables: unknown[] = [];
        const updateSets: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({
            status: 'PENDING',
            transactions: [pendingTransaction],
          }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              if (
                table === transactions &&
                values !== null &&
                typeof values === 'object' &&
                'stripeCheckoutCancellationRequestedAt' in values &&
                values.stripeCheckoutCancellationRequestedAt instanceof Date
              ) {
                pendingTransaction.stripeCheckoutCancellationRequestedAt =
                  values.stripeCheckoutCancellationRequestedAt;
                operationOrder.push('marker-commit');
              } else {
                operationOrder.push('local-update');
              }
              updatedTables.push(table);
              updateSets.push(values);
              return {
                where: () =>
                  table === eventAddons
                    ? Effect.succeed([])
                    : {
                        returning: () =>
                          table === eventRegistrations ||
                          table === eventRegistrationOptions ||
                          table === transactions
                            ? Effect.succeed([{ id: 'updated' }])
                            : Effect.succeed([]),
                      },
              };
            },
          }),
        };
        let isTransactionActive = false;
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [{ addonId: 'addon-1', quantity: 2 }],
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'PENDING',
                  transactions: [],
                  userId: 'scanner-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            Effect.sync(() => {
              isTransactionActive = true;
            }).pipe(
              Effect.andThen(callback(tx) as Effect.Effect<unknown>),
              Effect.ensuring(
                Effect.sync(() => {
                  isTransactionActive = false;
                }),
              ),
            ),
          ),
        };
        const retrieveCheckoutSession = vi.fn(async () => {
          expect(isTransactionActive).toBe(false);
          operationOrder.push('stripe-retrieve');
          return {
            id: 'checkout-race',
            status: 'expired',
          } as Stripe.Checkout.Session;
        });
        const stripe = createStripeClientDouble({ retrieveCheckoutSession });
        vi.mocked(stripe.checkout.sessions.expire).mockImplementation(
          async () => {
            expect(isTransactionActive).toBe(false);
            operationOrder.push('stripe-expire');
            throw new Error('Checkout Session is already expired');
          },
        );

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        expect(updatedTables).toEqual([
          transactions,
          transactions,
          eventRegistrations,
          eventRegistrationOptions,
          eventAddons,
        ]);
        expect(updateSets[1]).toEqual({ status: 'cancelled' });
        expectCounterDecrement(updateSets[3], 'reservedSpots', 1);
        expect(updateSets[4]).toEqual(
          expect.objectContaining({
            totalAvailableQuantity: expect.objectContaining({
              queryChunks: expect.arrayContaining([2]),
            }),
          }),
        );
        expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
          'checkout-race',
          undefined,
          {
            idempotencyKey: 'cancel-registration-checkout-transaction-race',
            stripeAccount: 'acct_123',
          },
        );
        expect(retrieveCheckoutSession).toHaveBeenCalledWith(
          'checkout-race',
          undefined,
          { stripeAccount: 'acct_123' },
        );
        expect(operationOrder.slice(0, 4)).toEqual([
          'marker-commit',
          'stripe-expire',
          'stripe-retrieve',
          'local-update',
        ]);
        expect(database.transaction).toHaveBeenCalledTimes(2);
      }),
  );

  it.effect(
    'keeps a pending registration and its reservations when Stripe expiry is unconfirmed',
    () =>
      Effect.gen(function* () {
        const pendingTransaction = {
          amount: 1000,
          id: 'transaction-race',
          method: 'stripe',
          status: 'pending',
          stripeChargeId: null,
          stripeCheckoutCancellationRequestedAt: null as Date | null,
          stripeCheckoutSessionId: 'checkout-race',
          stripePaymentIntentId: null,
          type: 'registration',
        };
        const updateSets: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({
            status: 'PENDING',
            transactions: [pendingTransaction],
          }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              if (
                table === transactions &&
                values !== null &&
                typeof values === 'object' &&
                'stripeCheckoutCancellationRequestedAt' in values &&
                values.stripeCheckoutCancellationRequestedAt instanceof Date
              ) {
                pendingTransaction.stripeCheckoutCancellationRequestedAt =
                  values.stripeCheckoutCancellationRequestedAt;
              }
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () => Effect.succeed([{ id: 'updated' }]),
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'PENDING',
                  transactions: [pendingTransaction],
                  userId: 'scanner-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };
        const stripe = createStripeClientDouble();
        vi.mocked(stripe.checkout.sessions.expire).mockRejectedValue(
          new Error('Stripe expiry timed out'),
        );

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe(
          'Stripe could not confirm checkout cancellation; the registration and reserved items remain unchanged',
        );
        expect(updateSets).toEqual([
          {
            stripeCheckoutCancellationRequestedAt: expect.any(Date),
          },
        ]);
        expect(database.transaction).toHaveBeenCalledOnce();

        vi.mocked(stripe.checkout.sessions.expire).mockResolvedValue({
          status: 'open',
        } as Stripe.Checkout.Session);
        const nonExpiredError = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        expect(nonExpiredError['_tag']).toBe('EventRegistrationInternalError');
        expect(updateSets).toHaveLength(1);
        expect(database.transaction).toHaveBeenCalledTimes(2);
      }),
  );

  it.effect(
    'treats an exact checkout cancellation finalized by a concurrent request as idempotent under the row lock',
    () =>
      Effect.gen(function* () {
        const pendingTransaction = {
          amount: 1000,
          id: 'transaction-race',
          method: 'stripe',
          status: 'pending' as 'cancelled' | 'pending',
          stripeChargeId: null,
          stripeCheckoutCancellationRequestedAt: null as Date | null,
          stripeCheckoutSessionId: 'checkout-race',
          stripePaymentIntentId: null,
          type: 'registration',
        };
        let transactionCall = 0;
        const updateSets: unknown[] = [];
        const tx = {
          select: () => ({
            from: (table: unknown) => ({
              where: () => ({
                for: () => {
                  if (table === eventRegistrations) {
                    return Effect.succeed([
                      {
                        checkInTime: null,
                        eventId: 'event-1',
                        guestCount: 0,
                        id: 'registration-1',
                        registrationOptionId: 'option-1',
                        status: transactionCall === 1 ? 'PENDING' : 'CANCELLED',
                        userId: 'scanner-1',
                      },
                    ]);
                  }
                  if (table === transactions) {
                    return Effect.succeed([
                      {
                        ...pendingTransaction,
                        status: transactionCall === 1 ? 'pending' : 'cancelled',
                      },
                    ]);
                  }
                  return Effect.succeed([]);
                },
              }),
            }),
          }),
          update: () => ({
            set: (values: unknown) => {
              updateSets.push(values);
              if (
                values !== null &&
                typeof values === 'object' &&
                'stripeCheckoutCancellationRequestedAt' in values &&
                values.stripeCheckoutCancellationRequestedAt instanceof Date
              ) {
                pendingTransaction.stripeCheckoutCancellationRequestedAt =
                  values.stripeCheckoutCancellationRequestedAt;
              }
              return {
                where: () => ({
                  returning: () => Effect.succeed([{ id: 'updated' }]),
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'PENDING',
                  transactions: [pendingTransaction],
                  userId: 'scanner-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) => {
            transactionCall += 1;
            return callback(tx);
          }),
        };
        const stripe = createStripeClientDouble();

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        expect(database.transaction).toHaveBeenCalledTimes(2);
        expect(updateSets).toEqual([
          {
            stripeCheckoutCancellationRequestedAt: expect.any(Date),
          },
        ]);
        expect(stripe.checkout.sessions.expire).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'does not release reservations when payment completion wins cancellation finalization',
    () =>
      Effect.gen(function* () {
        let registrationStatus: 'CONFIRMED' | 'PENDING' = 'PENDING';
        const paymentTransaction = {
          amount: 1000,
          id: 'transaction-race',
          method: 'stripe',
          status: 'pending' as 'pending' | 'successful',
          stripeChargeId: null,
          stripeCheckoutCancellationRequestedAt: null as Date | null,
          stripeCheckoutSessionId: 'checkout-race',
          stripePaymentIntentId: null,
          type: 'registration',
        };
        const updateSets: unknown[] = [];
        const tx = {
          select: () => ({
            from: (table: unknown) => ({
              where: () => ({
                for: () =>
                  table === eventRegistrations
                    ? Effect.succeed([
                        {
                          checkInTime: null,
                          eventId: 'event-1',
                          guestCount: 0,
                          id: 'registration-1',
                          registrationOptionId: 'option-1',
                          status: registrationStatus,
                          userId: 'scanner-1',
                        },
                      ])
                    : table === transactions
                      ? Effect.succeed([paymentTransaction])
                      : Effect.succeed([]),
              }),
            }),
          }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              if (
                table === transactions &&
                values !== null &&
                typeof values === 'object' &&
                'stripeCheckoutCancellationRequestedAt' in values &&
                values.stripeCheckoutCancellationRequestedAt instanceof Date
              ) {
                paymentTransaction.stripeCheckoutCancellationRequestedAt =
                  values.stripeCheckoutCancellationRequestedAt;
              }
              return {
                where: () => ({
                  returning: () => Effect.succeed([{ id: 'updated' }]),
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  addonPurchases: [],
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: registrationStatus,
                  transactions: [paymentTransaction],
                  userId: 'scanner-1',
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };
        const stripe = createStripeClientDouble();
        vi.mocked(stripe.checkout.sessions.expire).mockImplementation(
          async () => {
            registrationStatus = 'CONFIRMED';
            paymentTransaction.status = 'successful';
            paymentTransaction.stripeCheckoutCancellationRequestedAt = null;
            return { status: 'expired' } as Stripe.Checkout.Session;
          },
        );

        const error = yield* eventRegistrationHandlers[
          'events.cancelRegistration'
        ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              stripe,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toContain(
          'payment state changed while cancellation was being processed',
        );
        expect(updateSets).toEqual([
          {
            stripeCheckoutCancellationRequestedAt: expect.any(Date),
          },
        ]);
        expect(database.transaction).toHaveBeenCalledTimes(2);
      }),
  );

  it.effect(
    'cancels unapproved manual applications without releasing reserved spots',
    () =>
      Effect.gen(function* () {
        const updateSets: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({ status: 'PENDING' }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () =>
                    table === eventRegistrations
                      ? Effect.succeed([{ id: 'updated' }])
                      : Effect.succeed([]),
                }),
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'PENDING',
                  transactions: [],
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expect(updateSets).toEqual([{ status: 'CANCELLED' }]);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'cancels pending guest registrations and releases buyer plus guest reserved spots',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createGuestCancellationDatabase({
          status: 'PENDING',
        });

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
              tenant: {
                ...tenant,
                stripeAccountId: 'acct_123',
              },
            }),
          ),
        );

        expectCounterDecrement(updateSets[3], 'reservedSpots', 3);
        expect(database.transaction).toHaveBeenCalledTimes(2);
      }),
  );

  it.effect('rejects checked-in registration cancellation', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                checkedInGuestCount: 0,
                checkInTime: new Date(),
                event: {
                  start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                },
                guestCount: 0,
                id: 'registration-1',
                registrationOptionId: 'option-1',
                status: 'CONFIRMED',
                transactions: [],
              }),
          },
        },
        transaction: vi.fn(),
      };

      const error = yield* eventRegistrationHandlers[
        'events.cancelRegistration'
      ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
        Effect.flip,
        Effect.provide(createContextLayer({ database })),
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Checked-in registrations cannot be cancelled',
      );
      expect(database.transaction).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    'cancels waitlisted registrations and releases a waitlist spot',
    () =>
      Effect.gen(function* () {
        const updateSets: unknown[] = [];
        const tx = {
          ...createCancellationTransactionSelect({ status: 'WAITLIST' }),
          update: (table: unknown) => ({
            set: (values: unknown) => {
              updateSets.push(values);
              return {
                where: () =>
                  table === transactions
                    ? Effect.succeed([])
                    : {
                        returning: () =>
                          table === eventRegistrations ||
                          table === eventRegistrationOptions
                            ? Effect.succeed([{ id: 'updated' }])
                            : Effect.succeed([]),
                      },
              };
            },
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
                  },
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'WAITLIST',
                  transactions: [],
                }),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        yield* eventRegistrationHandlers['events.cancelRegistration'](
          { registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expect(updateSets).toEqual([
          { status: 'CANCELLED' },
          expect.objectContaining({ waitlistSpots: expect.anything() }),
        ]);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );
});

describe('event registration transfer handlers', () => {
  it.effect(
    'returns eligible transfer targets for organizer-assisted transfer',
    () =>
      Effect.gen(function* () {
        const result = yield* eventRegistrationHandlers[
          'events.findTransferTargets'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            search: 'alex',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({ database: createTransferTargetsDatabase() }),
          ),
        );

        expect(result).toEqual([
          {
            email: 'alex@example.com',
            firstName: 'Alex',
            id: 'target-user-1',
            lastName: 'Able',
          },
        ]);
      }),
  );

  it.effect(
    'returns transfer targets for unrestricted registration options',
    () =>
      Effect.gen(function* () {
        const result = yield* eventRegistrationHandlers[
          'events.findTransferTargets'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            search: 'alex',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database: createTransferTargetsDatabase({
                registrationOptionRoleIds: [],
              }),
            }),
          ),
        );

        expect(result).toEqual([
          {
            email: 'alex@example.com',
            firstName: 'Alex',
            id: 'target-user-1',
            lastName: 'Able',
          },
          {
            email: 'other@example.com',
            firstName: 'Other',
            id: 'other-user-1',
            lastName: 'Role',
          },
        ]);
      }),
  );

  it.effect(
    'allows event organizers to transfer a confirmed unpaid registration to another tenant user',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase();

        yield* eventRegistrationHandlers['events.transferEventRegistration'](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database })));

        expect(updateSets).toEqual([{ userId: 'target-user-1' }]);
      }),
  );

  it.effect(
    'allows participants to transfer their own confirmed unpaid registration by target email',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          organizerRegistrations: [],
        });

        yield* eventRegistrationHandlers['events.transferMyRegistration'](
          {
            registrationId: 'registration-1',
            targetEmail: ' TARGET@EXAMPLE.COM ',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ id: 'attendee-1' }),
            }),
          ),
        );

        expect(updateSets).toEqual([{ userId: 'target-user-1' }]);
      }),
  );

  it.effect('allows transfer to unrestricted registration options', () =>
    Effect.gen(function* () {
      const { database, updateSets } = createTransferDatabase({
        registrationOptionRoleIds: [],
        targetTenantUser: {
          id: 'target-tenant-user-1',
          roles: [],
        },
      });

      yield* eventRegistrationHandlers['events.transferEventRegistration'](
        {
          eventId: 'event-1',
          registrationId: 'registration-1',
          targetUserId: 'target-user-1',
        },
        emptyHandlerOptions,
      ).pipe(Effect.provide(createContextLayer({ database })));

      expect(updateSets).toEqual([{ userId: 'target-user-1' }]);
    }),
  );

  it.effect(
    'rejects participant transfer when the target email is not an existing user',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          targetUser: null,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferMyRegistration'
        ](
          {
            registrationId: 'registration-1',
            targetEmail: 'missing@example.com',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ id: 'attendee-1' }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(error.message).toBe('Target user not found');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'does not reveal existing users outside the tenant during participant transfer',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          targetTenantUser: null,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferMyRegistration'
        ](
          {
            registrationId: 'registration-1',
            targetEmail: 'target@example.com',
          },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ id: 'attendee-1' }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(error.message).toBe('Target user not found');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect('rejects transfer without organizer access', () =>
    Effect.gen(function* () {
      const { database, updateSets } = createTransferDatabase({
        organizerRegistrations: [],
      });

      const error = yield* eventRegistrationHandlers[
        'events.transferEventRegistration'
      ](
        {
          eventId: 'event-1',
          registrationId: 'registration-1',
          targetUserId: 'target-user-1',
        },
        emptyHandlerOptions,
      ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(updateSets).toEqual([]);
    }),
  );

  it.effect(
    'rejects paid registration transfer until refund and resale handling exists',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          registration: {
            appliedDiscountedPrice: null,
            appliedDiscountType: null,
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            transactions: [
              {
                amount: 1200,
                status: 'successful',
                type: 'registration',
              },
            ],
            userId: 'attendee-1',
          },
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Paid registration transfer is not available until the refund/resale flow is implemented',
        );
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects discounted registration transfer until target discount validation exists',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          registration: {
            appliedDiscountedPrice: 0,
            appliedDiscountType: 'esnCard',
            checkInTime: null,
            event: {
              start: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            eventId: 'event-1',
            id: 'registration-1',
            registrationOptionId: 'option-1',
            status: 'CONFIRMED',
            transactions: [],
            userId: 'attendee-1',
          },
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Discounted registration transfer is not available until transfer discount validation is implemented',
        );
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect('rejects transfer when the target user is not role-eligible', () =>
    Effect.gen(function* () {
      const { database, updateSets } = createTransferDatabase({
        targetTenantUser: {
          id: 'target-tenant-user-1',
          roles: [{ id: 'other-role-1' }],
        },
      });

      const error = yield* eventRegistrationHandlers[
        'events.transferEventRegistration'
      ](
        {
          eventId: 'event-1',
          registrationId: 'registration-1',
          targetUserId: 'target-user-1',
        },
        emptyHandlerOptions,
      ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Target user is not eligible for this registration option',
      );
      expect(updateSets).toEqual([]);
    }),
  );

  it.effect(
    'rejects transfer when the target user is outside the current tenant',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          targetTenantUser: null,
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(error.message).toBe('Target tenant user not found');
        expect(updateSets).toEqual([]);
      }),
  );

  it.effect(
    'rejects transfer when the target already has an active registration',
    () =>
      Effect.gen(function* () {
        const { database, updateSets } = createTransferDatabase({
          existingTargetRegistration: { id: 'target-registration-1' },
        });

        const error = yield* eventRegistrationHandlers[
          'events.transferEventRegistration'
        ](
          {
            eventId: 'event-1',
            registrationId: 'registration-1',
            targetUserId: 'target-user-1',
          },
          emptyHandlerOptions,
        ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Target user already has an active registration',
        );
        expect(updateSets).toEqual([]);
      }),
  );
});

describe('event registration scan handlers', () => {
  it.effect('rejects scan reads for users who cannot check in this event', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () => Effect.succeed(scannedRegistration),
            findMany: () => Effect.succeed([]),
          },
        },
      };

      const error = yield* eventRegistrationHandlers[
        'events.registrationScanned'
      ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
        Effect.flip,
        Effect.provide(createContextLayer({ database })),
      );

      expect(error['_tag']).toBe('RpcForbiddenError');
    }),
  );

  it.effect('disables scan check-in before the pre-start window opens', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                ...scannedRegistration,
                event: {
                  ...scannedRegistration.event,
                  start: new Date(Date.now() + 2 * 60 * 60 * 1000),
                },
              }),
          },
        },
      };

      const result = yield* eventRegistrationHandlers[
        'events.registrationScanned'
      ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
        Effect.provide(
          createContextLayer({
            database,
            user: createUser({ permissions: ['events:organizeAll'] }),
          }),
        ),
      );

      expect(result.allowCheckin).toBe(false);
      expect(result.checkInTimingIssue).toBe(true);
      expect(result.registrationStatusIssue).toBe(false);
      expect(result.sameUserIssue).toBe(false);
    }),
  );

  it.effect(
    'evaluates the scan window against the configured server clock',
    () =>
      Effect.gen(function* () {
        const nowIso = '2026-09-15T12:00:00.000Z';
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  ...scannedRegistration,
                  event: {
                    ...scannedRegistration.event,
                    start: new Date('2026-09-15T12:30:00.000Z'),
                  },
                }),
            },
          },
        };

        const result = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
          Effect.provide(
            createContextLayer({
              database,
              nowIso,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(result.allowCheckin).toBe(true);
        expect(result.checkInTimingIssue).toBe(false);
      }),
  );

  it.effect(
    'maps an invalid configured server clock to a typed scan error',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () => Effect.succeed(scannedRegistration),
            },
          },
        };

        const error = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              nowIso: 'not-a-date',
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe('Invalid E2E_NOW_ISO server clock value');
      }),
  );

  for (const status of nonConfirmedRegistrationStatuses) {
    it.effect(`disables scan check-in for ${status} registrations`, () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  ...scannedRegistration,
                  status,
                }),
            },
          },
        };

        const result = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(result.allowCheckin).toBe(false);
        expect(result.registrationStatusIssue).toBe(true);
        expect(result.sameUserIssue).toBe(false);
      }),
    );
  }

  it.effect(
    'allows scanning remaining guests after the buyer is checked in',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  ...scannedRegistration,
                  checkedInGuestCount: 1,
                  checkInTime: new Date(),
                  guestCount: 2,
                }),
            },
          },
        };

        const result = yield* eventRegistrationHandlers[
          'events.registrationScanned'
        ]({ registrationId: 'registration-1' }, emptyHandlerOptions).pipe(
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(result.allowCheckin).toBe(true);
        expect(result.alreadyCheckedInIssue).toBe(false);
        expect(result.attendeeCheckedIn).toBe(true);
        expect(result.checkedInGuestCount).toBe(1);
        expect(result.checkInTimingIssue).toBe(false);
        expect(result.guestCount).toBe(2);
        expect(result.remainingGuestCount).toBe(1);
      }),
  );

  it.effect(
    'records check-in and increments the option counter for an organizer',
    () =>
      Effect.gen(function* () {
        const nowIso = '2026-09-15T12:00:00.000Z';
        const updateCalls: string[] = [];
        const tx = {
          update: (table: unknown) => ({
            set: (values: { checkInTime?: Date }) => ({
              where: () => ({
                returning: () => {
                  if (table === eventRegistrations) {
                    updateCalls.push('registration');
                    return Effect.succeed([
                      {
                        checkedInGuestCount: 0,
                        checkInTime: values.checkInTime,
                        id: 'registration-1',
                      },
                    ]);
                  }

                  if (table === eventRegistrationOptions) {
                    updateCalls.push('option');
                    return Effect.succeed([{ id: 'option-1' }]);
                  }

                  return Effect.succeed([]);
                },
              }),
            }),
          }),
        };
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date('2026-09-15T12:30:00.000Z'),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  userId: 'attendee-1',
                }),
              findMany: () =>
                Effect.succeed([
                  {
                    id: 'organizer-registration-1',
                    registrationOption: {
                      organizingRegistration: true,
                    },
                  },
                ]),
            },
          },
          transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
            callback(tx),
          ),
        };

        const result = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: 0, registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(Effect.provide(createContextLayer({ database, nowIso })));

        expect(result.alreadyCheckedIn).toBe(false);
        expect(result.checkInTime).toBe(nowIso);
        expect(updateCalls).toEqual(['registration', 'option']);
        expect(database.transaction).toHaveBeenCalledOnce();
      }),
  );

  it.effect('records selected guest check-ins with the attendee check-in', () =>
    Effect.gen(function* () {
      const updateSets: unknown[] = [];
      const tx = {
        update: (table: unknown) => ({
          set: (values: unknown) => {
            updateSets.push(values);
            return {
              where: () => ({
                returning: () => {
                  if (table === eventRegistrations) {
                    return Effect.succeed([
                      {
                        checkedInGuestCount: 2,
                        checkInTime: new Date(),
                        id: 'registration-1',
                      },
                    ]);
                  }

                  if (table === eventRegistrationOptions) {
                    return Effect.succeed([{ id: 'option-1' }]);
                  }

                  return Effect.succeed([]);
                },
              }),
            };
          },
        }),
      };
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                checkedInGuestCount: 0,
                checkInTime: null,
                event: {
                  start: new Date(Date.now() + 30 * 60 * 1000),
                },
                eventId: 'event-1',
                guestCount: 2,
                id: 'registration-1',
                registrationOptionId: 'option-1',
                status: 'CONFIRMED',
                userId: 'attendee-1',
              }),
            findMany: () =>
              Effect.succeed([
                {
                  id: 'organizer-registration-1',
                  registrationOption: {
                    organizingRegistration: true,
                  },
                },
              ]),
          },
        },
        transaction: vi.fn((callback: (tx: typeof tx) => unknown) =>
          callback(tx),
        ),
      };

      const result = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        {
          guestCheckInCount: 2,
          registrationId: 'registration-1',
        },
        emptyHandlerOptions,
      ).pipe(Effect.provide(createContextLayer({ database })));

      expect(result.alreadyCheckedIn).toBe(false);
      expect(updateSets).toEqual([
        expect.objectContaining({ checkInTime: expect.any(Date) }),
        expect.objectContaining({ checkedInSpots: expect.anything() }),
      ]);
    }),
  );

  it.effect(
    'rejects negative guest check-in counts before reading registration state',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: vi.fn(() =>
                Effect.die(new Error('registration lookup should not run')),
              ),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: -1, registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Guest check-in count must be a non-negative integer',
        );
        expect(
          database.query.eventRegistrations.findFirst,
        ).not.toHaveBeenCalled();
        expect(database.transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rejects guest check-in counts above remaining guests before writing',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 1,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 30 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 2,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status: 'CONFIRMED',
                  userId: 'attendee-1',
                }),
              findMany: () =>
                Effect.succeed([
                  {
                    id: 'organizer-registration-1',
                    registrationOption: {
                      organizingRegistration: true,
                    },
                  },
                ]),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: 2, registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Guest check-in count exceeds remaining guests',
        );
        expect(database.transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect('rejects check-in before the pre-start window opens', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                checkedInGuestCount: 0,
                checkInTime: null,
                event: {
                  start: new Date(Date.now() + 2 * 60 * 60 * 1000),
                },
                eventId: 'event-1',
                guestCount: 0,
                id: 'registration-1',
                registrationOptionId: 'option-1',
                status: 'CONFIRMED',
                userId: 'attendee-1',
              }),
          },
        },
        transaction: vi.fn(),
      };

      const error = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        { guestCheckInCount: 0, registrationId: 'registration-1' },
        emptyHandlerOptions,
      ).pipe(
        Effect.flip,
        Effect.provide(
          createContextLayer({
            database,
            user: createUser({ permissions: ['events:organizeAll'] }),
          }),
        ),
      );

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe('Check-in is not open for this event yet');
      expect(database.transaction).not.toHaveBeenCalled();
    }),
  );

  it.effect('treats duplicate check-in as an idempotent success', () =>
    Effect.gen(function* () {
      const checkInTime = new Date('2026-09-18T09:45:00.000Z');
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                checkedInGuestCount: 0,
                checkInTime,
                event: {
                  start: new Date(Date.now() + 2 * 60 * 60 * 1000),
                },
                eventId: 'event-1',
                id: 'registration-1',
                registrationOptionId: 'option-1',
                status: 'CONFIRMED',
                userId: 'attendee-1',
              }),
            findMany: () =>
              Effect.succeed([
                {
                  id: 'organizer-registration-1',
                  registrationOption: {
                    organizingRegistration: true,
                  },
                },
              ]),
          },
        },
        transaction: vi.fn(),
      };

      const result = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        { guestCheckInCount: 0, registrationId: 'registration-1' },
        emptyHandlerOptions,
      ).pipe(Effect.provide(createContextLayer({ database })));

      expect(result).toEqual({
        alreadyCheckedIn: true,
        checkInTime: '2026-09-18T09:45:00.000Z',
      });
      expect(database.transaction).not.toHaveBeenCalled();
    }),
  );

  it.effect('rejects users checking in their own registration', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          eventRegistrations: {
            findFirst: () =>
              Effect.succeed({
                checkedInGuestCount: 0,
                checkInTime: null,
                event: {
                  start: new Date(Date.now() + 30 * 60 * 1000),
                },
                eventId: 'event-1',
                guestCount: 0,
                id: 'registration-1',
                registrationOptionId: 'option-1',
                status: 'CONFIRMED',
                userId: 'scanner-1',
              }),
            findMany: () =>
              Effect.succeed([
                {
                  id: 'organizer-registration-1',
                  registrationOption: {
                    organizingRegistration: true,
                  },
                },
              ]),
          },
        },
      };

      const error = yield* eventRegistrationHandlers[
        'events.checkInRegistration'
      ](
        { guestCheckInCount: 0, registrationId: 'registration-1' },
        emptyHandlerOptions,
      ).pipe(Effect.flip, Effect.provide(createContextLayer({ database })));

      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Users cannot check in their own registration',
      );
    }),
  );

  for (const status of nonConfirmedRegistrationStatuses) {
    it.effect(`rejects direct check-in for ${status} registrations`, () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  checkedInGuestCount: 0,
                  checkInTime: null,
                  event: {
                    start: new Date(Date.now() + 30 * 60 * 1000),
                  },
                  eventId: 'event-1',
                  guestCount: 0,
                  id: 'registration-1',
                  registrationOptionId: 'option-1',
                  status,
                  userId: 'attendee-1',
                }),
            },
          },
          transaction: vi.fn(),
        };

        const error = yield* eventRegistrationHandlers[
          'events.checkInRegistration'
        ](
          { guestCheckInCount: 0, registrationId: 'registration-1' },
          emptyHandlerOptions,
        ).pipe(
          Effect.flip,
          Effect.provide(
            createContextLayer({
              database,
              user: createUser({ permissions: ['events:organizeAll'] }),
            }),
          ),
        );

        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Only confirmed registrations can be checked in',
        );
        expect(database.transaction).not.toHaveBeenCalled();
      }),
    );
  }
});
