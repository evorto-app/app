import { describe, expect, it } from 'vitest';

import {
  type RegistrationMode,
  registrationModeLabel,
  registrationModeLabels,
  writableRegistrationModes,
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
      'Manual approval',
      'First come, first served',
      'Unsupported random allocation',
    ]);
  });

  it('keeps unsupported random allocation out of writable modes', () => {
    expect(writableRegistrationModes).toEqual(['fcfs', 'application']);
  });
});
