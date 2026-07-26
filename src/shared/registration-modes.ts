export const registrationModes = ['fcfs', 'application'] as const;

export type RegistrationMode = (typeof registrationModes)[number];

export const registrationModeLabels: Record<RegistrationMode, string> = {
  application: 'Manual approval',
  fcfs: 'First come, first served',
};

export const registrationModeLabel = (mode: RegistrationMode) =>
  registrationModeLabels[mode];
