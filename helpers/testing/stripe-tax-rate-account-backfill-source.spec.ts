import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const source = (relativePath: string) =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

describe('Stripe tax-rate account backfill source', () => {
  it('keeps provider I/O outside the lock and refreshes same-account replay metadata', () => {
    const implementation = source(
      'src/server/payments/stripe-tax-rate-account-backfill.ts',
    );
    const executeStart = implementation.indexOf(
      'export const executeStripeTaxRateAccountBackfill',
    );
    const operationsStart = implementation.indexOf(
      'const makeStripeTaxRateAccountBackfillOperations',
    );
    const orchestration = implementation.slice(executeStart, operationsStart);
    const commitImplementation = implementation.slice(operationsStart);

    expect(orchestration.indexOf('retrieveStripeTaxRate(')).toBeGreaterThan(-1);
    expect(orchestration.indexOf('commitVerifiedSnapshot(')).toBeGreaterThan(
      orchestration.indexOf('retrieveStripeTaxRate('),
    );
    expect(orchestration).not.toContain('.transaction(');

    expect(implementation).toContain(
      'LOCK TABLE public.tenants IN SHARE ROW EXCLUSIVE MODE',
    );
    expect(implementation).toContain(
      'LOCK TABLE public.tenant_stripe_tax_rates IN SHARE ROW EXCLUSIVE MODE',
    );
    expect(commitImplementation).toContain(".for('update')");
    expect(commitImplementation).toContain('const refreshedRows =');
    expect(commitImplementation).toContain('.set(providerOwnedMetadata)');
    expect(commitImplementation).toContain("return 'alreadyBackfilled'");
    expect(commitImplementation).not.toMatch(/UPDATE\s+.+\s+FROM\s+tenants/iu);
  });

  it('installs both schema-qualified fail-closed rolling-deployment guards', () => {
    const implementation = source(
      'src/server/payments/stripe-tax-rate-account-backfill.ts',
    );

    expect(implementation).toContain(
      'CREATE OR REPLACE FUNCTION public.evorto_require_owned_tenant_stripe_tax_rate()',
    );
    expect(implementation).toContain(
      'BEFORE INSERT OR UPDATE ON public.tenant_stripe_tax_rates',
    );
    expect(implementation).toContain('NEW."stripeAccountId" IS NULL');
    expect(implementation).toContain(
      'CREATE OR REPLACE FUNCTION public.evorto_require_tax_rate_cleanup_before_account_change()',
    );
    expect(implementation).toContain(
      'BEFORE UPDATE OF "stripeAccountId" ON public.tenants',
    );
    expect(implementation).toContain('FROM public.tenant_stripe_tax_rates');
    expect(implementation).toContain(
      'ne(tenantStripeTaxRates.stripeAccountId, tenants.stripeAccountId)',
    );
  });

  it('documents the temporary guard lifecycle and no-inference recovery rule', () => {
    const runbook = source('STRIPE_TAX_RATE_ACCOUNT_ROLLOUT.md');
    const readme = source('README.md');
    const quality = source('QUALITY.md');
    const packageJson = source('package.json');

    expect(packageJson).toContain(
      '"db:backfill-stripe-tax-rate-accounts": "bun helpers/backfill-stripe-tax-rate-accounts.ts"',
    );
    expect(runbook).toContain('provider-authoritative verified reimport');
    expect(runbook).toContain('not row-level security');
    expect(runbook).toContain('Do not bypass a failed backfill');
    expect(runbook).toContain('later coordinated contract release');
    expect(readme).toContain('STRIPE_TAX_RATE_ACCOUNT_ROLLOUT.md');
    expect(quality).toContain('db:backfill-stripe-tax-rate-accounts');
  });

  it('seeds deterministic tax rates with their owning Stripe account', () => {
    const seedHelper = source('helpers/add-tax-rates.ts');

    expect(seedHelper).toContain(
      'tenant: { id: string; stripeAccountId: null | string }',
    );
    expect(seedHelper).toContain('stripeAccountId: tenant.stripeAccountId');
    expect(seedHelper).not.toContain('values(toInsert as any)');
  });
});
