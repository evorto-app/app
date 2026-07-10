import { DateTime } from 'luxon';

import { DEFAULT_E2E_NOW_ISO } from '@shared/testing/deterministic-test-defaults';

const readServerNow = (): DateTime => {
  const nowIso = process.env['E2E_NOW_ISO']?.trim() || DEFAULT_E2E_NOW_ISO;
  const now = DateTime.fromISO(nowIso, { zone: 'utc' });

  if (!now.isValid) {
    throw new Error(
      `Invalid E2E_NOW_ISO value "${nowIso}": ${now.invalidExplanation ?? now.invalidReason ?? 'unknown reason'}`,
    );
  }

  return now;
};

export const latestServerOrWallNow = (): Date => {
  const serverNow = readServerNow();
  const wallNow = DateTime.utc();

  return (serverNow > wallNow ? serverNow : wallNow).toJSDate();
};

export const futureServerEventWindow = (
  options: {
    closeRegistrationInDays?: number;
    durationHours?: number;
    openRegistrationInDays?: number;
    startInDays?: number;
  } = {},
): {
  closeRegistrationTime: Date;
  end: Date;
  openRegistrationTime: Date;
  start: Date;
} => {
  const serverNow = readServerNow();
  const wallNow = DateTime.utc();
  const latestNow = serverNow > wallNow ? serverNow : wallNow;
  const earliestNow = serverNow < wallNow ? serverNow : wallNow;
  const startInDays = options.startInDays ?? 7;
  const start = latestNow.plus({ days: startInDays });
  const closeRegistrationInDays =
    options.closeRegistrationInDays ?? Math.max(1, startInDays - 2);

  return {
    closeRegistrationTime: latestNow
      .plus({ days: closeRegistrationInDays })
      .toJSDate(),
    end: start.plus({ hours: options.durationHours ?? 2 }).toJSDate(),
    openRegistrationTime: earliestNow
      .plus({ days: options.openRegistrationInDays ?? -1 })
      .toJSDate(),
    start: start.toJSDate(),
  };
};

export const serverNowUnixSeconds = (): number =>
  Math.floor(readServerNow().toSeconds());
