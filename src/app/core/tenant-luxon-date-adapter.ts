import { inject, Injectable } from '@angular/core';
import { LuxonDateAdapter } from '@angular/material-luxon-adapter';
import { DateTime } from 'luxon';

import { type SupportedTenantTimezone } from '../../types/custom/tenant';
import { ConfigService } from './config.service';
import { resolveTenantRuntimeTimezone } from './tenant-runtime';

@Injectable()
export class TenantLuxonDateAdapter extends LuxonDateAdapter {
  private readonly config = inject(ConfigService);

  private get dateTimeOptions(): {
    locale: string;
    outputCalendar: 'gregory';
    zone: string;
  } {
    return {
      locale: this.locale,
      outputCalendar: 'gregory',
      zone: this.timezone,
    };
  }

  private get timezone(): SupportedTenantTimezone {
    return resolveTenantRuntimeTimezone(this.config.tenantSignal()?.timezone);
  }

  override clone(date: DateTime): DateTime {
    return DateTime.fromMillis(date.toMillis(), this.dateTimeOptions);
  }

  override createDate(year: number, month: number, date: number): DateTime {
    if (month < 0 || month > 11) {
      throw new Error(
        `Invalid month index "${month}". Month index has to be between 0 and 11.`,
      );
    }
    if (date < 1) {
      throw new Error(`Invalid date "${date}". Date has to be greater than 0.`);
    }

    const result = DateTime.fromObject(
      { day: date, month: month + 1, year },
      this.dateTimeOptions,
    );
    if (!this.isValid(result)) {
      throw new Error(
        `Invalid date "${date}". Reason: "${result.invalidReason}".`,
      );
    }

    return result;
  }

  override deserialize(value: unknown): DateTime | null {
    const options = this.dateTimeOptions;
    const date =
      value instanceof Date
        ? DateTime.fromJSDate(value, options)
        : typeof value === 'string' && value.length > 0
          ? DateTime.fromISO(value, options)
          : DateTime.isDateTime(value)
            ? DateTime.fromMillis(value.toMillis(), options)
            : null;

    if (date && this.isValid(date)) {
      return date;
    }
    if (value === '') {
      return null;
    }

    return super.deserialize(value);
  }

  override format(date: DateTime, displayFormat: string): string {
    if (!this.isValid(date)) {
      throw new Error('TenantLuxonDateAdapter: Cannot format an invalid date.');
    }

    return date
      .setZone(this.timezone)
      .setLocale(this.locale)
      .toFormat(displayFormat);
  }

  override parse(
    value: unknown,
    parseFormat: string | string[],
  ): DateTime | null {
    const options = this.dateTimeOptions;

    if (typeof value === 'string' && value.length > 0) {
      const iso8601Date = DateTime.fromISO(value, options);
      if (this.isValid(iso8601Date)) {
        return iso8601Date;
      }

      const formats = Array.isArray(parseFormat) ? parseFormat : [parseFormat];
      if (formats.length === 0) {
        throw new Error('Formats array must not be empty.');
      }
      for (const format of formats) {
        const fromFormat = DateTime.fromFormat(value, format, options);
        if (this.isValid(fromFormat)) {
          return fromFormat;
        }
      }
      return this.invalid();
    }
    if (typeof value === 'number') {
      return DateTime.fromMillis(value, options);
    }
    if (value instanceof Date) {
      return DateTime.fromJSDate(value, options);
    }
    if (DateTime.isDateTime(value)) {
      return DateTime.fromMillis(value.toMillis(), options);
    }

    return null;
  }

  override today(): DateTime {
    return DateTime.now().setZone(this.timezone).setLocale(this.locale);
  }
}
