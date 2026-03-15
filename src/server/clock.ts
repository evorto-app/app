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
      `Invalid E2E_NOW_ISO value "${normalizedPinnedNowIso}": ${parsed.invalidExplanation ?? parsed.invalidReason ?? 'unknown reason'}`,
    );
  }

  return parsed;
};

export const getServerNow = (
  pinnedNowIso: string | undefined,
): DateTime => resolvePinnedNow(pinnedNowIso) ?? DateTime.now().setZone('utc');
