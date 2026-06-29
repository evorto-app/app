import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';

const readSource = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

describe('legacy stabilization fields', () => {
  it('keeps displayInHub as the only active role hub visibility field', () => {
    const rolesSource = readSource('roles.ts');

    expect(rolesSource).toContain('displayInHub');
    expect(rolesSource).not.toContain('showInHub');
  });

  it('keeps the global migration step for removed production columns and enums', () => {
    const migrationSource = readSource(
      '../../../migration/steps/004_drop_legacy_stabilization_fields.ts',
    );

    expect(migrationSource).toContain('ALTER TABLE IF EXISTS "roles"');
    expect(migrationSource).toContain('DROP COLUMN IF EXISTS "showInHub"');
    expect(migrationSource).toContain(
      'ALTER TABLE IF EXISTS "event_registrations"',
    );
    expect(migrationSource).toContain('DROP COLUMN IF EXISTS "paymentStatus"');
    expect(migrationSource).toContain('DROP TYPE IF EXISTS "payment_status"');
  });

  it('runs the legacy cleanup before tenant-scoped migration work', () => {
    const migrationIndexSource = readSource('../../../migration/index.ts');

    expect(migrationIndexSource).toContain('dropLegacyStabilizationFields');
    expect(
      migrationIndexSource.indexOf('await dropLegacyStabilizationFields()'),
    ).toBeLessThan(migrationIndexSource.indexOf('await runForTenant('));
  });
});
