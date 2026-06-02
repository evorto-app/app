import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const roleSelectTemplate = (): string =>
  readFileSync(
    nodePath.join(
      process.cwd(),
      'src/app/shared/components/controls/role-select/role-select.component.html',
    ),
    'utf8',
  );

describe('RoleSelect template', () => {
  it('renders selected-role chips through explicit query states', () => {
    const template = roleSelectTemplate();

    expect(template).toContain('roleQuery.isSuccess()');
    expect(template).toContain('roleQuery.data().name');
    expect(template).toContain('roleQuery.isPending()');
    expect(template).toContain('Loading role ...');
    expect(template).toContain('Failed to load role');
    expect(template).toContain('selectedRoleTrackId(roleQuery, $index)');
    expect(template).toContain('selectedRoleLabel(roleQuery, $index)');
  });
});
