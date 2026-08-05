import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';

import {
  getRequiredTemplateRole,
  templateGraphNotFoundError,
} from './template-graph.query';

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

  it('does not expose template identifiers or storage scope when a template is missing', () => {
    const error = templateGraphNotFoundError();

    expect(templateGraphNotFoundError).toHaveLength(0);
    expect(error.message).toBe(
      'This template no longer exists in this organization. No changes were made. Return to Templates and choose an existing template.',
    );
    expect(error.message).not.toMatch(/\b(?:id|tenant|target)\b/iu);
  });

  it('keeps platform event validation messages in product language', () => {
    const source = readSource('../platform/platform-events.handlers.ts');

    expect(source).not.toContain('was not found for the target tenant');
    expect(source).not.toContain('preconditions changed');
    expect(source).not.toContain('registration-option identity set');
    expect(source).toContain(
      'The sign-up choices changed while this page was open.',
    );
  });
});
