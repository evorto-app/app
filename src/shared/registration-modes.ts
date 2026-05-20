export type RegistrationMode = 'application' | 'fcfs' | 'random';

export const registrationModeLabels: Record<RegistrationMode, string> = {
  application: 'Application review',
  fcfs: 'First come, first served',
  random: 'Random allocation',
};

export const registrationModeLabel = (mode: RegistrationMode): string =>
  registrationModeLabels[mode];
