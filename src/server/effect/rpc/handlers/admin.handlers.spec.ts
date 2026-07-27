import { describe, expect, layer } from '@effect/vitest';
import { Effect, Exit, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { SqlError, UniqueViolation } from 'effect/unstable/sql/SqlError';
import Stripe from 'stripe';

import { Database, type DatabaseClient } from '../../../../db';
import { roleTenantNameUniqueConstraintName } from '../../../../db/schema';
import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
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

const createAdminOptions = () => ({
  headers: Headers.empty,
});

const createSettingsAdminOptions = (
  _stripeAccountId: null | string = null,
) => ({
  headers: Headers.empty,
});

const createRequestContext = (
  permissions: readonly Permission[],
  stripeAccountId: null | string = null,
) =>
  ({
    authData: {},
    authenticated: true,
    permissions,
    platformAuthority: null,
    tenant: {
      ...createTenant(),
      stripeAccountId,
    },
    user: null,
    userAssigned: false,
  }) satisfies RpcRequestContextShape;

const adminPermissions = [
  'admin:changeSettings',
  'admin:managePayments',
  'admin:manageRoles',
  'admin:tax',
  'internal:viewInternalPages',
] as const satisfies readonly Permission[];

const adminHandlerLayer = Layer.mergeAll(
  RpcAccess.Default,
  Layer.succeed(RpcRequestContext, createRequestContext(adminPermissions)),
);

const createAppearanceSettingsInput = () => ({
  faviconUrl: undefined,
  logoUrl: undefined,
  seoDescription: undefined,
  seoTitle: undefined,
  theme: 'evorto' as const,
});

const createLegalSettingsInput = () => ({
  legalNoticeText: undefined,
  legalNoticeUrl: undefined,
  termsText: undefined,
  termsUrl: undefined,
});

const createOrganizationSettingsInput = () => ({
  defaultLocation: null,
  emailSenderEmail: undefined,
  emailSenderName: undefined,
  timezone: 'Europe/Berlin' as const,
});

const createPaymentProviderSettingsInput = (
  expectedStripeAccountId: null | string = null,
) => ({
  allowOther: true,
  currency: 'EUR' as const,
  esnCardEnabled: false,
  expectedStripeAccountId,
  receiptCountries: ['NL'],
  refundFeesOnCancellation: true,
  stripeAccountId: undefined,
});

const createRoleWriteInput = () => ({
  defaultOrganizerRole: false,
  defaultUserRole: true,
  description: '  Default tenant member  ',
  displayInHub: true,
  name: '  Member  ',
  permissions: ['users:viewAll', 'admin:manageRoles', 'users:viewAll'] as const,
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
    readonly preReadStripeAccountId?: null | string;
    readonly rotationTargetStripeAccountId?: string;
  } = {},
) => {
  const query =
    'query' in database ? database.query : noLocaleMoneyDependentDataQuery();
  let limitedSelectCount = 0;
  let stripeAccountReadCount = 0;
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
            const stripeAccountId =
              stripeAccountReadCount++ === 0
                ? options.preReadStripeAccountId === undefined
                  ? (options.lockedStripeAccountId ?? null)
                  : options.preReadStripeAccountId
                : (options.rotationTargetStripeAccountId ??
                  options.lockedStripeAccountId ??
                  null);
            return Effect.succeed([
              {
                stripeAccountId,
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

const provideDatabase = (database: object) =>
  Layer.succeed(Database, database as DatabaseClient);

type StripeHttpRequestArguments = Parameters<
  InstanceType<typeof Stripe.HttpClient>['makeRequest']
>;

const readyStripeAccountResponse = (stripeAccountId: string) => ({
  charges_enabled: true,
  details_submitted: true,
  id: stripeAccountId,
  object: 'account',
  payouts_enabled: true,
});

class TaxRateStripeHttpClient extends Stripe.HttpClient {
  readonly requestedAccountIds: string[] = [];

  constructor(
    private readonly accountResponse: (
      stripeAccountId: string,
    ) => unknown = readyStripeAccountResponse,
  ) {
    super();
  }

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

    const accountMatch = /^\/v1\/accounts\/([^/?]+)$/u.exec(path);
    if (accountMatch?.[1]) {
      const stripeAccountId = decodeURIComponent(accountMatch[1]);
      this.requestedAccountIds.push(stripeAccountId);
      const accountResponse = this.accountResponse(stripeAccountId);
      if (accountResponse instanceof Stripe.errors.StripeInvalidRequestError) {
        return Promise.resolve(
          new TaxRateStripeResponse(
            {
              error: {
                message: accountResponse.message,
                type: 'invalid_request_error',
              },
            },
            404,
          ),
        );
      }
      return accountResponse instanceof Error
        ? Promise.reject(accountResponse)
        : Promise.resolve(new TaxRateStripeResponse(accountResponse));
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
  constructor(
    private readonly body: unknown,
    statusCode = 200,
  ) {
    super(statusCode, { 'request-id': 'req_admin_tax_rate' });
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

const taxRateImportLayer = (
  database: object,
  httpClient = new TaxRateStripeHttpClient(),
) =>
  Layer.mergeAll(
    provideDatabase(database),
    Layer.succeed(
      StripeClient,
      new Stripe('sk_test_admin_tax_rate', {
        httpClient,
        maxNetworkRetries: 0,
      }),
    ),
  );

layer(adminHandlerLayer)((it) => {
  describe('adminHandlers role permissions', () => {
    it.effect('findMany requires role management permission', () =>
      Effect.gen(function* () {
        const error = yield* adminHandlers['admin.roles.findMany'](
          {},
          {
            headers: Headers.empty,
          },
        ).pipe(
          Effect.provideService(RpcRequestContext, createRequestContext([])),
          Effect.flip,
        );

        expect(error['_tag']).toBe('RpcForbiddenError');
        expect(error.permission).toBe('admin:manageRoles');
      }),
    );

    it.effect('findOne returns the canonical role fields only', () =>
      Effect.gen(function* () {
        const database = {
          query: {
            roles: {
              findFirst: () =>
                Effect.succeed({
                  defaultOrganizerRole: false,
                  defaultUserRole: true,
                  description: 'Visible in the hub',
                  displayInHub: true,
                  id: 'role-1',
                  name: 'Member',
                  permissions: ['events:viewPublic'],
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

    it.effect(
      'fails visibly when a persisted role contains platform authority',
      () =>
        Effect.gen(function* () {
          const database = {
            query: {
              roles: {
                findFirst: () =>
                  Effect.succeed({
                    defaultOrganizerRole: false,
                    defaultUserRole: true,
                    description: 'Corrupt persisted role',
                    displayInHub: true,
                    id: 'role-corrupt',
                    name: 'Corrupt',
                    permissions: ['events:viewPublic', 'globalAdmin:*'],
                    sortOrder: 1,
                  }),
              },
            },
          };

          const exit = yield* adminHandlers['admin.roles.findOne'](
            { id: 'role-corrupt' },
            createAdminOptions(),
          ).pipe(Effect.provide(provideDatabase(database)), Effect.exit);

          expect(Exit.isFailure(exit)).toBe(true);
        }),
    );

    it.effect('findHubRoles requires internal page visibility', () =>
      Effect.gen(function* () {
        const error = yield* adminHandlers['admin.roles.findHubRoles'](
          undefined,
          {
            headers: Headers.empty,
          },
        ).pipe(
          Effect.provideService(RpcRequestContext, createRequestContext([])),
          Effect.flip,
        );

        expect(error).toMatchObject({
          _tag: 'RpcForbiddenError',
          permission: 'internal:viewInternalPages',
        });
      }),
    );

    it.effect(
      'returns a typed role-write validation error before persistence',
      () =>
        Effect.gen(function* () {
          const error = yield* adminHandlers['admin.roles.create'](
            {
              ...createRoleWriteInput(),
              name: ' '.repeat(3),
            },
            createAdminOptions(),
          ).pipe(Effect.provide(provideDatabase({})), Effect.flip);

          expect(error).toMatchObject({
            _tag: 'RoleWriteValidationError',
            field: 'name',
            message: 'Role name is required',
          });
        }),
    );

    it.effect('persists the shared normalized role-write shape', () =>
      Effect.gen(function* () {
        let capturedValues: Record<string, unknown> | undefined;
        const insertQuery = {
          returning: () =>
            Effect.succeed([
              {
                defaultOrganizerRole: false,
                defaultUserRole: true,
                description: 'Default tenant member',
                displayInHub: true,
                id: 'role-1',
                name: 'Member',
                permissions: ['admin:manageRoles', 'users:viewAll'],
                sortOrder: 1,
              },
            ]),
          values: (values: Record<string, unknown>) => {
            capturedValues = values;
            return insertQuery;
          },
        };
        const transactionDatabase = {
          execute: () => Effect.void,
          insert: () => insertQuery,
        };
        const database = {
          transaction: <A, E, R>(
            run: (
              database_: typeof transactionDatabase,
            ) => Effect.Effect<A, E, R>,
          ) => run(transactionDatabase),
        };

        const role = yield* adminHandlers['admin.roles.create'](
          createRoleWriteInput(),
          createAdminOptions(),
        ).pipe(Effect.provide(provideDatabase(database)));

        expect(capturedValues).toEqual({
          defaultOrganizerRole: false,
          defaultUserRole: true,
          description: 'Default tenant member',
          displayInHub: true,
          name: 'Member',
          permissions: ['admin:manageRoles', 'users:viewAll'],
          tenantId: 'tenant-1',
        });
        expect(role.name).toBe('Member');
      }),
    );

    it.effect(
      'maps the tenant role-name constraint to a typed duplicate error',
      () =>
        Effect.gen(function* () {
          const duplicate = new SqlError({
            reason: new UniqueViolation({
              cause: { code: '23505' },
              constraint: roleTenantNameUniqueConstraintName,
              message: 'duplicate key value violates unique constraint',
              operation: 'INSERT',
            }),
          });
          const insertQuery = {
            returning: () => Effect.fail(duplicate),
            values: () => insertQuery,
          };
          const transactionDatabase = {
            execute: () => Effect.void,
            insert: () => insertQuery,
          };
          const database = {
            transaction: <A, E, R>(
              run: (
                database_: typeof transactionDatabase,
              ) => Effect.Effect<A, E, R>,
            ) => run(transactionDatabase),
          };

          const error = yield* adminHandlers['admin.roles.create'](
            createRoleWriteInput(),
            createAdminOptions(),
          ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

          expect(error).toMatchObject({
            _tag: 'RoleNameAlreadyExistsError',
            message: 'A role named Member already exists',
            name: 'Member',
          });
        }),
    );
  });

  describe('adminHandlers Stripe tax-rate import', () => {
    it.effect('rejects import when the tenant has no connected account', () =>
      Effect.gen(function* () {
        const error = yield* adminHandlers['admin.tenant.importStripeTaxRates'](
          { ids: ['txr_admin'] },
          createAdminOptions(),
        ).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'stripeAccountRequired',
        });
      }),
    );

    it.effect(
      'rejects provider listing when the tenant has no connected account',
      () =>
        Effect.gen(function* () {
          const error = yield* adminHandlers['admin.tenant.listStripeTaxRates'](
            undefined,
            createAdminOptions(),
          ).pipe(Effect.flip);

          expect(error).toMatchObject({
            _tag: 'RpcBadRequestError',
            reason: 'stripeAccountRequired',
          });
        }),
    );

    it.effect(
      'keeps a concurrent tenant account change in the expected channel',
      () =>
        Effect.gen(function* () {
          const error = yield* adminHandlers[
            'admin.tenant.importStripeTaxRates'
          ]({ ids: ['txr_admin'] }, createAdminOptions()).pipe(
            Effect.provideService(
              RpcRequestContext,
              createRequestContext(adminPermissions, 'acct_current'),
            ),
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
            message:
              'The tenant Stripe account changed while tax rates were being loaded; retry the import',
            reason: 'stripeAccountChanged',
          });
        }),
    );

    it.effect(
      'keeps a conflicting stored rate account in the expected channel',
      () =>
        Effect.gen(function* () {
          const error = yield* adminHandlers[
            'admin.tenant.importStripeTaxRates'
          ]({ ids: ['txr_admin'] }, createAdminOptions()).pipe(
            Effect.provideService(
              RpcRequestContext,
              createRequestContext(adminPermissions, 'acct_current'),
            ),
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
            reason: 'stripeTaxRateAccountConflict',
          });
        }),
    );
  });

  describe('adminHandlers focused tenant settings', () => {
    it.effect('requires the dedicated payment-management permission', () =>
      Effect.gen(function* () {
        const error = yield* adminHandlers[
          'admin.tenant.updatePaymentProviderSettings'
        ](
          createPaymentProviderSettingsInput(),
          createSettingsAdminOptions(),
        ).pipe(
          Effect.provideService(
            RpcRequestContext,
            createRequestContext(['admin:changeSettings']),
          ),
          Effect.provide(provideDatabase({})),
          Effect.flip,
        );

        expect(error).toMatchObject({
          _tag: 'RpcForbiddenError',
          permission: 'admin:managePayments',
        });
      }),
    );

    it.effect('persists only the registration-policy section', () =>
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

        yield* adminHandlers['admin.tenant.updateRegistrationSettings'](
          {
            cancellationDeadlineHoursBeforeStart: 96,
            maxActiveRegistrationsPerUser: 4,
            transferDeadlineHoursBeforeStart: 12,
          },
          createSettingsAdminOptions(),
        ).pipe(
          Effect.provide(
            provideDatabase({
              update: () => updateQuery,
            }),
          ),
        );

        expect(capturedUpdate).toEqual({
          cancellationDeadlineHoursBeforeStart: 96,
          maxActiveRegistrationsPerUser: 4,
          transferDeadlineHoursBeforeStart: 12,
        });
      }),
    );

    it.effect('normalizes and persists only the appearance section', () =>
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

        yield* adminHandlers['admin.tenant.updateAppearanceSettings'](
          {
            faviconUrl: ' https://cdn.example.org/favicon.ico ',
            logoUrl: '/tenant-assets/tenant-1/logo/logo.png',
            seoDescription: '  Public description  ',
            seoTitle: '  Public title  ',
            theme: 'evorto',
          },
          createSettingsAdminOptions(),
        ).pipe(
          Effect.provide(
            provideDatabase({
              update: () => updateQuery,
            }),
          ),
        );

        expect(capturedUpdate).toEqual({
          faviconUrl: 'https://cdn.example.org/favicon.ico',
          logoUrl: '/tenant-assets/tenant-1/logo/logo.png',
          seoDescription: 'Public description',
          seoTitle: 'Public title',
          theme: 'evorto',
        });
      }),
    );

    it.effect(
      'persists a validated organization location and normalized sender',
      () =>
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

          yield* adminHandlers['admin.tenant.updateOrganizationSettings'](
            {
              defaultLocation,
              emailSenderEmail: ' events@section.example.org ',
              emailSenderName: ' Example Section ',
              timezone: 'Europe/Berlin',
            },
            createSettingsAdminOptions(),
          ).pipe(
            Effect.provide(
              provideDatabase(
                withTenantSettingsTransaction(
                  {
                    update: () => updateQuery,
                  },
                  {
                    lockedTimezone: 'Europe/Berlin',
                  },
                ),
              ),
            ),
          );

          expect(capturedUpdate).toEqual({
            defaultLocation,
            emailSenderEmail: 'events@section.example.org',
            emailSenderName: 'Example Section',
            timezone: 'Europe/Berlin',
          });
        }),
    );

    it.effect('normalizes and persists only the legal section', () =>
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

        yield* adminHandlers['admin.tenant.updateLegalSettings'](
          {
            legalNoticeText: '  Tenant imprint text  ',
            legalNoticeUrl: ' https://section.example.org/imprint ',
            termsText: ' Tenant terms text ',
            termsUrl: 'https://section.example.org/terms',
          },
          createSettingsAdminOptions(),
        ).pipe(
          Effect.provide(
            provideDatabase({
              update: () => updateQuery,
            }),
          ),
        );

        expect(capturedUpdate).toEqual({
          legalNoticeText: 'Tenant imprint text',
          legalNoticeUrl: 'https://section.example.org/imprint',
          termsText: 'Tenant terms text',
          termsUrl: 'https://section.example.org/terms',
        });
      }),
    );

    it.effect('rejects invalid tenant legal-link URLs', () =>
      Effect.gen(function* () {
        const database = {
          update: () => {
            throw new Error('database should not be touched');
          },
        };

        const error = yield* adminHandlers['admin.tenant.updateLegalSettings'](
          {
            ...createLegalSettingsInput(),
            legalNoticeUrl: 'not a url',
          },
          createSettingsAdminOptions(),
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe('Invalid tenant legal links');
      }),
    );

    it.effect('rejects invalid tenant brand asset URLs', () =>
      Effect.gen(function* () {
        const database = {
          update: () => {
            throw new Error('database should not be touched');
          },
        };

        const error = yield* adminHandlers[
          'admin.tenant.updateAppearanceSettings'
        ](
          {
            ...createAppearanceSettingsInput(),
            logoUrl: 'file:///tmp/logo.svg',
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

          const error = yield* adminHandlers[
            'admin.tenant.updateAppearanceSettings'
          ](
            {
              ...createAppearanceSettingsInput(),
              logoUrl: '/tenant-assets/tenant-1/logo/..%2Fsecret.png',
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
            const error = yield* adminHandlers[
              'admin.tenant.updateAppearanceSettings'
            ](
              {
                ...createAppearanceSettingsInput(),
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

        const error = yield* adminHandlers[
          'admin.tenant.updatePaymentProviderSettings'
        ](
          {
            ...createPaymentProviderSettingsInput(),
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

        const error = yield* adminHandlers[
          'admin.tenant.updatePaymentProviderSettings'
        ](
          {
            ...createPaymentProviderSettingsInput(),
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

          const error = yield* adminHandlers[
            'admin.tenant.updatePaymentProviderSettings'
          ](
            {
              ...createPaymentProviderSettingsInput(),
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

        const error = yield* adminHandlers[
          'admin.tenant.updateOrganizationSettings'
        ](
          {
            ...createOrganizationSettingsInput(),
            timezone: 'Europe/Prague',
          },
          createSettingsAdminOptions(),
        ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error).toMatchObject({
          message: 'Tenant timezone setting is locked',
          reason:
            'Timezone cannot be changed after event or payment data exists.',
        });
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

          const error = yield* adminHandlers[
            'admin.tenant.updateOrganizationSettings'
          ](
            {
              ...createOrganizationSettingsInput(),
              timezone: 'Europe/Amsterdam',
            },
            createSettingsAdminOptions(),
          ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

          expect(error['_tag']).toBe('RpcBadRequestError');
          expect(error).toMatchObject({
            message: 'Tenant timezone setting is locked',
            reason:
              'Timezone cannot be changed after event or payment data exists.',
          });
        }),
    );

    it.effect(
      'validates and persists an initial Stripe account connection',
      () =>
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
          const stripeHttpClient = new TaxRateStripeHttpClient();

          yield* adminHandlers['admin.tenant.updatePaymentProviderSettings'](
            {
              ...createPaymentProviderSettingsInput(),
              stripeAccountId: ' acct_initial ',
            },
            createSettingsAdminOptions(),
          ).pipe(
            Effect.provide(taxRateImportLayer(database, stripeHttpClient)),
          );

          expect(stripeHttpClient.requestedAccountIds).toEqual([
            'acct_initial',
          ]);
          expect(capturedUpdate).toMatchObject({
            stripeAccountId: 'acct_initial',
          });
        }),
    );

    it.effect('rejects a foreign Stripe account before persistence', () =>
      Effect.gen(function* () {
        const stripeHttpClient = new TaxRateStripeHttpClient(
          () =>
            new Stripe.errors.StripeInvalidRequestError({
              headers: {},
              message: 'No such connected account',
              requestId: 'req_foreign_account',
              statusCode: 404,
              type: 'invalid_request_error',
            }),
        );
        const database = withTenantSettingsTransaction({
          update: () => {
            throw new Error('database update should not run');
          },
        });

        const error = yield* adminHandlers[
          'admin.tenant.updatePaymentProviderSettings'
        ](
          {
            ...createPaymentProviderSettingsInput(),
            stripeAccountId: 'acct_foreign',
          },
          createSettingsAdminOptions(),
        ).pipe(
          Effect.provide(taxRateImportLayer(database, stripeHttpClient)),
          Effect.flip,
        );

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          message: 'Stripe account could not be verified',
        });
        expect(error.reason).toContain('connected to this Stripe platform');
        expect(stripeHttpClient.requestedAccountIds).toEqual(['acct_foreign']);
      }),
    );

    it.effect(
      'rejects a Stripe account that cannot accept and pay out funds',
      () =>
        Effect.gen(function* () {
          const stripeHttpClient = new TaxRateStripeHttpClient(
            (stripeAccountId) => ({
              ...readyStripeAccountResponse(stripeAccountId),
              payouts_enabled: false,
            }),
          );
          const database = withTenantSettingsTransaction({
            update: () => {
              throw new Error('database update should not run');
            },
          });

          const error = yield* adminHandlers[
            'admin.tenant.updatePaymentProviderSettings'
          ](
            {
              ...createPaymentProviderSettingsInput(),
              stripeAccountId: 'acct_incomplete',
            },
            createSettingsAdminOptions(),
          ).pipe(
            Effect.provide(taxRateImportLayer(database, stripeHttpClient)),
            Effect.flip,
          );

          expect(error).toMatchObject({
            _tag: 'RpcBadRequestError',
            message: 'Stripe account is not ready for payments',
          });
          expect(error.reason).toContain('enable both charges and payouts');
        }),
    );

    it.effect(
      'rejects an unverified non-null account change from stale request context',
      () =>
        Effect.gen(function* () {
          const database = withTenantSettingsTransaction(
            {
              update: () => {
                throw new Error('database update should not run');
              },
            },
            {
              lockedStripeAccountId: 'acct_current',
              preReadStripeAccountId: 'acct_stale',
            },
          );

          const error = yield* adminHandlers[
            'admin.tenant.updatePaymentProviderSettings'
          ](
            {
              ...createPaymentProviderSettingsInput('acct_stale'),
              stripeAccountId: 'acct_stale',
            },
            createSettingsAdminOptions(),
          ).pipe(
            Effect.provideService(
              RpcRequestContext,
              createRequestContext(adminPermissions, 'acct_stale'),
            ),
            Effect.provide(provideDatabase(database)),
            Effect.flip,
          );

          expect(error).toMatchObject({
            _tag: 'RpcBadRequestError',
            message: 'Stripe account changed while payment settings were open',
          });
        }),
    );

    it.effect(
      'rejects a stale loaded account before validating a new rotation target',
      () =>
        Effect.gen(function* () {
          const database = withTenantSettingsTransaction(
            {
              update: () => {
                throw new Error('database update should not run');
              },
            },
            {
              lockedStripeAccountId: 'acct_current',
              preReadStripeAccountId: 'acct_current',
            },
          );

          const error = yield* adminHandlers[
            'admin.tenant.updatePaymentProviderSettings'
          ](
            {
              ...createPaymentProviderSettingsInput('acct_stale'),
              stripeAccountId: 'acct_next',
            },
            createSettingsAdminOptions(),
          ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

          expect(error).toMatchObject({
            _tag: 'RpcBadRequestError',
            message: 'Stripe account changed while payment settings were open',
          });
        }),
    );

    it.effect(
      'rejects an account clear when the connected account changed after the form loaded',
      () =>
        Effect.gen(function* () {
          const database = withTenantSettingsTransaction(
            {
              update: () => {
                throw new Error('database update should not run');
              },
            },
            {
              lockedStripeAccountId: 'acct_current',
              preReadStripeAccountId: 'acct_stale',
            },
          );

          const error = yield* adminHandlers[
            'admin.tenant.updatePaymentProviderSettings'
          ](
            createPaymentProviderSettingsInput('acct_stale'),
            createSettingsAdminOptions(),
          ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

          expect(error).toMatchObject({
            _tag: 'RpcBadRequestError',
            message: 'Stripe account changed while payment settings were open',
          });
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

          const error = yield* adminHandlers[
            'admin.tenant.updatePaymentProviderSettings'
          ](
            createPaymentProviderSettingsInput('acct_existing'),
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

          const error = yield* adminHandlers[
            'admin.tenant.updatePaymentProviderSettings'
          ](
            createPaymentProviderSettingsInput('acct_existing'),
            createSettingsAdminOptions(),
          ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

          expect(error['_tag']).toBe('RpcBadRequestError');
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
          let capturedUpdate: Record<string, unknown> | undefined;
          let deletedTaxMetadata = false;
          const updateQuery = {
            returning: () => Effect.succeed([{ id: 'tenant-1' }]),
            set: (value: Record<string, unknown>) => {
              capturedUpdate = value;
              return updateQuery;
            },
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

          yield* adminHandlers['admin.tenant.updatePaymentProviderSettings'](
            {
              ...createPaymentProviderSettingsInput('acct_existing'),
              stripeAccountId: 'acct_next',
            },
            createSettingsAdminOptions('acct_existing'),
          ).pipe(
            Effect.provideService(
              RpcRequestContext,
              createRequestContext(adminPermissions, 'acct_existing'),
            ),
            Effect.provide(taxRateImportLayer(database)),
          );

          expect(deletedTaxMetadata).toBe(true);
          expect(capturedUpdate).toMatchObject({
            stripeAccountId: 'acct_next',
          });
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

          const error = yield* adminHandlers[
            'admin.tenant.updatePaymentProviderSettings'
          ](
            {
              ...createPaymentProviderSettingsInput('acct_existing'),
              stripeAccountId: undefined,
            },
            createSettingsAdminOptions(),
          ).pipe(Effect.provide(provideDatabase(database)), Effect.flip);

          expect(error['_tag']).toBe('RpcBadRequestError');
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
          let capturedUpdate: Record<string, unknown> | undefined;
          let deletedTaxMetadata = false;
          const updateQuery = {
            returning: () => Effect.succeed([{ id: 'tenant-1' }]),
            set: (value: Record<string, unknown>) => {
              capturedUpdate = value;
              return updateQuery;
            },
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

          yield* adminHandlers['admin.tenant.updatePaymentProviderSettings'](
            {
              ...createPaymentProviderSettingsInput('acct_existing'),
              stripeAccountId: 'acct_new',
            },
            createSettingsAdminOptions(),
          ).pipe(Effect.provide(taxRateImportLayer(database)));

          expect(deletedTaxMetadata).toBe(true);
          expect(capturedUpdate).toMatchObject({
            stripeAccountId: 'acct_new',
          });
        }),
    );

    it.effect(
      'allows payment-provider edits when the locked Stripe account is unchanged',
      () =>
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
          const database = withTenantSettingsTransaction(
            { update: () => updateQuery },
            {
              hasPendingStripeObligations: true,
              lockedStripeAccountId: 'acct_existing',
            },
          );

          yield* adminHandlers['admin.tenant.updatePaymentProviderSettings'](
            {
              ...createPaymentProviderSettingsInput('acct_existing'),
              refundFeesOnCancellation: false,
              stripeAccountId: 'acct_existing',
            },
            createSettingsAdminOptions(),
          ).pipe(Effect.provide(provideDatabase(database)));

          expect(capturedUpdate).toEqual({
            currency: 'EUR',
            discountProviders: {
              esnCard: {
                config: {},
                status: 'disabled',
              },
            },
            receiptSettings: {
              allowOther: true,
              receiptCountries: ['NL'],
            },
            refundFeesOnCancellation: false,
            stripeAccountId: 'acct_existing',
          });
        }),
    );
  });
});
