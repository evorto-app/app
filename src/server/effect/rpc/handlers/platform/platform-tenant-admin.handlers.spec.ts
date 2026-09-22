import { describe, expect, it, layer } from '@effect/vitest';
import { createRegistrationDatabaseTestLayer } from '@server/testing/registration-database';
import {
  type PlatformRoleCreateInput,
  PlatformRoleRecord,
  PlatformRolesCreate,
  PlatformRolesUpdate,
} from '@shared/rpc-contracts/app-rpcs/platform-tenant-admin.rpcs';
import { RpcRequestContext } from '@shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import { getTableColumns } from 'drizzle-orm';
import { Cause, Effect, Exit, Layer, Schema } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { SqlError, UniqueViolation } from 'effect/unstable/sql/SqlError';

import {
  roleTenantNameUniqueConstraintName,
  tenants,
} from '../../../../../db/schema';
import { PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';
import { Tenant } from '../../../../../types/custom/tenant';
import { RpcAccess } from '../shared/rpc-access.service';
import {
  collectSupportedStripeTaxRatePages,
  decodePlatformTaxRateAuditRecord,
  ensureStripeAccountUnchanged,
  normalizePlatformTenantUserSearch,
  PlatformTaxRateAuditRecord,
  platformTaxRateBatchAuditSnapshot,
  platformTenantAdminHandlers,
  type StripeTaxRateSource,
  taxRateBatchResourceId,
  uniqueSortedIds,
} from './platform-tenant-admin.handlers';

const roleTenant = {
  cancellationDeadlineHoursBeforeStart: 120,
  createdAt: new Date('2026-07-01T12:00:00.000Z'),
  currency: 'EUR',
  defaultLocation: null,
  discountProviders: { esnCard: { config: {}, status: 'disabled' } },
  domain: 'target.example.org',
  emailSenderEmail: null,
  emailSenderName: null,
  faviconUrl: null,
  id: 'tenant-target',
  legalNoticeText: null,
  legalNoticeUrl: null,
  logoUrl: null,
  maxActiveRegistrationsPerUser: 0,
  name: 'Target tenant',
  receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
  refundFeesOnCancellation: true,
  seoDescription: null,
  seoTitle: null,
  stripeAccountId: null,
  termsText: null,
  termsUrl: null,
  theme: 'evorto',
  timezone: 'Europe/Berlin',
  transferDeadlineHoursBeforeStart: 0,
  updatedAt: new Date('2026-07-01T12:00:00.000Z'),
} satisfies typeof tenants.$inferSelect;

const authority = PlatformAdministratorAuthority.make({
  actorEmail: 'platform@example.org',
  actorId: 'auth0|platform-admin',
  kind: 'platformAdministrator',
});

const roleInput = {
  defaultOrganizerRole: false,
  defaultUserRole: false,
  description: '  Member description  ',
  displayInHub: true,
  name: '  Member  ',
  permissions: ['users:viewAll', 'admin:manageRoles', 'users:viewAll'],
  reason: 'Correct a target-tenant role',
  targetTenantId: roleTenant.id,
} satisfies PlatformRoleCreateInput;

const normalizedRole = PlatformRoleRecord.make({
  defaultOrganizerRole: false,
  defaultUserRole: false,
  description: 'Member description',
  displayInHub: true,
  id: 'role-1',
  name: 'Member',
  permissions: ['admin:manageRoles', 'users:viewAll'],
  sortOrder: 0,
});

const roleRow = (name: string) => [
  normalizedRole.defaultOrganizerRole,
  normalizedRole.defaultUserRole,
  normalizedRole.description,
  normalizedRole.displayInHub,
  normalizedRole.id,
  name,
  normalizedRole.permissions,
  normalizedRole.sortOrder,
];

const createRoleWriteFixture = (writeFailure?: SqlError) => {
  const transactions: string[] = [];
  const writes: { parameters: readonly unknown[]; statement: string }[] = [];
  const audits: (readonly unknown[])[] = [];
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) => {
      if (statement.includes('pg_advisory_xact_lock')) {
        expect(parameters).toEqual([
          `evorto:tenant-role-graph:${roleTenant.id}`,
        ]);
        return Effect.succeed([]);
      }
      if (statement.includes('from "tenants"')) {
        expect(parameters).toContain(roleTenant.id);
        if (statement.endsWith('for update')) {
          return Effect.succeed([[roleTenant.id, null]]);
        }
        expect(Object.keys(roleTenant)).toEqual(
          Object.keys(getTableColumns(tenants)),
        );
        return Effect.succeed([
          Object.values(roleTenant).map((value) =>
            value instanceof Date
              ? value.toISOString().replace('Z', '')
              : value,
          ),
        ]);
      }
      if (
        statement.startsWith('select') &&
        statement.includes('from "roles"')
      ) {
        expect(parameters).toEqual([normalizedRole.id, roleTenant.id]);
        expect(statement).toContain('for update');
        return Effect.succeed([roleRow('Previous name')]);
      }
      if (
        statement.startsWith('insert into "roles"') ||
        statement.startsWith('update "roles"')
      ) {
        writes.push({ parameters, statement });
        return writeFailure
          ? Effect.fail(writeFailure)
          : Effect.succeed([roleRow(normalizedRole.name)]);
      }
      if (statement.startsWith('insert into "platform_audit_entries"')) {
        audits.push(parameters);
        return Effect.succeed([]);
      }
      return Effect.die(new Error(`Unexpected role fixture SQL: ${statement}`));
    },
    transactionControl: (command) =>
      Effect.sync(() => {
        transactions.push(command);
      }),
  });

  return {
    audits,
    layer: Layer.mergeAll(
      databaseLayer,
      RpcAccess.Default,
      Layer.succeed(RpcRequestContext, {
        authData: { sub: authority.actorId },
        authenticated: true,
        permissions: [],
        platformAuthority: authority,
        tenant: Schema.decodeUnknownSync(Tenant)(roleTenant),
        user: null,
        userAssigned: false,
      }),
    ),
    transactions,
    writes,
  };
};

const rpcOptions = <R extends Rpc.Any>(rpc: R) => ({
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc,
});

const roleMutations = [
  {
    action: 'role.create',
    name: 'create',
    run: (input: PlatformRoleCreateInput) =>
      platformTenantAdminHandlers['platform.roles.create'](
        input,
        rpcOptions(PlatformRolesCreate),
      ),
  },
  {
    action: 'role.update',
    name: 'update',
    run: (input: PlatformRoleCreateInput) =>
      platformTenantAdminHandlers['platform.roles.update'](
        { ...input, roleId: normalizedRole.id },
        rpcOptions(PlatformRolesUpdate),
      ),
  },
];

const stripeRate = (
  id: string,
  overrides: Partial<StripeTaxRateSource> = {},
): StripeTaxRateSource => ({
  active: true,
  country: 'DE',
  display_name: 'VAT',
  id,
  inclusive: true,
  percentage: 19,
  state: null,
  ...overrides,
});

const persistedRate = (
  id: string,
  displayName: string,
): PlatformTaxRateAuditRecord =>
  PlatformTaxRateAuditRecord.make({
    active: true,
    country: 'DE',
    displayName,
    id: `local-${id}`,
    inclusive: true,
    percentage: '19',
    state: null,
    stripeAccountId: 'acct_current',
    stripeTaxRateId: id,
    tenantId: 'tenant-1',
  });

for (const mutation of roleMutations) {
  describe(`platform role ${mutation.name}`, () => {
    const success = createRoleWriteFixture();
    layer(success.layer)((it) => {
      it.effect(
        'normalizes the persisted role and records its target-scoped audit',
        () =>
          Effect.gen(function* () {
            const result = yield* mutation.run(roleInput);

            expect(result).toEqual(normalizedRole);
            expect(success.writes).toHaveLength(1);
            const parameters = success.writes[0]?.parameters;
            expect(parameters).toContain(normalizedRole.name);
            expect(parameters).toContain(normalizedRole.description);
            expect(parameters).toContain(
              JSON.stringify(normalizedRole.permissions),
            );
            expect(parameters).toContain(roleTenant.id);
            expect(parameters).not.toContain(roleInput.name);
            expect(parameters).not.toContain(roleInput.description);
            expect(success.audits).toHaveLength(1);
            expect(success.audits[0]).toContain(mutation.action);
            expect(success.audits[0]).toContain(roleTenant.id);
            expect(success.audits[0]).toContain(authority.actorId);
            expect(success.audits[0]).toContain(roleInput.reason);
            expect(success.transactions).toEqual(['BEGIN', 'COMMIT']);
          }),
      );
    });

    const validation = createRoleWriteFixture();
    layer(validation.layer)((it) => {
      it.effect(
        'returns typed input errors before opening a write transaction',
        () =>
          Effect.gen(function* () {
            const invalidInputs: {
              field: string;
              input: PlatformRoleCreateInput;
            }[] = [
              { field: 'name', input: { ...roleInput, name: ' '.repeat(3) } },
              { field: 'name', input: { ...roleInput, name: 'n'.repeat(101) } },
              {
                field: 'description',
                input: { ...roleInput, description: 'd'.repeat(501) },
              },
              {
                field: 'permissions',
                input: { ...roleInput, permissions: ['globalAdmin:*'] },
              },
              {
                field: 'permissions',
                input: {
                  ...roleInput,
                  permissions: ['globalAdmin:manageTenants'],
                },
              },
            ];
            for (const invalid of invalidInputs) {
              const error = yield* mutation
                .run(invalid.input)
                .pipe(Effect.flip);
              expect(error).toMatchObject({
                _tag: 'RoleWriteValidationError',
                field: invalid.field,
              });
            }
            expect(validation.writes).toEqual([]);
            expect(validation.audits).toEqual([]);
            expect(validation.transactions).toEqual([]);
          }),
      );
    });

    const duplicate = createRoleWriteFixture(
      new SqlError({
        reason: new UniqueViolation({
          cause: new Error('Synthetic duplicate role name'),
          constraint: roleTenantNameUniqueConstraintName,
        }),
      }),
    );
    layer(duplicate.layer)((it) => {
      it.effect(
        'returns the normalized duplicate name and rolls back without an audit',
        () =>
          Effect.gen(function* () {
            const error = yield* mutation.run(roleInput).pipe(Effect.flip);

            expect(error).toMatchObject({
              _tag: 'RoleNameAlreadyExistsError',
              name: normalizedRole.name,
            });
            expect(duplicate.writes).toHaveLength(1);
            expect(duplicate.audits).toEqual([]);
            expect(duplicate.transactions).toEqual(['BEGIN', 'ROLLBACK']);
          }),
      );
    });

    const unexpected = createRoleWriteFixture(
      new SqlError({
        reason: new UniqueViolation({
          cause: new Error('Synthetic unrelated constraint failure'),
          constraint: 'unrelated_unique_constraint',
        }),
      }),
    );
    layer(unexpected.layer)((it) => {
      it.effect('preserves unrelated database failures as defects', () =>
        Effect.gen(function* () {
          const exit = yield* mutation.run(roleInput).pipe(Effect.exit);

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(Cause.hasDies(exit.cause)).toBe(true);
          }
          expect(unexpected.writes).toHaveLength(1);
          expect(unexpected.audits).toEqual([]);
          expect(unexpected.transactions).toEqual(['BEGIN', 'ROLLBACK']);
        }),
      );
    });
  });
}

describe('platform tenant-admin handler boundaries', () => {
  it('escapes tenant-user wildcard search characters', () => {
    expect(normalizePlatformTenantUserSearch('  100%_member  ')).toBe(
      String.raw`%100\%\_member%`,
    );
    expect(normalizePlatformTenantUserSearch(' '.repeat(3))).toBeUndefined();
  });

  it('deduplicates and stabilizes mutation identifiers', () => {
    expect(uniqueSortedIds(['role-b', 'role-a', 'role-b'])).toEqual([
      'role-a',
      'role-b',
    ]);
  });

  it.effect('fails tax import when the locked Stripe account changed', () =>
    Effect.gen(function* () {
      yield* ensureStripeAccountUnchanged('acct_original', 'acct_original');

      const changedError = yield* ensureStripeAccountUnchanged(
        'acct_original',
        'acct_replacement',
      ).pipe(Effect.flip);
      expect(changedError.reason).toBe('stripeAccountChanged');

      const disconnectedError = yield* ensureStripeAccountUnchanged(
        'acct_original',
        null,
      ).pipe(Effect.flip);
      expect(disconnectedError.reason).toBe('stripeAccountChanged');
    }),
  );

  it('audits full tax-rate metadata in stable Stripe ID order', () => {
    const before = platformTaxRateBatchAuditSnapshot('batch-1', [
      persistedRate('txr_b', 'Old B'),
      persistedRate('txr_a', 'Old A'),
    ]);
    const after = platformTaxRateBatchAuditSnapshot('batch-1', [
      persistedRate('txr_a', 'New A'),
      persistedRate('txr_b', 'Old B'),
    ]);

    expect(before).toMatchObject({
      state: {
        rates: [
          {
            displayName: 'Old A',
            stripeTaxRateId: 'txr_a',
            tenantId: 'tenant-1',
          },
          { displayName: 'Old B', stripeTaxRateId: 'txr_b' },
        ],
      },
    });
    expect(after).not.toEqual(before);
    expect(after).toMatchObject({
      state: {
        rates: [
          {
            active: true,
            country: 'DE',
            displayName: 'New A',
            id: 'local-txr_a',
            inclusive: true,
            percentage: '19',
            state: null,
            stripeAccountId: 'acct_current',
            stripeTaxRateId: 'txr_a',
            tenantId: 'tenant-1',
          },
          {
            displayName: 'Old B',
            stripeTaxRateId: 'txr_b',
          },
        ],
      },
    });
  });

  it('scopes tax-rate audit resource identity to the Stripe account', () => {
    expect(taxRateBatchResourceId('acct_a', ['txr_b', 'txr_a'])).toBe(
      taxRateBatchResourceId('acct_a', ['txr_a', 'txr_b']),
    );
    expect(taxRateBatchResourceId('acct_a', ['txr_a'])).not.toBe(
      taxRateBatchResourceId('acct_b', ['txr_a']),
    );
  });

  it.effect('fails closed when a selected tax rate has no account owner', () =>
    Effect.gen(function* () {
      const exit = yield* decodePlatformTaxRateAuditRecord({
        ...persistedRate('txr_unowned', 'Unowned'),
        stripeAccountId: null,
      }).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect('walks every bounded Stripe tax-rate page', () =>
    Effect.gen(function* () {
      const cursors: (string | undefined)[] = [];
      const rates = yield* collectSupportedStripeTaxRatePages(
        (startingAfter) => {
          cursors.push(startingAfter);
          return Effect.succeed(
            startingAfter === undefined
              ? {
                  data: [
                    stripeRate('txr_active'),
                    stripeRate('txr_inactive', { active: false }),
                  ],
                  hasMore: true,
                }
              : {
                  data: [stripeRate('txr_second_page')],
                  hasMore: false,
                },
          );
        },
        3,
      );

      expect(cursors).toEqual([undefined, 'txr_inactive']);
      expect(rates.map((rate) => rate.id)).toEqual([
        'txr_active',
        'txr_second_page',
      ]);
    }),
  );

  it.effect('fails instead of silently truncating Stripe tax-rate pages', () =>
    Effect.gen(function* () {
      let page = 0;
      const error = yield* collectSupportedStripeTaxRatePages(() => {
        page += 1;
        return Effect.succeed({
          data: [stripeRate(`txr_${page}`)],
          hasMore: true,
        });
      }, 2).pipe(Effect.flip);

      expect(page).toBe(2);
      expect(error.reason).toBe('stripeTaxRatePageLimitExceeded');
    }),
  );
});
