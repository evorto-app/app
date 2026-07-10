import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const readSource = (sourcePath: string): string =>
  readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');

const tenantOutboundProducerPaths = [
  'src/server/effect/rpc/handlers/events/event-registration.service.ts',
  'src/server/effect/rpc/handlers/events/events-registration.handlers.ts',
  'src/server/http/qr-code.web-handler.ts',
  'src/server/http/stripe-webhook.web-handler.ts',
  'src/server/registrations/registration-checkout-completion.ts',
  'src/server/registrations/registration-transfer.service.ts',
] as const;

describe('tenant outbound URL source boundary', () => {
  it('routes every tenant-scoped registration producer through the canonical helper', () => {
    for (const producerPath of tenantOutboundProducerPaths) {
      const source = readSource(producerPath);
      expect(source, producerPath).toContain('tenantOutboundUrl');
      expect(source, producerPath).not.toContain('serverNetworkConfig');
      expect(source, producerPath).not.toContain("headers['origin']");
      expect(source, producerPath).not.toContain('x-forwarded-host');
    }
  });

  it('keeps canonical root mutation exclusive to platform tenant contracts', () => {
    const platformContract = readSource(
      'src/shared/rpc-contracts/app-rpcs/global-admin.rpcs.ts',
    );
    const tenantAdminContract = readSource(
      'src/shared/rpc-contracts/app-rpcs/admin.rpcs.ts',
    );
    const tenantAdminSettings = tenantAdminContract.slice(
      tenantAdminContract.indexOf(
        'export const AdminTenantUpdateSettingsInput',
      ),
      tenantAdminContract.indexOf('export type AdminTenantUpdateSettingsInput'),
    );

    expect(platformContract).toContain(
      'canonicalRootUrl: Tenant.fields.canonicalRootUrl',
    );
    expect(tenantAdminSettings).not.toContain('canonicalRootUrl');
    expect(tenantAdminSettings).not.toContain('domain:');
  });

  it('persists the canonical root with a database host-match constraint', () => {
    const tenantSchema = readSource('src/db/schema/tenants.ts');

    expect(tenantSchema).toContain(
      "canonicalRootUrl: text('canonical_root_url').notNull()",
    );
    expect(tenantSchema).toContain('tenants_canonical_root_url_matches_domain');
  });
});
