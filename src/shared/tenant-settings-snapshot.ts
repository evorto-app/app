import { Schema } from 'effect';

import { Tenant } from '../types/custom/tenant';
import { GoogleLocation } from '../types/location';

// Compare only fields the corresponding form can overwrite. Unrelated tenant
// changes must not invalidate an edit; optional values have one wire form.
export const AdminTenantSettingsSnapshot = Schema.Struct({
  cancellationDeadlineHoursBeforeStart:
    Tenant.fields.cancellationDeadlineHoursBeforeStart,
  currency: Tenant.fields.currency,
  defaultLocation: Schema.NullOr(GoogleLocation),
  discountProviders: Tenant.fields.discountProviders,
  emailSenderEmail: Schema.NullOr(Schema.String),
  emailSenderName: Schema.NullOr(Schema.String),
  faviconUrl: Schema.NullOr(Schema.String),
  legalNoticeText: Schema.NullOr(Schema.String),
  legalNoticeUrl: Schema.NullOr(Schema.String),
  logoUrl: Schema.NullOr(Schema.String),
  maxActiveRegistrationsPerUser: Tenant.fields.maxActiveRegistrationsPerUser,
  receiptSettings: Tenant.fields.receiptSettings,
  refundFeesOnCancellation: Tenant.fields.refundFeesOnCancellation,
  seoDescription: Schema.NullOr(Schema.String),
  seoTitle: Schema.NullOr(Schema.String),
  stripeAccountId: Schema.NullOr(Schema.String),
  termsText: Schema.NullOr(Schema.String),
  termsUrl: Schema.NullOr(Schema.String),
  theme: Tenant.fields.theme,
  timezone: Tenant.fields.timezone,
  transferDeadlineHoursBeforeStart:
    Tenant.fields.transferDeadlineHoursBeforeStart,
});
export type AdminTenantSettingsSnapshot = Schema.Schema.Type<
  typeof AdminTenantSettingsSnapshot
>;

export const adminTenantSettingsSnapshot = (
  tenant: Pick<Tenant, keyof typeof AdminTenantSettingsSnapshot.fields>,
): AdminTenantSettingsSnapshot => ({
  cancellationDeadlineHoursBeforeStart:
    tenant.cancellationDeadlineHoursBeforeStart,
  currency: tenant.currency,
  defaultLocation: tenant.defaultLocation ?? null,
  discountProviders: tenant.discountProviders,
  emailSenderEmail: tenant.emailSenderEmail ?? null,
  emailSenderName: tenant.emailSenderName ?? null,
  faviconUrl: tenant.faviconUrl ?? null,
  legalNoticeText: tenant.legalNoticeText ?? null,
  legalNoticeUrl: tenant.legalNoticeUrl ?? null,
  logoUrl: tenant.logoUrl ?? null,
  maxActiveRegistrationsPerUser: tenant.maxActiveRegistrationsPerUser,
  receiptSettings: tenant.receiptSettings,
  refundFeesOnCancellation: tenant.refundFeesOnCancellation,
  seoDescription: tenant.seoDescription ?? null,
  seoTitle: tenant.seoTitle ?? null,
  stripeAccountId: tenant.stripeAccountId ?? null,
  termsText: tenant.termsText ?? null,
  termsUrl: tenant.termsUrl ?? null,
  theme: tenant.theme,
  timezone: tenant.timezone,
  transferDeadlineHoursBeforeStart: tenant.transferDeadlineHoursBeforeStart,
});

export const PlatformTenantSettingsSnapshot = Schema.Struct({
  currency: Tenant.fields.currency,
  domain: Tenant.fields.domain,
  name: Tenant.fields.name,
  stripeAccountId: Schema.NullOr(Schema.String),
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
  stripeAccountId: tenant.stripeAccountId ?? null,
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
