import { formatDate } from '@angular/common';
import {
  inject,
  InjectionToken,
  LOCALE_ID,
  Pipe,
  type PipeTransform,
} from '@angular/core';
import { DateTime, FixedOffsetZone } from 'luxon';

import {
  DEFAULT_TENANT_TIMEZONE,
  type SupportedTenantTimezone,
} from '../../types/custom/tenant';

const fixedOffsetTimezonePattern = /^([+-])(\d{2}):?(\d{2})$/;
const numericDatePattern = /^-?\d+(?:\.\d+)?$/;

export const TENANT_DATE_PIPE_TIMEZONE =
  new InjectionToken<SupportedTenantTimezone>('TENANT_DATE_PIPE_TIMEZONE', {
    factory: () => DEFAULT_TENANT_TIMEZONE,
    providedIn: 'root',
  });

const resolveLuxonZone = (timezone: string) => {
  const fixedOffsetMatch = fixedOffsetTimezonePattern.exec(timezone);
  if (!fixedOffsetMatch) {
    return timezone;
  }

  const [, sign, hours, minutes] = fixedOffsetMatch;
  const offsetMinutes = Number(hours) * 60 + Number(minutes);
  return FixedOffsetZone.instance(
    sign === '-' ? -offsetMinutes : offsetMinutes,
  );
};

const parseDateValue = (
  value: Date | number | string,
  zone: ReturnType<typeof resolveLuxonZone>,
): DateTime => {
  if (value instanceof Date) {
    return DateTime.fromJSDate(value);
  }
  if (typeof value === 'number') {
    return DateTime.fromMillis(value);
  }
  if (numericDatePattern.test(value)) {
    return DateTime.fromMillis(Number(value));
  }

  return DateTime.fromISO(value, { setZone: true, zone });
};

@Pipe({
  name: 'date',
})
export class TenantDatePipe implements PipeTransform {
  private readonly defaultLocale = inject(LOCALE_ID);
  private readonly defaultTimezone = inject(TENANT_DATE_PIPE_TIMEZONE);

  transform(
    value: Date | number | string,
    format?: string,
    timezone?: string,
    locale?: string,
  ): null | string;
  transform(
    value: null | undefined,
    format?: string,
    timezone?: string,
    locale?: string,
  ): null;
  transform(
    value: Date | null | number | string | undefined,
    format = 'mediumDate',
    timezone = this.defaultTimezone,
    locale = this.defaultLocale,
  ): null | string {
    if (
      value === null ||
      value === undefined ||
      value === '' ||
      (typeof value === 'number' && Number.isNaN(value))
    ) {
      return null;
    }

    const zone = resolveLuxonZone(timezone);
    const dateTime = parseDateValue(value, zone).setZone(zone);
    if (!dateTime.isValid) {
      throw new Error(
        `TenantDatePipe: Unable to convert "${String(value)}" into a date.`,
      );
    }

    return formatDate(
      dateTime.toMillis(),
      format,
      locale,
      dateTime.toFormat('ZZ'),
    );
  }
}
