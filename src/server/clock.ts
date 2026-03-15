import { DateTime } from 'luxon';

export const resolvePinnedNow = (
  pinnedNowIso: string | undefined,
): DateTime | undefined => {
  const normalizedPinnedNowIso = pinnedNowIso?.trim();
  if (!normalizedPinnedNowIso) {
    return undefined;
  }

  const parsed = DateTime.fromISO(normalizedPinnedNowIso, { zone: 'utc' });
  if (!parsed.isValid) {
    throw new Error(
      `Invalid pinnedNowIso value "${normalizedPinnedNowIso}": ${parsed.invalidExplanation ?? parsed.invalidReason ?? 'unknown reason'}`,
    );
  }

  return parsed;
};

export const getServerNow = (
  pinnedNowIso: string | undefined,
): DateTime => resolvePinnedNow(pinnedNowIso) ?? DateTime.utc();
