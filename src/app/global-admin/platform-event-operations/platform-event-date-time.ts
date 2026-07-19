import { DateTime } from 'luxon';

import type { SupportedTenantTimezone } from '../../../types/custom/tenant';

import { toTenantDateTime } from '../../core/tenant-runtime';

const dateTimeLocalFormat = "yyyy-MM-dd'T'HH:mm";
const displayDateTimeFormat = 'dd LLL yyyy, HH:mm';

export const platformEventInstantToLocalDateTime = (
  value: Date | string,
  timezone: SupportedTenantTimezone,
): string => {
  const instant =
    typeof value === 'string'
      ? DateTime.fromISO(value, { setZone: true })
      : DateTime.fromJSDate(value);
  if (!instant.isValid) return '';

  return toTenantDateTime(instant, timezone).toFormat(dateTimeLocalFormat);
};

export const platformEventInstantToDisplayDateTime = (
  value: Date | string,
  timezone: SupportedTenantTimezone,
): string => {
  const instant =
    typeof value === 'string'
      ? DateTime.fromISO(value, { setZone: true })
      : DateTime.fromJSDate(value);
  if (!instant.isValid) return '';

  return toTenantDateTime(instant, timezone)
    .setLocale('en')
    .toFormat(displayDateTimeFormat);
};

export const platformEventLocalDateTimeToInstant = (
  value: string,
  timezone: SupportedTenantTimezone,
): null | string => {
  const localDateTime = DateTime.fromFormat(value, dateTimeLocalFormat, {
    zone: timezone,
  });
  if (
    !localDateTime.isValid ||
    localDateTime.toFormat(dateTimeLocalFormat) !== value ||
    localDateTime.getPossibleOffsets().length !== 1
  ) {
    return null;
  }

  return localDateTime.toUTC().toJSDate().toISOString();
};

export const platformEventInstantRangeHasValidOrder = (
  start: string,
  end: string,
  allowEqual = false,
): boolean => {
  const startMillis = DateTime.fromISO(start, { setZone: true }).toMillis();
  const endMillis = DateTime.fromISO(end, { setZone: true }).toMillis();
  if (!Number.isFinite(startMillis) || !Number.isFinite(endMillis))
    return false;
  return allowEqual ? endMillis >= startMillis : endMillis > startMillis;
};

export const platformEventLocalDateTimeRangeHasValidOrder = (
  start: string,
  end: string,
  timezone: SupportedTenantTimezone,
): boolean | null => {
  const startInstant = platformEventLocalDateTimeToInstant(start, timezone);
  const endInstant = platformEventLocalDateTimeToInstant(end, timezone);
  return startInstant && endInstant
    ? platformEventInstantRangeHasValidOrder(startInstant, endInstant)
    : null;
};
