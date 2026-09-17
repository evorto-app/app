import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect } from 'effect';
import QRCode from 'qrcode';
import { beforeEach, vi } from 'vitest';

import type { Permission } from '../../shared/permissions/permissions';

import { eventRegistrations } from '../../db/schema';
import { Context as RequestContext } from '../../types/custom/context';
import { Tenant } from '../../types/custom/tenant';
import { User } from '../../types/custom/user';
import { createRegistrationDatabaseTestLayer } from '../testing/registration-database';
import { handleQrRegistrationCodeWebRequest } from './qr-code.web-handler';

const tenant = new Tenant({
  cancellationDeadlineHoursBeforeStart: 120,
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
  maxActiveRegistrationsPerUser: 0,
  name: 'Tenant',
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['NL'],
  },
  refundFeesOnCancellation: true,
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Amsterdam',
  transferDeadlineHoursBeforeStart: 0,
});

const createUser = ({
  id = 'user-1',
  permissions = [],
}: {
  id?: string;
  permissions?: readonly Permission[];
} = {}) =>
  new User({
    attributes: [],
    auth0Id: `auth0|${id}`,
    communicationEmail: `${id}@example.com`,
    email: `${id}@example.com`,
    firstName: 'Test',
    homeTenantId: undefined,
    homeTenantName: undefined,
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
  new RequestContext({
    authentication: {
      isAuthenticated: authenticated,
    },
    permissions,
    tenant,
    user: authenticated ? createUser({ id: userId, permissions }) : undefined,
  });

type QrRegistration = Pick<
  typeof eventRegistrations.$inferSelect,
  'eventId' | 'id' | 'status' | 'tenantId' | 'userId'
>;

const confirmedRegistration: QrRegistration = {
  eventId: 'event-1',
  id: 'registration-1',
  status: 'CONFIRMED',
  tenantId: 'tenant-1',
  userId: 'user-1',
};

const runQrRequest = ({
  database,
  environment = {},
  registrationId = 'registration-1',
  requestContext = createRequestContext(),
  requestUrl = 'https://tenant.example.com/qr/registration/registration-1',
}: {
  database: ReturnType<typeof createRegistrationDatabaseTestLayer>;
  environment?: Record<string, string>;
  registrationId?: string;
  requestContext?: RequestContext;
  requestUrl?: string;
}) =>
  handleQrRegistrationCodeWebRequest(
    new Request(requestUrl),
    registrationId,
    requestContext,
  ).pipe(
    Effect.provide(database),
    Effect.provide(
      ConfigProvider.layer(ConfigProvider.fromEnv({ env: environment })),
    ),
  );

const qrReadStatements = {
  organizerRegistration:
    'select "d0"."id" as "id", "registrationOption"."r" as "registrationOption" from "event_registrations" as "d0" left join lateral(select row_to_json("t".*) "r" from (select "d1"."organizingRegistration" as "organizingRegistration" from "event_registration_options" as "d1" where "d0"."registrationOptionId" = "d1"."id" limit $1) as "t") as "registrationOption" on true where (("d0"."eventId" = $2) and ("d0"."status" = $3) and ("d0"."tenantId" = $4) and ("d0"."userId" = $5))',
  registration:
    'select "d0"."eventId" as "eventId", "d0"."id" as "id", "d0"."status" as "status", "d0"."tenantId" as "tenantId", "d0"."userId" as "userId" from "event_registrations" as "d0" where "d0"."id" = $1 limit $2',
  tenant:
    'select "d0"."domain" as "domain" from "tenants" as "d0" where "d0"."id" = $1 limit $2',
};

const createDatabase = ({
  organizerRegistrations = [],
  organizerUserId = 'other-user',
  registration = confirmedRegistration,
  tenantRecord = { domain: tenant.domain },
}: {
  organizerRegistrations?: readonly {
    registrationOption?: { organizingRegistration: boolean };
  }[];
  organizerUserId?: string;
  registration?: null | QrRegistration;
  tenantRecord?: null | { domain: string };
} = {}) =>
  createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        if (statement === qrReadStatements.registration) {
          expect(parameters).toEqual(['registration-1', 1]);
          return registration
            ? [
                [
                  registration.eventId,
                  registration.id,
                  registration.status,
                  registration.tenantId,
                  registration.userId,
                ],
              ]
            : [];
        }
        if (statement === qrReadStatements.organizerRegistration) {
          expect(parameters).toEqual([
            1,
            confirmedRegistration.eventId,
            'CONFIRMED',
            tenant.id,
            organizerUserId,
          ]);
          return organizerRegistrations.map((row, index) => [
            `organizer-registration-${index}`,
            row.registrationOption ?? null,
          ]);
        }
        if (statement === qrReadStatements.tenant) {
          expect(parameters).toEqual([tenant.id, 1]);
          return tenantRecord ? [[tenantRecord.domain]] : [];
        }
        throw new Error(`Unexpected registration QR fixture SQL: ${statement}`);
      }),
  });

const qrCodeToBuffer = vi.spyOn(QRCode, 'toBuffer');

describe('handleQrRegistrationCodeWebRequest', () => {
  beforeEach(() => {
    qrCodeToBuffer.mockClear();
  });

  it.effect('requires authentication before returning a registration QR', () =>
    Effect.gen(function* () {
      const response = yield* runQrRequest({
        database: createDatabase(),
        requestContext: createRequestContext({ authenticated: false }),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(yield* Effect.promise(() => response.text())).toBe(
        'Sign in to open this ticket.',
      );
    }),
  );

  it.effect('does not cache a missing ticket response', () =>
    Effect.gen(function* () {
      const response = yield* runQrRequest({
        database: createDatabase({ registration: null }),
      });
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(yield* Effect.promise(() => response.text())).toBe(
        'Ticket not found.',
      );
      expect(qrCodeToBuffer).not.toHaveBeenCalled();
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
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(response.headers.get('Content-Type')).toBe('image/png');
        expect(
          (yield* Effect.promise(() => response.arrayBuffer())).byteLength,
        ).toBeGreaterThan(0);
      }),
  );

  it.effect(
    'uses the derived tenant origin instead of the request origin',
    () =>
      Effect.gen(function* () {
        const response = yield* runQrRequest({
          database: createDatabase(),
          requestUrl:
            'http://caller-controlled.invalid/qr/registration/registration-1',
        });

        expect(response.status).toBe(200);
        expect(qrCodeToBuffer).toHaveBeenCalledWith(
          'https://tenant.example.com/scan/registration/registration-1',
          expect.objectContaining({
            type: 'png',
          }),
        );
      }),
  );

  it.effect('preserves the explicit loopback runtime port in local dev', () =>
    Effect.gen(function* () {
      const response = yield* runQrRequest({
        database: createDatabase(),
        environment: {
          BASE_URL: 'http://localhost:4317',
          NODE_ENV: 'development',
        },
      });

      expect(response.status).toBe(200);
      expect(qrCodeToBuffer).toHaveBeenCalledWith(
        'http://localhost:4317/scan/registration/registration-1',
        expect.any(Object),
      );
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
            organizerUserId: 'organizer-1',
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
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(yield* Effect.promise(() => response.text())).toBe(
          'Ticket not found.',
        );
      }),
  );

  it.effect('gives a clear next step when the ticket cannot be opened', () =>
    Effect.gen(function* () {
      const response = yield* runQrRequest({
        database: createDatabase({ tenantRecord: null }),
      });

      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(yield* Effect.promise(() => response.text())).toBe(
        'This ticket is unavailable. Ask the event organizer for help.',
      );
    }),
  );

  it.effect('allows organize-all access to fetch a confirmed ticket QR', () =>
    Effect.gen(function* () {
      const response = yield* runQrRequest({
        database: createDatabase(),
        requestContext: createRequestContext({
          permissions: ['events:organizeAll'],
          userId: 'organizer-1',
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    }),
  );

  it.effect(
    'hides a ticket belonging to another tenant even from its owner',
    () =>
      Effect.gen(function* () {
        const response = yield* runQrRequest({
          database: createDatabase({
            registration: {
              ...confirmedRegistration,
              tenantId: 'tenant-other',
            },
          }),
        });

        expect(response.status).toBe(404);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(yield* Effect.promise(() => response.text())).toBe(
          'Ticket not found.',
        );
        expect(qrCodeToBuffer).not.toHaveBeenCalled();
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
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    }),
  );
});
