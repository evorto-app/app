import { Schema } from 'effect';

import { Tenant } from '../types/custom/tenant';
import { GoogleLocation } from '../types/location';

// Compare exactly the persisted fields owned by each form. Other settings pages
// may save independently; optional values have one wire representation.
export const AdminTenantAppearanceSettingsSnapshot = Schema.Struct({
  faviconUrl: Schema.NullOr(Schema.String),
  logoUrl: Schema.NullOr(Schema.String),
  seoDescription: Schema.NullOr(Schema.String),
  seoTitle: Schema.NullOr(Schema.String),
  theme: Tenant.fields.theme,
});
export type AdminTenantAppearanceSettingsSnapshot = Schema.Schema.Type<
  typeof AdminTenantAppearanceSettingsSnapshot
>;

export const adminTenantAppearanceSettingsSnapshot = (
  tenant: Pick<
    Tenant,
    keyof typeof AdminTenantAppearanceSettingsSnapshot.fields
  >,
): AdminTenantAppearanceSettingsSnapshot => ({
  faviconUrl: tenant.faviconUrl ?? null,
  logoUrl: tenant.logoUrl ?? null,
  seoDescription: tenant.seoDescription ?? null,
  seoTitle: tenant.seoTitle ?? null,
  theme: tenant.theme,
});

export const AdminTenantLegalSettingsSnapshot = Schema.Struct({
  legalNoticeText: Schema.NullOr(Schema.String),
  legalNoticeUrl: Schema.NullOr(Schema.String),
  termsText: Schema.NullOr(Schema.String),
  termsUrl: Schema.NullOr(Schema.String),
});
export type AdminTenantLegalSettingsSnapshot = Schema.Schema.Type<
  typeof AdminTenantLegalSettingsSnapshot
>;

export const adminTenantLegalSettingsSnapshot = (
  tenant: Pick<Tenant, keyof typeof AdminTenantLegalSettingsSnapshot.fields>,
): AdminTenantLegalSettingsSnapshot => ({
  legalNoticeText: tenant.legalNoticeText ?? null,
  legalNoticeUrl: tenant.legalNoticeUrl ?? null,
  termsText: tenant.termsText ?? null,
  termsUrl: tenant.termsUrl ?? null,
});

export const AdminTenantOrganizationSettingsSnapshot = Schema.Struct({
  defaultLocation: Schema.NullOr(GoogleLocation),
  emailSenderEmail: Schema.NullOr(Schema.String),
  emailSenderName: Schema.NullOr(Schema.String),
  timezone: Tenant.fields.timezone,
});
export type AdminTenantOrganizationSettingsSnapshot = Schema.Schema.Type<
  typeof AdminTenantOrganizationSettingsSnapshot
>;

export const adminTenantOrganizationSettingsSnapshot = (
  tenant: Pick<
    Tenant,
    keyof typeof AdminTenantOrganizationSettingsSnapshot.fields
  >,
): AdminTenantOrganizationSettingsSnapshot => ({
  defaultLocation: tenant.defaultLocation ?? null,
  emailSenderEmail: tenant.emailSenderEmail ?? null,
  emailSenderName: tenant.emailSenderName ?? null,
  timezone: tenant.timezone,
});

export const AdminTenantPaymentProviderSettingsSnapshot = Schema.Struct({
  currency: Tenant.fields.currency,
  discountProviders: Tenant.fields.discountProviders,
  receiptSettings: Tenant.fields.receiptSettings,
  refundFeesOnCancellation: Tenant.fields.refundFeesOnCancellation,
});
export type AdminTenantPaymentProviderSettingsSnapshot = Schema.Schema.Type<
  typeof AdminTenantPaymentProviderSettingsSnapshot
>;

export const adminTenantPaymentProviderSettingsSnapshot = (
  tenant: Pick<
    Tenant,
    keyof typeof AdminTenantPaymentProviderSettingsSnapshot.fields
  >,
): AdminTenantPaymentProviderSettingsSnapshot => ({
  currency: tenant.currency,
  discountProviders: tenant.discountProviders,
  receiptSettings: tenant.receiptSettings,
  refundFeesOnCancellation: tenant.refundFeesOnCancellation,
});

export const AdminTenantRegistrationSettingsSnapshot = Schema.Struct({
  cancellationDeadlineHoursBeforeStart:
    Tenant.fields.cancellationDeadlineHoursBeforeStart,
  maxActiveRegistrationsPerUser: Tenant.fields.maxActiveRegistrationsPerUser,
  transferDeadlineHoursBeforeStart:
    Tenant.fields.transferDeadlineHoursBeforeStart,
});
export type AdminTenantRegistrationSettingsSnapshot = Schema.Schema.Type<
  typeof AdminTenantRegistrationSettingsSnapshot
>;

export const adminTenantRegistrationSettingsSnapshot = (
  tenant: Pick<
    Tenant,
    keyof typeof AdminTenantRegistrationSettingsSnapshot.fields
  >,
): AdminTenantRegistrationSettingsSnapshot => ({
  cancellationDeadlineHoursBeforeStart:
    tenant.cancellationDeadlineHoursBeforeStart,
  maxActiveRegistrationsPerUser: tenant.maxActiveRegistrationsPerUser,
  transferDeadlineHoursBeforeStart: tenant.transferDeadlineHoursBeforeStart,
});

export const PlatformTenantSettingsSnapshot = Schema.Struct({
  currency: Tenant.fields.currency,
  domain: Tenant.fields.domain,
  name: Tenant.fields.name,
  theme: Tenant.fields.theme,
  timezone: Tenant.fields.timezone,
});
export type PlatformTenantSettingsSnapshot = Schema.Schema.Type<
  typeof PlatformTenantSettingsSnapshot
>;

export const platformTenantSettingsSnapshot = (
  tenant: Pick<Tenant, keyof typeof PlatformTenantSettingsSnapshot.fields>,
): PlatformTenantSettingsSnapshot => ({
  currency: tenant.currency,
  domain: tenant.domain,
  name: tenant.name,
  theme: tenant.theme,
  timezone: tenant.timezone,
});

export class TenantSettingsConflictError extends Schema.TaggedErrorClass<TenantSettingsConflictError>()(
  'TenantSettingsConflictError',
  { message: Schema.String },
) {}

export const tenantSettingsConflict = () =>
  new TenantSettingsConflictError({
    message:
      'Organization settings changed since you opened this form. Reload the latest settings before saving. Your unsaved edits have been kept.',
  });
