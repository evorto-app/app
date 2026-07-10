import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';

import { Database, type DatabaseClient } from '../../../../db';
import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';
import { adminHandlers } from './admin.handlers';

const createTenant = (id = 'tenant-1') => ({
  cancellationDeadlineHoursBeforeStart: 120,
  canonicalRootUrl: `https://${id}.example.com`,
  currency: 'EUR' as const,
  defaultLocation: null,
  discountProviders: {
    esnCard: {
      config: {},
      status: 'disabled' as const,
    },
  },
  domain: `${id}.example.com`,
  faviconUrl: null,
  id,
  locale: 'en',
  logoUrl: null,
  name: id,
  privacyPolicyText: 'Current tenant privacy policy',
  privacyPolicyUrl: null,
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

const createAdminHeaders = () => ({
  [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
  [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson([
    'admin:manageRoles',
  ]),
  [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson(createTenant()),
});

const createAdminOptions = () => ({
  headers: Headers.fromInput(createAdminHeaders()),
});

const createSettingsAdminHeaders = () => ({
  [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
  [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson([
    'admin:changeSettings',
  ]),
  [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson(createTenant()),
});

const createSettingsAdminOptions = () => ({
  headers: Headers.fromInput(createSettingsAdminHeaders()),
});

const createSettingsInput = () => ({
  allowOther: true,
  cancellationDeadlineHoursBeforeStart: 120,
  currency: 'EUR' as const,
  defaultLocation: null,
  emailSenderEmail: undefined,
  emailSenderName: undefined,
  esnCardEnabled: false,
  maxActiveRegistrationsPerUser: 0,
  privacyPolicyText: 'Current tenant privacy policy',
  privacyPolicyUrl: undefined,
  receiptCountries: ['NL'],
  refundFeesOnCancellation: true,
  stripeAccountId: undefined,
  theme: 'evorto' as const,
  timezone: 'Europe/Berlin' as const,
  transferDeadlineHoursBeforeStart: 0,
});

const noLocaleMoneyDependentDataQuery = () => ({
  eventInstances: {
    findFirst: () => Effect.succeed(null),
  },
  eventTemplates: {
    findFirst: () => Effect.succeed(null),
  },
  financeReceipts: {
    findFirst: () => Effect.succeed(null),
  },
  transactions: {
    findFirst: () => Effect.succeed(null),
  },
});

const withTenantSettingsTransaction = <T extends object>(
  database: T,
  options: {
    readonly hasPendingStripeObligations?: boolean;
    readonly lockedCurrency?: 'AUD' | 'CZK' | 'EUR';
    readonly lockedStripeAccountId?: null | string;
    readonly lockedTimezone?: string;
  } = {},
) => {
  const query =
    'query' in database ? database.query : noLocaleMoneyDependentDataQuery();
  const transactionDatabase = {
    ...database,
    insert:
      'insert' in database
        ? database.insert
        : () => ({
            values: (value: {
              privacyPolicyText: null | string;
              privacyPolicyUrl: null | string;
              version: number;
            }) => ({
              returning: () =>
                Effect.succeed([
                  {
                    id: 'policy-next',
                    privacyPolicyText: value.privacyPolicyText,
                    privacyPolicyUrl: value.privacyPolicyUrl,
                    version: value.version,
                  },
                ]),
            }),
          }),
    query,
    select: () => ({
      from: () => ({
        where: () => ({
          for: () =>
            Effect.succeed([
              {
                currency: options.lockedCurrency ?? 'EUR',
                id: 'tenant-1',
                stripeAccountId: options.lockedStripeAccountId ?? null,
                timezone: options.lockedTimezone ?? 'Europe/Amsterdam',
              },
            ]),
          limit: () =>
            Effect.succeed(
              options.hasPendingStripeObligations
                ? [{ id: 'stripe-obligation-1' }]
                : [],
            ),
          orderBy: () => ({
            limit: () =>
              Effect.succeed([
                {
                  id: 'policy-1',
                  privacyPolicyText: 'Current tenant privacy policy',
                  privacyPolicyUrl: null,
                  version: 1,
                },
              ]),
          }),
        }),
      }),
    }),
  };

  return {
    ...transactionDatabase,
    transaction: <A, E, R>(
      run: (database: typeof transactionDatabase) => Effect.Effect<A, E, R>,
    ) => run(transactionDatabase),
  };
};

const provideDatabase = (database: object) =>
  Layer.succeed(Database, database as DatabaseClient);

describe('adminHandlers role permissions', () => {
  it.effect('findMany requires role management permission', () =>
    Effect.gen(function* () {
      const error = yield* adminHandlers['admin.roles.findMany'](
        {},
        {
          headers: Headers.fromInput({
            [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
            [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson([]),
          }),
        },
      ).pipe(Effect.flip);

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.permission).toBe('admin:manageRoles');
    }),
  );

  it.effect('findOne returns the canonical hub visibility field only', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          roles: {
            findFirst: () =>
              Effect.succeed({
                collapseMembersInHub: true,
                defaultOrganizerRole: false,
                defaultUserRole: true,
                description: 'Visible in the hub',
                displayInHub: true,
                id: 'role-1',
                name: 'Member',
                permissions: [
                  'events:viewPublic',
                  'globalAdmin:*',
                  'globalAdmin:manageTenants',
                ],
                sortOrder: 1,
              }),
          },
        },
      };

      const role = yield* adminHandlers['admin.roles.findOne'](
        { id: 'role-1' },
        createAdminOptions(),
      ).pipe(Effect.provide(provideDatabase(database)));

      expect(role).toMatchObject({
        displayInHub: true,
        id: 'role-1',
        name: 'Member',
        permissions: ['events:viewPublic'],
      });
      expect(role).not.toHaveProperty('showInHub');
    }),
  );
});

describe('adminHandlers tenant settings', () => {
  it.effect(
    'updates tenant SEO settings through the validated tenant shape',
    () =>
      Effect.gen(function* () {
        let capturedUpdate: Record<string, unknown> | undefined;
        const updateQuery = {
          returning: () =>
            Effect.succeed([
              {
                id: 'tenant-1',
              },
            ]),
          set: (value: Record<string, unknown>) => {
            capturedUpdate = value;
            return updateQuery;
          },
          where: () => updateQuery,
        };
        const database = withTenantSettingsTransaction({
          query: {
            eventInstances: {
              findFirst: () => Effect.succeed(null),
            },
            eventTemplates: {
              findFirst: () => Effect.succeed(null),
            },
            financeReceipts: {
              findFirst: () => Effect.succeed(null),
            },
            transactions: {
              findFirst: () => Effect.succeed(null),
            },
          },
          update: () => updateQuery,
        });

        const result = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            allowOther: true,
            cancellationDeadlineHoursBeforeStart: 96,
            currency: 'AUD',
            defaultLocation: null,
            emailSenderEmail: ' events@section.example.org ',
            emailSenderName: ' Example Section ',
            esnCardEnabled: false,
            faviconUrl: ' https://cdn.example.org/favicon.ico ',
            legalNoticeText: '  Tenant imprint text  ',
            legalNoticeUrl: ' https://section.example.org/imprint ',
            logoUrl: 'https://cdn.example.org/logo.svg',
            maxActiveRegistrationsPerUser: 4.8,
            privacyPolicyText: ' Tenant privacy text ',
            privacyPolicyUrl: 'https://section.example.org/privacy',
            receiptCountries: ['NL'],
            refundFeesOnCancellation: false,
            seoDescription: '  Public description  ',
            seoTitle: '  Public title  ',
            stripeAccountId: ' acct_123 ',
            termsText: ' Tenant terms text ',
            termsUrl: 'https://section.example.org/terms',
            theme: 'evorto',
            timezone: 'Australia/Brisbane',
            transferDeadlineHoursBeforeStart: 12,
          },
          createSettingsAdminOptions(),
        ).pipe(Effect.provide(provideDatabase(database)));

        expect(capturedUpdate).toMatchObject({
          cancellationDeadlineHoursBeforeStart: 96,
          currency: 'AUD',
          emailSenderEmail: 'events@section.example.org',
          emailSenderName: 'Example Section',
          faviconUrl: 'https://cdn.example.org/favicon.ico',
          legalNoticeText: 'Tenant imprint text',
          legalNoticeUrl: 'https://section.example.org/imprint',
          logoUrl: 'https://cdn.example.org/logo.svg',
          maxActiveRegistrationsPerUser: 4,
          privacyPolicyText: 'Tenant privacy text',
          privacyPolicyUrl: 'https://section.example.org/privacy',
          refundFeesOnCancellation: false,
          seoDescription: 'Public description',
          seoTitle: 'Public title',
          stripeAccountId: 'acct_123',
          termsText: 'Tenant terms text',
          termsUrl: 'https://section.example.org/terms',
          timezone: 'Australia/Brisbane',
          transferDeadlineHoursBeforeStart: 12,
        });
        expect(result).toMatchObject({
          cancellationDeadlineHoursBeforeStart: 96,
          currency: 'AUD',
          emailSenderEmail: 'events@section.example.org',
          emailSenderName: 'Example Section',
          faviconUrl: 'https://cdn.example.org/favicon.ico',
          legalNoticeText: 'Tenant imprint text',
          legalNoticeUrl: 'https://section.example.org/imprint',
          locale: 'de-DE',
          logoUrl: 'https://cdn.example.org/logo.svg',
          maxActiveRegistrationsPerUser: 4,
          privacyPolicyText: 'Tenant privacy text',
          privacyPolicyUrl: 'https://section.example.org/privacy',
          refundFeesOnCancellation: false,
          seoDescription: 'Public description',
          seoTitle: 'Public title',
          stripeAccountId: 'acct_123',
          termsText: 'Tenant terms text',
          termsUrl: 'https://section.example.org/terms',
          timezone: 'Australia/Brisbane',
          transferDeadlineHoursBeforeStart: 12,
        });
        expect(capturedUpdate).not.toHaveProperty('locale');
      }),
  );

  it.effect('persists a validated Google default location', () =>
    Effect.gen(function* () {
      let capturedUpdate: Record<string, unknown> | undefined;
      const updateQuery = {
        returning: () => Effect.succeed([{ id: 'tenant-1' }]),
        set: (value: Record<string, unknown>) => {
          capturedUpdate = value;
          return updateQuery;
        },
        where: () => updateQuery,
      };
      const database = withTenantSettingsTransaction({
        update: () => updateQuery,
      });
      const defaultLocation = {
        address: 'Alexanderplatz, Berlin, Germany',
        coordinates: {
          lat: 52.5219,
          lng: 13.4132,
        },
        name: 'Alexanderplatz',
        placeId: 'place-alexanderplatz',
        type: 'google' as const,
      };

      const result = yield* adminHandlers['admin.tenant.updateSettings'](
        {
          ...createSettingsInput(),
          defaultLocation,
        },
        createSettingsAdminOptions(),
      ).pipe(Effect.provide(provideDatabase(database)));

      expect(capturedUpdate).toMatchObject({ defaultLocation });
      expect(result.defaultLocation).toEqual(defaultLocation);
    }),
  );

  it.effect('rejects invalid tenant legal-link URLs', () =>
    Effect.gen(function* () {
      const database = {
        update: () => {
          throw new Error('database should not be touched');
        },
      };

      const error = yield* adminHandlers['admin.tenant.updateSettings'](
        {
          allowOther: true,
          currency: 'EUR',
          defaultLocation: null,
          esnCardEnabled: false,
          legalNoticeUrl: 'not a url',
          receiptCountries: ['NL'],
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
        createSettingsAdminOptions(),
      ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe('Invalid tenant legal links');
    }),
  );

  it.effect('preserves uploaded tenant brand asset route URLs', () =>
    Effect.gen(function* () {
      let capturedUpdate: Record<string, unknown> | undefined;
      const updateQuery = {
        returning: () =>
          Effect.succeed([
            {
              id: 'tenant-1',
            },
          ]),
        set: (value: Record<string, unknown>) => {
          capturedUpdate = value;
          return updateQuery;
        },
        where: () => updateQuery,
      };
      const database = withTenantSettingsTransaction({
        update: () => updateQuery,
      });

      const result = yield* adminHandlers['admin.tenant.updateSettings'](
        {
          ...createSettingsInput(),
          faviconUrl: ' /tenant-assets/tenant-1/favicon/favicon.ico ',
          logoUrl: '/tenant-assets/tenant-1/logo/logo.png',
        },
        createSettingsAdminOptions(),
      ).pipe(Effect.provide(provideDatabase(database)));

      expect(capturedUpdate).toMatchObject({
        faviconUrl: '/tenant-assets/tenant-1/favicon/favicon.ico',
        logoUrl: '/tenant-assets/tenant-1/logo/logo.png',
      });
      expect(result).toMatchObject({
        faviconUrl: '/tenant-assets/tenant-1/favicon/favicon.ico',
        logoUrl: '/tenant-assets/tenant-1/logo/logo.png',
      });
    }),
  );

  it.effect('rejects invalid tenant brand asset URLs', () =>
    Effect.gen(function* () {
      const database = {
        update: () => {
          throw new Error('database should not be touched');
        },
      };

      const error = yield* adminHandlers['admin.tenant.updateSettings'](
        {
          allowOther: true,
          currency: 'EUR',
          defaultLocation: null,
          esnCardEnabled: false,
          logoUrl: 'file:///tmp/logo.svg',
          privacyPolicyText: 'Current tenant privacy policy',
          receiptCountries: ['NL'],
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
        createSettingsAdminOptions(),
      ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe('Invalid tenant brand assets');
    }),
  );

  it.effect(
    'rejects uploaded tenant brand asset paths with encoded separators',
    () =>
      Effect.gen(function* () {
        const database = {
          update: () => {
            throw new Error('database should not be touched');
          },
        };

        const error = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            allowOther: true,
            currency: 'EUR',
            defaultLocation: null,
            esnCardEnabled: false,
            logoUrl: '/tenant-assets/tenant-1/logo/..%2Fsecret.png',
            privacyPolicyText: 'Current tenant privacy policy',
            receiptCountries: ['NL'],
            theme: 'evorto',
            timezone: 'Europe/Berlin',
          },
          createSettingsAdminOptions(),
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe('Invalid tenant brand assets');
      }),
  );

  it.effect(
    'rejects uploaded brand asset paths owned by another tenant or asset kind',
    () =>
      Effect.gen(function* () {
        const database = {
          update: () => {
            throw new Error('database should not be touched');
          },
        };

        for (const logoUrl of [
          '/tenant-assets/tenant-2/logo/logo.png',
          '/tenant-assets/tenant-1/favicon/logo.png',
        ]) {
          const error = yield* adminHandlers['admin.tenant.updateSettings'](
            {
              ...createSettingsInput(),
              logoUrl,
            },
            createSettingsAdminOptions(),
          ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

          expect(error['_tag']).toBe('RpcBadRequestError');
          expect(error.message).toBe('Invalid tenant brand assets');
          expect(error.reason).toContain(
            'uploaded logo path for the current tenant',
          );
        }
      }),
  );

  it.effect('rejects currency changes when tenant events exist', () =>
    Effect.gen(function* () {
      const database = withTenantSettingsTransaction({
        query: {
          eventInstances: {
            findFirst: () => Effect.succeed({ id: 'event-1' }),
          },
          eventTemplates: {
            findFirst: () => Effect.succeed(null),
          },
          financeReceipts: {
            findFirst: () => {
              throw new Error('receipt query should not be touched');
            },
          },
          transactions: {
            findFirst: () => {
              throw new Error('transaction query should not be touched');
            },
          },
        },
        update: () => {
          throw new Error('database update should not be touched');
        },
      });

      const error = yield* adminHandlers['admin.tenant.updateSettings'](
        {
          ...createSettingsInput(),
          currency: 'CZK',
        },
        createSettingsAdminOptions(),
      ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe(
        'Tenant currency is locked by existing financial configuration',
      );
    }),
  );

  it.effect('rejects currency changes when tenant templates exist', () =>
    Effect.gen(function* () {
      const database = withTenantSettingsTransaction({
        query: {
          eventInstances: {
            findFirst: () => {
              throw new Error('event query should not be touched');
            },
          },
          eventTemplates: {
            findFirst: () => Effect.succeed({ id: 'template-1' }),
          },
          financeReceipts: {
            findFirst: () => {
              throw new Error('receipt query should not be touched');
            },
          },
          transactions: {
            findFirst: () => {
              throw new Error('transaction query should not be touched');
            },
          },
        },
        update: () => {
          throw new Error('database update should not be touched');
        },
      });

      const error = yield* adminHandlers['admin.tenant.updateSettings'](
        {
          ...createSettingsInput(),
          currency: 'AUD',
        },
        createSettingsAdminOptions(),
      ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toContain('dedicated currency migration');
    }),
  );

  it.effect.each(['receipt', 'transaction'] as const)(
    'rejects currency changes when tenant %s data exists',
    (dependentData) =>
      Effect.gen(function* () {
        const database = withTenantSettingsTransaction({
          query: {
            eventInstances: {
              findFirst: () => Effect.succeed(null),
            },
            eventTemplates: {
              findFirst: () => Effect.succeed(null),
            },
            financeReceipts: {
              findFirst: () =>
                Effect.succeed(
                  dependentData === 'receipt' ? { id: 'receipt-1' } : null,
                ),
            },
            transactions: {
              findFirst: () =>
                Effect.succeed(
                  dependentData === 'transaction'
                    ? { id: 'transaction-1' }
                    : null,
                ),
            },
          },
          update: () => {
            throw new Error('database update should not be touched');
          },
        });

        const error = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            ...createSettingsInput(),
            currency: 'CZK',
          },
          createSettingsAdminOptions(),
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.reason).toContain('dedicated currency migration');
      }),
  );

  it.effect('rejects timezone changes when tenant transactions exist', () =>
    Effect.gen(function* () {
      const database = withTenantSettingsTransaction({
        query: {
          eventInstances: {
            findFirst: () => Effect.succeed(null),
          },
          transactions: {
            findFirst: () => Effect.succeed({ id: 'transaction-1' }),
          },
        },
        update: () => {
          throw new Error('database update should not be touched');
        },
      });

      const error = yield* adminHandlers['admin.tenant.updateSettings'](
        {
          ...createSettingsInput(),
          timezone: 'Europe/Prague',
        },
        createSettingsAdminOptions(),
      ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe(
        'Tenant currency and timezone settings are locked',
      );
    }),
  );

  it.effect(
    'uses the locked tenant runtime settings when the request context is stale',
    () =>
      Effect.gen(function* () {
        const database = withTenantSettingsTransaction(
          {
            query: {
              eventInstances: {
                findFirst: () => Effect.succeed({ id: 'event-1' }),
              },
              transactions: {
                findFirst: () => {
                  throw new Error('transaction query should not be touched');
                },
              },
            },
            update: () => {
              throw new Error('database update should not be touched');
            },
          },
          {
            lockedTimezone: 'Europe/Prague',
          },
        );

        const error = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            ...createSettingsInput(),
            timezone: 'Europe/Amsterdam',
          },
          createSettingsAdminOptions(),
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'Tenant currency and timezone settings are locked',
        );
      }),
  );

  it.effect(
    'uses the locked tenant account and blocks a stale-header account clear while Stripe obligations are pending',
    () =>
      Effect.gen(function* () {
        const database = withTenantSettingsTransaction(
          {
            update: () => {
              throw new Error('database update should not be touched');
            },
          },
          {
            hasPendingStripeObligations: true,
            lockedStripeAccountId: 'acct_existing',
          },
        );

        const error = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            ...createSettingsInput(),
            timezone: 'Europe/Amsterdam',
          },
          createSettingsAdminOptions(),
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'Stripe account cannot change while registration Checkouts or refunds are pending',
        );
      }),
  );

  it.effect(
    'allows other tenant edits when the locked Stripe account is unchanged',
    () =>
      Effect.gen(function* () {
        let updateCalled = false;
        const updateQuery = {
          returning: () => Effect.succeed([{ id: 'tenant-1' }]),
          set: () => {
            updateCalled = true;
            return updateQuery;
          },
          where: () => updateQuery,
        };
        const database = withTenantSettingsTransaction(
          { update: () => updateQuery },
          {
            hasPendingStripeObligations: true,
            lockedStripeAccountId: 'acct_existing',
          },
        );

        const result = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            ...createSettingsInput(),
            seoTitle: 'Updated title',
            stripeAccountId: 'acct_existing',
            timezone: 'Europe/Amsterdam',
          },
          createSettingsAdminOptions(),
        ).pipe(Effect.provide(provideDatabase(database)));

        expect(updateCalled).toBe(true);
        expect(result.seoTitle).toBe('Updated title');
        expect(result.stripeAccountId).toBe('acct_existing');
      }),
  );
});
