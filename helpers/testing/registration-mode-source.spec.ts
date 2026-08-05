import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (sourcePath: string): string =>
  readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');

const authoringSurfaces = [
  'src/app/events/event-edit/event-registration-option-editor.ts',
  'src/app/shared/components/forms/template-graph-editor/template-registration-option-editor.component.ts',
  'src/app/templates/template-create-event/template-create-event.component.ts',
] as const;

describe('registration mode source constraints', () => {
  it('uses the canonical registration modes in every authoring surface', () => {
    for (const path of authoringSurfaces) {
      const source = readSource(path);

      expect(source).toContain('registrationModes');
    }
  });

  it('keeps the database enum and labels aligned with the supported modes', () => {
    const sharedSource = readSource('src/shared/registration-modes.ts');
    const databaseSource = readSource('src/db/schema/global-enums.ts');

    expect(sharedSource).toContain("application: 'Manual approval'");
    expect(sharedSource).toContain("fcfs: 'First come, first served'");
    expect(sharedSource).toContain(
      "export const registrationModes = ['fcfs', 'application'] as const",
    );
    expect(databaseSource).toMatch(
      /pgEnum\('registration_mode',\s*\[\s*'fcfs',\s*'application',?\s*\]\)/,
    );
  });
});
