import { describe, expect, it } from 'vitest';

import {
  type RegistrationMode,
  registrationModeLabel,
  registrationModeLabels,
} from './registration-modes';

describe('registrationModeLabel', () => {
  it('renders readable labels for every persisted registration mode', () => {
    const modes: readonly RegistrationMode[] = [
      'application',
      'fcfs',
      'random',
    ];

    expect(Object.keys(registrationModeLabels).toSorted()).toEqual(
      [...modes].toSorted(),
    );
    expect(modes.map((mode) => registrationModeLabel(mode))).toEqual([
      'Application review',
      'First come, first served',
      'Random allocation',
    ]);
  });
});
