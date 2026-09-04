import type {
  eventRegistrationOptions,
  platformAuditEntries,
  tenants,
  tenantStripeTaxRates,
  transactions,
} from '@db/schema';
import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import { describe, expect, it, layer } from '@effect/vitest';
import { Cause, Effect, Exit, Layer, Schema } from 'effect';
import Stripe from 'stripe';

import { StripeClient } from '../stripe-client';
import { createRegistrationDatabaseTestLayer } from '../testing/registration-database';
import {
  attachTenantPaymentAccount,
  TenantPaymentSetupArguments,
} from './tenant-payment-setup';

const accountId = 'acct_payment_setup';
const organizationDomain = 'tenant-payment-setup.example';
const organizationId = 'tenant-payment-setup';

const input: TenantPaymentSetupArguments = {
  accountId,
  confirmation: 'attach-payment-account',
  expectedOrganizationDomain: organizationDomain,
  organizationId,
  reason: 'Initial payment setup requested by the organization board',
};

type PaymentAccountResponse = 'missing' | 'not-ready' | 'ready' | 'unavailable';

type PaymentSetupAuditValues = Pick<
  typeof platformAuditEntries.$inferInsert,
  | 'action'
  | 'actorEmail'
  | 'actorId'
  | 'after'
  | 'before'
  | 'reason'
  | 'targetTenantId'
>;

interface PaymentSetupFixtureOptions {
  readonly existingAccountId?: null | string;
  readonly existingDomain?: string;
  readonly importedTaxConfiguration?: boolean;
  readonly organizationExists?: boolean;
  readonly paidConfiguration?: boolean;
  readonly paymentHistory?: boolean;
  readonly pendingPayment?: boolean;
  readonly stripeResponse?: PaymentAccountResponse;
  readonly taxConfiguration?: boolean;
  readonly updateReturnsRow?: boolean;
}

interface PaymentSetupFixtureState {
  readonly auditValues: PaymentSetupAuditValues[];
  currentAccountId: null | string;
  readonly lockModes: string[];
  readonly operationOrder: string[];
  transactionCalls: number;
  transactionSelectCalls: number;
  readonly updateValues: Pick<typeof tenants.$inferInsert, 'stripeAccountId'>[];
}

type StripeHttpRequestArguments = Parameters<
  InstanceType<typeof Stripe.HttpClient>['makeRequest']
>;

class PaymentSetupStripeHttpClient extends Stripe.HttpClient {
  readonly providerFailure = new Error('Payment provider unavailable');
  readonly requestedAccountIds: string[] = [];

  constructor(
    private readonly response: PaymentAccountResponse,
    private readonly operationOrder: string[],
  ) {
    super();
  }

  override getClientName(): string {
    return 'evorto-payment-setup-test';
  }

  override makeRequest(
    ...arguments_: StripeHttpRequestArguments
  ): Promise<PaymentSetupStripeResponse> {
    const [host, , path, method] = arguments_;
    const accountMatch = /^\/v1\/accounts\/([^/?]+)$/u.exec(path);
    if (host !== 'api.stripe.com' || method !== 'GET' || !accountMatch?.[1]) {
      return Promise.reject(
        new Error(`Unexpected Stripe request: ${method} ${host}${path}`),
      );
    }

    const requestedAccountId = decodeURIComponent(accountMatch[1]);
    this.requestedAccountIds.push(requestedAccountId);
    this.operationOrder.push('provider-validation');

    if (this.response === 'unavailable') {
      return Promise.reject(this.providerFailure);
    }
    if (this.response === 'missing') {
      return Promise.resolve(
        new PaymentSetupStripeResponse(
          {
            error: {
              code: 'resource_missing',
              message: 'No such connected account',
              type: 'invalid_request_error',
            },
          },
          404,
        ),
      );
    }

    return Promise.resolve(
      new PaymentSetupStripeResponse({
        charges_enabled: this.response === 'ready',
        details_submitted: this.response === 'ready',
        id: requestedAccountId,
        object: 'account',
        payouts_enabled: this.response === 'ready',
      }),
    );
  }
}

class PaymentSetupStripeResponse extends Stripe.HttpClientResponse {
  constructor(
    private readonly body: unknown,
    statusCode = 200,
  ) {
    super(statusCode, { 'request-id': 'req_payment_setup' });
  }

  override getRawResponse(): unknown {
    return this.body;
  }

  override toJSON(): Promise<unknown> {
    return Promise.resolve(this.body);
  }
}

const createPaymentSetupFixture = (
  options: PaymentSetupFixtureOptions = {},
) => {
  const state: PaymentSetupFixtureState = {
    auditValues: [],
    currentAccountId: options.existingAccountId ?? null,
    lockModes: [],
    operationOrder: [],
    transactionCalls: 0,
    transactionSelectCalls: 0,
    updateValues: [],
  };
  const organizationExists = options.organizationExists !== false;
  let transactionOpen = false;
  let accountBeforeTransaction: null | string = state.currentAccountId;

  const readLockedOrganization = (parameters: readonly unknown[]) => {
    expect(parameters).toEqual([organizationId]);
    state.lockModes.push('update');
    state.operationOrder.push('organization-lock');
    const organization = {
      domain: options.existingDomain ?? organizationDomain,
      id: organizationId,
      stripeAccountId: state.currentAccountId,
    } satisfies Pick<
      typeof tenants.$inferSelect,
      'domain' | 'id' | 'stripeAccountId'
    >;
    return organizationExists
      ? [[organization.domain, organization.id, organization.stripeAccountId]]
      : [];
  };

  const readPendingPayment = (parameters: readonly unknown[]) => {
    expect(parameters).toEqual([
      'stripe',
      'pending',
      organizationId,
      'registration',
      'refund',
      'addon',
      1,
    ]);
    state.transactionSelectCalls += 1;
    const payment = { id: 'pending-payment' } satisfies Pick<
      typeof transactions.$inferSelect,
      'id'
    >;
    return options.pendingPayment ? [[payment.id]] : [];
  };

  const readPaidConfiguration = (parameters: readonly unknown[]) => {
    expect(parameters).toEqual([organizationId, true, 0, 1]);
    const option = { id: 'paid-item' } satisfies Pick<
      typeof eventRegistrationOptions.$inferSelect,
      'id'
    >;
    return options.paidConfiguration ? [[option.id]] : [];
  };

  const readAssignedTaxConfiguration = (parameters: readonly unknown[]) => {
    expect(parameters).toEqual([organizationId, 1]);
    const option = { stripeTaxRateId: 'tax-rate-existing' } satisfies Pick<
      typeof eventRegistrationOptions.$inferSelect,
      'stripeTaxRateId'
    >;
    return options.taxConfiguration ? [[option.stripeTaxRateId]] : [];
  };

  const readImportedTaxConfiguration = (parameters: readonly unknown[]) => {
    expect(parameters).toEqual([organizationId, 1]);
    const taxRate = { id: 'imported-tax-rate' } satisfies Pick<
      typeof tenantStripeTaxRates.$inferSelect,
      'id'
    >;
    return options.importedTaxConfiguration ? [[taxRate.id]] : [];
  };

  const readPaymentHistory = (parameters: readonly unknown[]) => {
    expect(parameters).toEqual([organizationId, 'stripe', 1]);
    state.transactionSelectCalls += 1;
    const payment = { id: 'past-payment' } satisfies Pick<
      typeof transactions.$inferSelect,
      'id'
    >;
    return options.paymentHistory ? [[payment.id]] : [];
  };

  const attachAccount = (parameters: readonly unknown[]) => {
    expect(parameters).toHaveLength(3);
    const [attachedAccountId, updatedAt, tenantId] = parameters;
    expect(attachedAccountId).toBe(accountId);
    expect(tenantId).toBe(organizationId);
    if (
      typeof attachedAccountId !== 'string' ||
      typeof updatedAt !== 'string'
    ) {
      throw new TypeError(
        'Expected account ID and serialized update timestamp',
      );
    }
    expect(Number.isNaN(Date.parse(updatedAt))).toBe(false);
    state.updateValues.push({ stripeAccountId: attachedAccountId });
    state.operationOrder.push('update');
    if (options.updateReturnsRow === false) return [];
    state.currentAccountId = attachedAccountId;
    const organization = { id: organizationId } satisfies Pick<
      typeof tenants.$inferSelect,
      'id'
    >;
    return [[organization.id]];
  };

  const insertAttachmentAudit = (parameters: readonly unknown[]) => {
    const audit = {
      action: 'tenant.update',
      actorEmail: 'Evorto operations',
      actorId: 'operations:payment-setup',
      after: {
        resourceId: organizationId,
        resourceType: 'tenant',
        state: { paymentsConfigured: true },
      },
      before: {
        resourceId: organizationId,
        resourceType: 'tenant',
        state: { paymentsConfigured: false },
      },
      reason: input.reason,
      targetTenantId: organizationId,
    } satisfies PaymentSetupAuditValues;
    expect(parameters).toHaveLength(8);
    const auditId = parameters[5];
    if (typeof auditId !== 'string') {
      throw new TypeError('Expected generated payment setup audit ID');
    }
    expect(auditId).toHaveLength(20);
    expect(parameters).toEqual([
      audit.action,
      audit.actorEmail,
      audit.actorId,
      JSON.stringify(audit.after),
      JSON.stringify(audit.before),
      auditId,
      audit.reason,
      audit.targetTenantId,
    ]);
    state.auditValues.push(audit);
    state.operationOrder.push('audit');
    return [];
  };

  const executeValues: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      expect(transactionOpen).toBe(true);
      switch (statement) {
        case 'insert into "platform_audit_entries" ("action", "actor_email", "actor_id", "after", "before", "created_at", "id", "reason", "target_tenant_id") values ($1, $2, $3, $4, $5, default, $6, $7, $8)': {
          return insertAttachmentAudit(parameters);
        }
        case 'select "domain", "id", "stripeAccountId" from "tenants" where "tenants"."id" = $1 for update': {
          return readLockedOrganization(parameters);
        }
        case 'select "event_addons"."id" from "event_addons" inner join "event_instances" on "event_instances"."id" = "event_addons"."eventId" where (("event_instances"."tenantId" = $1) and ((("event_addons"."isPaid" = $2) or ("event_addons"."price" > $3)))) limit $4':
        case 'select "event_registration_options"."id" from "event_registration_options" inner join "event_instances" on "event_instances"."id" = "event_registration_options"."eventId" where (("event_instances"."tenantId" = $1) and ((("event_registration_options"."isPaid" = $2) or ("event_registration_options"."price" > $3)))) limit $4':
        case 'select "template_event_addons"."id" from "template_event_addons" inner join "event_templates" on "event_templates"."id" = "template_event_addons"."templateId" where (("event_templates"."tenantId" = $1) and ((("template_event_addons"."isPaid" = $2) or ("template_event_addons"."price" > $3)))) limit $4':
        case 'select "template_registration_options"."id" from "template_registration_options" inner join "event_templates" on "event_templates"."id" = "template_registration_options"."templateId" where (("event_templates"."tenantId" = $1) and ((("template_registration_options"."isPaid" = $2) or ("template_registration_options"."price" > $3)))) limit $4': {
          return readPaidConfiguration(parameters);
        }
        case 'select "event_addons"."stripeTaxRateId" from "event_addons" inner join "event_instances" on "event_instances"."id" = "event_addons"."eventId" where (("event_instances"."tenantId" = $1) and (("event_addons"."stripeTaxRateId" is not null))) limit $2':
        case 'select "event_registration_options"."stripeTaxRateId" from "event_registration_options" inner join "event_instances" on "event_instances"."id" = "event_registration_options"."eventId" where (("event_instances"."tenantId" = $1) and (("event_registration_options"."stripeTaxRateId" is not null))) limit $2':
        case 'select "template_event_addons"."stripeTaxRateId" from "template_event_addons" inner join "event_templates" on "event_templates"."id" = "template_event_addons"."templateId" where (("event_templates"."tenantId" = $1) and (("template_event_addons"."stripeTaxRateId" is not null))) limit $2':
        case 'select "template_registration_options"."stripeTaxRateId" from "template_registration_options" inner join "event_templates" on "event_templates"."id" = "template_registration_options"."templateId" where (("event_templates"."tenantId" = $1) and (("template_registration_options"."stripeTaxRateId" is not null))) limit $2': {
          return readAssignedTaxConfiguration(parameters);
        }
        case 'select "id" from "tenant_stripe_tax_rates" where "tenant_stripe_tax_rates"."tenantId" = $1 limit $2': {
          return readImportedTaxConfiguration(parameters);
        }
        case 'select "id" from "transactions" where (("transactions"."method" = $1) and ("transactions"."status" = $2) and ("transactions"."tenantId" = $3) and ("transactions"."type" in ($4, $5, $6))) limit $7': {
          return readPendingPayment(parameters);
        }
        case 'select "id" from "transactions" where (("transactions"."tenantId" = $1) and ("transactions"."method" = $2)) limit $3': {
          return readPaymentHistory(parameters);
        }
        case 'update "tenants" set "stripeAccountId" = $1, "updatedAt" = $2 where "tenants"."id" = $3 returning "id"': {
          return attachAccount(parameters);
        }
        default: {
          throw new Error(`Unexpected payment setup SQL: ${statement}`);
        }
      }
    });

  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues,
    transactionControl: (command) =>
      Effect.sync(() => {
        if (command === 'BEGIN') {
          expect(transactionOpen).toBe(false);
          transactionOpen = true;
          accountBeforeTransaction = state.currentAccountId;
          state.transactionCalls += 1;
          state.operationOrder.push('transaction');
          return;
        }
        expect(transactionOpen).toBe(true);
        if (command === 'ROLLBACK') {
          state.currentAccountId = accountBeforeTransaction;
        }
        transactionOpen = false;
      }),
  });
  const stripeHttpClient = new PaymentSetupStripeHttpClient(
    options.stripeResponse ?? 'ready',
    state.operationOrder,
  );
  const stripe = new Stripe('sk_test_payment_setup', {
    httpClient: stripeHttpClient,
    maxNetworkRetries: 0,
  });

  return {
    layer: Layer.mergeAll(databaseLayer, Layer.succeed(StripeClient, stripe)),
    state,
    stripeHttpClient,
  };
};

describe('TenantPaymentSetupArguments', () => {
  it('normalizes a bounded reason and accepts only the explicit safe attachment shape', () => {
    const decode = Schema.decodeUnknownExit(TenantPaymentSetupArguments, {
      onExcessProperty: 'error',
    });

    expect(Exit.isSuccess(decode(input))).toBe(true);
    const normalized = decode({
      ...input,
      expectedOrganizationDomain: ` HTTPS://${organizationDomain.toUpperCase()} `,
      reason: `  ${input.reason}  `,
    });
    expect(Exit.isSuccess(normalized)).toBe(true);
    if (Exit.isSuccess(normalized)) {
      expect(normalized.value.reason).toBe(input.reason);
    }
    for (const invalid of [
      { ...input, accountId: '' },
      { ...input, accountId: ` ${accountId}` },
      { ...input, confirmation: 'confirm' },
      { ...input, expectedOrganizationDomain: '' },
      { ...input, expectedOrganizationDomain: 'tenant.example/path' },
      { ...input, organizationId: '' },
      { ...input, reason: '' },
      { ...input, reason: ' '.repeat(3) },
      { ...input, reason: `Attach approved for ${accountId}` },
      { ...input, reason: 'Attach approved for acct_shared_account_1.' },
      { ...input, reason: 'x'.repeat(501) },
      { ...input, extra: 'not-allowed' },
      {
        accountId,
        organizationId,
        reason: input.reason,
      },
    ]) {
      expect(Exit.isFailure(decode(invalid))).toBe(true);
    }
  });
});

describe('attachTenantPaymentAccount', () => {
  const success = createPaymentSetupFixture();
  layer(success.layer)('successful attachment', (it) => {
    it.effect(
      'locks, attaches exactly once, and stores a status-only audit',
      () =>
        Effect.gen(function* () {
          const normalizedInput = Schema.decodeUnknownSync(
            TenantPaymentSetupArguments,
          )({ ...input, reason: `  ${input.reason}  ` });
          const first = yield* attachTenantPaymentAccount(normalizedInput);
          const second = yield* attachTenantPaymentAccount(normalizedInput);

          expect(first).toEqual({ attached: true });
          expect(second).toEqual({
            attached: false,
            reason: 'already-configured',
          });
          expect(success.stripeHttpClient.requestedAccountIds).toEqual([
            accountId,
            accountId,
          ]);
          expect(success.state.transactionCalls).toBe(2);
          expect(success.state.lockModes).toEqual(['update', 'update']);
          expect(success.state.updateValues).toEqual([
            { stripeAccountId: accountId },
          ]);
          expect(success.state.auditValues).toHaveLength(1);
          expect(success.state.auditValues[0]).toEqual({
            action: 'tenant.update',
            actorEmail: 'Evorto operations',
            actorId: 'operations:payment-setup',
            after: {
              resourceId: organizationId,
              resourceType: 'tenant',
              state: { paymentsConfigured: true },
            },
            before: {
              resourceId: organizationId,
              resourceType: 'tenant',
              state: { paymentsConfigured: false },
            },
            reason: input.reason,
            targetTenantId: organizationId,
          });
          expect(JSON.stringify(success.state.auditValues[0])).not.toContain(
            accountId,
          );
          expect(success.state.operationOrder.slice(0, 5)).toEqual([
            'provider-validation',
            'transaction',
            'organization-lock',
            'update',
            'audit',
          ]);
        }),
    );
  });

  const conflicts: readonly {
    readonly expected: string;
    readonly name: string;
    readonly options: PaymentSetupFixtureOptions;
  }[] = [
    {
      expected: 'organization-not-found',
      name: 'missing organization',
      options: { organizationExists: false },
    },
    {
      expected: 'organization-domain-mismatch',
      name: 'mismatched organization domain',
      options: { existingDomain: 'different-organization.example' },
    },
    {
      expected: 'already-configured',
      name: 'existing payment setup',
      options: { existingAccountId: 'acct_existing' },
    },
    {
      expected: 'payment-in-progress',
      name: 'payment in progress',
      options: { pendingPayment: true },
    },
    {
      expected: 'payment-configuration-exists',
      name: 'stored paid event configuration',
      options: { paidConfiguration: true },
    },
    {
      expected: 'tax-configuration-exists',
      name: 'stored tax assignment',
      options: { taxConfiguration: true },
    },
    {
      expected: 'tax-configuration-exists',
      name: 'imported organization tax configuration',
      options: { importedTaxConfiguration: true },
    },
    {
      expected: 'payment-history-exists',
      name: 'past payment history',
      options: { paymentHistory: true },
    },
  ];

  for (const conflict of conflicts) {
    const fixture = createPaymentSetupFixture(conflict.options);
    layer(fixture.layer)(conflict.name, (it) => {
      it.effect(`returns ${conflict.expected} without mutating`, () =>
        Effect.gen(function* () {
          const outcome = yield* attachTenantPaymentAccount(input);

          expect(outcome).toEqual({
            attached: false,
            reason: conflict.expected,
          });
          expect(fixture.state.lockModes).toEqual(['update']);
          expect(fixture.state.updateValues).toEqual([]);
          expect(fixture.state.auditValues).toEqual([]);
        }),
      );
    });
  }

  const unavailableAccountResponses: readonly ('missing' | 'not-ready')[] = [
    'missing',
    'not-ready',
  ];
  for (const response of unavailableAccountResponses) {
    const fixture = createPaymentSetupFixture({ stripeResponse: response });
    layer(fixture.layer)(`${response} provider account`, (it) => {
      it.effect(
        'returns a safe unavailable outcome before opening a transaction',
        () =>
          Effect.gen(function* () {
            const outcome = yield* attachTenantPaymentAccount(input);

            expect(outcome).toEqual({
              attached: false,
              reason: 'account-unavailable',
            });
            expect(fixture.state.transactionCalls).toBe(0);
            expect(fixture.state.updateValues).toEqual([]);
            expect(fixture.state.auditValues).toEqual([]);
          }),
      );
    });
  }

  const providerFailure = createPaymentSetupFixture({
    stripeResponse: 'unavailable',
  });
  layer(providerFailure.layer)('unexpected provider failure', (it) => {
    it.effect('keeps the failure in the defect channel', () =>
      Effect.gen(function* () {
        const exit = yield* attachTenantPaymentAccount(input).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toMatchObject({
            raw: {
              detail: providerFailure.stripeHttpClient.providerFailure,
            },
            type: 'StripeConnectionError',
          });
        }
        expect(providerFailure.state.transactionCalls).toBe(0);
        expect(providerFailure.state.updateValues).toEqual([]);
        expect(providerFailure.state.auditValues).toEqual([]);
      }),
    );
  });

  const failedUpdate = createPaymentSetupFixture({ updateReturnsRow: false });
  layer(failedUpdate.layer)('unexpected database invariant', (it) => {
    it.effect('keeps a missing update result in the defect channel', () =>
      Effect.gen(function* () {
        const exit = yield* attachTenantPaymentAccount(input).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toMatchObject({
            message: 'Payment setup update returned no rows',
          });
        }
        expect(failedUpdate.state.auditValues).toEqual([]);
      }),
    );
  });
});
