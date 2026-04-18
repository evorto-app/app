import { DateTime } from 'luxon';

const resolvePinnedNow = (): DateTime | undefined => {
  const value = process.env['E2E_NOW_ISO']?.trim();
  if (!value) {
    return undefined;
  }

  const parsed = DateTime.fromISO(value, { zone: 'utc' });
  if (!parsed.isValid) {
    throw new Error(
      `Invalid E2E_NOW_ISO value "${value}": ${parsed.invalidExplanation ?? parsed.invalidReason ?? 'unknown reason'}`,
    );
  }

  return parsed;
};

export const getSeedDateTime = (date?: Date) => {
  if (date) {
    return DateTime.fromJSDate(date, { zone: 'utc' }).startOf('day');
  }

  const pinnedNow = resolvePinnedNow();
  if (pinnedNow) {
    return pinnedNow.startOf('day');
  }

  return DateTime.now().setZone('utc').startOf('day');
};

export const getSeedDate = (date?: Date) => {
  return getSeedDateTime(date).toJSDate();
};

export const getSeedDayKey = (date?: Date) => {
  return getSeedDateTime(date).toFormat('yyyy-LL-dd');
};
