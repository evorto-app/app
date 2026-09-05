import { describe, expect, it } from 'vitest';

import {
  type RegistrationMode,
  registrationModeLabel,
  registrationModeLabels,
  registrationModes,
} from './registration-modes';

describe('registrationModeLabel', () => {
  it('renders readable labels for every registration mode', () => {
    const modes: readonly RegistrationMode[] = ['application', 'fcfs'];

    expect(Object.keys(registrationModeLabels).toSorted()).toEqual(
      [...modes].toSorted(),
    );
    expect(modes.map((mode) => registrationModeLabel(mode))).toEqual([
      'Manual approval',
      'First come, first served',
    ]);
    expect(registrationModes).toEqual(['fcfs', 'application']);
  });
});
