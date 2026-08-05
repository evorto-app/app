import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { CanonicalUtcTimestamp, literalUnion } from '@shared/schema-utilities';
import { Effect, Schema, SchemaTransformation } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { Tenant } from '../../../types/custom/tenant';
import { BadRequestForbiddenOrUnauthorizedRpcError } from '../../errors/rpc-errors';
import {
  PlatformAuditResourceType,
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

export const GlobalAdminPlatformAuditState = Schema.Struct({
  addOnCount: Schema.optional(Schema.Number),
  announcementRoleCount: Schema.optional(Schema.Number),
  attendeeCheckedIn: Schema.optional(Schema.Boolean),
  checkedInGuestCount: Schema.optional(Schema.Number),
  currency: Schema.optional(PlatformTenantAuditSnapshot.fields.currency),
  defaultOrganizerRole: Schema.optional(Schema.Boolean),
  defaultUserRole: Schema.optional(Schema.Boolean),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  displayInHub: Schema.optional(Schema.Boolean),
  domain: Schema.optional(PlatformTenantAuditSnapshot.fields.domain),
  guestCount: Schema.optional(Schema.Number),
  locationName: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(PlatformTenantAuditSnapshot.fields.name),
  paymentsConfigured: Schema.optional(
    PlatformTenantAuditSnapshot.fields.paymentsConfigured,
  ),
  permissions: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  questionCount: Schema.optional(Schema.Number),
  receiptCount: Schema.optional(Schema.Number),
  registrationOptionCount: Schema.optional(Schema.Number),
  remainingGuestCount: Schema.optional(Schema.Number),
  roleCount: Schema.optional(Schema.Number),
  simpleModeEnabled: Schema.optional(Schema.Boolean),
  sortOrder: Schema.optional(Schema.Number),
  status: Schema.optional(Schema.NonEmptyString),
  taxRateAddedCount: Schema.optional(Schema.Number),
  taxRateCount: Schema.optional(Schema.Number),
  taxRateUnchangedCount: Schema.optional(Schema.Number),
  taxRateUpdatedCount: Schema.optional(Schema.Number),
  theme: Schema.optional(PlatformTenantAuditSnapshot.fields.theme),
  timezone: Schema.optional(PlatformTenantAuditSnapshot.fields.timezone),
  title: Schema.optional(Schema.NonEmptyString),
  transferStatus: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
});

export type GlobalAdminPlatformAuditState = Schema.Schema.Type<
  typeof GlobalAdminPlatformAuditState
>;

export const GlobalAdminPlatformAuditSnapshot = Schema.Struct({
  resourceType: PlatformAuditResourceType,
  state: GlobalAdminPlatformAuditState,
});

export type GlobalAdminPlatformAuditSnapshot = Schema.Schema.Type<
  typeof GlobalAdminPlatformAuditSnapshot
>;

export const GlobalAdminTenantRecord = PlatformTenantAuditSnapshot;

export type GlobalAdminTenantRecord = Schema.Schema.Type<
  typeof GlobalAdminTenantRecord
>;

export const GlobalAdminTenantIdInput = Schema.Struct({
  id: Schema.NonEmptyString,
});

export const GlobalAdminTenantWriteInput = Schema.Struct({
  currency: Tenant.fields.currency,
  domain: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
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

const GlobalAdminTenantCreatePayload = Schema.Struct({
  ...GlobalAdminTenantMutationInput.fields,
  initialPrivacyPolicy: Schema.Struct({
    privacyPolicyText: Schema.String,
    privacyPolicyUrl: Schema.String,
  }),
});

export const GlobalAdminTenantCreateInput = Schema.Json.pipe(
  Schema.decodeTo(
    GlobalAdminTenantCreatePayload,
    SchemaTransformation.transformOrFail({
      decode: (input) =>
        Schema.decodeUnknownEffect(GlobalAdminTenantCreatePayload)(input, {
          onExcessProperty: 'error',
        }).pipe(Effect.mapError((error) => error.issue)),
      encode: (value) => Effect.succeed(value),
    }),
  ),
);

export type GlobalAdminTenantCreateInput = Schema.Schema.Type<
  typeof GlobalAdminTenantCreateInput
>;

const GlobalAdminTenantUpdatePayload = Schema.Struct({
  id: Schema.NonEmptyString,
  ...GlobalAdminTenantMutationInput.fields,
});

export const GlobalAdminTenantUpdateInput = Schema.Json.pipe(
  Schema.decodeTo(
    GlobalAdminTenantUpdatePayload,
    SchemaTransformation.transformOrFail({
      decode: (input) =>
        Schema.decodeUnknownEffect(GlobalAdminTenantUpdatePayload)(input, {
          onExcessProperty: 'error',
        }).pipe(Effect.mapError((error) => error.issue)),
      encode: (value) => Effect.succeed(value),
    }),
  ),
);

export type GlobalAdminTenantUpdateInput = Schema.Schema.Type<
  typeof GlobalAdminTenantUpdateInput
>;

export const GlobalAdminPlatformAuditRecord = Schema.Struct({
  action: PlatformTenantAuditAction,
  actorEmail: Schema.NullOr(Schema.NonEmptyString),
  after: Schema.NullOr(GlobalAdminPlatformAuditSnapshot),
  before: Schema.NullOr(GlobalAdminPlatformAuditSnapshot),
  createdAt: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
  targetTenantName: Schema.NullOr(Schema.NonEmptyString),
});

export type GlobalAdminPlatformAuditRecord = Schema.Schema.Type<
  typeof GlobalAdminPlatformAuditRecord
>;

export const GlobalAdminPlatformAuditCursor = Schema.Struct({
  createdAt: CanonicalUtcTimestamp,
  id: Schema.NonEmptyString,
});

export type GlobalAdminPlatformAuditCursor = Schema.Schema.Type<
  typeof GlobalAdminPlatformAuditCursor
>;

export const GlobalAdminPlatformAuditPage = Schema.Struct({
  items: Schema.Array(GlobalAdminPlatformAuditRecord),
  nextCursor: Schema.NullOr(GlobalAdminPlatformAuditCursor),
});

export type GlobalAdminPlatformAuditPage = Schema.Schema.Type<
  typeof GlobalAdminPlatformAuditPage
>;

export const GlobalAdminEmailOutboxStatus = literalUnion(
  'queued',
  'sending',
  'sent',
  'failed',
  'deliveryUnknown',
  'suppressed',
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
  id: Schema.NonEmptyString,
  kind: GlobalAdminEmailOutboxKind,
  lastAttemptAt: Schema.NullOr(Schema.NonEmptyString),
  recipient: Schema.NonEmptyString,
  recordIncomplete: Schema.Boolean,
  status: GlobalAdminEmailOutboxStatus,
  subject: Schema.NonEmptyString,
  tenantDomain: Schema.NonEmptyString,
  tenantName: Schema.NonEmptyString,
  tenantTimezone: Tenant.fields.timezone,
});

export const GlobalAdminEmailOutboxOverview = Schema.Struct({
  items: Schema.Array(GlobalAdminEmailOutboxRecord),
  summary: Schema.Struct({
    deliveryUnknown: Schema.Number,
    failed: Schema.Number,
    queued: Schema.Number,
    sending: Schema.Number,
    sent: Schema.Number,
    staleSending: Schema.Number,
    suppressed: Schema.Number,
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
    payload: Schema.Struct({
      cursor: Schema.NullOr(GlobalAdminPlatformAuditCursor),
    }),
    success: GlobalAdminPlatformAuditPage,
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
