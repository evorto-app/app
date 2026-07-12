import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import Stripe from 'stripe';

import { Database, type DatabaseClient } from '../../../../db';
import { StripeClient } from '../../../stripe-client';
import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';
import { adminHandlers } from './admin.handlers';

const createTenant = (id = 'tenant-1') => ({
  cancellationDeadlineHoursBeforeStart: 120,
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
    readonly hasPaidEventConfiguration?: boolean;
    readonly hasPendingStripeObligations?: boolean;
    readonly lockedCurrency?: 'AUD' | 'CZK' | 'EUR';
    readonly lockedStripeAccountId?: null | string;
    readonly lockedTimezone?: string;
  } = {},
) => {
  const query =
    'query' in database ? database.query : noLocaleMoneyDependentDataQuery();
  let limitedSelectCount = 0;
  const transactionDatabase = {
    ...database,
    delete:
      'delete' in database
        ? database.delete
        : () => ({ where: () => Effect.void }),
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
    select: () => {
      const selectQuery = {
        for: () =>
          Effect.succeed([
            {
              currency: options.lockedCurrency ?? 'EUR',
              id: 'tenant-1',
              stripeAccountId: options.lockedStripeAccountId ?? null,
              timezone: options.lockedTimezone ?? 'Europe/Amsterdam',
            },
          ]),
        from: () => selectQuery,
        innerJoin: () => selectQuery,
        limit: () => {
          const isPendingObligationQuery = limitedSelectCount++ === 0;
          return Effect.succeed(
            isPendingObligationQuery
              ? options.hasPendingStripeObligations
                ? [{ id: 'stripe-obligation-1' }]
                : []
              : options.hasPaidEventConfiguration
                ? [{ id: 'paid-configuration-1' }]
                : [],
          );
        },
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
        where: () => selectQuery,
      };
      return selectQuery;
    },
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

type StripeHttpRequestArguments = Parameters<
  InstanceType<typeof Stripe.HttpClient>['makeRequest']
>;

class TaxRateStripeHttpClient extends Stripe.HttpClient {
  override getClientName(): string {
    return 'evorto-admin-tax-rate-test';
  }

  override makeRequest(
    ...arguments_: StripeHttpRequestArguments
  ): Promise<TaxRateStripeResponse> {
    const [host, , path, method] = arguments_;
    if (
      host !== 'api.stripe.com' ||
      method !== 'GET' ||
      path !== '/v1/tax_rates/txr_admin'
    ) {
      return Promise.reject(
        new Error(`Unexpected Stripe request: ${method} ${host}${path}`),
      );
    }

    return Promise.resolve(
      new TaxRateStripeResponse({
        active: true,
        country: 'DE',
        display_name: 'VAT',
        id: 'txr_admin',
        inclusive: true,
        percentage: 19,
        state: null,
      }),
    );
  }
}

class TaxRateStripeResponse extends Stripe.HttpClientResponse {
  constructor(private readonly body: unknown) {
    super(200, { 'request-id': 'req_admin_tax_rate' });
  }

  override getRawResponse(): unknown {
    return this.body;
  }

  override toJSON(): Promise<unknown> {
    return Promise.resolve(this.body);
  }
}

const createTaxRateAdminOptions = () => ({
  headers: Headers.fromInput({
    [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
    [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson([
      'admin:tax',
    ]),
    [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson({
      ...createTenant(),
      stripeAccountId: 'acct_current',
    }),
  }),
});

const createTaxRateImportDatabase = (input: {
  readonly existingRateStripeAccountId?: string | undefined;
  readonly lockedStripeAccountId: null | string;
}) => {
  const selectQuery = {
    for: () =>
      Effect.succeed([{ stripeAccountId: input.lockedStripeAccountId }]),
    from: () => selectQuery,
    where: () => selectQuery,
  };
  const transactionDatabase = {
    query: {
      tenantStripeTaxRates: {
        findFirst: () =>
          Effect.succeed(
            input.existingRateStripeAccountId
              ? {
                  id: 'tax-rate-row-1',
                  stripeAccountId: input.existingRateStripeAccountId,
                }
              : undefined,
          ),
      },
    },
    select: () => selectQuery,
  };

  return {
    transaction: <A, E, R>(
      run: (database: typeof transactionDatabase) => Effect.Effect<A, E, R>,
    ) => run(transactionDatabase),
  };
};

const taxRateImportLayer = (database: object) =>
  Layer.mergeAll(
    provideDatabase(database),
    Layer.succeed(
      StripeClient,
      new Stripe('sk_test_admin_tax_rate', {
        httpClient: new TaxRateStripeHttpClient(),
        maxNetworkRetries: 0,
      }),
    ),
  );

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

describe('adminHandlers Stripe tax-rate import', () => {
  it.effect(
    'keeps a concurrent tenant account change in the expected channel',
    () =>
      Effect.gen(function* () {
        const error = yield* adminHandlers['admin.tenant.importStripeTaxRates'](
          { ids: ['txr_admin'] },
          createTaxRateAdminOptions(),
        ).pipe(
          Effect.provide(
            taxRateImportLayer(
              createTaxRateImportDatabase({
                lockedStripeAccountId: 'acct_changed',
              }),
            ),
          ),
          Effect.flip,
        );

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          message: 'Stripe account changed while tax rates were loading',
          reason: 'Reload the page and import rates from the current account.',
        });
      }),
  );

  it.effect(
    'keeps a conflicting stored rate account in the expected channel',
    () =>
      Effect.gen(function* () {
        const error = yield* adminHandlers['admin.tenant.importStripeTaxRates'](
          { ids: ['txr_admin'] },
          createTaxRateAdminOptions(),
        ).pipe(
          Effect.provide(
            taxRateImportLayer(
              createTaxRateImportDatabase({
                existingRateStripeAccountId: 'acct_foreign',
                lockedStripeAccountId: 'acct_current',
              }),
            ),
          ),
          Effect.flip,
        );

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          message:
            'Imported tax-rate metadata belongs to a different Stripe account',
          reason:
            'Change or disconnect the Stripe account before importing this rate.',
        });
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
    'blocks Stripe account removal while paid event configuration exists',
    () =>
      Effect.gen(function* () {
        const database = withTenantSettingsTransaction(
          {
            update: () => {
              throw new Error('database update should not be touched');
            },
          },
          {
            hasPaidEventConfiguration: true,
            lockedStripeAccountId: 'acct_existing',
          },
        );

        const error = yield* adminHandlers['admin.tenant.updateSettings'](
          createSettingsInput(),
          createSettingsAdminOptions(),
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'Stripe account cannot change while paid event configuration exists',
        );
        expect(error.reason).toContain(
          'Make every event and template registration option and add-on free',
        );
      }),
  );

  it.effect(
    'blocks Stripe account rotation while paid event configuration exists',
    () =>
      Effect.gen(function* () {
        const database = withTenantSettingsTransaction(
          {
            update: () => {
              throw new Error('database update should not be touched');
            },
          },
          {
            hasPaidEventConfiguration: true,
            lockedStripeAccountId: 'acct_existing',
          },
        );

        const error = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            ...createSettingsInput(),
            stripeAccountId: 'acct_next',
            timezone: 'Europe/Amsterdam',
          },
          createSettingsAdminOptions(),
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'Stripe account cannot change while paid event configuration exists',
        );
      }),
  );

  it.effect(
    'removes old-account and legacy tax metadata before rotating Stripe accounts',
    () =>
      Effect.gen(function* () {
        let deletedTaxMetadata = false;
        const updateQuery = {
          returning: () => Effect.succeed([{ id: 'tenant-1' }]),
          set: () => updateQuery,
          where: () => updateQuery,
        };
        const database = withTenantSettingsTransaction(
          {
            delete: () => ({
              where: () => {
                deletedTaxMetadata = true;
                return Effect.void;
              },
            }),
            update: () => updateQuery,
          },
          { lockedStripeAccountId: 'acct_existing' },
        );

        const result = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            ...createSettingsInput(),
            stripeAccountId: 'acct_new',
            timezone: 'Europe/Amsterdam',
          },
          createSettingsAdminOptions(),
        ).pipe(Effect.provide(provideDatabase(database)));

        expect(deletedTaxMetadata).toBe(true);
        expect(result.stripeAccountId).toBe('acct_new');
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
