import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureMigratedTenantPrivacyPolicy,
  legacyTenantDiscountProviders,
  normalizeLegacyTenantPrivacyPolicy,
} from '../../migration/steps/tenant';
import { normalizeTenantDomain } from '../../src/shared/tenant-origin';

const migrationDatabase = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const readSource = (relativePath: string): string =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

describe('tenant migration domain reuse', () => {
  it('normalizes mixed-case whitespace before lookup and insertion', () => {
    expect(normalizeTenantDomain('  TUMI.Example.Org  ')).toBe(
      'tumi.example.org',
    );

    const migration = readSource('migration/index.ts');
    const tenantStep = readSource('migration/steps/tenant.ts');
    const normalization =
      'const normalizedDomain = normalizeTenantDomain(newDomain);';
    const existingTenantLookup = 'where: { domain: normalizedDomain }';

    expect(migration).toContain(normalization);
    expect(migration).toContain(existingTenantLookup);
    expect(migration.indexOf(normalization)).toBeLessThan(
      migration.indexOf(existingTenantLookup),
    );
    expect(migration).toContain('const newTenant = await migrateTenant(');
    expect(tenantStep).toContain('domain: normalizedDomain');
    expect(tenantStep).not.toContain('domain: newDomain');
    expect(migration).toMatch(
      /await ensureMigratedTenantPrivacyPolicy\(database, newTenant\.id, oldTenant\)/,
    );
  });

  it('owns one target database client at the migration boundary', () => {
    const migration = readSource('migration/index.ts');
    const packageSource = readSource('package.json');
    const migrationSources = [
      readSource('migration/config.ts'),
      readSource('migration/cutover-guard.ts'),
      readSource('migration/legacy-event-location.ts'),
      readSource('migration/legacy-event-prices.ts'),
      readSource('migration/preflight.ts'),
      readSource('migration/steps/002_import_legacy_paid_option_tax_rates.ts'),
      readSource('migration/steps/003_add_admin_manage_taxes_permission.ts'),
      readSource('migration/steps/events.ts'),
      readSource('migration/steps/icons.ts'),
      readSource('migration/steps/roles.ts'),
      readSource('migration/steps/template-categories.ts'),
      readSource('migration/steps/templates.ts'),
      readSource('migration/steps/tenant.ts'),
      readSource('migration/steps/user-assignments.ts'),
      readSource('migration/steps/users.ts'),
    ].join('\n');

    expect(migration).toContain('createDatabaseClient(');
    expect(migration).toContain('try: () => runMigration(database, stripe)');
    expect(migration).toContain('pool.end()');
    expect(migration).toContain('if (import.meta.main)');
    expect(packageSource).toContain(
      '"db:migrate": "bun run env:runtime && dotenv -c dev -- bun migration/index.ts"',
    );
    expect(migrationSources).not.toMatch(
      /import \{ database \} from ['"][^'"]*src\/db['"]/u,
    );
    expect(migrationSources).not.toMatch(
      /import \{ stripe \} from ['"][^'"]*stripe-client['"]/u,
    );
  });

  it('keeps the importer data-only and blocks unsupported history before reset', () => {
    const migration = readSource('migration/index.ts');
    const preflight = readSource('migration/preflight.ts');
    const taxImport = readSource(
      'migration/steps/002_import_legacy_paid_option_tax_rates.ts',
    );
    const tenantStep = readSource('migration/steps/tenant.ts');

    expect(migration).not.toContain('addUniqueIndexTenantStripeTaxRates');
    expect(migration).not.toContain('backfillAndSeedTaxRates');
    expect(migration.indexOf('await preflightLegacyTenant')).toBeLessThan(
      migration.indexOf('if (clearDb)'),
    );
    expect(preflight).toContain('Production cutover is blocked');
    expect(taxImport).toContain('stripe.taxRates.retrieve');
    expect(taxImport).toContain('stripeAccountId: legacyStripeAccountId');
    expect(taxImport).not.toContain('NODE_ENV');
    expect(taxImport).not.toContain('dev_tax_free');
    expect(taxImport).not.toContain('dev_vat_');
    expect(tenantStep).toContain(
      'stripeAccountId: oldTenantData.stripeConnectAccountId?.trim() || null',
    );
    expect(tenantStep).not.toContain('.insert(schema.tenantStripeTaxRates)');
  });

  it('maps legacy event data without stale target fields or JSON assertions', () => {
    const assignmentStep = readSource('migration/steps/user-assignments.ts');
    const eventStep = readSource('migration/steps/events.ts');
    const templateStep = readSource('migration/steps/templates.ts');

    expect(eventStep).not.toContain('untouchedSinceMigration');
    expect(eventStep).not.toContain('.prices.options');
    expect(templateStep).not.toContain('.prices.options');
    expect(eventStep).toContain('legacyEventLocation({');
    expect(templateStep).toContain('legacyEventLocation({');
    expect(eventStep).toContain('has no migrated target template');
    expect(eventStep).toContain('has no mapped target creator');
    expect(templateStep).toContain('has no migrated target category');
    expect(assignmentStep).toContain('tenantId: newTenant.id');
    expect(assignmentStep).not.toContain('userAssignment.user.authId');
  });
});

describe('tenant migration privacy policy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('normalizes legacy text and HTTP policy pages', () => {
    expect(
      normalizeLegacyTenantPrivacyPolicy('  Legacy privacy policy  '),
    ).toEqual({
      privacyPolicyText: 'Legacy privacy policy',
      privacyPolicyUrl: null,
    });
    expect(
      normalizeLegacyTenantPrivacyPolicy(
        ' HTTPS://Section.Example.Org/privacy ',
      ),
    ).toEqual({
      privacyPolicyText: null,
      privacyPolicyUrl: 'https://section.example.org/privacy',
    });
  });

  it('fails closed when the legacy tenant has no privacy policy', () => {
    expect(() => normalizeLegacyTenantPrivacyPolicy('   ')).toThrow(
      'Cannot migrate a tenant without a configured legacy privacy policy.',
    );
  });

  it('creates version one and backfills legal fields for a new migration', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    migrationDatabase.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit })),
        })),
      })),
    });
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const insertValues = vi.fn(() => ({ onConflictDoNothing }));
    migrationDatabase.insert.mockReturnValue({ values: insertValues });
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    migrationDatabase.update.mockReturnValue({ set: updateSet });

    await ensureMigratedTenantPrivacyPolicy(migrationDatabase, 'tenant-1', {
      privacyPolicyPage: ' Legacy privacy policy ',
    });

    expect(insertValues).toHaveBeenCalledWith({
      createdByUserId: null,
      privacyPolicyText: 'Legacy privacy policy',
      privacyPolicyUrl: null,
      tenantId: 'tenant-1',
      version: 1,
    });
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith({
      privacyPolicyText: 'Legacy privacy policy',
      privacyPolicyUrl: null,
    });
  });

  it('preserves an existing current policy when a migration reruns', async () => {
    const currentPolicy = {
      privacyPolicyText: null,
      privacyPolicyUrl: 'https://section.example.org/current-policy',
    };
    const limit = vi.fn().mockResolvedValue([currentPolicy]);
    migrationDatabase.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit })),
        })),
      })),
    });
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    migrationDatabase.update.mockReturnValue({ set: updateSet });

    await ensureMigratedTenantPrivacyPolicy(migrationDatabase, 'tenant-1', {
      privacyPolicyPage: 'Outdated legacy privacy policy',
    });

    expect(migrationDatabase.insert).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(currentPolicy);
  });
});

describe('tenant migration discount providers', () => {
  it('enables the legacy ESNcard provider and preserves its purchase link', () => {
    expect(
      legacyTenantDiscountProviders({
        esnCardLink: ' https://cards.example.org/buy ',
      }),
    ).toEqual({
      esnCard: {
        config: { buyEsnCardUrl: 'https://cards.example.org/buy' },
        status: 'enabled',
      },
    });
    expect(legacyTenantDiscountProviders({})).toEqual({
      esnCard: { config: {}, status: 'enabled' },
    });
  });

  it('blocks malformed legacy provider configuration', () => {
    expect(() => legacyTenantDiscountProviders(null)).toThrow('invalid shape');
    expect(() =>
      legacyTenantDiscountProviders({ esnCardLink: 'file:///tmp/card' }),
    ).toThrow('valid HTTP URL');
  });
});
