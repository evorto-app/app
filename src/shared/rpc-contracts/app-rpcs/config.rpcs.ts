import { asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { PlatformAdministratorAuthority } from '../../../types/custom/platform-authority';
import { Tenant } from '../../../types/custom/tenant';
import { BadRequestRpcError } from '../../errors/rpc-errors';
import { PermissionSchema } from '../../permissions/permissions';

export class ClientTenantConfig extends Schema.Class<ClientTenantConfig>(
  'ClientTenantConfig',
)({
  cancellationDeadlineHoursBeforeStart:
    Tenant.fields.cancellationDeadlineHoursBeforeStart,
  currency: Tenant.fields.currency,
  defaultLocation: Tenant.fields.defaultLocation,
  discountProviders: Tenant.fields.discountProviders,
  domain: Tenant.fields.domain,
  emailSenderEmail: Tenant.fields.emailSenderEmail,
  emailSenderName: Tenant.fields.emailSenderName,
  faviconUrl: Tenant.fields.faviconUrl,
  id: Tenant.fields.id,
  legalNoticeText: Tenant.fields.legalNoticeText,
  legalNoticeUrl: Tenant.fields.legalNoticeUrl,
  logoUrl: Tenant.fields.logoUrl,
  maxActiveRegistrationsPerUser: Tenant.fields.maxActiveRegistrationsPerUser,
  name: Tenant.fields.name,
  paymentsConfigured: Schema.Boolean,
  privacyPolicyText: Tenant.fields.privacyPolicyText,
  privacyPolicyUrl: Tenant.fields.privacyPolicyUrl,
  receiptSettings: Tenant.fields.receiptSettings,
  refundFeesOnCancellation: Tenant.fields.refundFeesOnCancellation,
  seoDescription: Tenant.fields.seoDescription,
  seoTitle: Tenant.fields.seoTitle,
  termsText: Tenant.fields.termsText,
  termsUrl: Tenant.fields.termsUrl,
  theme: Tenant.fields.theme,
  timezone: Tenant.fields.timezone,
  transferDeadlineHoursBeforeStart:
    Tenant.fields.transferDeadlineHoursBeforeStart,
}) {}

export const toClientTenantConfig = (tenant: Tenant): ClientTenantConfig =>
  new ClientTenantConfig({
    cancellationDeadlineHoursBeforeStart:
      tenant.cancellationDeadlineHoursBeforeStart,
    currency: tenant.currency,
    defaultLocation: tenant.defaultLocation,
    discountProviders: tenant.discountProviders,
    domain: tenant.domain,
    emailSenderEmail: tenant.emailSenderEmail,
    emailSenderName: tenant.emailSenderName,
    faviconUrl: tenant.faviconUrl,
    id: tenant.id,
    legalNoticeText: tenant.legalNoticeText,
    legalNoticeUrl: tenant.legalNoticeUrl,
    logoUrl: tenant.logoUrl,
    maxActiveRegistrationsPerUser: tenant.maxActiveRegistrationsPerUser,
    name: tenant.name,
    paymentsConfigured: Boolean(tenant.stripeAccountId),
    privacyPolicyText: tenant.privacyPolicyText,
    privacyPolicyUrl: tenant.privacyPolicyUrl,
    receiptSettings: tenant.receiptSettings,
    refundFeesOnCancellation: tenant.refundFeesOnCancellation,
    seoDescription: tenant.seoDescription,
    seoTitle: tenant.seoTitle,
    termsText: tenant.termsText,
    termsUrl: tenant.termsUrl,
    theme: tenant.theme,
    timezone: tenant.timezone,
    transferDeadlineHoursBeforeStart: tenant.transferDeadlineHoursBeforeStart,
  });

export const PublicConfig = Schema.Struct({
  googleMapsApiKey: Schema.NullOr(Schema.NonEmptyString),
});

export type PublicConfig = Schema.Schema.Type<typeof PublicConfig>;

export const ConfigPermissions = Schema.Array(PermissionSchema);

export type ConfigPermissions = Schema.Schema.Type<typeof ConfigPermissions>;

export const ConfigHeaderRpcError = BadRequestRpcError;

export type ConfigHeaderRpcError = BadRequestRpcError;

export const ConfigPublic = asRpcQuery(
  Rpc.make('config.public', {
    payload: Schema.Void,
    success: PublicConfig,
  }),
);

export const ConfigIsAuthenticated = asRpcQuery(
  Rpc.make('config.isAuthenticated', {
    payload: Schema.Void,
    success: Schema.Boolean,
  }),
);

export const ConfigPermissionList = asRpcQuery(
  Rpc.make('config.permissions', {
    error: ConfigHeaderRpcError,
    payload: Schema.Void,
    success: ConfigPermissions,
  }),
);

export const ConfigPlatformAuthority = asRpcQuery(
  Rpc.make('config.platformAuthority', {
    error: ConfigHeaderRpcError,
    payload: Schema.Void,
    success: Schema.NullOr(PlatformAdministratorAuthority),
  }),
);

export const ConfigTenant = asRpcQuery(
  Rpc.make('config.tenant', {
    error: ConfigHeaderRpcError,
    payload: Schema.Void,
    success: ClientTenantConfig,
  }),
);

export class ConfigRpcs extends RpcGroup.make(
  ConfigPublic,
  ConfigIsAuthenticated,
  ConfigPermissionList,
  ConfigPlatformAuthority,
  ConfigTenant,
) {}
