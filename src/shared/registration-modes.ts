export type RegistrationMode = 'application' | 'fcfs' | 'random';

export const registrationModeLabels: Record<RegistrationMode, string> = {
  application: 'Manual approval',
  fcfs: 'First come, first served',
  random: 'Unsupported random allocation',
};

export const writableRegistrationModes = [
  'fcfs',
  'application',
] as const satisfies readonly RegistrationMode[];

export type WritableRegistrationMode =
  (typeof writableRegistrationModes)[number];

export const registrationModeLabel = (mode: RegistrationMode) =>
  registrationModeLabels[mode];

export const isWritableRegistrationMode = (
  mode: RegistrationMode,
): mode is WritableRegistrationMode =>
  mode === 'fcfs' || mode === 'application';

export const requireWritableRegistrationMode = (
  mode: RegistrationMode,
): WritableRegistrationMode => {
  if (isWritableRegistrationMode(mode)) {
    return mode;
  }
  throw new Error(`Unsupported registration mode cannot be saved: ${mode}`);
};
