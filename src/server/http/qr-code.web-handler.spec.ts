import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import QRCode from 'qrcode';

import type { Context as RequestContext } from '../../types/custom/context';

import { Database } from '../../db';
import { handleQrRegistrationCodeWebRequest } from './qr-code.web-handler';

afterEach(() => {
  vi.restoreAllMocks();
});

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
}: {
  id?: string;
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
  permissions: [],
  roleIds: [],
});

const createRequestContext = ({
  authenticated = true,
  userId = 'user-1',
}: {
  authenticated?: boolean;
  userId?: string;
} = {}): RequestContext =>
  ({
    authentication: {
      isAuthenticated: authenticated,
    },
    permissions: [],
    tenant,
    user: authenticated ? createUser({ id: userId }) : undefined,
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
  registration = confirmedRegistration,
}: {
  registration?: null | typeof confirmedRegistration;
} = {}) => ({
  query: {
    eventRegistrations: {
      findFirst: () => Effect.succeed(registration),
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
  it.effect(
    'allows ticket possession to fetch a confirmed registration QR image',
    () =>
      Effect.gen(function* () {
        const response = yield* runQrRequest({
          database: createDatabase(),
          requestContext: createRequestContext({ authenticated: false }),
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/png');
        expect(
          (yield* Effect.promise(() => response.arrayBuffer())).byteLength,
        ).toBeGreaterThan(0);
      }),
  );

  it.effect('uses the registration tenant domain in the encoded scan URL', () =>
    Effect.gen(function* () {
      const encodedTargets: string[] = [];
      vi.spyOn(QRCode, 'toBuffer').mockImplementation(((text: string) => {
        encodedTargets.push(text);

        return Promise.resolve(Buffer.from([1, 2, 3]));
      }) as typeof QRCode.toBuffer);

      const response = yield* runQrRequest({ database: createDatabase() });

      expect(response.status).toBe(200);
      expect(encodedTargets).toEqual([
        'https://tenant.example.com/scan/registration/registration-1',
      ]);
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
    'does not require the requester to own another user confirmed registration',
    () =>
      Effect.gen(function* () {
        const response = yield* runQrRequest({
          database: createDatabase(),
          requestContext: createRequestContext({ userId: 'other-user' }),
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/png');
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
