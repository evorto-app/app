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
  it('routes every tenant-scoped registration producer through the trusted-origin helper', () => {
    for (const producerPath of tenantOutboundProducerPaths) {
      const source = readSource(producerPath);
      expect(source, producerPath).toMatch(
        /tenantOutboundUrl|resolveTenantPublicOrigin/,
      );
      expect(source, producerPath).not.toContain('serverNetworkConfig');
      expect(source, producerPath).not.toContain("headers['origin']");
      expect(source, producerPath).not.toContain('x-forwarded-host');
    }
  });

  it('does not expose a caller-controlled canonical origin in tenant contracts', () => {
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

    expect(platformContract).not.toContain('canonicalRootUrl');
    expect(tenantAdminSettings).not.toContain('canonicalRootUrl');
    expect(tenantAdminSettings).not.toContain('domain:');
  });

  it('derives the public origin from the normalized domain', () => {
    const tenantSchema = readSource('src/db/schema/tenants.ts');
    const tenantOrigin = readSource('src/shared/tenant-origin.ts');
    const tenantOutbound = readSource('src/server/tenant-outbound-url.ts');

    expect(tenantSchema).not.toContain('canonicalRootUrl');
    expect(tenantOrigin).toContain('deriveTenantPublicOrigin');
    expect(tenantOrigin).toContain('normalizeTenantDomain(primaryDomain)');
    expect(tenantOrigin).toContain('normalizeLoopbackDevelopmentOrigin');
    expect(tenantOutbound).toContain('resolveTenantPublicOrigin');
    expect(tenantOutbound).toContain('primaryDomain: tenant.domain');
  });
});
