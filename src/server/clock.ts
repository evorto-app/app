import { DateTime } from 'luxon';

const resolvePinnedNow = (): DateTime | undefined => {
  const raw = process.env['E2E_NOW_ISO']?.trim();
  if (!raw) {
    return undefined;
  }

  const parsed = DateTime.fromISO(raw, { zone: 'utc' });
  if (!parsed.isValid) {
    throw new Error(
      `Invalid E2E_NOW_ISO value "${raw}": ${parsed.invalidExplanation ?? parsed.invalidReason ?? 'unknown reason'}`,
    );
  }

  return parsed;
};

export const getServerNow = (): DateTime =>
  resolvePinnedNow() ?? DateTime.now().setZone('utc');
