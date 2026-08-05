import { Database } from '@db/index';
import {
  eventAddons,
  eventRegistrationOptions,
  platformAuditEntries,
  templateEventAddons,
  templateRegistrationOptions,
  tenants,
  tenantStripeTaxRates,
  transactions,
} from '@db/schema';
import { describe, expect, it, layer } from '@effect/vitest';
import { Cause, Effect, Exit, Layer, Schema } from 'effect';
import Stripe from 'stripe';

import { StripeClient } from '../stripe-client';
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
  readonly auditValues: Record<string, unknown>[];
  currentAccountId: null | string;
  readonly lockModes: string[];
  readonly operationOrder: string[];
  transactionCalls: number;
  transactionSelectCalls: number;
  readonly updateValues: Record<string, unknown>[];
}

type StripeHttpRequestArguments = Parameters<
  InstanceType<typeof Stripe.HttpClient>['makeRequest']
>;

class PaymentSetupSelectQuery {
  private table: unknown;

  constructor(
    private readonly selection: Readonly<Record<string, unknown>>,
    private readonly rowsFor: (
      selection: Readonly<Record<string, unknown>>,
      table: unknown,
    ) => readonly unknown[],
    private readonly state: PaymentSetupFixtureState,
  ) {}

  for(lockMode: string) {
    this.state.lockModes.push(lockMode);
    this.state.operationOrder.push('organization-lock');
    return Effect.succeed(this.rowsFor(this.selection, this.table));
  }

  from(table: unknown): this {
    this.table = table;
    return this;
  }

  innerJoin(): this {
    return this;
  }

  limit() {
    return Effect.succeed(this.rowsFor(this.selection, this.table));
  }

  where(): this {
    return this;
  }
}

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

  const rowsFor = (
    selection: Readonly<Record<string, unknown>>,
    table: unknown,
  ): readonly unknown[] => {
    if (table === tenants) {
      return organizationExists
        ? [
            {
              domain: options.existingDomain ?? organizationDomain,
              id: organizationId,
              stripeAccountId: state.currentAccountId,
            },
          ]
        : [];
    }
    if (table === transactions) {
      state.transactionSelectCalls += 1;
      if (state.transactionSelectCalls === 1) {
        return options.pendingPayment ? [{ id: 'pending-payment' }] : [];
      }
      if (state.transactionSelectCalls === 2) {
        return options.paymentHistory ? [{ id: 'past-payment' }] : [];
      }
      throw new Error('Unexpected payment history query');
    }
    if (
      table === eventRegistrationOptions ||
      table === eventAddons ||
      table === templateRegistrationOptions ||
      table === templateEventAddons
    ) {
      if (Object.hasOwn(selection, 'stripeTaxRateId')) {
        return options.taxConfiguration
          ? [{ stripeTaxRateId: 'tax-rate-existing' }]
          : [];
      }
      return options.paidConfiguration ? [{ id: 'paid-item' }] : [];
    }
    if (table === tenantStripeTaxRates) {
      return options.importedTaxConfiguration
        ? [{ id: 'imported-tax-rate' }]
        : [];
    }

    throw new Error('Unexpected payment setup query');
  };

  const transactionDatabase = {
    insert: (table: unknown) => {
      if (table !== platformAuditEntries) {
        throw new Error('Unexpected payment setup insert');
      }
      return {
        values: (values: Record<string, unknown>) => {
          state.auditValues.push(values);
          state.operationOrder.push('audit');
          return Effect.void;
        },
      };
    },
    select: (selection: Readonly<Record<string, unknown>>) =>
      new PaymentSetupSelectQuery(selection, rowsFor, state),
    update: (table: unknown) => {
      if (table !== tenants) {
        throw new Error('Unexpected payment setup update');
      }
      let values: Record<string, unknown> | undefined;
      const query = {
        returning: () => {
          if (!values) {
            throw new Error('Payment setup update was not assigned values');
          }
          state.operationOrder.push('update');
          if (options.updateReturnsRow === false) {
            return Effect.succeed([]);
          }
          state.currentAccountId =
            typeof values['stripeAccountId'] === 'string'
              ? values['stripeAccountId']
              : null;
          return Effect.succeed([{ id: organizationId }]);
        },
        set: (nextValues: Record<string, unknown>) => {
          values = nextValues;
          state.updateValues.push(nextValues);
          return query;
        },
        where: () => query,
      };
      return query;
    },
  };

  const databaseLayer = Layer.mock(Database)({
    transaction: (run) => {
      state.transactionCalls += 1;
      state.operationOrder.push('transaction');
      return run(transactionDatabase);
    },
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
