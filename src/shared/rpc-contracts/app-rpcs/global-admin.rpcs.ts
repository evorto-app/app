import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { literalUnion } from '@shared/schema-utilities';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { Tenant } from '../../../types/custom/tenant';
import { BadRequestForbiddenOrUnauthorizedRpcError } from '../../errors/rpc-errors';

export const GlobalAdminRpcError = BadRequestForbiddenOrUnauthorizedRpcError;

export type GlobalAdminRpcError = BadRequestForbiddenOrUnauthorizedRpcError;

export const GlobalAdminTenantRecord = Schema.Struct({
  canonicalRootUrl: Schema.NonEmptyString,
  currency: Tenant.fields.currency,
  domain: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  locale: Tenant.fields.locale,
  name: Schema.NonEmptyString,
  stripeAccountId: Schema.NullOr(Schema.String),
  stripeConnected: Schema.Boolean,
  theme: Tenant.fields.theme,
  timezone: Tenant.fields.timezone,
});

export type GlobalAdminTenantRecord = Schema.Schema.Type<
  typeof GlobalAdminTenantRecord
>;

export const GlobalAdminTenantIdInput = Schema.Struct({
  id: Schema.NonEmptyString,
});

export const GlobalAdminTenantWriteInput = Schema.Struct({
  canonicalRootUrl: Schema.NonEmptyString,
  currency: Tenant.fields.currency,
  domain: Schema.NonEmptyString,
  locale: Tenant.fields.locale,
  name: Schema.NonEmptyString,
  stripeAccountId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  theme: Tenant.fields.theme,
  timezone: Tenant.fields.timezone,
});

export type GlobalAdminTenantWriteInput = Schema.Schema.Type<
  typeof GlobalAdminTenantWriteInput
>;

export const GlobalAdminEmailOutboxStatus = literalUnion(
  'queued',
  'sending',
  'sent',
  'failed',
);

export const GlobalAdminEmailOutboxKind = literalUnion(
  'manualApproval',
  'receiptReviewed',
);

export const GlobalAdminEmailOutboxRecord = Schema.Struct({
  attempts: Schema.Number,
  createdAt: Schema.NonEmptyString,
  exhaustedAt: Schema.NullOr(Schema.NonEmptyString),
  id: Schema.NonEmptyString,
  kind: GlobalAdminEmailOutboxKind,
  lastAttemptAt: Schema.NullOr(Schema.NonEmptyString),
  lastError: Schema.NullOr(Schema.String),
  maxAttempts: Schema.Number,
  nextAttemptAt: Schema.NonEmptyString,
  recipient: Schema.NonEmptyString,
  sentAt: Schema.NullOr(Schema.NonEmptyString),
  status: GlobalAdminEmailOutboxStatus,
  subject: Schema.NonEmptyString,
  tenantDomain: Schema.NonEmptyString,
  tenantId: Schema.NonEmptyString,
  tenantName: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
});

export const GlobalAdminEmailOutboxOverview = Schema.Struct({
  items: Schema.Array(GlobalAdminEmailOutboxRecord),
  summary: Schema.Struct({
    exhausted: Schema.Number,
    failed: Schema.Number,
    queued: Schema.Number,
    sending: Schema.Number,
    sent: Schema.Number,
    staleSending: Schema.Number,
    waitingForRetry: Schema.Number,
  }),
});

export const GlobalAdminTenantsFindMany = asRpcQuery(
  Rpc.make('globalAdmin.tenants.findMany', {
    error: GlobalAdminRpcError,
    payload: Schema.Void,
    success: Schema.Array(GlobalAdminTenantRecord),
  }),
);

export const GlobalAdminTenantsFindOne = asRpcQuery(
  Rpc.make('globalAdmin.tenants.findOne', {
    error: GlobalAdminRpcError,
    payload: GlobalAdminTenantIdInput,
    success: Schema.NullOr(GlobalAdminTenantRecord),
  }),
);

export const GlobalAdminTenantsCreate = asRpcMutation(
  Rpc.make('globalAdmin.tenants.create', {
    error: GlobalAdminRpcError,
    payload: GlobalAdminTenantWriteInput,
    success: GlobalAdminTenantRecord,
  }),
);

export const GlobalAdminTenantsUpdate = asRpcMutation(
  Rpc.make('globalAdmin.tenants.update', {
    error: GlobalAdminRpcError,
    payload: Schema.Struct({
      canonicalRootUrl: Schema.NonEmptyString,
      currency: Tenant.fields.currency,
      domain: Schema.NonEmptyString,
      id: Schema.NonEmptyString,
      locale: Tenant.fields.locale,
      name: Schema.NonEmptyString,
      stripeAccountId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
      theme: Tenant.fields.theme,
      timezone: Tenant.fields.timezone,
    }),
    success: GlobalAdminTenantRecord,
  }),
);

export const GlobalAdminEmailOutboxFindOverview = asRpcQuery(
  Rpc.make('globalAdmin.emailOutbox.findOverview', {
    error: GlobalAdminRpcError,
    payload: Schema.Void,
    success: GlobalAdminEmailOutboxOverview,
  }),
);

export class GlobalAdminRpcs extends RpcGroup.make(
  GlobalAdminEmailOutboxFindOverview,
  GlobalAdminTenantsCreate,
  GlobalAdminTenantsFindOne,
  GlobalAdminTenantsFindMany,
  GlobalAdminTenantsUpdate,
) {}
