import { describe, expect, it } from 'vitest';

import { registrationModes as databaseRegistrationModes } from '../../src/db/schema/global-enums';
import {
  registrationModeLabels,
  registrationModes,
} from '../../src/shared/registration-modes';

describe('registration mode contract', () => {
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
