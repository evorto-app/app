import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const readSource = (relativePath: string): string =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

describe('platform authority source', () => {
  it('keeps platform identity distinct from tenant user permissions', () => {
    const resolver = readSource(
      'src/server/context/request-context-resolver.ts',
    );
    const httpContext = readSource(
      'src/server/context/http-request-context.ts',
    );

    expect(resolver).toContain('resolvePlatformAuthority');
    expect(resolver).toContain("kind: 'platformAdministrator'");
    expect(resolver).not.toContain('...ALL_PERMISSIONS');
    expect(httpContext).toContain('platformAuthority,');
    expect(httpContext).toContain('user: tenantUser');
    expect(httpContext).not.toContain('{ ...tenantUser, permissions }');
  });

  it('protects dedicated platform routes and RPCs with explicit authority', () => {
    const routes = readSource('src/app/global-admin/global-admin.routes.ts');
    const handlers = readSource(
      'src/server/effect/rpc/handlers/global-admin.handlers.ts',
    );
    const appRoutes = readSource('src/app/app.routes.ts');

    expect(routes).toContain('canActivate: [platformAuthorityGuard]');
    expect(routes).not.toContain('permissionGuard');
    expect(handlers).toContain('requirePlatformAdministrator');
    expect(handlers).not.toContain('ensurePermission(options.headers');
    expect(appRoutes).toContain('canActivate: [userAccountGuard, authGuard]');
  });

  it('binds delegated capability to one target without a tenant user', () => {
    const access = readSource(
      'src/server/effect/rpc/handlers/shared/rpc-access.service.ts',
    );
    const operations = readSource(
      'src/server/effect/rpc/handlers/shared/platform-operation.service.ts',
    );

    expect(access).toContain('operation.targetTenantId === context.tenant.id');
    expect(access).toContain(
      'operation.allowedPermissions.includes(permission)',
    );
    expect(operations).toContain('permissions: []');
    expect(operations).toContain('user: null');
    expect(operations).toContain('userAssigned: false');
    expect(operations).toContain(
      "message: 'Platform administrator authority required'",
    );
  });

  it('keeps platform tenant changes atomic and append-only', () => {
    const handlers = readSource(
      'src/server/effect/rpc/handlers/global-admin.handlers.ts',
    );
    const auditSchema = readSource('src/db/schema/platform-audit-entries.ts');
    const createTemplate = readSource(
      'src/app/global-admin/tenant-create/tenant-create.component.html',
    );

    expect(handlers).toContain('database.transaction((transaction)');
    expect(handlers).toContain(
      'transaction.insert(platformAuditEntries).values',
    );
    expect(handlers).toContain('.insert(tenantPrivacyPolicyVersions)');
    expect(handlers).toContain(
      '.returning({ id: tenantPrivacyPolicyVersions.id })',
    );
    expect(handlers).toContain(
      'tenantHasPendingStripeObligations(transaction, id)',
    );
    expect(handlers).toContain(
      'tenantHasActiveRegistrationTransfers(transaction, id)',
    );
    expect(handlers).toContain('new GlobalAdminTenantUrlMigrationBlockedError');
    expect(handlers).not.toContain('.update(platformAuditEntries)');
    expect(handlers).not.toContain('.delete(platformAuditEntries)');
    expect(auditSchema).not.toContain('updatedAt');
    expect(auditSchema).not.toContain('deletedAt');
    expect(auditSchema).toContain('platform_audit_reason_nonempty_check');
    expect(createTemplate).toContain('Reason for platform change');
    expect(createTemplate).toContain('Initial tenant privacy policy');
  });

  it('uses typed resource audit envelopes and tenant-scoped tax uniqueness', () => {
    const audit = readSource('src/shared/platform-audit.ts');
    const taxRates = readSource('src/db/schema/tenant-stripe-tax-rates.ts');

    expect(audit).toContain('resourceId: Schema.NonEmptyString');
    expect(audit).toContain('resourceType: PlatformAuditResourceType');
    expect(audit).toContain('state: Schema.Json');
    expect(taxRates).toContain(
      "uniqueIndex('tenant_stripe_tax_rates_tenant_stripe_unique')",
    );
    expect(taxRates).toContain('table.tenantId');
    expect(taxRates).toContain('table.stripeTaxRateId');
  });

  it('pins target-scoped event graphs and deterministic registration operations', () => {
    const contracts = readSource(
      'src/shared/rpc-contracts/app-rpcs/platform-events.rpcs.ts',
    );
    const eventHandlers = readSource(
      'src/server/effect/rpc/handlers/platform/platform-events.handlers.ts',
    );
    const registrationHandlers = readSource(
      'src/server/effect/rpc/handlers/platform/platform-registrations.handlers.ts',
    );
    const eventEditor = readSource(
      'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
    );
    const scanner = readSource(
      'src/app/global-admin/platform-event-operations/platform-scanner.component.ts',
    );

    expect(contracts).toContain("Rpc.make('platform.registrations.approve'");
    expect(contracts).toContain("Rpc.make('platform.registrations.cancel'");
    expect(contracts).toContain('Schema.isLessThanOrEqualTo(100)');
    expect(contracts).toContain('addOns: Schema.Array(');
    expect(contracts).toContain('questions: Schema.Array(');
    expect(contracts).toContain('registrationOptions: Schema.Array(');

    const createHandler = eventHandlers.slice(
      eventHandlers.indexOf("'platform.events.create'"),
      eventHandlers.indexOf("'platform.events.findOne'"),
    );
    expect(createHandler).toContain('lockTenantRoleGraph(');
    expect(createHandler.indexOf('lockTenantRoleGraph')).toBeLessThan(
      createHandler.indexOf('const creatorMemberships'),
    );
    expect(eventHandlers).toContain('updatePlatformEventGraph(');
    expect(eventEditor).toContain('Draft event editor');
    expect(eventEditor).toContain('<mat-panel-title>Add-ons</mat-panel-title>');
    expect(eventEditor).toContain(
      '<mat-panel-title>Registration questions</mat-panel-title>',
    );

    expect(registrationHandlers).toContain('executiveUserId: null');
    expect(registrationHandlers).toContain(
      "cancelledBy: 'platformAdministrator'",
    );
    expect(registrationHandlers).toContain('enforceParticipantDeadline: false');
    expect(registrationHandlers).toContain("action: 'registration.approve'");
    expect(registrationHandlers).toContain("action: 'registration.cancel'");
    expect(scanner).toContain('registrationIdFromPlatformScannerInput');
    expect(scanner).not.toContain('getUserMedia');
  });
});
