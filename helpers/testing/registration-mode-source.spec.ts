import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { registrationModes as databaseRegistrationModes } from '../../src/db/schema/global-enums';
import {
  registrationModeLabels,
  registrationModes,
} from '../../src/shared/registration-modes';

const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (sourcePath: string): string =>
  readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');

const authoringSurfaces = [
  'src/app/events/event-edit/event-registration-option-editor.ts',
  'src/app/shared/components/forms/template-graph-editor/template-registration-option-editor.component.ts',
  'src/app/templates/template-create-event/template-create-event.component.ts',
] as const;

describe('registration mode source constraints', () => {
  it('keeps event and template authoring on the shared supported modes', () => {
    for (const path of authoringSurfaces) {
      const source = readSource(path);

      expect(source).toContain('registrationModes');
      expect(source).not.toContain("['random'");
      expect(source).not.toContain("'fcfs', 'random'");
    }
  });

  it('aligns persisted modes, authoring choices and labels without retired values', () => {
    expect(databaseRegistrationModes.enumValues).toEqual(registrationModes);
    expect(registrationModes).toEqual(['fcfs', 'application']);
    expect(Object.keys(registrationModeLabels).toSorted()).toEqual(
      [...registrationModes].toSorted(),
    );
    expect(registrationModeLabels).toEqual({
      application: 'Manual approval',
      fcfs: 'First come, first served',
    });
  });
});
