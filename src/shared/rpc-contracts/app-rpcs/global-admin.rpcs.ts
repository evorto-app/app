import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { literalUnion } from '@shared/schema-utilities';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { Tenant } from '../../../types/custom/tenant';
import { BadRequestForbiddenOrUnauthorizedRpcError } from '../../errors/rpc-errors';
import {
  PlatformAuditSnapshot,
  PlatformTenantAuditAction,
  PlatformTenantAuditSnapshot,
} from '../../platform-audit';
import { PlatformOperationReason } from './platform-operations.shared';

export class GlobalAdminTenantUrlMigrationBlockedError extends Schema.TaggedErrorClass<GlobalAdminTenantUrlMigrationBlockedError>()(
  'GlobalAdminTenantUrlMigrationBlockedError',
  {
    activeRegistrationTransfers: Schema.Boolean,
    message: Schema.String,
    pendingStripeObligations: Schema.Boolean,
    reason: Schema.String,
    tenantId: Schema.NonEmptyString,
  },
) {}

export const GlobalAdminRpcError = BadRequestForbiddenOrUnauthorizedRpcError;

export type GlobalAdminRpcError = BadRequestForbiddenOrUnauthorizedRpcError;

export const GlobalAdminTenantUpdateError = Schema.Union([
  BadRequestForbiddenOrUnauthorizedRpcError,
  GlobalAdminTenantUrlMigrationBlockedError,
]);

export type GlobalAdminTenantUpdateError = Schema.Schema.Type<
  typeof GlobalAdminTenantUpdateError
>;

export const GlobalAdminTenantRecord = PlatformTenantAuditSnapshot;

export type GlobalAdminTenantRecord = Schema.Schema.Type<
  typeof GlobalAdminTenantRecord
>;

export const GlobalAdminTenantIdInput = Schema.Struct({
  id: Schema.NonEmptyString,
});

export const GlobalAdminTenantWriteInput = Schema.Struct({
  canonicalRootUrl: Tenant.fields.canonicalRootUrl,
  currency: Tenant.fields.currency,
  domain: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  stripeAccountId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  theme: Tenant.fields.theme,
  timezone: Tenant.fields.timezone,
});

export type GlobalAdminTenantWriteInput = Schema.Schema.Type<
  typeof GlobalAdminTenantWriteInput
>;

export const GlobalAdminAuditReason = PlatformOperationReason;

export const GlobalAdminTenantMutationInput = Schema.Struct({
  reason: GlobalAdminAuditReason,
  tenant: GlobalAdminTenantWriteInput,
});

export type GlobalAdminTenantMutationInput = Schema.Schema.Type<
  typeof GlobalAdminTenantMutationInput
>;

export const GlobalAdminTenantCreateInput = Schema.Struct({
  ...GlobalAdminTenantMutationInput.fields,
  initialPrivacyPolicy: Schema.Struct({
    privacyPolicyText: Schema.String,
    privacyPolicyUrl: Schema.String,
  }),
});

export type GlobalAdminTenantCreateInput = Schema.Schema.Type<
  typeof GlobalAdminTenantCreateInput
>;

export const GlobalAdminTenantUpdateInput = Schema.Struct({
  id: Schema.NonEmptyString,
  ...GlobalAdminTenantMutationInput.fields,
});

export type GlobalAdminTenantUpdateInput = Schema.Schema.Type<
  typeof GlobalAdminTenantUpdateInput
>;

export const GlobalAdminPlatformAuditRecord = Schema.Struct({
  action: PlatformTenantAuditAction,
  actorEmail: Schema.NullOr(Schema.NonEmptyString),
  actorId: Schema.NonEmptyString,
  after: Schema.NullOr(PlatformAuditSnapshot),
  before: Schema.NullOr(PlatformAuditSnapshot),
  createdAt: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
  targetTenantId: Schema.NonEmptyString,
});

export type GlobalAdminPlatformAuditRecord = Schema.Schema.Type<
  typeof GlobalAdminPlatformAuditRecord
>;

export const GlobalAdminEmailOutboxStatus = literalUnion(
  'queued',
  'sending',
  'sent',
  'failed',
);

export const GlobalAdminEmailOutboxKinds = [
  'manualApproval',
  'receiptReviewed',
  'registrationCancelled',
  'registrationConfirmed',
  'registrationTransferred',
  'waitlistSpotAvailable',
] as const;

export const GlobalAdminEmailOutboxKind = literalUnion(
  ...GlobalAdminEmailOutboxKinds,
);

export type GlobalAdminEmailOutboxKind = Schema.Schema.Type<
  typeof GlobalAdminEmailOutboxKind
>;

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
    payload: GlobalAdminTenantCreateInput,
    success: GlobalAdminTenantRecord,
  }),
);

export const GlobalAdminTenantsUpdate = asRpcMutation(
  Rpc.make('globalAdmin.tenants.update', {
    error: GlobalAdminTenantUpdateError,
    payload: GlobalAdminTenantUpdateInput,
    success: GlobalAdminTenantRecord,
  }),
);

export const GlobalAdminPlatformAuditFindMany = asRpcQuery(
  Rpc.make('globalAdmin.platformAudit.findMany', {
    error: GlobalAdminRpcError,
    payload: Schema.Void,
    success: Schema.Array(GlobalAdminPlatformAuditRecord),
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
  GlobalAdminPlatformAuditFindMany,
  GlobalAdminTenantsCreate,
  GlobalAdminTenantsFindOne,
  GlobalAdminTenantsFindMany,
  GlobalAdminTenantsUpdate,
) {}
