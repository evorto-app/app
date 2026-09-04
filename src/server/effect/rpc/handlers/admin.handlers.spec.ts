import * as PgClient from '@effect/sql-pg/PgClient';
import { describe, expect, it, vi } from '@effect/vitest';
import { adminTenantSettingsSnapshot } from '@shared/tenant-settings-snapshot';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Cause, Effect, Exit, Layer, Schema, SchemaIssue } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { SqlError, UniqueViolation } from 'effect/unstable/sql/SqlError';
import Stripe from 'stripe';

import { Database, type DatabaseClient } from '../../../../db';
import { relations } from '../../../../db/relations';
import { roleTenantNameUniqueConstraintName } from '../../../../db/schema';
import { type Permission } from '../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs';
import * as AdminRpcs from '../../../../shared/rpc-contracts/app-rpcs/admin.rpcs';
import { type RoleWriteInput } from '../../../../shared/rpc-contracts/app-rpcs/role-write.shared';
import { Tenant } from '../../../../types/custom/tenant';
import { StripeClient } from '../../../stripe-client';
import { createRegistrationDatabaseTestLayer } from '../../../testing/registration-database';
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

const createSettingsInput = (
  expectedTenant = Schema.decodeUnknownSync(Tenant)(createTenant()),
) => ({
  allowOther: true,
  cancellationDeadlineHoursBeforeStart: 120,
  currency: 'EUR' as const,
  defaultLocation: null,
  emailSenderEmail: undefined,
  emailSenderName: undefined,
  esnCardEnabled: false,
  expectedSettings: adminTenantSettingsSnapshot(expectedTenant),
  maxActiveRegistrationsPerUser: 0,
  receiptCountries: ['NL'],
  refundFeesOnCancellation: true,
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
    readonly lockedTheme?: 'classic' | 'esn' | 'evorto';
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
                  ...createTenant(),
                  currency: options.lockedCurrency ?? 'EUR',
                  id: 'tenant-1',
                  stripeAccountId: options.lockedStripeAccountId ?? null,
                  theme: options.lockedTheme ?? 'evorto',
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

const roleWriteInput = {
  defaultOrganizerRole: false,
  defaultUserRole: false,
  description: '  Member description  ',
  displayInHub: true,
  name: '  Member  ',
  permissions: ['users:viewAll', 'admin:manageRoles', 'users:viewAll'],
} satisfies RoleWriteInput;
const canonicalRole = AdminRpcs.AdminRoleRecord.make({
  defaultOrganizerRole: false,
  defaultUserRole: false,
  description: 'Member description',
  displayInHub: true,
  id: 'role-1',
  name: 'Member',
  permissions: ['admin:manageRoles', 'users:viewAll'],
  sortOrder: 1,
});
const canonicalRoleRow = [
  false,
  false,
  'Member description',
  true,
  'role-1',
  'Member',
  ['admin:manageRoles', 'users:viewAll'],
  1,
];
const roleRequestLayer = requestContextLayer(
  createRequestContext(['admin:manageRoles']),
);
const roleReadLayer = (rows: readonly (readonly unknown[])[]) =>
  createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        expect(statement).toContain('from "roles"');
        expect(statement).toContain(
          '"defaultOrganizerRole" as "defaultOrganizerRole"',
        );
        expect(statement).not.toContain('collapseMembers');
        expect(parameters).toEqual(['role-1', 'tenant-1', 1]);
        return rows;
      }),
  });
const readRole = () =>
  adminHandlers['admin.roles.findOne'](
    { id: 'role-1' },
    createRpcOptions(
      AdminRpcs.AdminRolesFindOne.middleware(RpcRequestContextMiddleware),
    ),
  ).pipe(Effect.provide(roleRequestLayer));

const roleWriteFixture = (writeFailure?: SqlError) => {
  const transactions: string[] = [];
  const writes: (readonly unknown[])[] = [];
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) => {
      if (statement.includes('pg_advisory_xact_lock')) {
        expect(parameters).toEqual(['evorto:tenant-role-graph:tenant-1']);
        return Effect.succeed([]);
      }
      if (
        statement.startsWith('select') &&
        statement.includes('from "roles"')
      ) {
        expect(statement).toContain('for update');
        expect(parameters).toEqual(['role-1', 'tenant-1']);
        return Effect.succeed([[false, 'role-1']]);
      }
      if (
        statement.startsWith('insert into "roles"') ||
        statement.startsWith('update "roles"')
      ) {
        writes.push(parameters);
        return writeFailure
          ? Effect.fail(writeFailure)
          : Effect.succeed([canonicalRoleRow]);
      }
      return Effect.die(
        new Error(`Unexpected admin role fixture SQL: ${statement}`),
      );
    },
    transactionControl: (command) =>
      Effect.sync(() => {
        transactions.push(command);
      }),
  });
  return {
    layer: Layer.mergeAll(databaseLayer, roleRequestLayer),
    transactions,
    writes,
  };
};

const roleMutations = [
  {
    name: 'create',
    run: (input: RoleWriteInput) =>
      adminHandlers['admin.roles.create'](
        input,
        createRpcOptions(
          AdminRpcs.AdminRolesCreate.middleware(RpcRequestContextMiddleware),
        ),
      ),
  },
  {
    name: 'update',
    run: (input: RoleWriteInput) =>
      adminHandlers['admin.roles.update'](
        { ...input, id: canonicalRole.id },
        createRpcOptions(
          AdminRpcs.AdminRolesUpdate.middleware(RpcRequestContextMiddleware),
        ),
      ),
  },
];

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
      ).pipe(
        Effect.provide(requestContextLayer(createRequestContext([]))),
        Effect.provide(unavailableDatabaseLayer),
        Effect.flip,
      );
      expect(error).toMatchObject({
        _tag: 'RpcForbiddenError',
        permission: 'admin:manageRoles',
      });
    }),
  );
  it.effect('findOne returns the canonical role fields only', () =>
    Effect.gen(function* () {
      const role = yield* readRole().pipe(
        Effect.provide(roleReadLayer([canonicalRoleRow])),
      );
      expect(role).toEqual(canonicalRole);
      expect(role).not.toHaveProperty('collapseMembersInHup');
    }),
  );
  it.effect('findOne explains how to recover when a role is gone', () =>
    Effect.gen(function* () {
      const error = yield* readRole().pipe(
        Effect.provide(roleReadLayer([])),
        Effect.flip,
      );
      expect(error).toMatchObject({
        _tag: 'AdminRoleNotFoundError',
        message: 'This role no longer exists. Return to the role list.',
      });
    }),
  );
  it.effect(
    'fails visibly when a persisted role contains platform authority',
    () =>
      Effect.gen(function* () {
        const corruptRole = [
          false,
          false,
          'Corrupt role',
          true,
          'role-1',
          'Member',
          ['globalAdmin:*'],
          1,
        ];
        const exit = yield* readRole().pipe(
          Effect.provide(roleReadLayer([corruptRole])),
          Effect.exit,
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.hasDies(exit.cause)).toBe(true);
          const defect = exit.cause.reasons.find((reason) =>
            Cause.isDieReason(reason),
          )?.defect;
          expect(Schema.isSchemaError(defect)).toBe(true);
          if (Schema.isSchemaError(defect)) {
            const issues = SchemaIssue.makeFormatterStandardSchemaV1()(
              defect.issue,
            ).issues;
            expect(issues.map((issue) => issue.path)).toEqual([
              ['permissions', 0],
            ]);
          }
        }
      }),
  );
  it.effect(
    'findHubRoles requires internal page visibility before a database read',
    () =>
      Effect.gen(function* () {
        const error = yield* adminHandlers['admin.roles.findHubRoles'](
          undefined,
          createRpcOptions(
            AdminRpcs.AdminRolesFindHubRoles.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        ).pipe(
          Effect.provide(requestContextLayer(createRequestContext([]))),
          Effect.provide(unavailableDatabaseLayer),
          Effect.flip,
        );
        expect(error).toMatchObject({
          _tag: 'RpcForbiddenError',
          permission: 'internal:viewInternalPages',
        });
      }),
  );
});

for (const mutation of roleMutations) {
  describe(`admin role ${mutation.name}`, () => {
    it.effect(
      'normalizes role fields and commits the tenant-scoped write',
      () =>
        Effect.gen(function* () {
          const fixture = roleWriteFixture();
          const role = yield* mutation
            .run(roleWriteInput)
            .pipe(Effect.provide(fixture.layer));
          expect(role).toEqual(canonicalRole);
          expect(fixture.transactions).toEqual(['BEGIN', 'COMMIT']);
          expect(fixture.writes).toHaveLength(1);
          expect(fixture.writes[0]).toEqual(
            expect.arrayContaining([
              'Member',
              'Member description',
              JSON.stringify(canonicalRole.permissions),
              'tenant-1',
            ]),
          );
          expect(fixture.writes[0]).not.toContain(roleWriteInput.name);
          expect(fixture.writes[0]).not.toContain(roleWriteInput.description);
        }),
    );
    it.effect(
      'rejects invalid fields and platform authority before a write transaction',
      () =>
        Effect.gen(function* () {
          const fixture = roleWriteFixture();
          const invalidInputs: { field: string; input: RoleWriteInput }[] = [
            {
              field: 'name',
              input: { ...roleWriteInput, name: ' '.repeat(3) },
            },
            {
              field: 'name',
              input: { ...roleWriteInput, name: 'n'.repeat(101) },
            },
            {
              field: 'description',
              input: { ...roleWriteInput, description: 'd'.repeat(501) },
            },
            {
              field: 'permissions',
              input: { ...roleWriteInput, permissions: ['globalAdmin:*'] },
            },
            {
              field: 'permissions',
              input: {
                ...roleWriteInput,
                permissions: ['globalAdmin:manageTenants'],
              },
            },
          ];
          for (const invalid of invalidInputs) {
            const error = yield* mutation
              .run(invalid.input)
              .pipe(Effect.provide(fixture.layer), Effect.flip);
            expect(error).toMatchObject({
              _tag: 'RoleWriteValidationError',
              field: invalid.field,
            });
          }
          expect(fixture.transactions).toEqual([]);
          expect(fixture.writes).toEqual([]);
        }),
    );
    it.effect(
      'maps the named tenant role-name conflict and rolls the transaction back',
      () =>
        Effect.gen(function* () {
          const fixture = roleWriteFixture(
            new SqlError({
              reason: new UniqueViolation({
                cause: new Error('Synthetic duplicate role name'),
                constraint: roleTenantNameUniqueConstraintName,
              }),
            }),
          );
          const error = yield* mutation
            .run(roleWriteInput)
            .pipe(Effect.provide(fixture.layer), Effect.flip);
          expect(error).toMatchObject({
            _tag: 'RoleNameAlreadyExistsError',
            name: 'Member',
          });
          expect(fixture.transactions).toEqual(['BEGIN', 'ROLLBACK']);
          expect(fixture.writes).toHaveLength(1);
        }),
    );
  });
}

describe('adminHandlers Stripe tax-rate import', () => {
  it.effect(
    'keeps a concurrent tenant account change in the defect channel',
    () =>
      Effect.gen(function* () {
        const exit = yield* adminHandlers['admin.tenant.importStripeTaxRates'](
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
            Effect.exit,
          );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) expect(Cause.hasDies(exit.cause)).toBe(true);
      }),
  );

  it.effect(
    'keeps a conflicting stored rate account in the defect channel',
    () =>
      Effect.gen(function* () {
        const exit = yield* adminHandlers['admin.tenant.importStripeTaxRates'](
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
            Effect.exit,
          );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) expect(Cause.hasDies(exit.cause)).toBe(true);
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
            expectedSettings: adminTenantSettingsSnapshot(
              Schema.decodeUnknownSync(Tenant)(createTenant()),
            ),
            faviconUrl: ' https://cdn.example.org/favicon.ico ',
            legalNoticeText: '  Tenant imprint text  ',
            legalNoticeUrl: ' https://section.example.org/imprint ',
            logoUrl: 'https://cdn.example.org/logo.svg',
            maxActiveRegistrationsPerUser: 4,
            receiptCountries: ['NL'],
            refundFeesOnCancellation: false,
            seoDescription: '  Public description  ',
            seoTitle: '  Public title  ',
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
          termsText: 'Tenant terms text',
          termsUrl: 'https://section.example.org/terms',
          theme: 'classic',
          timezone: 'Australia/Brisbane',
          transferDeadlineHoursBeforeStart: 12,
        });
        expect(capturedUpdate).not.toHaveProperty('locale');
        expect(capturedUpdate).not.toHaveProperty('stripeAccountId');
        expect(result).not.toHaveProperty('stripeAccountId');
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
            ...createSettingsInput(
              Schema.decodeUnknownSync(Tenant)({
                ...createTenant(),
                timezone: 'Europe/Prague',
              }),
            ),
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
    'saves other settings after payment setup changes without exposing or overwriting the account',
    () =>
      Effect.gen(function* () {
        let capturedUpdate: Record<string, unknown> | undefined;
        const updateQuery = {
          returning: () =>
            Effect.succeed([
              { id: 'tenant-1', stripeAccountId: 'acct_existing' },
            ]),
          set: (values: Record<string, unknown>) => {
            capturedUpdate = values;
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

        expect(capturedUpdate).toMatchObject({ seoTitle: 'Updated title' });
        expect(capturedUpdate).not.toHaveProperty('stripeAccountId');
        expect(result.seoTitle).toBe('Updated title');
        expect(result.paymentsConfigured).toBe(true);
        expect(result).not.toHaveProperty('stripeAccountId');
      }),
  );
  it.effect(
    'rejects stale general settings against the locked row before any write',
    () =>
      Effect.gen(function* () {
        let writes = 0;
        const database = withTenantSettingsTransaction(
          {
            update: () => {
              writes++;
              throw new Error('stale form must not write');
            },
          },
          { lockedTheme: 'esn' },
        );
        const error = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            ...createSettingsInput(),
            seoTitle: 'Second editor title',
          },
          createRpcOptions(
            AdminRpcs.AdminTenantUpdateSettings.middleware(
              RpcRequestContextMiddleware,
            ),
          ),
        ).pipe(
          Effect.provide(
            requestContextLayer(createRequestContext(['admin:changeSettings'])),
          ),
          Effect.provide(tenantSettingsLayer(database)),
          Effect.flip,
        );
        expect(error._tag).toBe('TenantSettingsConflictError');
        expect(writes).toBe(0);
      }),
  );
});
