import { literalUnion } from '@shared/schema-utilities';
import { Schema } from 'effect';

import { Tenant } from '../types/custom/tenant';

export const platformTenantAuditActions = [
  'event.create',
  'event.review',
  'event.submitForReview',
  'event.update',
  'event.updateListing',
  'receipt.reimburse',
  'receipt.review',
  'refundClaim.requeue',
  'registration.approve',
  'registration.cancel',
  'registration.checkIn',
  'role.create',
  'role.delete',
  'role.update',
  'taxRates.import',
  'template.create',
  'template.update',
  'tenant.create',
  'tenant.update',
  'user.assignRoles',
] as const;

export const PlatformTenantAuditAction = literalUnion(
  ...platformTenantAuditActions,
);

export type PlatformTenantAuditAction = Schema.Schema.Type<
  typeof PlatformTenantAuditAction
>;

export const PlatformAuditResourceType = literalUnion(
  'event',
  'receipt',
  'refundClaim',
  'registration',
  'role',
  'taxRateBatch',
  'template',
  'tenant',
  'userRoleAssignment',
);

export const PlatformAuditSnapshot = Schema.Struct({
  resourceId: Schema.NonEmptyString,
  resourceType: PlatformAuditResourceType,
  state: Schema.Json,
});

export type PlatformAuditSnapshot = Schema.Schema.Type<
  typeof PlatformAuditSnapshot
>;

export class PlatformTenantAuditSnapshot extends Schema.Class<PlatformTenantAuditSnapshot>(
  'PlatformTenantAuditSnapshot',
)({
  canonicalRootUrl: Tenant.fields.canonicalRootUrl,
  currency: Tenant.fields.currency,
  domain: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  locale: Tenant.fields.locale,
  name: Schema.NonEmptyString,
  stripeAccountId: Schema.NullOr(Schema.String),
  stripeConnected: Schema.Boolean,
  theme: Tenant.fields.theme,
  timezone: Tenant.fields.timezone,
}) {}
