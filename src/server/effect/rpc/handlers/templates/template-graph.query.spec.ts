import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';

import { getRequiredTemplateRole } from './template-graph.query';

const readSource = (file: string) =>
  readFileSync(new URL(file, import.meta.url), 'utf8');

describe('tenant template graph query source guards', () => {
  it('scopes the root and every child query through the target tenant', () => {
    const source = readSource('template-graph.query.ts');

    expect(source).toContain('eq(eventTemplates.tenantId, tenantId)');
    expect(source).toContain('eq(roles.tenantId, tenantId)');
    expect(
      source.match(/eq\(eventTemplates\.tenantId, tenantId\)/g),
    ).toHaveLength(6);
    expect(source).not.toContain('targetTenantId');
  });

  it('is the single graph loader used by ordinary and platform handlers', () => {
    const ordinarySource = readSource('../templates.handlers.ts');
    const platformEventSource = readSource(
      '../platform/platform-events.handlers.ts',
    );
    const platformTemplateSource = readSource(
      '../platform/platform-templates.handlers.ts',
    );

    expect(ordinarySource).toContain('loadTemplateGraphDetail');
    expect(platformEventSource).toContain('loadTemplateGraphDetail');
    expect(platformTemplateSource).toContain('loadTemplateGraphDetail');
    expect(platformTemplateSource).not.toContain('loadPlatformTemplateDetail');
  });

  it('surfaces an unresolved persisted role instead of dropping it', () => {
    const rolesById = new Map([
      ['role-found', { id: 'role-found', name: 'Found role' }],
    ]);

    expect(
      getRequiredTemplateRole({
        optionId: 'option-1',
        roleId: 'role-found',
        rolesById,
        templateId: 'template-1',
      }),
    ).toEqual({ id: 'role-found', name: 'Found role' });
    expect(() =>
      getRequiredTemplateRole({
        optionId: 'option-1',
        roleId: 'role-missing',
        rolesById,
        templateId: 'template-1',
      }),
    ).toThrowError(
      'Persisted template template-1 registration option option-1 references missing tenant role role-missing',
    );
  });
});
