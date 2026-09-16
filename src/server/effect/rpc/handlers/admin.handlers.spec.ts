import * as PgClient from '@effect/sql-pg/PgClient';
import { describe, expect, it, vi } from '@effect/vitest';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Effect, Layer, Schema } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import Stripe from 'stripe';

import { Database, type DatabaseClient } from '../../../../db';
import { relations } from '../../../../db/relations';
import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import * as AdminRpcs from '../../../../shared/rpc-contracts/app-rpcs/admin.rpcs';
import { Tenant } from '../../../../types/custom/tenant';
import { StripeClient } from '../../../stripe-client';
import { adminHandlers } from './admin.handlers';
import { RpcAccess } from './shared/rpc-access.service';

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
  logoUrl: null,
  maxActiveRegistrationsPerUser: 0,
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

const createSettingsInput = () => ({
  allowOther: true,
  cancellationDeadlineHoursBeforeStart: 120,
  currency: 'EUR' as const,
  defaultLocation: null,
  emailSenderEmail: undefined,
  emailSenderName: undefined,
  esnCardEnabled: false,
  maxActiveRegistrationsPerUser: 0,
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
    readonly hasStripeTaxRateConfiguration?: boolean;
    readonly lockedCurrency?: 'AUD' | 'CZK' | 'EUR';
    readonly lockedStripeAccountId?: null | string;
    readonly lockedTimezone?: string;
    readonly rotationTargetStripeAccountId?: string;
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
    query,
    select: (selection: Record<string, unknown> = {}) => {
      const isStripeTaxRateConfigurationQuery = Reflect.has(
        selection,
        'stripeTaxRateId',
      );
      const isStripeTaxRateRotationBindingQuery = Reflect.has(
        selection,
        'sourceStripeTaxRateId',
      );
      const isStripeAccountRead =
        Reflect.has(selection, 'stripeAccountId') &&
        !Reflect.has(selection, 'currency');
      const selectQuery = {
        for: () =>
          isStripeTaxRateRotationBindingQuery
            ? Effect.succeed([])
            : Effect.succeed([
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
          if (isStripeAccountRead) {
            return Effect.succeed([
              {
                stripeAccountId:
                  options.rotationTargetStripeAccountId ??
                  options.lockedStripeAccountId ??
                  null,
              },
            ]);
          }
          if (isStripeTaxRateConfigurationQuery) {
            return Effect.succeed(
              options.hasStripeTaxRateConfiguration
                ? [{ stripeTaxRateId: 'txr_assigned' }]
                : [],
            );
          }

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
        orderBy: () => selectQuery,
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

const createRequestContext = (
  permissions: readonly Permission[],
  stripeAccountId: null | string = null,
) =>
  ({
    authData: {},
    authenticated: true,
    permissions,
    platformAuthority: null,
    tenant: Schema.decodeUnknownSync(Tenant)({
      ...createTenant(),
      stripeAccountId,
    }),
    user: null,
    userAssigned: false,
  }) satisfies RpcRequestContextShape;

const requestContextLayer = (context: RpcRequestContextShape) =>
  Layer.mergeAll(RpcAccess.Default, Layer.succeed(RpcRequestContext, context));

const createRpcOptions = <R extends Rpc.Any>(rpc: R) => ({
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc,
});

const provideDatabase = (database: object) =>
  Layer.succeed(Database, database as DatabaseClient);

const unexpectedDatabaseAccess = Effect.die(
  new Error('Database should not be accessed before permission validation'),
);
const unavailableDatabaseLayer = Layer.effect(
  Database,
  PgDrizzle.makeWithDefaults({ relations }),
).pipe(
  Layer.provide(
    PgClient.layerFrom(
      PgClient.makeWith({
        acquirer: unexpectedDatabaseAccess,
        config: {},
        listenAcquirer: unexpectedDatabaseAccess,
        transactionAcquirer: unexpectedDatabaseAccess,
      }),
    ),
  ),
);

type StripeHttpRequestArguments = Parameters<
  InstanceType<typeof Stripe.HttpClient>['makeRequest']
>;

class UnexpectedStripeHttpClient extends Stripe.HttpClient {
  override getClientName(): string {
    return 'evorto-admin-no-stripe-test';
  }

  override makeRequest(
    ...arguments_: StripeHttpRequestArguments
  ): Promise<Stripe.HttpClientResponse> {
    const [host, , path, method] = arguments_;
    return Promise.reject(
      new Error(`Unexpected Stripe request: ${method} ${host}${path}`),
    );
  }
}

const tenantSettingsLayer = (database: object) =>
  Layer.mergeAll(
    provideDatabase(database),
    Layer.succeed(
      StripeClient,
      new Stripe('sk_test_admin_no_stripe', {
        httpClient: new UnexpectedStripeHttpClient(),
        maxNetworkRetries: 0,
      }),
    ),
  );

class TaxRateStripeHttpClient extends Stripe.HttpClient {
  override getClientName(): string {
    return 'evorto-admin-tax-rate-test';
  }

  override makeRequest(
    ...arguments_: StripeHttpRequestArguments
  ): Promise<TaxRateStripeResponse> {
    const [host, , path, method] = arguments_;
    if (host !== 'api.stripe.com' || method !== 'GET') {
      return Promise.reject(
        new Error(`Unexpected Stripe request: ${method} ${host}${path}`),
      );
    }

    if (path === '/v1/tax_rates' || path.startsWith('/v1/tax_rates?')) {
      return Promise.resolve(
        new TaxRateStripeResponse({
          data: [],
          has_more: false,
          object: 'list',
          url: '/v1/tax_rates',
        }),
      );
    }
    if (path !== '/v1/tax_rates/txr_admin') {
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
  it.effect.each([
    {
      context: createRequestContext([]),
      errorTag: 'RpcForbiddenError',
      label: 'an authenticated user without Members Hub permission',
    },
    {
      context: {
        ...createRequestContext(['internal:viewInternalPages']),
        authenticated: false,
      },
      errorTag: 'RpcUnauthorizedError',
      label: 'an unauthenticated request even with a permission in context',
    },
  ])('findHubRoles denies $label before querying roles', (scenario) =>
    Effect.gen(function* () {
      const error = yield* adminHandlers['admin.roles.findHubRoles'](
        undefined,
        createRpcOptions(
          AdminRpcs.AdminRolesFindHubRoles.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      ).pipe(
        Effect.provide(requestContextLayer(scenario.context)),
        Effect.provide(unavailableDatabaseLayer),
        Effect.flip,
      );

      expect(error).toMatchObject({ _tag: scenario.errorTag });
    }),
  );

  it.effect(
    'findHubRoles returns visible roles only from the permitted tenant',
    () =>
      Effect.gen(function* () {
        const user = { firstName: 'Alex', id: 'user-1', lastName: 'Morgan' };
        const findMany = vi.fn(() =>
          Effect.succeed([
            {
              description: 'Members Hub role',
              id: 'role-1',
              name: 'Member',
              usersToTenants: [{ user }],
            },
          ]),
        );
        const roles = yield* adminHandlers['admin.roles.findHubRoles'](
          undefined,
          createRpcOptions(
            AdminRpcs.AdminRolesFindHubRoles.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        ).pipe(
          Effect.provide(
            requestContextLayer(
              createRequestContext(['internal:viewInternalPages']),
            ),
          ),
          Effect.provide(provideDatabase({ query: { roles: { findMany } } })),
        );

        expect(findMany).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            where: { displayInHub: true, tenantId: 'tenant-1' },
          }),
        );
        expect(roles).toEqual([
          {
            description: 'Members Hub role',
            id: 'role-1',
            name: 'Member',
            userCount: 1,
            users: [user],
          },
        ]);
      }),
  );

  it.effect('findMany requires role management permission', () =>
    Effect.gen(function* () {
      const error = yield* adminHandlers['admin.roles.findMany'](
        {},
        createRpcOptions(
          AdminRpcs.AdminRolesFindMany.middleware(RpcRequestContextMiddleware),
        ),
      )
        .pipe(
          Effect.provide(requestContextLayer(createRequestContext([]))),
          Effect.provide(unavailableDatabaseLayer),
        )
        .pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: 'RpcForbiddenError',
        permission: 'admin:manageRoles',
      });
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
        createRpcOptions(
          AdminRpcs.AdminRolesFindOne.middleware(RpcRequestContextMiddleware),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(createRequestContext(['admin:manageRoles'])),
          ),
        )
        .pipe(Effect.provide(provideDatabase(database)));

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
          createRpcOptions(
            AdminRpcs.AdminTenantImportStripeTaxRates.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:tax'], 'acct_current'),
              ),
            ),
          )
          .pipe(
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
          createRpcOptions(
            AdminRpcs.AdminTenantImportStripeTaxRates.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:tax'], 'acct_current'),
              ),
            ),
          )
          .pipe(
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
    'rejects credential-bearing buy-card URLs before writing settings',
    () =>
      Effect.gen(function* () {
        for (const buyEsnCardUrl of [
          'https://user:pass@cards.example.org/buy',
          'https://user@cards.example.org/buy',
          'https://:pass@cards.example.org/buy',
        ]) {
          const database = withTenantSettingsTransaction({
            update: () => {
              throw new Error('database should not be touched');
            },
          });
          const error = yield* adminHandlers['admin.tenant.updateSettings'](
            { ...createSettingsInput(), buyEsnCardUrl },
            createRpcOptions(
              AdminRpcs.AdminTenantUpdateSettings.middleware(
                RpcRequestContextMiddleware,
              ),
            ),
          ).pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:changeSettings']),
              ),
            ),
            Effect.provide(tenantSettingsLayer(database)),
            Effect.flip,
          );
          expect(error['_tag']).toBe('RpcBadRequestError');
          expect(error.message).toBe(
            'Updated tenant settings failed validation',
          );
        }
      }),
  );

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
            maxActiveRegistrationsPerUser: 4,
            receiptCountries: ['NL'],
            refundFeesOnCancellation: false,
            seoDescription: '  Public description  ',
            seoTitle: '  Public title  ',
            stripeAccountId: ' acct_123 ',
            termsText: ' Tenant terms text ',
            termsUrl: 'https://section.example.org/terms',
            theme: 'classic',
            timezone: 'Australia/Brisbane',
            transferDeadlineHoursBeforeStart: 12,
          },
          createRpcOptions(
            AdminRpcs.AdminTenantUpdateSettings.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:changeSettings']),
              ),
            ),
          )
          .pipe(Effect.provide(tenantSettingsLayer(database)));

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
          refundFeesOnCancellation: false,
          seoDescription: 'Public description',
          seoTitle: 'Public title',
          stripeAccountId: 'acct_123',
          termsText: 'Tenant terms text',
          termsUrl: 'https://section.example.org/terms',
          theme: 'classic',
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
          logoUrl: 'https://cdn.example.org/logo.svg',
          maxActiveRegistrationsPerUser: 4,
          refundFeesOnCancellation: false,
          seoDescription: 'Public description',
          seoTitle: 'Public title',
          stripeAccountId: 'acct_123',
          termsText: 'Tenant terms text',
          termsUrl: 'https://section.example.org/terms',
          theme: 'classic',
          timezone: 'Australia/Brisbane',
          transferDeadlineHoursBeforeStart: 12,
        });
        expect(capturedUpdate).not.toHaveProperty('locale');
      }),
  );

  it.effect(
    'rejects invalid settings before opening a database transaction',
    () =>
      Effect.gen(function* () {
        const noNetworkLayer = Layer.mergeAll(
          unavailableDatabaseLayer,
          Layer.succeed(
            StripeClient,
            new Stripe('sk_test_admin_no_stripe', {
              httpClient: new UnexpectedStripeHttpClient(),
              maxNetworkRetries: 0,
            }),
          ),
        );
        for (const patch of [
          { maxActiveRegistrationsPerUser: 1.5 },
          { cancellationDeadlineHoursBeforeStart: -1 },
          { transferDeadlineHoursBeforeStart: 2_147_483_648 },
          { receiptCountries: [] },
          { receiptCountries: ['DE', 'DE'] },
          { receiptCountries: ['invalid'] },
        ]) {
          const result = yield* adminHandlers['admin.tenant.updateSettings'](
            { ...createSettingsInput(), ...patch },
            createRpcOptions(
              AdminRpcs.AdminTenantUpdateSettings.middleware(
                RpcRequestContextMiddleware,
              ),
            ),
          ).pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:changeSettings']),
              ),
            ),
            Effect.provide(noNetworkLayer),
            Effect.flip,
          );
          expect(result).toMatchObject({
            _tag: 'RpcBadRequestError',
            message: 'Updated tenant settings failed validation',
          });
        }
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
        createRpcOptions(
          AdminRpcs.AdminTenantUpdateSettings.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(createRequestContext(['admin:changeSettings'])),
          ),
        )
        .pipe(Effect.provide(tenantSettingsLayer(database)));

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
          ...createSettingsInput(),
          legalNoticeUrl: 'not a url',
          receiptCountries: ['NL'],
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
        createRpcOptions(
          AdminRpcs.AdminTenantUpdateSettings.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(createRequestContext(['admin:changeSettings'])),
          ),
        )
        .pipe(Effect.provide(tenantSettingsLayer(database)), Effect.flip);

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
        createRpcOptions(
          AdminRpcs.AdminTenantUpdateSettings.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(createRequestContext(['admin:changeSettings'])),
          ),
        )
        .pipe(Effect.provide(tenantSettingsLayer(database)));

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
          ...createSettingsInput(),
          logoUrl: 'file:///tmp/logo.svg',
          receiptCountries: ['NL'],
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
        createRpcOptions(
          AdminRpcs.AdminTenantUpdateSettings.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(createRequestContext(['admin:changeSettings'])),
          ),
        )
        .pipe(Effect.provide(tenantSettingsLayer(database)), Effect.flip);

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
            ...createSettingsInput(),
            logoUrl: '/tenant-assets/tenant-1/logo/..%2Fsecret.png',
            receiptCountries: ['NL'],
            theme: 'evorto',
            timezone: 'Europe/Berlin',
          },
          createRpcOptions(
            AdminRpcs.AdminTenantUpdateSettings.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:changeSettings']),
              ),
            ),
          )
          .pipe(Effect.provide(tenantSettingsLayer(database)), Effect.flip);

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
            createRpcOptions(
              AdminRpcs.AdminTenantUpdateSettings.middleware(
                RpcRequestContextMiddleware,
              ),
            ),
          )
            .pipe(
              Effect.provide(
                requestContextLayer(
                  createRequestContext(['admin:changeSettings']),
                ),
              ),
            )
            .pipe(Effect.provide(tenantSettingsLayer(database)), Effect.flip);

          expect(error['_tag']).toBe('RpcBadRequestError');
          if (error._tag !== 'RpcBadRequestError') {
            return yield* Effect.die(error);
          }
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
        createRpcOptions(
          AdminRpcs.AdminTenantUpdateSettings.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(createRequestContext(['admin:changeSettings'])),
          ),
        )
        .pipe(Effect.provide(tenantSettingsLayer(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe(
        'Currency cannot be changed after financial information has been added.',
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
        createRpcOptions(
          AdminRpcs.AdminTenantUpdateSettings.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(createRequestContext(['admin:changeSettings'])),
          ),
        )
        .pipe(Effect.provide(tenantSettingsLayer(database)), Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      if (error._tag !== 'RpcBadRequestError') {
        return yield* Effect.die(error);
      }
      expect(error.reason).toContain(
        'Keep the current currency to save these settings.',
      );
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
          createRpcOptions(
            AdminRpcs.AdminTenantUpdateSettings.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:changeSettings']),
              ),
            ),
          )
          .pipe(Effect.provide(tenantSettingsLayer(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        if (error._tag !== 'RpcBadRequestError') {
          return yield* Effect.die(error);
        }
        expect(error.reason).toContain(
          'Keep the current currency to save these settings.',
        );
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
        createRpcOptions(
          AdminRpcs.AdminTenantUpdateSettings.middleware(
            RpcRequestContextMiddleware,
          ),
        ),
      )
        .pipe(
          Effect.provide(
            requestContextLayer(createRequestContext(['admin:changeSettings'])),
          ),
        )
        .pipe(Effect.provide(tenantSettingsLayer(database)), Effect.flip);

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
          createRpcOptions(
            AdminRpcs.AdminTenantUpdateSettings.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:changeSettings']),
              ),
            ),
          )
          .pipe(Effect.provide(tenantSettingsLayer(database)), Effect.flip);

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
          createRpcOptions(
            AdminRpcs.AdminTenantUpdateSettings.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:changeSettings']),
              ),
            ),
          )
          .pipe(Effect.provide(tenantSettingsLayer(database)), Effect.flip);

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
          createRpcOptions(
            AdminRpcs.AdminTenantUpdateSettings.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:changeSettings']),
              ),
            ),
          )
          .pipe(Effect.provide(tenantSettingsLayer(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        if (error._tag !== 'RpcBadRequestError') {
          return yield* Effect.die(error);
        }
        expect(error.message).toBe(
          'Stripe account cannot be disconnected while paid event configuration exists',
        );
        expect(error.reason).toContain(
          'Make every event and template registration option and add-on free',
        );
      }),
  );

  it.effect(
    'allows Stripe account rotation when no tax-rate bindings exist',
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
          {
            lockedStripeAccountId: 'acct_existing',
            rotationTargetStripeAccountId: 'acct_next',
          },
        );

        const result = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            ...createSettingsInput(),
            stripeAccountId: 'acct_next',
            timezone: 'Europe/Amsterdam',
          },
          createRpcOptions(
            AdminRpcs.AdminTenantUpdateSettings.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:changeSettings'], 'acct_existing'),
              ),
            ),
          )
          .pipe(Effect.provide(taxRateImportLayer(database)));

        expect(deletedTaxMetadata).toBe(true);
        expect(result.stripeAccountId).toBe('acct_next');
      }),
  );

  it.effect(
    'blocks Stripe disconnect while tax-rate bindings remain assigned',
    () =>
      Effect.gen(function* () {
        const database = withTenantSettingsTransaction(
          {
            update: () => {
              throw new Error('database update should not be touched');
            },
          },
          {
            hasStripeTaxRateConfiguration: true,
            lockedStripeAccountId: 'acct_existing',
          },
        );

        const error = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            ...createSettingsInput(),
            stripeAccountId: undefined,
            timezone: 'Europe/Amsterdam',
          },
          createRpcOptions(
            AdminRpcs.AdminTenantUpdateSettings.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:changeSettings']),
              ),
            ),
          )
          .pipe(Effect.provide(tenantSettingsLayer(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        if (error._tag !== 'RpcBadRequestError') {
          return yield* Effect.die(error);
        }
        expect(error.message).toBe(
          'Stripe account cannot be disconnected while tax rates remain assigned',
        );
        expect(error.reason).toContain('before disconnecting Stripe');
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
          {
            lockedStripeAccountId: 'acct_existing',
            rotationTargetStripeAccountId: 'acct_new',
          },
        );

        const result = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            ...createSettingsInput(),
            stripeAccountId: 'acct_new',
            timezone: 'Europe/Amsterdam',
          },
          createRpcOptions(
            AdminRpcs.AdminTenantUpdateSettings.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:changeSettings']),
              ),
            ),
          )
          .pipe(Effect.provide(tenantSettingsLayer(database)));

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
          createRpcOptions(
            AdminRpcs.AdminTenantUpdateSettings.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        )
          .pipe(
            Effect.provide(
              requestContextLayer(
                createRequestContext(['admin:changeSettings']),
              ),
            ),
          )
          .pipe(Effect.provide(tenantSettingsLayer(database)));

        expect(updateCalled).toBe(true);
        expect(result.seoTitle).toBe('Updated title');
        expect(result.stripeAccountId).toBe('acct_existing');
      }),
  );
});
