import { Database } from '@db/index';
import {
  platformAuditEntries,
  tenants,
  tenantStripeTaxRates,
  transactions,
} from '@db/schema';
import { PlatformOperationReason } from '@shared/rpc-contracts/app-rpcs/platform-operations.shared';
import { normalizeTenantDomain } from '@shared/tenant-origin';
import { and, eq } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import { StripeClient } from '../stripe-client';
import {
  tenantHasPaidEventConfiguration,
  tenantHasStripeTaxRateConfiguration,
} from './paid-event-configuration';
import { tenantHasPendingStripeObligations } from './pending-stripe-obligations';
import { validateStripePaymentAccount } from './stripe-payment-account-validation';

const PaymentAccountId = Schema.Trimmed.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
);

const PaymentSetupReason = PlatformOperationReason;

const ExpectedOrganizationDomain = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      normalizeTenantDomain(value);
      return;
    } catch {
      return 'Expected the organization website address';
    }
  }),
);

export const TenantPaymentSetupArguments = Schema.Struct({
  accountId: PaymentAccountId,
  confirmation: Schema.Literal('attach-payment-account'),
  expectedOrganizationDomain: ExpectedOrganizationDomain,
  organizationId: Schema.NonEmptyString,
  reason: PaymentSetupReason,
}).check(
  Schema.makeFilter(
    (input) =>
      input.reason.includes(input.accountId)
        ? 'The reason must not contain the payment account ID'
        : undefined,
    {
      description:
        'The reason describes approval and context without payment account identifiers.',
    },
  ),
);

export type TenantPaymentSetupArguments = Schema.Schema.Type<
  typeof TenantPaymentSetupArguments
>;

export const tenantPaymentSetupFailureReasons = [
  'account-unavailable',
  'already-configured',
  'organization-domain-mismatch',
  'organization-not-found',
  'payment-configuration-exists',
  'payment-history-exists',
  'payment-in-progress',
  'tax-configuration-exists',
] as const;

export const TenantPaymentSetupOutcome = Schema.Union([
  Schema.Struct({ attached: Schema.Literal(true) }),
  Schema.Struct({
    attached: Schema.Literal(false),
    reason: Schema.Literals(tenantPaymentSetupFailureReasons),
  }),
]);

export type TenantPaymentSetupOutcome = Schema.Schema.Type<
  typeof TenantPaymentSetupOutcome
>;

const failed = (
  reason: (typeof tenantPaymentSetupFailureReasons)[number],
): TenantPaymentSetupOutcome => ({ attached: false, reason });

const paymentSetupAuditSnapshot = (
  organizationId: string,
  paymentsConfigured: boolean,
) => ({
  resourceId: organizationId,
  resourceType: 'tenant' as const,
  state: { paymentsConfigured },
});

export const attachTenantPaymentAccount = Effect.fn(
  'attachTenantPaymentAccount',
)(function* (
  input: TenantPaymentSetupArguments,
): Effect.fn.Return<TenantPaymentSetupOutcome, never, Database | StripeClient> {
  const stripe = yield* StripeClient;
  const expectedOrganizationDomain = normalizeTenantDomain(
    input.expectedOrganizationDomain,
  );
  const accountAvailable = yield* validateStripePaymentAccount(
    stripe,
    input.accountId,
  ).pipe(
    Effect.as(true),
    Effect.catchTag('RpcBadRequestError', () => Effect.succeed(false)),
  );
  if (!accountAvailable) {
    return failed('account-unavailable');
  }

  return yield* Database.use((database) =>
    database
      .transaction((transaction) =>
        Effect.gen(function* () {
          const organizationRows = yield* transaction
            .select({
              domain: tenants.domain,
              id: tenants.id,
              stripeAccountId: tenants.stripeAccountId,
            })
            .from(tenants)
            .where(eq(tenants.id, input.organizationId))
            .for('update');
          const organization = organizationRows[0];
          if (!organization) {
            return failed('organization-not-found');
          }
          if (
            normalizeTenantDomain(organization.domain) !==
            expectedOrganizationDomain
          ) {
            return failed('organization-domain-mismatch');
          }
          if (organization.stripeAccountId !== null) {
            return failed('already-configured');
          }

          if (
            yield* tenantHasPendingStripeObligations(
              transaction,
              input.organizationId,
            )
          ) {
            return failed('payment-in-progress');
          }
          if (
            yield* tenantHasPaidEventConfiguration(
              transaction,
              input.organizationId,
            )
          ) {
            return failed('payment-configuration-exists');
          }
          if (
            yield* tenantHasStripeTaxRateConfiguration(
              transaction,
              input.organizationId,
            )
          ) {
            return failed('tax-configuration-exists');
          }

          const importedTaxRates = yield* transaction
            .select({ id: tenantStripeTaxRates.id })
            .from(tenantStripeTaxRates)
            .where(eq(tenantStripeTaxRates.tenantId, input.organizationId))
            .limit(1);
          if (importedTaxRates.length > 0) {
            return failed('tax-configuration-exists');
          }

          const paymentHistory = yield* transaction
            .select({ id: transactions.id })
            .from(transactions)
            .where(
              and(
                eq(transactions.tenantId, input.organizationId),
                eq(transactions.method, 'stripe'),
              ),
            )
            .limit(1);
          if (paymentHistory.length > 0) {
            return failed('payment-history-exists');
          }

          const updatedRows = yield* transaction
            .update(tenants)
            .set({ stripeAccountId: input.accountId })
            .where(eq(tenants.id, input.organizationId))
            .returning({ id: tenants.id });
          if (!updatedRows[0]) {
            return yield* Effect.die(
              new Error('Payment setup update returned no rows'),
            );
          }

          yield* transaction.insert(platformAuditEntries).values({
            action: 'tenant.update',
            actorEmail: 'Evorto operations',
            actorId: 'operations:payment-setup',
            after: paymentSetupAuditSnapshot(input.organizationId, true),
            before: paymentSetupAuditSnapshot(input.organizationId, false),
            reason: input.reason,
            targetTenantId: input.organizationId,
          });

          return { attached: true } as const;
        }),
      )
      .pipe(Effect.orDie),
  );
});
