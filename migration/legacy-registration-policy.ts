export interface LegacyRegistrationPolicy {
  readonly cancellationDeadlineHoursBeforeStart: number;
  readonly refundFeesOnCancellation: boolean;
  readonly transferDeadlineHoursBeforeStart: null | number;
}

const POSTGRES_INTEGER_MAX = 2_147_483_647;

type LegacyRegistrationKind = 'organizers' | 'participants';

interface LegacyOrganizerDeRegistrationSettings {
  readonly cancellationDeadlineHoursBeforeStart: number;
  readonly deRegistrationPossible: boolean;
  readonly refundFeesOnDeRegistration: boolean;
}

interface LegacyParticipantDeRegistrationSettings extends LegacyOrganizerDeRegistrationSettings {
  readonly movePossible: boolean;
  readonly refundFeesOnMove: boolean;
  readonly transferDeadlineHoursBeforeStart: number;
}

interface LegacyDeRegistrationConfig {
  readonly organizers: LegacyOrganizerDeRegistrationSettings;
  readonly participants: LegacyParticipantDeRegistrationSettings;
}

interface LegacyGlobalDeRegistrationConfig {
  readonly free: LegacyDeRegistrationConfig;
  readonly paid: LegacyDeRegistrationConfig;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (
  value: unknown,
  context: string,
): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`${context} has an invalid shape; migration is blocked.`);
  }
  return value;
};

const booleanSetting = (
  settings: Readonly<Record<string, unknown>>,
  key: string,
  defaultValue: boolean,
  context: string,
): boolean => {
  const value = settings[key];
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') {
    throw new Error(
      `${context}.${key} must be a boolean; migration is blocked.`,
    );
  }
  return value;
};

const daySettingInHours = (
  settings: Readonly<Record<string, unknown>>,
  key: string,
  defaultValue: number,
  context: string,
): number => {
  const configuredValue = settings[key];
  const value = configuredValue === undefined ? defaultValue : configuredValue;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `${context}.${key} must be a nonnegative safe integer; migration is blocked.`,
    );
  }

  const hours = value * 24;
  if (!Number.isSafeInteger(hours) || hours > POSTGRES_INTEGER_MAX) {
    throw new Error(
      `${context}.${key} cannot be represented as target integer hours; migration is blocked.`,
    );
  }
  return hours;
};

const settingsRecord = (value: unknown, context: string) =>
  value === undefined ? {} : requireRecord(value, context);

const decodeOrganizerSettings = (
  value: unknown,
  context: string,
): LegacyOrganizerDeRegistrationSettings => {
  const settings = settingsRecord(value, context);
  return {
    cancellationDeadlineHoursBeforeStart: daySettingInHours(
      settings,
      'minimumDaysForDeRegistration',
      5,
      context,
    ),
    deRegistrationPossible: booleanSetting(
      settings,
      'deRegistrationPossible',
      true,
      context,
    ),
    refundFeesOnDeRegistration: booleanSetting(
      settings,
      'refundFeesOnDeRegistration',
      true,
      context,
    ),
  };
};

const decodeParticipantSettings = (
  value: unknown,
  context: string,
): LegacyParticipantDeRegistrationSettings => {
  const settings = settingsRecord(value, context);
  return {
    ...decodeOrganizerSettings(settings, context),
    movePossible: booleanSetting(settings, 'movePossible', true, context),
    refundFeesOnMove: booleanSetting(
      settings,
      'refundFeesOnMove',
      true,
      context,
    ),
    transferDeadlineHoursBeforeStart: daySettingInHours(
      settings,
      'minimumDaysForMove',
      0,
      context,
    ),
  };
};

const decodeDeRegistrationConfig = (
  value: unknown,
  context: string,
): LegacyDeRegistrationConfig => {
  const config = settingsRecord(value, context);
  return {
    organizers: decodeOrganizerSettings(
      config['organizers'],
      `${context}.organizers`,
    ),
    participants: decodeParticipantSettings(
      config['participants'],
      `${context}.participants`,
    ),
  };
};

const decodeGlobalDeRegistrationConfig = (
  tenantSettings: unknown,
  context: string,
): LegacyGlobalDeRegistrationConfig => {
  const settings = requireRecord(tenantSettings, `${context}.settings`);
  const options = settingsRecord(
    settings['deRegistrationOptions'],
    `${context}.settings.deRegistrationOptions`,
  );
  return {
    free: decodeDeRegistrationConfig(
      options['free'],
      `${context}.settings.deRegistrationOptions.free`,
    ),
    paid: decodeDeRegistrationConfig(
      options['paid'],
      `${context}.settings.deRegistrationOptions.paid`,
    ),
  };
};

export const assertLegacyDeregistrationSupported = (
  disableDeregistration: boolean,
  context: string,
): void => {
  if (disableDeregistration) {
    throw new Error(
      `${context} disables de-registration at event level, which has no target representation; migration is blocked.`,
    );
  }
};

export const legacyRegistrationPolicy = ({
  context,
  eventSettings,
  registrationMode,
  registrationType,
  tenantSettings,
}: {
  readonly context: string;
  readonly eventSettings: unknown;
  readonly registrationMode: string;
  readonly registrationType: LegacyRegistrationKind;
  readonly tenantSettings: unknown;
}): LegacyRegistrationPolicy => {
  if (registrationMode !== 'ONLINE' && registrationMode !== 'STRIPE') {
    throw new Error(
      `${context} has unsupported registration mode ${registrationMode}; migration is blocked.`,
    );
  }

  const eventConfig =
    eventSettings === null || eventSettings === undefined
      ? null
      : decodeDeRegistrationConfig(
          eventSettings,
          `${context}.deRegistrationSettings`,
        );
  const config =
    eventConfig ??
    decodeGlobalDeRegistrationConfig(tenantSettings, context)[
      registrationMode === 'STRIPE' ? 'paid' : 'free'
    ];
  if (registrationType === 'organizers') {
    const settings = config.organizers;
    if (!settings.deRegistrationPossible) {
      throw new Error(
        `${context} disables organizers de-registration, which has no target representation; migration is blocked.`,
      );
    }
    return {
      cancellationDeadlineHoursBeforeStart:
        settings.cancellationDeadlineHoursBeforeStart,
      refundFeesOnCancellation: settings.refundFeesOnDeRegistration,
      transferDeadlineHoursBeforeStart: null,
    };
  }

  const settings = config.participants;
  if (!settings.deRegistrationPossible) {
    throw new Error(
      `${context} disables participants de-registration, which has no target representation; migration is blocked.`,
    );
  }
  if (!settings.movePossible) {
    throw new Error(
      `${context} disables participant moves, which has no target representation; migration is blocked.`,
    );
  }
  if (settings.refundFeesOnMove !== settings.refundFeesOnDeRegistration) {
    throw new Error(
      `${context} uses different participant refund policies for moves and de-registration, which has no target representation; migration is blocked.`,
    );
  }

  return {
    cancellationDeadlineHoursBeforeStart:
      settings.cancellationDeadlineHoursBeforeStart,
    refundFeesOnCancellation: settings.refundFeesOnDeRegistration,
    transferDeadlineHoursBeforeStart: settings.transferDeadlineHoursBeforeStart,
  };
};
