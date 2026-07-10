import type { DatePipeConfig } from '@angular/common';

import { DateTime } from 'luxon';

import {
  DEFAULT_TENANT_TIMEZONE,
  type SupportedTenantCurrency,
  type SupportedTenantTimezone,
} from '../../types/custom/tenant';

interface TenantRuntimeConfig {
  tenantSignal(): null | {
    currency?: SupportedTenantCurrency;
    timezone?: string;
  };
}

export const resolveTenantRuntimeTimezone = (
  configuredTimezone: null | string | undefined,
): SupportedTenantTimezone => configuredTimezone ?? DEFAULT_TENANT_TIMEZONE;

export const tenantDatePipeConfig = (
  config: TenantRuntimeConfig,
): DatePipeConfig => ({
  timezone: resolveTenantRuntimeTimezone(config.tenantSignal()?.timezone),
});

export const tenantCurrencyCode = (
  config: TenantRuntimeConfig,
): SupportedTenantCurrency => config.tenantSignal()?.currency ?? 'EUR';

export const toTenantDateTime = (
  value: Date | DateTime,
  timezone: SupportedTenantTimezone,
): DateTime =>
  (value instanceof Date ? DateTime.fromJSDate(value) : value).setZone(
    timezone,
  );

export const tenantNow = (
  timezone: SupportedTenantTimezone,
  now: DateTime = DateTime.now(),
): DateTime => now.setZone(timezone);
