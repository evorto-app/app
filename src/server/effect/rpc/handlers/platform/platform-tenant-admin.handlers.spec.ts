import { describe, expect, it } from '@effect/vitest';
import { Effect, Exit } from 'effect';

import {
  collectSupportedStripeTaxRatePages,
  decodePlatformTaxRateAuditRecord,
  ensureStripeAccountUnchanged,
  normalizePlatformTenantUserSearch,
  normalizeTenantAssignableRolePermissions,
  PlatformTaxRateAuditRecord,
  platformTaxRateBatchAuditSnapshot,
  type StripeTaxRateSource,
  taxRateBatchResourceId,
  uniqueSortedIds,
} from './platform-tenant-admin.handlers';

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

  it.effect('keeps platform authority out of tenant role permissions', () =>
    Effect.gen(function* () {
      const permissions = yield* normalizeTenantAssignableRolePermissions([
        'users:viewAll',
        'admin:manageRoles',
        'users:viewAll',
      ]);
      expect(permissions).toEqual(['admin:manageRoles', 'users:viewAll']);

      const wildcardError = yield* normalizeTenantAssignableRolePermissions([
        'globalAdmin:*',
      ]).pipe(Effect.flip);
      expect(wildcardError.reason).toBe('platformPermissionNotAssignable');

      const manageError = yield* normalizeTenantAssignableRolePermissions([
        'globalAdmin:manageTenants',
      ]).pipe(Effect.flip);
      expect(manageError.reason).toBe('platformPermissionNotAssignable');
    }),
  );

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
