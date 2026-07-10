import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { notificationEmailPattern } from '@shared/notification-email';
import { literalUnion, nonNegativeNumber } from '@shared/schema-utilities';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { Tenant } from '../../../types/custom/tenant';
import { TenantRolePermissionSchema } from '../../permissions/permissions';
import { AdminRoleRpcError, AdminTenantRpcError } from './admin.errors';

const UrlString = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => {
      try {
        new URL(value.trim());
        return;
      } catch {
        return 'Expected a valid URL';
      }
    }),
  ),
);

const TenantBrandAssetUrlString = Schema.Union([
  Schema.String.pipe(
    Schema.check(
      Schema.makeFilter((value) => {
        const trimmedValue = value.trim();
        if (trimmedValue.startsWith('/tenant-assets/')) {
          return;
        }
        try {
          const url = new URL(trimmedValue);
          return url.protocol === 'http:' || url.protocol === 'https:'
            ? undefined
            : 'Expected an HTTP(S) tenant brand asset URL';
        } catch {
          return 'Expected a tenant brand asset URL';
        }
      }),
    ),
  ),
]);

const OptionalSenderEmail = Schema.NonEmptyString.check(
  Schema.isPattern(notificationEmailPattern),
);

export const AdminRoleRecord = Schema.Struct({
  collapseMembersInHup: Schema.Boolean,
  defaultOrganizerRole: Schema.Boolean,
  defaultUserRole: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  displayInHub: Schema.Boolean,
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  permissions: Schema.mutable(Schema.Array(TenantRolePermissionSchema)),
  sortOrder: Schema.Number,
});

export type AdminRoleRecord = Schema.Schema.Type<typeof AdminRoleRecord>;

export const AdminRolesFindManyInput = Schema.Struct({
  defaultOrganizerRole: Schema.optional(Schema.Boolean),
  defaultUserRole: Schema.optional(Schema.Boolean),
});

export type AdminRolesFindManyInput = Schema.Schema.Type<
  typeof AdminRolesFindManyInput
>;

export const AdminRolesFindMany = asRpcQuery(
  Rpc.make('admin.roles.findMany', {
    error: AdminRoleRpcError,
    payload: AdminRolesFindManyInput,
    success: Schema.Array(AdminRoleRecord),
  }),
);

export const AdminRolesFindOne = asRpcQuery(
  Rpc.make('admin.roles.findOne', {
    error: AdminRoleRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: AdminRoleRecord,
  }),
);

export const AdminHubRoleUserRecord = Schema.Struct({
  firstName: Schema.String,
  id: Schema.NonEmptyString,
  lastName: Schema.String,
});

export type AdminHubRoleUserRecord = Schema.Schema.Type<
  typeof AdminHubRoleUserRecord
>;

export const AdminHubRoleRecord = Schema.Struct({
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  name: Schema.String,
  userCount: Schema.Number,
  users: Schema.Array(AdminHubRoleUserRecord),
});

export type AdminHubRoleRecord = Schema.Schema.Type<typeof AdminHubRoleRecord>;

export const AdminRolesFindHubRoles = asRpcQuery(
  Rpc.make('admin.roles.findHubRoles', {
    error: AdminRoleRpcError,
    payload: Schema.Void,
    success: Schema.Array(AdminHubRoleRecord),
  }),
);

export const AdminRolesCreateInput = Schema.Struct({
  collapseMembersInHup: Schema.Boolean,
  defaultOrganizerRole: Schema.Boolean,
  defaultUserRole: Schema.Boolean,
  description: Schema.NullOr(Schema.NonEmptyString),
  displayInHub: Schema.Boolean,
  name: Schema.NonEmptyString,
  permissions: Schema.mutable(Schema.Array(TenantRolePermissionSchema)),
});

export type AdminRolesCreateInput = Schema.Schema.Type<
  typeof AdminRolesCreateInput
>;

export const AdminRolesCreate = asRpcMutation(
  Rpc.make('admin.roles.create', {
    error: AdminRoleRpcError,
    payload: AdminRolesCreateInput,
    success: AdminRoleRecord,
  }),
);

export const AdminRolesDelete = asRpcMutation(
  Rpc.make('admin.roles.delete', {
    error: AdminRoleRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const AdminRolesSearch = asRpcQuery(
  Rpc.make('admin.roles.search', {
    error: AdminRoleRpcError,
    payload: Schema.Struct({
      search: Schema.String,
    }),
    success: Schema.Array(AdminRoleRecord),
  }),
);

export const AdminRolesUpdateInput = Schema.Struct({
  ...AdminRolesCreateInput.fields,
  id: Schema.NonEmptyString,
});

export type AdminRolesUpdateInput = Schema.Schema.Type<
  typeof AdminRolesUpdateInput
>;

export const AdminRolesUpdate = asRpcMutation(
  Rpc.make('admin.roles.update', {
    error: AdminRoleRpcError,
    payload: AdminRolesUpdateInput,
    success: AdminRoleRecord,
  }),
);

export const AdminTenantTaxRateRecord = Schema.Struct({
  active: Schema.Boolean,
  country: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  inclusive: Schema.Boolean,
  percentage: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
  stripeTaxRateId: Schema.NonEmptyString,
});

export type AdminTenantTaxRateRecord = Schema.Schema.Type<
  typeof AdminTenantTaxRateRecord
>;

export const AdminTenantStripeTaxRateRecord = Schema.Struct({
  active: Schema.Boolean,
  country: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  inclusive: Schema.Boolean,
  percentage: Schema.NullOr(Schema.Number),
  state: Schema.NullOr(Schema.String),
});

export type AdminTenantStripeTaxRateRecord = Schema.Schema.Type<
  typeof AdminTenantStripeTaxRateRecord
>;

export const AdminTenantImportStripeTaxRates = asRpcMutation(
  Rpc.make('admin.tenant.importStripeTaxRates', {
    error: AdminTenantRpcError,
    payload: Schema.Struct({
      ids: Schema.Array(Schema.NonEmptyString),
    }),
    success: Schema.Void,
  }),
);

export const AdminTenantListImportedTaxRates = asRpcQuery(
  Rpc.make('admin.tenant.listImportedTaxRates', {
    error: AdminTenantRpcError,
    payload: Schema.Void,
    success: Schema.Array(AdminTenantTaxRateRecord),
  }),
);

export const AdminTenantListStripeTaxRates = asRpcQuery(
  Rpc.make('admin.tenant.listStripeTaxRates', {
    error: AdminTenantRpcError,
    payload: Schema.Void,
    success: Schema.Array(AdminTenantStripeTaxRateRecord),
  }),
);

export const AdminTenantUpdateSettingsInput = Schema.Struct({
  allowOther: Schema.Boolean,
  buyEsnCardUrl: Schema.optional(UrlString),
  currency: Tenant.fields.currency,
  defaultLocation: Schema.NullOr(Schema.Any),
  emailSenderEmail: Schema.optional(OptionalSenderEmail),
  emailSenderName: Schema.optional(Schema.NonEmptyString),
  esnCardEnabled: Schema.Boolean,
  faviconUrl: Schema.optional(TenantBrandAssetUrlString),
  legalNoticeText: Schema.optional(Schema.String),
  legalNoticeUrl: Schema.optional(UrlString),
  locale: Tenant.fields.locale,
  logoUrl: Schema.optional(TenantBrandAssetUrlString),
  maxActiveRegistrationsPerUser: nonNegativeNumber,
  privacyPolicyText: Schema.optional(Schema.String),
  privacyPolicyUrl: Schema.optional(UrlString),
  receiptCountries: Schema.Array(Schema.NonEmptyString),
  seoDescription: Schema.optional(Schema.String),
  seoTitle: Schema.optional(Schema.String),
  stripeAccountId: Schema.optional(Schema.NonEmptyString),
  termsText: Schema.optional(Schema.String),
  termsUrl: Schema.optional(UrlString),
  theme: literalUnion('evorto', 'esn'),
  timezone: Tenant.fields.timezone,
});

export type AdminTenantUpdateSettingsInput = Schema.Schema.Type<
  typeof AdminTenantUpdateSettingsInput
>;

export const AdminTenantBrandAssetKind = literalUnion('favicon', 'logo');
export type AdminTenantBrandAssetKind = Schema.Schema.Type<
  typeof AdminTenantBrandAssetKind
>;

export const AdminTenantUploadBrandAsset = asRpcMutation(
  Rpc.make('admin.tenant.uploadBrandAsset', {
    error: AdminTenantRpcError,
    payload: Schema.Struct({
      fileBase64: Schema.NonEmptyString,
      fileName: Schema.NonEmptyString,
      fileSizeBytes: Schema.Number,
      kind: AdminTenantBrandAssetKind,
      mimeType: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      assetUrl: Schema.NonEmptyString,
      sizeBytes: Schema.Number,
      storageKey: Schema.NonEmptyString,
    }),
  }),
);

export const AdminTenantUpdateSettings = asRpcMutation(
  Rpc.make('admin.tenant.updateSettings', {
    error: AdminTenantRpcError,
    payload: AdminTenantUpdateSettingsInput,
    success: Tenant,
  }),
);

export class AdminRpcs extends RpcGroup.make(
  AdminRolesCreate,
  AdminRolesDelete,
  AdminRolesFindHubRoles,
  AdminRolesFindMany,
  AdminRolesFindOne,
  AdminRolesSearch,
  AdminRolesUpdate,
  AdminTenantImportStripeTaxRates,
  AdminTenantListImportedTaxRates,
  AdminTenantListStripeTaxRates,
  AdminTenantUploadBrandAsset,
  AdminTenantUpdateSettings,
) {}
