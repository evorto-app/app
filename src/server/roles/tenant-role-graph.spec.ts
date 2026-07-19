import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { uniqueTenantRoleIds } from './tenant-role-graph';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

const readSource = (relativePath: string): string =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const occurrenceCount = (source: string, token: string): number =>
  source.split(token).length - 1;

describe('tenant role graph concurrency boundary', () => {
  it('deduplicates role IDs before tenant-scoped validation', () => {
    expect(uniqueTenantRoleIds(['role-b', 'role-a', 'role-b'])).toEqual([
      'role-a',
      'role-b',
    ]);
  });

  it('uses one transaction advisory lock and checks every role reference kind', () => {
    const source = readSource('src/server/roles/tenant-role-graph.ts');

    expect(source).toContain('pg_advisory_xact_lock');
    expect(source).toContain('evorto:tenant-role-graph:');
    expect(source).toContain('rolesToTenantUsers.roleId');
    expect(source).toContain('eventRegistrationOptions.roleIds');
    expect(source).toContain('templateRegistrationOptions.roleIds');
  });

  it('serializes ordinary and platform role mutations with the shared invariants', () => {
    const ordinary = readSource(
      'src/server/effect/rpc/handlers/admin.handlers.ts',
    );
    const platform = readSource(
      'src/server/effect/rpc/handlers/platform/platform-tenant-admin.handlers.ts',
    );

    expect(
      occurrenceCount(ordinary, 'lockTenantRoleGraph('),
    ).toBeGreaterThanOrEqual(3);
    expect(ordinary).toContain('ensureTenantRetainsAnotherDefaultUserRole(');
    expect(ordinary).toContain('ensureTenantRoleIsUnreferenced(');
    expect(
      occurrenceCount(platform, 'lockTenantRoleGraph('),
    ).toBeGreaterThanOrEqual(4);
    expect(platform).toContain('ensureTenantRetainsAnotherDefaultUserRole(');
    expect(platform).toContain('ensureTenantRoleIsUnreferenced(');
  });

  it('locks an ordinary target membership before replacing assignments', () => {
    const source = readSource(
      'src/server/effect/rpc/handlers/users.handlers.ts',
    );
    const assignment = source.slice(
      source.indexOf("'users.assignRoles'"),
      source.indexOf("'users.authData'"),
    );

    expect(assignment).toContain('lockTenantRoleGraph(tx, tenant.id)');
    expect(assignment).toContain('.select({ id: usersToTenants.id })');
    expect(assignment).toContain(".for('update')");
    expect(assignment.indexOf('lockTenantRoleGraph')).toBeLessThan(
      assignment.indexOf(".for('update')"),
    );
  });

  it('holds the role graph lock across ordinary template validation and writes', () => {
    const service = readSource(
      'src/server/effect/rpc/handlers/templates/simple-template.service.ts',
    );
    const handlers = readSource(
      'src/server/effect/rpc/handlers/templates.handlers.ts',
    );

    expect(occurrenceCount(service, 'lockTenantRoleGraph(')).toBe(2);
    expect(
      occurrenceCount(handlers, '.transaction((transaction)'),
    ).toBeGreaterThanOrEqual(2);
  });

  it('takes the role graph advisory lock before template rows in every authoring path', () => {
    const ordinaryTemplates = readSource(
      'src/server/effect/rpc/handlers/templates.handlers.ts',
    );
    const ordinaryUpdate = ordinaryTemplates.slice(
      ordinaryTemplates.indexOf("'templates.update':"),
      ordinaryTemplates.indexOf("'templates.updateSimpleTemplate':"),
    );
    expect(ordinaryUpdate).toContain('lockTenantRoleGraph(');
    expect(ordinaryUpdate).toContain(".for('update')");
    expect(ordinaryUpdate.indexOf('lockTenantRoleGraph(')).toBeLessThan(
      ordinaryUpdate.indexOf(".for('update')"),
    );

    const platformTemplates = readSource(
      'src/server/effect/rpc/handlers/platform/platform-templates.handlers.ts',
    );
    const platformCreate = platformTemplates.slice(
      platformTemplates.indexOf("'platform.templates.create':"),
      platformTemplates.indexOf("'platform.templates.findOne':"),
    );
    expect(platformCreate).toContain('lockTenantRoleGraph(');
    expect(platformCreate).toContain(
      'lockTenantCurrencyForFinancialConfiguration(',
    );
    expect(platformCreate.indexOf('lockTenantRoleGraph(')).toBeLessThan(
      platformCreate.indexOf('lockTenantCurrencyForFinancialConfiguration('),
    );

    const platformUpdate = platformTemplates.slice(
      platformTemplates.indexOf("'platform.templates.update':"),
    );
    expect(platformUpdate).toContain('lockTenantRoleGraph(');
    expect(platformUpdate).toContain(".for('update')");
    expect(platformUpdate.indexOf('lockTenantRoleGraph(')).toBeLessThan(
      platformUpdate.indexOf(".for('update')"),
    );

    const simpleTemplateService = readSource(
      'src/server/effect/rpc/handlers/templates/simple-template.service.ts',
    );
    const simpleUpdate = simpleTemplateService.slice(
      simpleTemplateService.indexOf('const updateSimpleTemplate'),
    );
    expect(simpleUpdate).toContain('lockTenantRoleGraph(');
    expect(simpleUpdate).toContain('.update(eventTemplates)');
    expect(simpleUpdate.indexOf('lockTenantRoleGraph(')).toBeLessThan(
      simpleUpdate.indexOf('.update(eventTemplates)'),
    );

    const events = readSource(
      'src/server/effect/rpc/handlers/events/events-lifecycle.handlers.ts',
    );
    const eventCreate = events.slice(
      events.indexOf('export const createEventGraph'),
      events.indexOf('const isExpectedEventCreateError'),
    );
    expect(eventCreate).toContain('lockTenantRoleGraph(');
    expect(eventCreate).toContain(".for('share')");
    expect(eventCreate.indexOf('lockTenantRoleGraph(')).toBeLessThan(
      eventCreate.indexOf(".for('share')"),
    );
  });

  it('holds the role graph lock across event option validation and writes', () => {
    const source = readSource(
      'src/server/effect/rpc/handlers/events/events-lifecycle.handlers.ts',
    );

    expect(
      occurrenceCount(source, 'lockTenantRoleGraph('),
    ).toBeGreaterThanOrEqual(2);
    expect(
      occurrenceCount(source, 'tenantRoleIdsExist('),
    ).toBeGreaterThanOrEqual(2);
  });

  it('locks platform event creation before establishing its transaction snapshot', () => {
    const source = readSource(
      'src/server/effect/rpc/handlers/platform/platform-events.handlers.ts',
    );
    const createHandler = source.slice(
      source.indexOf("'platform.events.create'"),
      source.indexOf("'platform.events.findOne'"),
    );

    expect(createHandler).toContain('lockTenantRoleGraph(');
    expect(createHandler.indexOf('lockTenantRoleGraph(')).toBeLessThan(
      createHandler.indexOf('const creatorMemberships'),
    );
    expect(createHandler).not.toContain("isolationLevel: 'repeatable read'");
  });
});
