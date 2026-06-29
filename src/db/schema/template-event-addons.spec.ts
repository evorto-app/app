import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';

const readSource = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

describe('template event add-on schema', () => {
  it('keeps add-ons scoped to templates until event add-on fulfillment exists', () => {
    const schemaIndexSource = readSource('index.ts');
    const templateAddonSource = readSource('template-event-addons.ts');

    expect(schemaIndexSource).toContain(
      "export * from './template-event-addons'",
    );
    expect(templateAddonSource).toContain("pgTable('template_event_addons'");
    expect(schemaIndexSource).not.toContain("export * from './event-addons'");
  });

  it('does not expose registration-question schemas yet', () => {
    const schemaIndexSource = readSource('index.ts');

    expect(schemaIndexSource).not.toContain('registration-question');
    expect(schemaIndexSource).not.toContain('registration-questions');
  });
});
