import { Schema } from 'effect';

export const CancellationPolicySchema = Schema.Struct({
  allowCancellation: Schema.Boolean,
  includeTransactionFees: Schema.Boolean,
  includeAppFees: Schema.Boolean,
  cutoffDays: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  cutoffHours: Schema.Number.pipe(Schema.int(), Schema.between(0, 23)),
});

export const PolicyVariantSchema = Schema.Literal(
  'paid-regular',
  'paid-organizer',
  'free-regular',
  'free-organizer',
);

export const TenantCancellationPoliciesSchema = Schema.Record({
  key: PolicyVariantSchema,
  value: CancellationPolicySchema,
});

export const CancellationReasonSchema = Schema.Literal(
  'user',
  'admin',
  'organizer',
  'payment_abandoned',
  'other',
);

export const SetTenantPoliciesInputSchema = Schema.Struct({
  applyToAll: Schema.Boolean,
  policy: CancellationPolicySchema,
  overrides: Schema.optional(TenantCancellationPoliciesSchema),
});

export const GetTenantPoliciesOutputSchema = Schema.Struct({
  policies: Schema.optional(TenantCancellationPoliciesSchema),
});

export const OptionPolicySchema = Schema.Struct({
  useTenantDefault: Schema.Boolean,
  policy: Schema.optional(CancellationPolicySchema),
});

export const CancelRegistrationInputSchema = Schema.Struct({
  registrationId: Schema.NonEmptyString,
  reason: Schema.optional(CancellationReasonSchema),
  reasonNote: Schema.optional(Schema.String),
  noRefund: Schema.optional(Schema.Boolean),
});

export const CancellationResultSchema = Schema.Struct({
  cancelled: Schema.Boolean,
  refunded: Schema.Boolean,
  refundAmount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  includesTransactionFees: Schema.Boolean,
  includesAppFees: Schema.Boolean,
});