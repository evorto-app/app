import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (path: string): string =>
  readFileSync(join(repositoryRoot, path), 'utf8');

const authoringSurfaces = [
  'src/app/events/event-edit/event-edit.ts',
  'src/app/templates/template-create/template-create.component.ts',
  'src/app/templates/template-edit/template-edit.component.ts',
  'src/app/templates/template-create-event/template-create-event.component.ts',
] as const;

describe('registration mode source constraints', () => {
  it('keeps event and template authoring limited to first-come-first-served', () => {
    for (const path of authoringSurfaces) {
      const source = readSource(path);

      expect(source).toContain('registrationModes');
      expect(source).toContain("['fcfs']");
      expect(source).not.toContain("['application'");
      expect(source).not.toContain("['random'");
      expect(source).not.toContain("'application', 'fcfs'");
      expect(source).not.toContain("'fcfs', 'random'");
    }
  });

  it('keeps persisted unsupported modes readable but out of the authoring default', () => {
    const labelSource = readSource('src/shared/registration-modes.ts');
    const formSource = readSource(
      'src/app/templates/shared/template-form/template-registration-option-form.utilities.ts',
    );

    expect(labelSource).toContain("application: 'Application review'");
    expect(labelSource).toContain("random: 'Random allocation'");
    expect(formSource).toContain("registrationMode: 'fcfs'");
    expect(formSource).not.toContain("registrationMode: 'application'");
    expect(formSource).not.toContain("registrationMode: 'random'");
  });
});
