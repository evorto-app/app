import { DateTime } from 'luxon';

import {
  type SupportedTenantCurrency,
  type SupportedTenantTimezone,
} from '../../types/custom/tenant';

interface TenantRuntimeConfig {
  tenantSignal(): null | {
    currency: SupportedTenantCurrency;
    timezone: SupportedTenantTimezone;
  };
}

type TenantRuntimeConfigurationField = 'currency' | 'timezone';

export class TenantRuntimeConfigurationUnavailableError extends Error {
  public constructor(field: TenantRuntimeConfigurationField) {
    super(
      `The organization ${field} is unavailable because the organization settings did not load.`,
    );
    this.name = 'TenantRuntimeConfigurationUnavailableError';
  }
}

const requireTenantRuntimeValue = <Value>(
  field: TenantRuntimeConfigurationField,
  value: null | undefined | Value,
): Value => {
  if (value === null || value === undefined) {
    throw new TenantRuntimeConfigurationUnavailableError(field);
  }

  return value;
};

export const resolveTenantRuntimeTimezone = (
  configuredTimezone: null | SupportedTenantTimezone | undefined,
): SupportedTenantTimezone =>
  requireTenantRuntimeValue('timezone', configuredTimezone);

export const tenantDatePipeTimezone = (
  config: TenantRuntimeConfig,
): SupportedTenantTimezone =>
  resolveTenantRuntimeTimezone(config.tenantSignal()?.timezone);

export const tenantCurrencyCode = (
  config: TenantRuntimeConfig,
): SupportedTenantCurrency =>
  requireTenantRuntimeValue('currency', config.tenantSignal()?.currency);

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
