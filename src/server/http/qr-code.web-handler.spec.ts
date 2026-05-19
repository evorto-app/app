import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import type { Permission } from '../../shared/permissions/permissions';
import type { Context as RequestContext } from '../../types/custom/context';

import { Database } from '../../db';
import { handleQrRegistrationCodeWebRequest } from './qr-code.web-handler';

const tenant = {
  currency: 'EUR' as const,
  defaultLocation: undefined,
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
  id = 'user-1',
  permissions = [],
}: {
  id?: string;
  permissions?: readonly Permission[];
} = {}) => ({
  attributes: [],
  auth0Id: `auth0|${id}`,
  communicationEmail: undefined,
  email: `${id}@example.com`,
  firstName: 'Test',
  iban: undefined,
  id,
  lastName: 'User',
  paypalEmail: undefined,
  permissions,
  roleIds: [],
});

const createRequestContext = ({
  authenticated = true,
  permissions = [],
  userId = 'user-1',
}: {
  authenticated?: boolean;
  permissions?: readonly Permission[];
  userId?: string;
} = {}): RequestContext =>
  ({
    authentication: {
      isAuthenticated: authenticated,
    },
    permissions,
    tenant,
    user: authenticated ? createUser({ id: userId, permissions }) : undefined,
  }) as RequestContext;

const confirmedRegistration = {
  eventId: 'event-1',
  id: 'registration-1',
  status: 'CONFIRMED',
  tenantId: 'tenant-1',
  userId: 'user-1',
};

const runQrRequest = ({
  database,
  registrationId = 'registration-1',
  requestContext = createRequestContext(),
}: {
  database: unknown;
  registrationId?: string;
  requestContext?: RequestContext;
}) =>
  handleQrRegistrationCodeWebRequest(
    new Request('https://tenant.example.com/qr/registration/registration-1'),
    registrationId,
    requestContext,
  ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

const createDatabase = ({
  organizerRegistrations = [],
  registration = confirmedRegistration,
}: {
  organizerRegistrations?: readonly {
    registrationOption?: { organizingRegistration: boolean };
  }[];
  registration?: null | typeof confirmedRegistration;
} = {}) => ({
  query: {
    eventRegistrations: {
      findFirst: () => Effect.succeed(registration),
      findMany: () => Effect.succeed(organizerRegistrations),
    },
    tenants: {
      findFirst: () =>
        Effect.succeed({
          domain: tenant.domain,
        }),
    },
  },
});

describe('handleQrRegistrationCodeWebRequest', () => {
  it.effect('requires authentication before returning a registration QR', () =>
    Effect.gen(function* () {
      const response = yield* runQrRequest({
        database: createDatabase(),
        requestContext: createRequestContext({ authenticated: false }),
      });

      expect(response.status).toBe(401);
      expect(yield* Effect.promise(() => response.text())).toBe(
        'Authentication required',
      );
    }),
  );

  it.effect(
    'allows the confirmed registration owner to fetch the QR image',
    () =>
      Effect.gen(function* () {
        const response = yield* runQrRequest({
          database: createDatabase(),
          requestContext: createRequestContext({ userId: 'user-1' }),
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/png');
        expect(
          (yield* Effect.promise(() => response.arrayBuffer())).byteLength,
        ).toBeGreaterThan(0);
      }),
  );

  it.effect(
    'allows an organizer registration for the same event to fetch the QR image',
    () =>
      Effect.gen(function* () {
        const response = yield* runQrRequest({
          database: createDatabase({
            organizerRegistrations: [
              {
                registrationOption: {
                  organizingRegistration: true,
                },
              },
            ],
          }),
          requestContext: createRequestContext({ userId: 'organizer-1' }),
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/png');
      }),
  );

  it.effect(
    'hides another user confirmed registration from unauthorized users',
    () =>
      Effect.gen(function* () {
        const response = yield* runQrRequest({
          database: createDatabase(),
          requestContext: createRequestContext({ userId: 'other-user' }),
        });

        expect(response.status).toBe(404);
        expect(yield* Effect.promise(() => response.text())).toBe(
          'Registration not found',
        );
      }),
  );

  it.effect('does not generate QR images for pending registrations', () =>
    Effect.gen(function* () {
      const response = yield* runQrRequest({
        database: createDatabase({
          registration: {
            ...confirmedRegistration,
            status: 'PENDING',
          },
        }),
      });

      expect(response.status).toBe(404);
    }),
  );
});
