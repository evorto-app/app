import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import { describe, expect, it, vi } from '@effect/vitest';
import { getTableName } from 'drizzle-orm';
import {
  Cause,
  ConfigProvider,
  Context,
  Effect,
  Exit,
  Layer,
  Schema,
} from 'effect';
import { SqlError, UniqueViolation } from 'effect/unstable/sql/SqlError';
import Stripe from 'stripe';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  activeEventRegistrationUniqueIndexName,
  addonToEventRegistrationOptions,
  emailOutbox,
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrationQuestions,
  eventRegistrations,
  registrationAcquisitionComponents,
  registrationAcquisitions,
  RegistrationCheckoutSnapshotSchema,
  tenants,
  tenantStripeTaxRates,
  transactions,
  userDiscountCards,
  usersToTenants,
} from '../../../../../db/schema';
import { StripeClient } from '../../../../stripe-client';
import { createRegistrationDatabaseTestLayer } from '../../../../testing/registration-database';
import {
  type ApproveManualRegistrationArguments,
  decodeRegistrationCheckoutSnapshot,
  ensureCurrentRegistrationSnapshot,
  EventRegistrationService,
  isDefinitiveCheckoutSessionCreateFailure,
  isUserEligibleForRegistrationOption,
  lockCurrentRegistrationTaxConfiguration,
  orderRegistrationAddonPurchases,
  validateRegistrationAddons,
  validateRegistrationQuestionAnswers,
} from './event-registration.service';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from './events.errors';

class UnusedStripeHttpClient extends Stripe.HttpClient {
  override getClientName() {
    return 'evorto-registration-service-test';
  }

  override makeRequest() {
    return Promise.reject(new Error('Unexpected unmocked Stripe test request'));
  }
}

const createStripeTestClient = (): Stripe => {
  const client = new Stripe('sk_test_123', {
    httpClient: new UnusedStripeHttpClient(),
  });
  vi.spyOn(client.checkout.sessions, 'create').mockRejectedValue(
    new Error('Unexpected unmocked Stripe Checkout create request'),
  );
  vi.spyOn(client.checkout.sessions, 'expire').mockRejectedValue(
    new Error('Unexpected unmocked Stripe Checkout expire request'),
  );
  return client;
};

const checkoutSessionResponse = ({
  id,
  paymentIntent,
  url,
}: {
  id: string;
  paymentIntent: Stripe.Checkout.Session['payment_intent'];
  url: string;
}): Stripe.Response<Stripe.Checkout.Session> => ({
  adaptive_pricing: null,
  after_expiration: null,
  allow_promotion_codes: null,
  amount_subtotal: null,
  amount_total: null,
  automatic_tax: {
    enabled: false,
    liability: null,
    provider: null,
    status: null,
  },
  billing_address_collection: null,
  cancel_url: null,
  client_reference_id: null,
  client_secret: null,
  collected_information: null,
  consent: null,
  consent_collection: null,
  created: 1_900_000_000,
  currency: 'eur',
  currency_conversion: null,
  custom_fields: [],
  custom_text: {
    after_submit: null,
    shipping_address: null,
    submit: null,
    terms_of_service_acceptance: null,
  },
  customer: null,
  customer_account: null,
  customer_creation: null,
  customer_details: null,
  customer_email: null,
  discounts: null,
  expires_at: 1_900_000_000,
  id,
  integration_identifier: null,
  invoice: null,
  invoice_creation: null,
  lastResponse: {
    headers: {},
    requestId: `req_${id}`,
    statusCode: 200,
  },
  livemode: false,
  locale: null,
  managed_payments: null,
  metadata: null,
  mode: 'payment',
  object: 'checkout.session',
  origin_context: null,
  payment_intent: paymentIntent,
  payment_link: null,
  payment_method_collection: null,
  payment_method_configuration_details: null,
  payment_method_options: null,
  payment_method_types: ['card'],
  payment_status: 'unpaid',
  permissions: null,
  recovered_from: null,
  saved_payment_method_options: null,
  setup_intent: null,
  shipping_address_collection: null,
  shipping_cost: null,
  shipping_options: [],
  status: 'open',
  submit_type: null,
  subscription: null,
  success_url: null,
  total_details: null,
  ui_mode: 'hosted_page',
  url,
  wallet_options: null,
});

const stripeClient = createStripeTestClient();
const tenantPublicOrigin = {
  domain: 'tenant.example.com',
} as const;
const configProviderLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: Object.fromEntries([
      ['BASE_URL', 'https://app.example'],
      ['CLIENT_ID', 'client-id'],
      ['CLIENT_SECRET', 'client-secret'],
      ['DATABASE_URL', 'postgresql://db.example/app'],
      ['E2E_NOW_ISO', '2026-09-15T12:00:00.000Z'],
      ['ISSUER_BASE_URL', 'https://issuer.example'],
      ['NODE_ENV', 'production'],
      ['SECRET', 'secret'],
    ]),
  }),
);

const questionSetLockSql = {
  event:
    'select "id" from "event_instances" where (("event_instances"."id" = $1) and ("event_instances"."tenantId" = $2)) for share',
  questions:
    'select "id", "required" from "event_registration_questions" where (("event_registration_questions"."eventId" = $1) and ("event_registration_questions"."registrationOptionId" = $2)) order by "event_registration_questions"."id" for share',
  tenant: 'select "id" from "tenants" where "tenants"."id" = $1 for key share',
};

const readQuestionSetLockFixture = ({
  parameters,
  questions = [],
  statement,
  transactionOpen,
}: {
  parameters: readonly unknown[];
  questions?: readonly Pick<
    typeof eventRegistrationQuestions.$inferSelect,
    'id' | 'required'
  >[];
  statement: string;
  transactionOpen: boolean;
}) => {
  switch (statement) {
    case questionSetLockSql.event: {
      expect(transactionOpen).toBe(true);
      expect(parameters).toEqual(['event-1', 'tenant-1']);
      return [['event-1']];
    }
    case questionSetLockSql.questions: {
      expect(transactionOpen).toBe(true);
      expect(parameters).toEqual(['event-1', 'option-1']);
      return questions.map((question) => [question.id, question.required]);
    }
    case questionSetLockSql.tenant:
    case 'select "id" from "tenants" where "tenants"."id" = $1 for update': {
      expect(transactionOpen).toBe(true);
      expect(parameters).toEqual(['tenant-1']);
      return [['tenant-1']];
    }
    default: {
      return;
    }
  }
};

type RegistrationSnapshotOption = Omit<
  Pick<
    typeof eventRegistrationOptions.$inferSelect,
    | 'closeRegistrationTime'
    | 'id'
    | 'isPaid'
    | 'openRegistrationTime'
    | 'organizingRegistration'
    | 'price'
    | 'registrationMode'
    | 'roleIds'
    | 'stripeTaxRateId'
  >,
  'roleIds'
> & {
  readonly event: null | Pick<
    typeof eventInstances.$inferSelect,
    'start' | 'status' | 'tenantId'
  >;
  readonly roleIds: readonly string[];
};

const registrationSnapshotSelectPrefix =
  'select "d0"."closeRegistrationTime"::text as "closeRegistrationTime", "d0"."id" as "id", "d0"."isPaid" as "isPaid", "d0"."openRegistrationTime"::text as "openRegistrationTime", "d0"."organizingRegistration" as "organizingRegistration", "d0"."price" as "price", "d0"."registrationMode" as "registrationMode", "d0"."roleIds" as "roleIds", "d0"."stripeTaxRateId" as "stripeTaxRateId", "event"."r" as "event" from "event_registration_options" as "d0" ';

const readRegistrationSnapshotFixture = ({
  option,
  parameters,
  statement,
  transactionOpen,
}: {
  option: null | RegistrationSnapshotOption;
  parameters: readonly unknown[];
  statement: string;
  transactionOpen: boolean;
}) => {
  if (!statement.startsWith(registrationSnapshotSelectPrefix)) return;
  expect(transactionOpen).toBe(true);
  expect(statement).toContain(
    'select "d1"."start"::text as "start", "d1"."status" as "status", "d1"."tenantId" as "tenantId" from "event_instances" as "d1"',
  );
  expect(statement).toContain('"d0"."eventId" = "d1"."id"');
  expect(
    statement.endsWith(
      ' where (("d0"."eventId" = $2) and ("d0"."id" = $3)) limit $4',
    ),
  ).toBe(true);
  expect(parameters).toEqual([1, 'event-1', 'option-1', 1]);
  if (!option) return [];
  return [
    [
      option.closeRegistrationTime.toISOString().replace('Z', ''),
      option.id,
      option.isPaid,
      option.openRegistrationTime.toISOString().replace('Z', ''),
      option.organizingRegistration,
      option.price,
      option.registrationMode,
      [...option.roleIds],
      option.stripeTaxRateId,
      option.event
        ? {
            ...option.event,
            start: option.event.start.toISOString().replace('Z', ''),
          }
        : null,
    ],
  ];
};

type RegistrationSnapshotAddon = NonNullable<
  Parameters<typeof ensureCurrentRegistrationSnapshot>[1]['addOns']
>[number];

const registrationSnapshotAddonSql =
  'select "event_addons"."id", "event_addons"."allowMultiple", "event_addons"."allowPurchaseDuringRegistration", "addon_to_event_registration_options"."included_quantity", "event_addons"."isPaid", "event_addons"."maxQuantityPerUser", "addon_to_event_registration_options"."optional_purchase_quantity", "event_addons"."price", "event_addons"."stripeTaxRateId" from "event_addons" inner join "addon_to_event_registration_options" on (("addon_to_event_registration_options"."addonId" = "event_addons"."id") and ("addon_to_event_registration_options"."eventId" = "event_addons"."eventId")) where (("event_addons"."eventId" = $1) and ("addon_to_event_registration_options"."registrationOptionId" = $2))';

const readRegistrationSnapshotAddonsFixture = ({
  addOns,
  parameters,
  statement,
  transactionOpen,
}: {
  addOns: readonly RegistrationSnapshotAddon[];
  parameters: readonly unknown[];
  statement: string;
  transactionOpen: boolean;
}) => {
  if (statement !== registrationSnapshotAddonSql) return;
  expect(transactionOpen).toBe(true);
  expect(parameters).toEqual(['event-1', 'option-1']);
  return addOns.map((addOn) => [
    addOn.addOnId,
    addOn.allowMultiple,
    addOn.allowPurchaseDuringRegistration,
    addOn.includedQuantity,
    addOn.isPaid,
    addOn.maxQuantityPerUser,
    addOn.optionalPurchaseQuantity,
    addOn.price,
    addOn.stripeTaxRateId,
  ]);
};

type RegistrationDiscountCard = Pick<
  typeof userDiscountCards.$inferSelect,
  'status' | 'type' | 'validFrom' | 'validTo'
>;
const registrationDiscountProvidersSql =
  'select "d0"."discount_providers" as "discountProviders" from "tenants" as "d0" where "d0"."id" = $1 limit $2';
const registrationDiscountRowsSql =
  'select "d0"."discountedPrice" as "discountedPrice", "d0"."discountType" as "discountType" from "event_registration_option_discounts" as "d0" where "d0"."registrationOptionId" = $1';
const registrationDiscountCardsSql =
  'select "status", "type", "validFrom"::text, "validTo"::text from "user_discount_cards" where (("user_discount_cards"."tenantId" = $1) and ("user_discount_cards"."userId" = $2)) order by "user_discount_cards"."id" for share';
const readLockedNoDiscountFixture = ({
  parameters,
  statement,
  transactionOpen,
}: {
  parameters: readonly unknown[];
  statement: string;
  transactionOpen: boolean;
}) => {
  if (!transactionOpen) return;
  if (statement === registrationDiscountProvidersSql) {
    expect(parameters).toEqual(['tenant-1', 1]);
    return [[{ esnCard: { config: {}, status: 'disabled' } }]];
  }
  if (statement === registrationDiscountCardsSql) {
    expect(parameters).toEqual(['tenant-1', 'user-1']);
    return [];
  }
  if (statement === registrationDiscountRowsSql) {
    expect(parameters).toEqual(['option-1']);
    return [];
  }
  return;
};

const approvedRegistrationOption = {
  closeRegistrationTime: new Date('2026-09-20T10:00:00.000Z'),
  confirmedSpots: 0,
  event: {
    start: new Date('2026-09-18T10:00:00.000Z'),
    status: 'APPROVED',
    tenantId: 'tenant-1',
    title: 'Approved event',
  },
  eventId: 'event-1',
  id: 'option-1',
  isPaid: false,
  openRegistrationTime: new Date('2026-09-10T10:00:00.000Z'),
  organizingRegistration: false,
  price: 0,
  registrationMode: 'fcfs',
  reservedSpots: 0,
  roleIds: ['role-1'],
  spots: 10,
  stripeTaxRateId: null,
} as const;

const paidManualApprovalRegistration = {
  addonPurchases: [],
  appliedDiscountedPrice: null,
  appliedDiscountType: null,
  basePriceAtRegistration: null,
  discountAmount: null,
  event: {
    start: new Date('2026-09-18T10:00:00.000Z'),
    status: 'APPROVED',
    tenantId: 'tenant-1',
    title: 'Approved event',
  },
  eventId: 'event-1',
  guestCount: 0,
  id: 'registration-1',
  registrationOption: {
    eventId: 'event-1',
    id: 'option-1',
    isPaid: true,
    price: 1000,
    registrationMode: 'application',
    stripeTaxRateId: 'txr_19',
  },
  registrationOptionId: 'option-1',
  status: 'PENDING',
  transactions: [],
  user: {
    communicationEmail: 'alice@example.com',
    email: 'alice@example.com',
  },
  userId: 'user-1',
} as const;

const createPaidManualApprovalDatabase = ({
  bindingCommitAmbiguous = false,
  bindingSucceeds = true,
  operationOrder,
  persistCommittedEmail = true,
  registrationStatuses = ['PENDING'],
}: {
  bindingCommitAmbiguous?: boolean;
  bindingSucceeds?: boolean;
  operationOrder: string[];
  persistCommittedEmail?: boolean;
  registrationStatuses?: readonly ('CANCELLED' | 'PENDING')[];
}) =>
  createManualApprovalDatabase({
    bindingCommitAmbiguous,
    bindingSucceeds,
    operationOrder,
    persistCommittedEmail,
    registrationStatuses,
  }).pipe(Effect.map((fixture) => fixture.database));

const createPaidDirectRegistrationDatabase = ({
  bindingSucceeds,
  operationOrder,
  registrationOption = {},
}: {
  bindingSucceeds: boolean;
  operationOrder: string[];
  registrationOption?: { isPaid?: boolean; price?: number };
}) =>
  createDirectCheckoutDatabase({
    bindingSucceeds,
    operationOrder,
    registrationOption,
  }).pipe(Effect.map((fixture) => fixture.database));

const freeManualApprovalRegistration = {
  ...paidManualApprovalRegistration,
  registrationOption: {
    ...paidManualApprovalRegistration.registrationOption,
    isPaid: false,
    price: 0,
    stripeTaxRateId: null,
  },
} as const;

const transactionCurrencySchema = Schema.Literals(['EUR', 'CZK', 'AUD']);

type ManualApprovalClaim = Pick<
  typeof transactions.$inferSelect,
  | 'appFee'
  | 'currency'
  | 'id'
  | 'stripeAccountId'
  | 'stripeCheckoutRequest'
  | 'stripeCheckoutSessionId'
  | 'stripeCheckoutUrl'
>;

const createManualApprovalDatabase = ({
  bindingCommitAmbiguous = false,
  bindingSucceeds = true,
  discountSettings,
  existingClaim = null,
  lockedStripeAccountId = 'acct_123',
  operationOrder = [],
  persistCommittedEmail = true,
  registration = paidManualApprovalRegistration,
  registrationStatuses = ['PENDING'],
}: {
  bindingCommitAmbiguous?: boolean;
  bindingSucceeds?: boolean;
  discountSettings?: {
    tenantRecord: undefined | { discountProviders: null | object };
  };
  existingClaim?: ManualApprovalClaim | null;
  lockedStripeAccountId?: null | string;
  operationOrder?: string[];
  persistCommittedEmail?: boolean;
  registration?:
    | typeof freeManualApprovalRegistration
    | typeof paidManualApprovalRegistration;
  registrationStatuses?: readonly ('CANCELLED' | 'PENDING')[];
} = {}) =>
  Effect.gen(function* () {
    let bindingUpdateCount = 0;
    let tenantSettingsReadCount = 0;
    let acquisitionComponentInsertValues:
      | readonly Pick<
          typeof registrationAcquisitionComponents.$inferSelect,
          'allocationKey' | 'grossAmount' | 'kind' | 'netAmount'
        >[]
      | undefined;
    let acquisitionInsertValues:
      | Pick<
          typeof registrationAcquisitions.$inferSelect,
          | 'kind'
          | 'operationKey'
          | 'ordinal'
          | 'ownerUserId'
          | 'registrationId'
          | 'spotCount'
        >
      | undefined;
    let claim: ManualApprovalClaim | null = existingClaim;
    let claimExecutiveUserId: null | string | undefined;
    let claimInsertValues: typeof transactions.$inferInsert | undefined;
    let claimInsertCount = 0;
    let emailInsertCount = 0;
    const emailKinds: string[] = [];
    let reservationUpdateCount = 0;
    let registrationLockCount = 0;
    let registrationUpdateValues:
      Partial<typeof eventRegistrations.$inferSelect> | undefined;
    let transactionCount = 0;
    let transactionOpen = false;
    let persistedEmail = false;
    let releasedClaimId: string | undefined;
    const claimRows = () =>
      claim
        ? [
            [
              claim.appFee,
              claim.currency,
              claim.id,
              claim.stripeAccountId,
              claim.stripeCheckoutRequest,
              claim.stripeCheckoutSessionId,
              claim.stripeCheckoutUrl,
            ],
          ]
        : [];
    const string = Schema.decodeUnknownSync(Schema.String);
    const number = Schema.decodeUnknownSync(Schema.Number);
    const nullableString = Schema.decodeUnknownSync(
      Schema.NullOr(Schema.String),
    );
    const databaseLayer = createRegistrationDatabaseTestLayer({
      executeValues: (statement, parameters) =>
        Effect.sync(() => {
          const questionSetRows = readQuestionSetLockFixture({
            parameters,
            statement,
            transactionOpen,
          });
          if (questionSetRows) return questionSetRows;
          const snapshotRows = readRegistrationSnapshotFixture({
            option: {
              ...approvedRegistrationOption,
              ...registration.registrationOption,
              event: registration.event,
            },
            parameters,
            statement,
            transactionOpen,
          });
          if (snapshotRows) return snapshotRows;
          const discountRows = readLockedNoDiscountFixture({
            parameters,
            statement,
            transactionOpen,
          });
          if (discountRows) return discountRows;
          if (
            statement.includes(` from "${getTableName(eventRegistrations)}"`) &&
            statement.includes('row_to_json')
          ) {
            expect(parameters).toEqual([
              1,
              1,
              1,
              1,
              'event-1',
              'registration-1',
              'tenant-1',
              1,
            ]);
            return [
              [
                registration.appliedDiscountedPrice,
                registration.appliedDiscountType,
                registration.basePriceAtRegistration,
                registration.discountAmount,
                registration.eventId,
                registration.guestCount,
                registration.id,
                registration.registrationOptionId,
                registration.status,
                registration.userId,
                registration.addonPurchases,
                {
                  ...registration.event,
                  start: registration.event.start
                    .toISOString()
                    .replace('Z', ''),
                },
                registration.registrationOption,
                registration.user,
              ],
            ];
          }
          if (
            statement.includes(
              ` from "${getTableName(tenantStripeTaxRates)}"`,
            ) &&
            !statement.includes(' for update')
          ) {
            expect(parameters).toEqual([
              true,
              true,
              'acct_123',
              'txr_19',
              'tenant-1',
              1,
            ]);
            return [['VAT', true, '19']];
          }
          if (
            statement.includes(' from "tenants"') &&
            statement.includes('"discountProviders"')
          ) {
            expect(parameters).toEqual(['tenant-1', 1]);
            expect(statement).not.toContain(' for update');
            tenantSettingsReadCount += 1;
            if (!discountSettings)
              throw new Error('Unexpected tenant settings fixture read');
            return discountSettings.tenantRecord
              ? [[discountSettings.tenantRecord.discountProviders]]
              : [];
          }
          if (statement.includes(' from "user_discount_cards"')) {
            expect(parameters).toEqual(['verified', 'tenant-1', 'user-1']);
            return discountSettings
              ? [['esnCard', '2026-12-31T00:00:00.000']]
              : [];
          }
          if (
            statement.startsWith('select ') &&
            statement.includes(
              ` from "${getTableName(eventRegistrationOptions)}"`,
            )
          ) {
            expect(statement).toContain(' for update');
            expect(parameters).toEqual(['option-1', 'event-1']);
            return [[registration.registrationOption.stripeTaxRateId]];
          }
          if (
            statement.startsWith('select ') &&
            statement.includes(` from "${getTableName(eventRegistrations)}"`)
          ) {
            expect(statement).toMatch(/^select "status" from /);
            expect(statement).toContain(' for update');
            expect(parameters).toEqual(
              expect.arrayContaining(['registration-1', 'tenant-1', 'event-1']),
            );
            expect(parameters).toHaveLength(3);
            const status =
              registrationStatuses[
                Math.min(registrationLockCount, registrationStatuses.length - 1)
              ] ?? 'PENDING';
            registrationLockCount += 1;
            return [[status]];
          }
          if (
            statement.startsWith('select ') &&
            statement.includes(` from "${getTableName(tenants)}"`)
          ) {
            expect(statement).toContain(' for update');
            expect(parameters).toEqual(['tenant-1']);
            return [[lockedStripeAccountId]];
          }
          if (
            statement.startsWith('select ') &&
            statement.includes(` from "${getTableName(tenantStripeTaxRates)}"`)
          ) {
            expect(statement).toContain(' for update');
            expect(statement).toContain('order by');
            expect(parameters).toEqual([
              'tenant-1',
              lockedStripeAccountId,
              true,
              true,
              'txr_19',
            ]);
            return [['VAT', true, '19', 'txr_19']];
          }
          if (
            statement.startsWith('select ') &&
            statement.includes(` from "${getTableName(emailOutbox)}"`)
          ) {
            expect(statement).toContain(' for update');
            expect(claim).not.toBeNull();
            expect(parameters).toEqual([
              'tenant-1',
              'manualApproval',
              `manual-approval/tenant-1/registration-1/${claim?.id}`,
            ]);
            return persistedEmail ? [['email-1']] : [];
          }
          if (
            statement.startsWith('select ') &&
            statement.includes(
              ` from "${getTableName(eventRegistrationAddonPurchaseLots)}"`,
            )
          ) {
            expect(statement).toContain(' for update');
            expect(parameters).toEqual(['registration-1', 'tenant-1']);
            return [];
          }
          if (
            statement.startsWith('select ') &&
            statement.includes(
              ` from "${getTableName(registrationAcquisitions)}"`,
            )
          ) {
            expect(statement).toContain(' for update');
            expect(parameters).toEqual(['tenant-1', 'registration-1']);
            return [];
          }
          if (
            statement.startsWith('select ') &&
            statement.includes(` from "${getTableName(transactions)}"`)
          ) {
            if (statement.startsWith('select "appFee", ')) {
              expect(parameters).toEqual(
                !statement.includes(' for update') && claim
                  ? [claim.id]
                  : [
                      'registration-1',
                      'stripe',
                      'pending',
                      'tenant-1',
                      'registration',
                    ],
              );
              return claimRows();
            }
            expect(statement).toContain(' for update');
            if (!claim)
              throw new Error('Cannot select absent manual approval claim');
            if (statement.startsWith('select "method", ')) {
              expect(parameters).toEqual([
                claim.id,
                'tenant-1',
                'registration-1',
              ]);
              return [
                [
                  'stripe',
                  'pending',
                  null,
                  claim.stripeCheckoutSessionId,
                  'registration',
                ],
              ];
            }
            expect(parameters).toEqual([
              claim.id,
              'registration-1',
              'stripe',
              'pending',
              'tenant-1',
              'registration',
            ]);
            expect(statement).toContain(
              'select "stripe_checkout_cancellation_requested_at"::text, "stripeCheckoutSessionId"',
            );
            return [[null, claim.stripeCheckoutSessionId]];
          }
          if (
            statement.startsWith(`insert into "${getTableName(transactions)}"`)
          ) {
            expect(statement).toContain('on conflict do nothing returning');
            expect(parameters).toHaveLength(15);
            const id = string(parameters[0]);
            const tenantId = string(parameters[1]);
            const amount = number(parameters[2]);
            const appFee = number(parameters[3]);
            const comment = string(parameters[4]);
            const currency = Schema.decodeUnknownSync(
              transactionCurrencySchema,
            )(parameters[5]);
            const eventId = string(parameters[6]);
            const eventRegistrationId = string(parameters[7]);
            claimExecutiveUserId = nullableString(parameters[8]);
            const method = Schema.decodeUnknownSync(Schema.Literal('stripe'))(
              parameters[9],
            );
            const status = Schema.decodeUnknownSync(Schema.Literal('pending'))(
              parameters[10],
            );
            const stripeAccountId = string(parameters[11]);
            const stripeCheckoutRequest = Schema.decodeUnknownSync(
              Schema.fromJsonString(RegistrationCheckoutSnapshotSchema),
            )(parameters[12]);
            const targetUserId = string(parameters[13]);
            const type = Schema.decodeUnknownSync(
              Schema.Literal('registration'),
            )(parameters[14]);
            expect({
              eventId,
              eventRegistrationId,
              targetUserId,
              tenantId,
            }).toEqual({
              eventId: 'event-1',
              eventRegistrationId: 'registration-1',
              targetUserId: 'user-1',
              tenantId: 'tenant-1',
            });
            claimInsertCount += 1;
            operationOrder.push('claim');
            claimInsertValues = {
              amount,
              appFee,
              comment,
              currency,
              eventId,
              eventRegistrationId,
              executiveUserId: claimExecutiveUserId,
              id,
              method,
              status,
              stripeAccountId,
              stripeCheckoutRequest,
              targetUserId,
              tenantId,
              type,
            };
            claim = {
              appFee,
              currency,
              id,
              stripeAccountId,
              stripeCheckoutRequest,
              stripeCheckoutSessionId: null,
              stripeCheckoutUrl: null,
            };
            return claimRows();
          }
          if (
            statement.startsWith(`insert into "${getTableName(emailOutbox)}"`)
          ) {
            expect(statement).toContain(
              'on conflict ("idempotency_key") do nothing',
            );
            expect(parameters).toHaveLength(12);
            expect(parameters[1]).toBe('tenant-1');
            expect(parameters[5]).toBe(
              `manual-approval/tenant-1/registration-1/${claim?.id ?? 'confirmed'}`,
            );
            expect(parameters[6]).toBe('manualApproval');
            emailInsertCount += 1;
            persistedEmail = persistCommittedEmail;
            emailKinds.push(string(parameters[6]));
            operationOrder.push('email');
            return [];
          }
          if (
            statement.startsWith(
              `insert into "${getTableName(registrationAcquisitions)}"`,
            )
          ) {
            expect(parameters).toHaveLength(10);
            expect(parameters[1]).toBe('event-1');
            expect(parameters[9]).toBe('tenant-1');
            acquisitionInsertValues = {
              kind: Schema.decodeUnknownSync(Schema.Literal('initial'))(
                parameters[3],
              ),
              operationKey: string(parameters[4]),
              ordinal: number(parameters[5]),
              ownerUserId: string(parameters[6]),
              registrationId: string(parameters[7]),
              spotCount: number(parameters[8]),
            };
            return [];
          }
          if (
            statement.startsWith(
              `insert into "${getTableName(registrationAcquisitionComponents)}"`,
            )
          ) {
            expect(parameters).toHaveLength(19);
            acquisitionComponentInsertValues = [
              {
                allocationKey: string(parameters[2]),
                grossAmount: number(parameters[7]),
                kind: Schema.decodeUnknownSync(Schema.Literal('registration'))(
                  parameters[9],
                ),
                netAmount: number(parameters[10]),
              },
            ];
            return [];
          }
          if (
            statement.startsWith(
              `update "${getTableName(eventRegistrationAddonPurchaseLots)}"`,
            )
          ) {
            expect(parameters).toEqual(
              parameters[0] === null
                ? [
                    null,
                    expect.any(String),
                    'registration-1',
                    'tenant-1',
                    releasedClaimId,
                  ]
                : [claim?.id, expect.any(String), 'registration-1', 'tenant-1'],
            );
            return [];
          }
          if (
            statement.startsWith(
              `update "${getTableName(eventRegistrationOptions)}"`,
            )
          ) {
            expect(statement).toContain('returning "id"');
            expect(parameters).toEqual(
              expect.arrayContaining(['option-1', 'event-1']),
            );
            reservationUpdateCount += 1;
            operationOrder.push(
              reservationUpdateCount === 1 ? 'reserve' : 'release-capacity',
            );
            return [['option-1']];
          }
          if (
            statement.startsWith(`update "${getTableName(eventRegistrations)}"`)
          ) {
            expect(statement).toContain('returning "id"');
            expect(parameters).toEqual(
              expect.arrayContaining(['registration-1', 'tenant-1', 'PENDING']),
            );
            registrationUpdateValues = {
              appliedDiscountedPrice: Schema.decodeUnknownSync(
                Schema.NullOr(Schema.Number),
              )(parameters[0]),
              appliedDiscountType: Schema.decodeUnknownSync(
                Schema.NullOr(Schema.Literal('esnCard')),
              )(parameters[1]),
              basePriceAtRegistration: number(parameters[2]),
              discountAmount: number(parameters[4]),
              status: Schema.decodeUnknownSync(
                Schema.Literals(['PENDING', 'CONFIRMED']),
              )(parameters[5]),
            };
            operationOrder.push('registration');
            return [['registration-1']];
          }
          if (statement.startsWith(`update "${getTableName(transactions)}"`)) {
            if (!claim)
              throw new Error('Cannot update an absent manual approval claim');
            expect(statement).toContain('returning "id"');
            expect(parameters).toEqual(
              expect.arrayContaining([claim.id, 'tenant-1', 'registration-1']),
            );
            const update = statement.slice(0, statement.indexOf(' where '));
            if (update.includes('"status" =')) {
              expect(parameters).toContain('cancelled');
              operationOrder.push('release-claim');
              const id = claim.id;
              releasedClaimId = id;
              claim = null;
              return [[id]];
            }
            bindingUpdateCount += 1;
            operationOrder.push('bind');
            if (!bindingSucceeds) return [];
            claim = {
              ...claim,
              stripeCheckoutSessionId: string(parameters[6]),
              stripeCheckoutUrl: string(parameters[7]),
            };
            return [[claim.id]];
          }
          throw new Error(
            `Unexpected manual approval fixture SQL: ${statement} parameters=${JSON.stringify(parameters)}`,
          );
        }),
      transactionControl: (command) =>
        Effect.gen(function* () {
          transactionOpen = command === 'BEGIN';
          if (command === 'BEGIN') transactionCount += 1;
          if (
            bindingCommitAmbiguous &&
            command === 'COMMIT' &&
            transactionCount === 2
          ) {
            return yield* Effect.die(
              new Error('binding commit acknowledgement lost'),
            );
          }
        }),
    });
    const context = yield* Layer.build(databaseLayer);
    const database = Context.get(context, Database);
    return {
      acquisitionComponentInsertValues: () => acquisitionComponentInsertValues,
      acquisitionInsertValues: () => acquisitionInsertValues,
      bindingUpdateCount: () => bindingUpdateCount,
      claimExecutiveUserId: () => claimExecutiveUserId,
      claimInsertCount: () => claimInsertCount,
      claimInsertValues: () => claimInsertValues,
      database,
      emailInsertCount: () => emailInsertCount,
      emailKinds,
      getClaim: () => claim,
      operationOrder,
      registrationUpdateValues: () => registrationUpdateValues,
      reservationUpdateCount: () => reservationUpdateCount,
      tenantSettingsReadCount: () => tenantSettingsReadCount,
      transactionCount: () => transactionCount,
    };
  });
const runManualApproval = ({
  database,
  executiveUserId = 'organizer-1',
  onApproved,
  stripe,
  stripeAccountId = 'acct_123',
}: {
  database: DatabaseClient;
  executiveUserId?: null | string;
  onApproved?: ApproveManualRegistrationArguments['onApproved'];
  stripe: Stripe;
  stripeAccountId?: string | undefined;
}) =>
  EventRegistrationService.approveManualRegistration({
    executiveUserId,
    expectedEventId: 'event-1',
    ...(onApproved && { onApproved }),
    registrationId: 'registration-1',
    targetTenant: {
      ...tenantPublicOrigin,
      currency: 'EUR',
      emailSenderEmail: null,
      emailSenderName: null,
      id: 'tenant-1',
      name: 'Tenant',
      stripeAccountId,
    },
  }).pipe(
    Effect.provide(EventRegistrationService.Default),
    Effect.provide(Layer.succeed(Database, database)),
    Effect.provideService(StripeClient, stripe),
    Effect.provide(configProviderLayer),
  );

const createDirectCheckoutDatabase = ({
  bindingSucceeds = true,
  configuredStripeTaxRateId = 'txr_19',
  discountSettings,
  lockedStripeAccountId = 'acct_123',
  operationOrder = [],
  registrationOption = {},
}: {
  bindingSucceeds?: boolean;
  configuredStripeTaxRateId?: string;
  discountSettings?: {
    tenantRecord: undefined | { discountProviders: null | object };
  };
  lockedStripeAccountId?: string;
  operationOrder?: string[];
  registrationOption?: {
    isPaid?: boolean;
    price?: number;
    stripeTaxRateId?: null | string;
  };
} = {}) => {
  const effectiveStripeTaxRateId =
    registrationOption.isPaid === false
      ? null
      : (registrationOption.stripeTaxRateId ?? configuredStripeTaxRateId);
  const option = {
    ...approvedRegistrationOption,
    isPaid: true,
    price: 1000,
    stripeTaxRateId: effectiveStripeTaxRateId,
    ...registrationOption,
  };
  let bindingUpdateCount = 0;
  let tenantSettingsReadCount = 0;
  let claim: ManualApprovalClaim | null = null;
  let claimInsertCount = 0;
  let claimStatus: 'cancelled' | 'pending' = 'pending';
  let registration:
    | Pick<
        typeof eventRegistrations.$inferSelect,
        | 'eventId'
        | 'guestCount'
        | 'id'
        | 'registrationOptionId'
        | 'status'
        | 'userId'
      >
    | undefined;
  let reservationUpdateCount = 0;
  let acquisitionId: string | undefined;
  let transactionSnapshot:
    | undefined
    | {
        claim: ManualApprovalClaim | null;
        claimStatus: 'cancelled' | 'pending';
        registration: typeof registration;
      };

  const requireClaim = () => {
    if (!claim) throw new Error('Direct checkout fixture has no payment claim');
    return claim;
  };
  const requireRegistration = () => {
    if (!registration)
      throw new Error('Direct checkout fixture has no registration');
    return registration;
  };
  const claimRow = (current: ManualApprovalClaim) => [
    current.appFee,
    current.currency,
    current.id,
    current.stripeAccountId,
    current.stripeCheckoutRequest,
    current.stripeCheckoutSessionId,
    current.stripeCheckoutUrl,
  ];
  const assertLockedRead = (statement: string) => {
    expect(transactionSnapshot).toBeDefined();
    expect(statement).toContain(' for update');
  };

  const readDirectRegistration: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      if (statement.includes(' for update')) {
        assertLockedRead(statement);
        if (statement.startsWith('select "guest_count",')) {
          expect(parameters).toEqual([
            requireRegistration().id,
            'tenant-1',
            'event-1',
          ]);
          return registration
            ? [
                [
                  registration.guestCount,
                  registration.registrationOptionId,
                  registration.status,
                ],
              ]
            : [];
        }
        expect(statement).toContain('select "status" from');
        expect(parameters).toEqual([
          requireRegistration().id,
          'event-1',
          'tenant-1',
        ]);
        return registration ? [[registration.status]] : [];
      }
      expect(statement).toContain(
        transactionSnapshot
          ? 'select "d0"."id" as "id" from "event_registrations" as "d0"'
          : 'select "d0"."id" as "id", "d0"."registrationOptionId" as "registrationOptionId", "d0"."status" as "status" from "event_registrations" as "d0"',
      );
      expect(parameters).toEqual([
        'event-1',
        'CANCELLED',
        'tenant-1',
        'user-1',
        ...(transactionSnapshot ? [] : [1]),
      ]);
      return registration && registration.status !== 'CANCELLED'
        ? [
            transactionSnapshot
              ? [registration.id]
              : [
                  registration.id,
                  registration.registrationOptionId,
                  registration.status,
                ],
          ]
        : [];
    });

  const readDirectOption: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      if (!statement.includes(' for update')) {
        expect(parameters).toEqual([1, 'event-1', 'option-1', 1]);
        return [
          [
            option.closeRegistrationTime.toISOString().replace('Z', ''),
            option.confirmedSpots,
            option.eventId,
            option.id,
            option.isPaid,
            option.openRegistrationTime.toISOString().replace('Z', ''),
            option.organizingRegistration,
            option.price,
            option.registrationMode,
            option.reservedSpots,
            [...option.roleIds],
            option.spots,
            option.stripeTaxRateId,
            {
              ...option.event,
              start: option.event.start.toISOString().replace('Z', ''),
            },
            [],
          ],
        ];
      }
      assertLockedRead(statement);
      expect(parameters).toEqual(['option-1', 'event-1']);
      return [[effectiveStripeTaxRateId]];
    });

  const readDirectClaim: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      if (!statement.includes(' for update')) {
        expect(statement).toContain(
          'select "appFee", "currency", "id", "stripe_account_id", "stripe_checkout_request", "stripeCheckoutSessionId", "stripeCheckoutUrl" from "transactions"',
        );
        expect(parameters).toEqual([
          requireRegistration().id,
          'stripe',
          'pending',
          'tenant-1',
          'registration',
        ]);
        return claim ? [claimRow(claim)] : [];
      }
      assertLockedRead(statement);
      const current = requireClaim();
      if (statement.startsWith('select "method",')) {
        expect(statement).toContain(
          'select "method", "status", "stripe_checkout_cancellation_requested_at"::text, "stripeCheckoutSessionId", "type" from "transactions"',
        );
        expect(parameters).toEqual(
          statement.includes('"eventRegistrationId" = $2')
            ? [current.id, requireRegistration().id, 'tenant-1']
            : [current.id, 'tenant-1', requireRegistration().id],
        );
        return [
          [
            'stripe',
            claimStatus,
            null,
            current.stripeCheckoutSessionId,
            'registration',
          ],
        ];
      }
      expect(parameters).toEqual([
        current.id,
        requireRegistration().id,
        'stripe',
        'pending',
        'tenant-1',
        'registration',
      ]);
      const projection = statement.slice(0, statement.indexOf(' from '));
      expect(projection).toBe(
        projection.includes('"stripeCheckoutUrl"')
          ? 'select "stripe_checkout_cancellation_requested_at"::text, "stripeCheckoutSessionId", "stripeCheckoutUrl"'
          : 'select "stripe_checkout_cancellation_requested_at"::text, "stripeCheckoutSessionId"',
      );
      return projection.includes('"stripeCheckoutUrl"')
        ? [[null, current.stripeCheckoutSessionId, current.stripeCheckoutUrl]]
        : [[null, current.stripeCheckoutSessionId]];
    });

  const insertDirectRegistration: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      expect(transactionSnapshot).toBeDefined();
      expect(statement).toContain(' returning "id"');
      const guestCount = Schema.decodeUnknownSync(Schema.Number)(parameters[7]);
      const status = Schema.decodeUnknownSync(
        Schema.Literals(['CONFIRMED', 'PENDING']),
      )(parameters[9]);
      expect(parameters).toEqual([
        null,
        null,
        option.isPaid ? option.price : 0,
        expect.any(String),
        'tenant-1',
        0,
        'event-1',
        guestCount,
        'option-1',
        status,
        ...(effectiveStripeTaxRateId
          ? [effectiveStripeTaxRateId, 'VAT', true, '19']
          : []),
        'user-1',
      ]);
      expect(status).toBe(
        option.isPaid && option.price > 0 ? 'PENDING' : 'CONFIRMED',
      );
      operationOrder.push(
        status === 'CONFIRMED' ? 'confirm-registration' : 'registration',
      );
      // Keep the original deterministic response identity for dependent assertions.
      registration = {
        eventId: 'event-1',
        guestCount,
        id: 'registration-direct',
        registrationOptionId: 'option-1',
        status,
        userId: 'user-1',
      };
      return [[registration.id]];
    });

  const insertDirectClaim: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      expect(transactionSnapshot).toBeDefined();
      expect(statement).toContain(
        ' returning "appFee", "currency", "id", "stripe_account_id", "stripe_checkout_request", "stripeCheckoutSessionId", "stripeCheckoutUrl"',
      );
      const amount = option.price * (requireRegistration().guestCount + 1);
      const id = Schema.decodeUnknownSync(Schema.String)(parameters[0]);
      const request = Schema.decodeUnknownSync(
        RegistrationCheckoutSnapshotSchema,
      )(JSON.parse(Schema.decodeUnknownSync(Schema.String)(parameters[12])));
      expect(parameters).toEqual([
        id,
        'tenant-1',
        amount,
        Math.round(amount * 0.035),
        'Registration for event Approved event event-1',
        'EUR',
        'event-1',
        requireRegistration().id,
        'user-1',
        'stripe',
        'pending',
        lockedStripeAccountId,
        JSON.stringify(request),
        'user-1',
        'registration',
      ]);
      claimInsertCount += 1;
      operationOrder.push('claim');
      claimStatus = 'pending';
      claim = {
        appFee: Math.round(amount * 0.035),
        currency: 'EUR',
        id,
        stripeAccountId: lockedStripeAccountId,
        stripeCheckoutRequest: request,
        stripeCheckoutSessionId: null,
        stripeCheckoutUrl: null,
      };
      return [claimRow(claim)];
    });

  const updateDirectCapacity: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      expect(transactionSnapshot).toBeDefined();
      const spotCount = Schema.decodeUnknownSync(Schema.Number)(parameters[0]);
      expect(parameters).toEqual([
        spotCount,
        expect.any(String),
        'option-1',
        'event-1',
        spotCount,
      ]);
      expect(statement).toContain(' returning "id"');
      reservationUpdateCount += 1;
      if (statement.includes('"confirmedSpots" =')) {
        expect(statement).toContain('"confirmedSpots" +');
        operationOrder.push('confirm-capacity');
      } else if (statement.includes('"reservedSpots" -')) {
        expect(spotCount).toBe(requireRegistration().guestCount + 1);
        operationOrder.push('release-capacity');
      } else {
        expect(statement).toContain('"reservedSpots" =');
        expect(statement).toContain('"reservedSpots" +');
        operationOrder.push('reserve');
      }
      return [['option-1']];
    });

  const updateDirectClaim: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      const current = requireClaim();
      expect(transactionSnapshot).toBeDefined();
      expect(statement).toContain(' returning "id"');
      const update = statement.slice(0, statement.indexOf(' where '));
      if (update.includes('"status" =')) {
        expect(parameters).toEqual([
          expect.any(String),
          'cancelled',
          current.id,
          'tenant-1',
          requireRegistration().id,
          'stripe',
          'pending',
          'registration',
          ...(parameters.length === 9 ? [expect.any(String)] : []),
        ]);
        expect(statement).toContain(
          '"stripe_checkout_cancellation_requested_at" is null',
        );
        expect(statement).toContain('"stripeCheckoutSessionId" is null');
        operationOrder.push('release-claim');
        claimStatus = 'cancelled';
        claim = null;
        return [[current.id]];
      }
      const sessionId = Schema.decodeUnknownSync(Schema.String)(parameters[6]);
      const url = Schema.decodeUnknownSync(Schema.String)(parameters[7]);
      const paymentIntentId = update.includes('"stripePaymentIntentId" =')
        ? Schema.decodeUnknownSync(Schema.String)(parameters[8])
        : undefined;
      expect(parameters).toEqual([
        expect.any(String),
        0,
        null,
        null,
        null,
        expect.any(String),
        sessionId,
        url,
        ...(paymentIntentId === undefined ? [] : [paymentIntentId]),
        current.id,
        requireRegistration().id,
        'stripe',
        'pending',
        'tenant-1',
        'registration',
      ]);
      expect(statement).toContain(
        '"stripe_checkout_cancellation_requested_at" is null',
      );
      expect(statement).toContain('"stripeCheckoutSessionId" is null');
      bindingUpdateCount += 1;
      operationOrder.push('bind');
      if (!bindingSucceeds) return [];
      claim = {
        ...current,
        stripeCheckoutSessionId: sessionId,
        stripeCheckoutUrl: url,
      };
      return [[current.id]];
    });

  const executeDirectStatement: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.gen(function* () {
      const questionSetRows = readQuestionSetLockFixture({
        parameters,
        statement,
        transactionOpen: transactionSnapshot !== undefined,
      });
      if (questionSetRows) return questionSetRows;
      const snapshotRows = readRegistrationSnapshotFixture({
        option,
        parameters,
        statement,
        transactionOpen: transactionSnapshot !== undefined,
      });
      if (snapshotRows) return snapshotRows;
      const addonRows = readRegistrationSnapshotAddonsFixture({
        addOns: [],
        parameters,
        statement,
        transactionOpen: transactionSnapshot !== undefined,
      });
      if (addonRows) return addonRows;
      const discountRows = readLockedNoDiscountFixture({
        parameters,
        statement,
        transactionOpen: transactionSnapshot !== undefined,
      });
      if (discountRows) return discountRows;
      if (
        statement.startsWith(
          `insert into "${getTableName(eventRegistrations)}"`,
        )
      )
        return yield* insertDirectRegistration(statement, parameters);
      if (statement.startsWith(`insert into "${getTableName(transactions)}"`))
        return yield* insertDirectClaim(statement, parameters);
      if (
        statement.startsWith(
          `update "${getTableName(eventRegistrationOptions)}"`,
        )
      )
        return yield* updateDirectCapacity(statement, parameters);
      if (statement.startsWith(`update "${getTableName(transactions)}"`))
        return yield* updateDirectClaim(statement, parameters);
      if (
        statement.startsWith(`update "${getTableName(eventRegistrations)}"`)
      ) {
        expect(transactionSnapshot).toBeDefined();
        expect(parameters).toEqual([
          expect.any(String),
          'CANCELLED',
          requireRegistration().id,
          'tenant-1',
          'PENDING',
        ]);
        expect(statement).toContain(' returning "id"');
        const current = requireRegistration();
        operationOrder.push('cancel-registration');
        registration = { ...current, status: 'CANCELLED' };
        return [[current.id]];
      }
      if (
        statement.startsWith(
          `insert into "${getTableName(registrationAcquisitions)}"`,
        )
      ) {
        expect(transactionSnapshot).toBeDefined();
        acquisitionId = Schema.decodeUnknownSync(Schema.String)(parameters[2]);
        expect(parameters).toEqual([
          expect.any(String),
          'event-1',
          acquisitionId,
          'initial',
          `registration-initial:${requireRegistration().id}`,
          0,
          'user-1',
          requireRegistration().id,
          requireRegistration().guestCount + 1,
          'tenant-1',
        ]);
        return [];
      }
      if (
        statement.startsWith(
          `insert into "${getTableName(registrationAcquisitionComponents)}"`,
        )
      ) {
        expect(transactionSnapshot).toBeDefined();
        expect(acquisitionId).toBeDefined();
        expect(parameters).toEqual([
          expect.any(String),
          acquisitionId,
          `registration-initial:${requireRegistration().id}`,
          0,
          0,
          'EUR',
          'event-1',
          0,
          expect.any(String),
          'registration',
          0,
          requireRegistration().guestCount + 1,
          requireRegistration().id,
          0,
          0,
          null,
          null,
          null,
          'tenant-1',
        ]);
        return [];
      }
      if (statement.startsWith(`insert into "${getTableName(emailOutbox)}"`)) {
        expect(transactionSnapshot).toBeDefined();
        expect(statement).toContain(
          'on conflict ("idempotency_key") do nothing',
        );
        expect(parameters).toEqual([
          expect.any(String),
          'tenant-1',
          'no-reply@notifications.evorto.app',
          'Evorto',
          expect.any(String),
          `registration-confirmed/tenant-1/${requireRegistration().id}`,
          'registrationConfirmed',
          null,
          null,
          'Registration confirmed: Approved event',
          expect.any(String),
          'alice@example.com',
        ]);
        return [];
      }
      if (!statement.startsWith('select '))
        throw new Error(`Unexpected direct checkout fixture SQL: ${statement}`);
      if (statement.includes(` from "${getTableName(eventRegistrations)}"`))
        return yield* readDirectRegistration(statement, parameters);
      if (
        statement.includes(` from "${getTableName(eventRegistrationOptions)}"`)
      )
        return yield* readDirectOption(statement, parameters);
      if (statement.includes(` from "${getTableName(transactions)}"`))
        return yield* readDirectClaim(statement, parameters);
      if (statement.includes(` from "${getTableName(eventAddons)}"`)) {
        expect(statement).toContain(' inner join ');
        expect(statement).toContain(' left join ');
        expect(statement).toContain('"event_addons"."isPaid"');
        expect(parameters).toEqual([
          'tenant-1',
          expect.any(String),
          true,
          true,
          'event-1',
          'option-1',
        ]);
        return [];
      }
      if (
        statement.includes(' from "tenants"') &&
        statement.includes('"discountProviders"')
      ) {
        expect(parameters).toEqual(['tenant-1', 1]);
        expect(statement).not.toContain(' for update');
        tenantSettingsReadCount += 1;
        if (!discountSettings)
          throw new Error('Unexpected tenant settings fixture read');
        return discountSettings.tenantRecord
          ? [[discountSettings.tenantRecord.discountProviders]]
          : [];
      }
      if (statement.includes(' from "user_discount_cards"')) {
        expect(parameters).toEqual(['verified', 'tenant-1', 'user-1']);
        return discountSettings ? [['esnCard', '2026-12-31T00:00:00.000']] : [];
      }
      if (
        statement.includes(' from "tenants"') &&
        !statement.includes(' for update')
      ) {
        expect(transactionSnapshot).toBeDefined();
        expect(statement).toContain(
          'select "d0"."email_sender_email" as "emailSenderEmail", "d0"."email_sender_name" as "emailSenderName", "d0"."id" as "id", "d0"."name" as "name"',
        );
        expect(parameters).toEqual(['tenant-1', 1]);
        return [[null, null, 'tenant-1', 'Tenant']];
      }
      if (statement.includes(' from "users"')) {
        expect(transactionSnapshot).toBeDefined();
        expect(statement).toBe(
          'select "d0"."communicationEmail" as "communicationEmail" from "users" as "d0" where "d0"."id" = $1 limit $2',
        );
        expect(parameters).toEqual(['user-1', 1]);
        return [['alice@example.com']];
      }
      if (statement.includes(` from "${getTableName(tenantStripeTaxRates)}"`)) {
        if (statement.includes(' for update')) {
          assertLockedRead(statement);
          expect(parameters).toEqual([
            'tenant-1',
            lockedStripeAccountId,
            true,
            true,
            effectiveStripeTaxRateId,
          ]);
          return [['VAT', true, '19', configuredStripeTaxRateId]];
        }
        expect(parameters).toEqual([
          true,
          true,
          expect.any(String),
          effectiveStripeTaxRateId,
          'tenant-1',
          1,
        ]);
        return [['VAT', true, '19']];
      }
      assertLockedRead(statement);
      if (statement.includes(` from "${getTableName(usersToTenants)}"`)) {
        expect(parameters).toEqual(['tenant-1', 'user-1']);
        return [['tenant-user-1']];
      }
      if (statement.includes(` from "${getTableName(tenants)}"`)) {
        expect(parameters).toEqual(['tenant-1']);
        return [[lockedStripeAccountId]];
      }
      if (
        statement.includes(` from "${getTableName(registrationAcquisitions)}"`)
      ) {
        expect(parameters).toEqual(['tenant-1', requireRegistration().id]);
        return [];
      }
      if (
        statement.includes(
          ` from "${getTableName(eventRegistrationAddonPurchases)}"`,
        )
      ) {
        expect(parameters).toEqual([requireRegistration().id]);
        return [];
      }
      throw new Error(`Unexpected direct checkout fixture SQL: ${statement}`);
    });

  return Effect.gen(function* () {
    const context = yield* Layer.build(
      createRegistrationDatabaseTestLayer({
        executeValues: executeDirectStatement,
        transactionControl: (command) =>
          Effect.sync(() => {
            if (command === 'BEGIN') {
              expect(transactionSnapshot).toBeUndefined();
              transactionSnapshot = {
                claim: claim ? { ...claim } : null,
                claimStatus,
                registration: registration ? { ...registration } : undefined,
              };
              return;
            }
            if (!transactionSnapshot)
              throw new Error(
                'Direct checkout fixture transaction was not begun',
              );
            if (command === 'ROLLBACK') {
              claim = transactionSnapshot.claim;
              claimStatus = transactionSnapshot.claimStatus;
              registration = transactionSnapshot.registration;
            }
            transactionSnapshot = undefined;
          }),
      }),
    );
    return {
      bindingUpdateCount: () => bindingUpdateCount,
      claimInsertCount: () => claimInsertCount,
      database: Context.get(context, Database),
      getClaim: () => claim,
      getRegistrationId: () => requireRegistration().id,
      operationOrder,
      reservationUpdateCount: () => reservationUpdateCount,
      tenantSettingsReadCount: () => tenantSettingsReadCount,
    };
  });
};
const runDirectCheckout = ({
  database,
  stripe,
  stripeAccountId = 'acct_123',
}: {
  database: DatabaseClient;
  stripe: Stripe;
  stripeAccountId?: string;
}) =>
  EventRegistrationService.registerForEvent({
    eventId: 'event-1',
    guestCount: 0,
    registrationOptionId: 'option-1',
    tenant: {
      ...tenantPublicOrigin,
      currency: 'EUR',
      id: 'tenant-1',
      stripeAccountId,
    },
    user: {
      email: 'alice@example.com',
      id: 'user-1',
      roleIds: ['role-1'],
    },
  }).pipe(
    Effect.provide(EventRegistrationService.Default),
    Effect.provide(Layer.succeed(Database, database)),
    Effect.provideService(StripeClient, stripe),
    Effect.provide(configProviderLayer),
  );

const approveManualRegistrationForTest = ({
  eventId,
  registrationId,
  tenant,
  user,
}: {
  eventId: string;
  registrationId: string;
  tenant: ApproveManualRegistrationArguments['targetTenant'];
  user: { id: string };
}) =>
  EventRegistrationService.approveManualRegistration({
    executiveUserId: user.id,
    expectedEventId: eventId,
    registrationId,
    targetTenant: tenant,
  });

type ReadWaitlistOption = Omit<
  Pick<
    typeof eventRegistrationOptions.$inferSelect,
    | 'closeRegistrationTime'
    | 'confirmedSpots'
    | 'eventId'
    | 'id'
    | 'isPaid'
    | 'openRegistrationTime'
    | 'organizingRegistration'
    | 'price'
    | 'registrationMode'
    | 'reservedSpots'
    | 'roleIds'
    | 'spots'
    | 'stripeTaxRateId'
  >,
  'roleIds'
> & {
  readonly event: Pick<
    typeof eventInstances.$inferSelect,
    'start' | 'status' | 'tenantId' | 'title'
  >;
  readonly questions?: readonly Pick<
    typeof eventRegistrationQuestions.$inferSelect,
    'id' | 'required'
  >[];
  readonly roleIds: readonly string[];
};

const createReadEligibilityDatabaseFixture = ({
  existingRegistration,
  option,
}: {
  readonly existingRegistration?: Pick<
    typeof eventRegistrations.$inferSelect,
    'id' | 'registrationOptionId' | 'status'
  >;
  readonly option: null | ReadWaitlistOption;
}) =>
  Effect.gen(function* () {
    const readExistingRegistration: SqlConnection.Connection['executeValues'] =
      (statement, parameters) =>
        Effect.sync(() => {
          expect(statement).toBe(
            'select "d0"."id" as "id", "d0"."registrationOptionId" as "registrationOptionId", "d0"."status" as "status" from "event_registrations" as "d0" where (("d0"."eventId" = $1) and (not ("d0"."status" = $2)) and ("d0"."tenantId" = $3) and ("d0"."userId" = $4)) limit $5',
          );
          expect(parameters).toEqual([
            'event-1',
            'CANCELLED',
            'tenant-1',
            'user-1',
            1,
          ]);
          return existingRegistration
            ? [
                [
                  existingRegistration.id,
                  existingRegistration.registrationOptionId,
                  existingRegistration.status,
                ],
              ]
            : [];
        });
    const readRegistrationOption: SqlConnection.Connection['executeValues'] = (
      statement,
      parameters,
    ) =>
      Effect.sync(() => {
        expect(statement).toContain(
          'select "d0"."closeRegistrationTime"::text as "closeRegistrationTime", "d0"."confirmedSpots" as "confirmedSpots", "d0"."eventId" as "eventId", "d0"."id" as "id", "d0"."isPaid" as "isPaid", "d0"."openRegistrationTime"::text as "openRegistrationTime", "d0"."organizingRegistration" as "organizingRegistration", "d0"."price" as "price", "d0"."registrationMode" as "registrationMode", "d0"."reservedSpots" as "reservedSpots", "d0"."roleIds" as "roleIds", "d0"."spots" as "spots", "d0"."stripeTaxRateId" as "stripeTaxRateId", "event"."r" as "event", "questions"."r" as "questions" from "event_registration_options" as "d0"',
        );
        expect(statement).toContain(
          'where (("d0"."eventId" = $2) and ("d0"."id" = $3)) limit $4',
        );
        expect(parameters).toEqual([1, 'event-1', 'option-1', 1]);
        if (!option) return [];
        return [
          [
            option.closeRegistrationTime.toISOString().replace('Z', ''),
            option.confirmedSpots,
            option.eventId,
            option.id,
            option.isPaid,
            option.openRegistrationTime.toISOString().replace('Z', ''),
            option.organizingRegistration,
            option.price,
            option.registrationMode,
            option.reservedSpots,
            [...option.roleIds],
            option.spots,
            option.stripeTaxRateId,
            {
              ...option.event,
              start: option.event.start.toISOString().replace('Z', ''),
            },
            option.questions ?? [],
          ],
        ];
      });
    const context = yield* Layer.build(
      createRegistrationDatabaseTestLayer({
        executeValues: (statement, parameters) => {
          if (statement.includes(' from "event_registrations" as "d0"'))
            return readExistingRegistration(statement, parameters);
          if (statement.includes(' from "event_registration_options" as "d0"'))
            return readRegistrationOption(statement, parameters);
          return Effect.die(
            new Error(
              `Unexpected registration eligibility fixture SQL: ${statement}`,
            ),
          );
        },
        transactionControl: () =>
          Effect.die(
            new Error('Unexpected registration eligibility transaction'),
          ),
      }),
    );
    const database = Context.get(context, Database);
    return {
      database,
      findRegistration: vi.spyOn(
        database.query.eventRegistrations,
        'findFirst',
      ),
      findRegistrationOption: vi.spyOn(
        database.query.eventRegistrationOptions,
        'findFirst',
      ),
      updateOptionCounters: vi.spyOn(database, 'update'),
    };
  });

type ScopedRegistrationAnswerInsert = Pick<
  typeof eventRegistrationQuestionAnswers.$inferSelect,
  | 'answer'
  | 'eventId'
  | 'id'
  | 'questionId'
  | 'registrationId'
  | 'registrationOptionId'
  | 'tenantId'
>;

const expectScopedRegistrationAnswerInsert = (
  statement: string,
  parameters: readonly unknown[],
  registrationId: string,
): ScopedRegistrationAnswerInsert => {
  expect(statement).toBe(
    'insert into "event_registration_question_answers" ("answer", "createdAt", "eventId", "id", "questionId", "registrationId", "registrationOptionId", "tenantId", "updatedAt") values ($1, default, $2, $3, $4, $5, $6, $7, default)',
  );
  const id = Schema.decodeUnknownSync(Schema.String)(parameters[2]);
  expect(id.length).toBeGreaterThan(0);
  expect(parameters).toEqual([
    'Vegetarian',
    'event-1',
    id,
    'question-1',
    registrationId,
    'option-1',
    'tenant-1',
  ]);
  return {
    answer: 'Vegetarian',
    eventId: 'event-1',
    id,
    questionId: 'question-1',
    registrationId,
    registrationOptionId: 'option-1',
    tenantId: 'tenant-1',
  };
};

const createCurrentWaitlistDatabaseFixture = ({
  activeFutureRegistrationIds = [],
  insertFailure,
  option,
}: {
  readonly activeFutureRegistrationIds?: readonly string[];
  readonly insertFailure?: SqlError;
  readonly option: ReadWaitlistOption;
}) =>
  Effect.gen(function* () {
    let inTransaction = false;
    const transactionCommands: ('BEGIN' | 'COMMIT' | 'ROLLBACK')[] = [];
    const answerInserts: ScopedRegistrationAnswerInsert[] = [];
    const readExistingRegistration: SqlConnection.Connection['executeValues'] =
      (statement, parameters) =>
        Effect.sync(() => {
          expect(inTransaction).toBe(false);
          expect(statement).toBe(
            'select "d0"."id" as "id" from "event_registrations" as "d0" where (("d0"."eventId" = $1) and (not ("d0"."status" = $2)) and ("d0"."tenantId" = $3) and ("d0"."userId" = $4)) limit $5',
          );
          expect(parameters).toEqual([
            'event-1',
            'CANCELLED',
            'tenant-1',
            'user-1',
            1,
          ]);
          return [];
        });
    const readWaitlistOption: SqlConnection.Connection['executeValues'] = (
      statement,
      parameters,
    ) =>
      Effect.sync(() => {
        expect(inTransaction).toBe(false);
        expect(statement).toContain(
          'select "d0"."closeRegistrationTime"::text as "closeRegistrationTime", "d0"."confirmedSpots" as "confirmedSpots", "d0"."eventId" as "eventId", "d0"."id" as "id", "d0"."openRegistrationTime"::text as "openRegistrationTime", "d0"."organizingRegistration" as "organizingRegistration", "d0"."registrationMode" as "registrationMode", "d0"."reservedSpots" as "reservedSpots", "d0"."roleIds" as "roleIds", "d0"."spots" as "spots", "event"."r" as "event", "questions"."r" as "questions" from "event_registration_options" as "d0"',
        );
        expect(statement).toContain(
          'where (("d0"."eventId" = $2) and ("d0"."id" = $3)) limit $4',
        );
        expect(parameters).toEqual([1, 'event-1', 'option-1', 1]);
        return [
          [
            option.closeRegistrationTime.toISOString().replace('Z', ''),
            option.confirmedSpots,
            option.eventId,
            option.id,
            option.openRegistrationTime.toISOString().replace('Z', ''),
            option.organizingRegistration,
            option.registrationMode,
            option.reservedSpots,
            [...option.roleIds],
            option.spots,
            { status: option.event.status, tenantId: option.event.tenantId },
            option.questions ?? [],
          ],
        ];
      });
    const lockMembership = vi.fn<SqlConnection.Connection['executeValues']>(
      (statement, parameters) =>
        Effect.sync(() => {
          expect(inTransaction).toBe(true);
          expect(statement).toBe(
            `select "id" from "${getTableName(usersToTenants)}" where (("${getTableName(usersToTenants)}"."tenantId" = $1) and ("${getTableName(usersToTenants)}"."userId" = $2)) for update`,
          );
          expect(parameters).toEqual(['tenant-1', 'user-1']);
          return [['membership-1']];
        }),
    );
    const findActiveRegistrations = vi.fn<
      SqlConnection.Connection['executeValues']
    >((statement, parameters) =>
      Effect.sync(() => {
        expect(inTransaction).toBe(true);
        expect(lockMembership).toHaveBeenCalledOnce();
        expect(statement).toBe(
          'select "d0"."id" as "id" from "event_registrations" as "d0" where (("d0"."eventId" = $1) and (not ("d0"."status" = $2)) and ("d0"."tenantId" = $3) and ("d0"."userId" = $4))',
        );
        expect(parameters).toEqual([
          'event-1',
          'CANCELLED',
          'tenant-1',
          'user-1',
        ]);
        return [];
      }),
    );
    const findActiveFutureRegistrations = vi.fn<
      SqlConnection.Connection['executeValues']
    >((statement, parameters) =>
      Effect.sync(() => {
        expect(inTransaction).toBe(true);
        expect(findActiveRegistrations).toHaveBeenCalledOnce();
        expect(statement).toBe(
          `select "${getTableName(eventRegistrations)}"."id" from "${getTableName(eventRegistrations)}" inner join "${getTableName(eventInstances)}" on "${getTableName(eventInstances)}"."id" = "${getTableName(eventRegistrations)}"."eventId" where (("${getTableName(eventRegistrations)}"."tenantId" = $1) and ("${getTableName(eventRegistrations)}"."userId" = $2) and ("${getTableName(eventRegistrations)}"."status" <> 'CANCELLED') and ("${getTableName(eventInstances)}"."start" > $3)) limit $4`,
        );
        expect(parameters).toEqual([
          'tenant-1',
          'user-1',
          new Date('2026-09-15T12:00:00.000Z'),
          1,
        ]);
        return activeFutureRegistrationIds.map((id) => [id]);
      }),
    );
    const updateWaitlistCounter = vi.fn<
      SqlConnection.Connection['executeValues']
    >((statement, parameters) =>
      Effect.sync(() => {
        expect(inTransaction).toBe(true);
        expect(findActiveRegistrations).toHaveBeenCalledOnce();
        expect(statement).toBe(
          'update "event_registration_options" set "updatedAt" = $1, "waitlistSpots" = "event_registration_options"."waitlistSpots" + 1 where (("event_registration_options"."id" = $2) and ("event_registration_options"."eventId" = $3) and ("event_registration_options"."confirmedSpots" + "event_registration_options"."reservedSpots" >= "event_registration_options"."spots")) returning "id"',
        );
        expect(parameters).toEqual([expect.any(String), 'option-1', 'event-1']);
        return [['option-1']];
      }),
    );
    const insertWaitlistRegistration = vi.fn<
      SqlConnection.Connection['executeValues']
    >((statement, parameters) =>
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          expect(inTransaction).toBe(true);
          expect(updateWaitlistCounter).toHaveBeenCalledOnce();
          expect(statement).toContain('insert into "event_registrations"');
          expect(statement).toContain(' returning "id"');
          expect(parameters).toEqual([
            expect.any(String),
            'tenant-1',
            'event-1',
            'option-1',
            'WAITLIST',
            'user-1',
          ]);
        });
        if (insertFailure) return yield* Effect.fail(insertFailure);
        return [['waitlist-1']];
      }),
    );
    const context = yield* Layer.build(
      createRegistrationDatabaseTestLayer({
        executeValues: (statement, parameters) => {
          const questionSetRows = readQuestionSetLockFixture({
            parameters,
            questions: option.questions ?? [],
            statement,
            transactionOpen: inTransaction,
          });
          if (questionSetRows) return Effect.succeed(questionSetRows);
          const snapshotRows = readRegistrationSnapshotFixture({
            option,
            parameters,
            statement,
            transactionOpen: inTransaction,
          });
          if (snapshotRows) return Effect.succeed(snapshotRows);
          if (statement.includes(` from "${getTableName(usersToTenants)}"`))
            return lockMembership(statement, parameters);
          if (
            statement.includes(` inner join "${getTableName(eventInstances)}"`)
          )
            return findActiveFutureRegistrations(statement, parameters);
          if (statement.startsWith('update "event_registration_options"'))
            return updateWaitlistCounter(statement, parameters);
          if (statement.startsWith('insert into "event_registrations"'))
            return insertWaitlistRegistration(statement, parameters);
          if (
            statement.startsWith(
              'insert into "event_registration_question_answers"',
            )
          )
            return Effect.sync(() => {
              expect(inTransaction).toBe(true);
              expect(insertWaitlistRegistration).toHaveBeenCalledOnce();
              answerInserts.push(
                expectScopedRegistrationAnswerInsert(
                  statement,
                  parameters,
                  'waitlist-1',
                ),
              );
              return [];
            });
          if (statement.includes(' from "event_registrations" as "d0"'))
            return inTransaction
              ? findActiveRegistrations(statement, parameters)
              : readExistingRegistration(statement, parameters);
          if (statement.includes(' from "event_registration_options" as "d0"'))
            return readWaitlistOption(statement, parameters);
          return Effect.die(
            new Error(`Unexpected current waitlist fixture SQL: ${statement}`),
          );
        },
        transactionControl: (command) =>
          Effect.sync(() => {
            expect(inTransaction).toBe(command !== 'BEGIN');
            transactionCommands.push(command);
            inTransaction = command === 'BEGIN';
          }),
      }),
    );
    return {
      answerInserts,
      database: Context.get(context, Database),
      findActiveFutureRegistrations,
      findActiveRegistrations,
      insertWaitlistRegistration,
      lockMembership,
      transactionCommands,
      updateWaitlistCounter,
    };
  });

type CurrentReservationAcquisitionInsert =
  typeof registrationAcquisitions.$inferSelect;
type CurrentReservationAddonLotInsert = Omit<
  typeof eventRegistrationAddonPurchaseLots.$inferSelect,
  | 'cancelledQuantity'
  | 'createdAt'
  | 'redeemedQuantity'
  | 'refundAllocatedApplicationFeeAmount'
  | 'refundAllocatedGrossAmount'
  | 'refundAllocatedNetAmount'
  | 'refundAllocatedQuantity'
  | 'updatedAt'
>;
type CurrentReservationAddonPurchaseInsert = Omit<
  typeof eventRegistrationAddonPurchases.$inferSelect,
  'cancelledQuantity' | 'createdAt' | 'updatedAt'
>;
type CurrentReservationComponentInsert =
  typeof registrationAcquisitionComponents.$inferSelect;
type CurrentReservationEmailInsert = Pick<
  typeof emailOutbox.$inferSelect,
  | 'html'
  | 'id'
  | 'idempotencyKey'
  | 'kind'
  | 'replyToEmail'
  | 'replyToName'
  | 'subject'
  | 'tenantId'
  | 'text'
  | 'toEmail'
>;
type CurrentReservationRegistrationInsert = Pick<
  typeof eventRegistrations.$inferSelect,
  | 'appliedDiscountedPrice'
  | 'appliedDiscountType'
  | 'basePriceAtRegistration'
  | 'discountAmount'
  | 'eventId'
  | 'guestCount'
  | 'id'
  | 'registrationOptionId'
  | 'status'
  | 'tenantId'
  | 'userId'
>;

const createCurrentReservationWriteFixtures = ({
  addon,
  communicationEmail,
  emailSenderEmail,
  emailSenderName,
  guestCount,
  manualApproval,
  throwUniqueViolation = false,
}: {
  addon?: { includedQuantity: number; selectedQuantity: number };
  communicationEmail: string;
  emailSenderEmail: null | string;
  emailSenderName: null | string;
  guestCount: number;
  manualApproval: boolean;
  throwUniqueViolation?: boolean;
}) => {
  const registrationInserts: CurrentReservationRegistrationInsert[] = [];
  const acquisitionInserts: CurrentReservationAcquisitionInsert[] = [];
  const acquisitionComponentInserts: CurrentReservationComponentInsert[] = [];
  const emailInserts: CurrentReservationEmailInsert[] = [];
  const addonPurchaseInserts: CurrentReservationAddonPurchaseInsert[] = [];
  const addonLotInserts: CurrentReservationAddonLotInsert[] = [];
  const writeOrder: string[] = [];

  const requireString = (value: unknown) => {
    const text = Schema.decodeUnknownSync(Schema.String)(value);
    expect(text.length).toBeGreaterThan(0);
    return text;
  };
  const requireDate = (value: unknown) => {
    const text = requireString(value);
    const date = new Date(text);
    expect(Number.isNaN(date.getTime())).toBe(false);
    expect(date.toISOString()).toBe(text);
    return date;
  };
  const expectInsert = (
    statement: string,
    table: string,
    columns: readonly string[],
    rows: readonly (readonly string[])[],
    suffix = '',
  ) => {
    expect(statement).toBe(
      `insert into "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) values ${rows.map((row) => `(${row.join(', ')})`).join(', ')}${suffix}`,
    );
  };
  const requireRegistrationId = () => {
    const registration = registrationInserts[0];
    if (!registration)
      throw new Error(
        'CurrentReservation fixture has no inserted registration',
      );
    return registration.id;
  };
  const requireAddon = () => {
    if (!addon)
      throw new Error('CurrentReservation fixture has no configured add-on');
    return addon;
  };
  const requireAcquisition = () => {
    const acquisition = acquisitionInserts[0];
    if (!acquisition)
      throw new Error('CurrentReservation fixture has no acquisition');
    return acquisition;
  };
  const requirePurchase = () => {
    const purchase = addonPurchaseInserts[0];
    if (!purchase)
      throw new Error('CurrentReservation fixture has no add-on purchase');
    return purchase;
  };
  const requireLot = () => {
    const lot = addonLotInserts[0];
    if (!lot)
      throw new Error('CurrentReservation fixture has no add-on purchase lot');
    return lot;
  };

  const insertRegistration: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.gen(function* () {
      expectInsert(
        statement,
        getTableName(eventRegistrations),
        [
          'applied_discounted_price',
          'applied_discount_type',
          'base_price_at_registration',
          'createdAt',
          'id',
          'updatedAt',
          'tenantId',
          'checked_in_guest_count',
          'checkInTime',
          'discount_amount',
          'eventId',
          'guest_count',
          'paymentId',
          'registrationOptionId',
          'status',
          'tax_rate_id',
          'tax_rate_name',
          'tax_rate_inclusive',
          'tax_rate_percentage',
          'userId',
        ],
        [
          manualApproval
            ? [
                'default',
                'default',
                'default',
                'default',
                '$1',
                'default',
                '$2',
                'default',
                'default',
                'default',
                '$3',
                '$4',
                'default',
                '$5',
                '$6',
                'default',
                'default',
                'default',
                'default',
                '$7',
              ]
            : [
                '$1',
                '$2',
                '$3',
                'default',
                '$4',
                'default',
                '$5',
                'default',
                'default',
                '$6',
                '$7',
                '$8',
                'default',
                '$9',
                '$10',
                'default',
                'default',
                'default',
                'default',
                '$11',
              ],
        ],
        ' returning "id"',
      );
      const generatedId = requireString(parameters[manualApproval ? 0 : 3]);
      expect(parameters).toEqual(
        manualApproval
          ? [
              generatedId,
              'tenant-1',
              'event-1',
              guestCount,
              'option-1',
              'PENDING',
              'user-1',
            ]
          : [
              null,
              null,
              0,
              generatedId,
              'tenant-1',
              0,
              'event-1',
              guestCount,
              'option-1',
              'CONFIRMED',
              'user-1',
            ],
      );
      writeOrder.push('registration');
      if (throwUniqueViolation) {
        return yield* Effect.fail(
          new SqlError({
            reason: new UniqueViolation({
              cause: new Error('duplicate active registration'),
              constraint: activeEventRegistrationUniqueIndexName,
            }),
          }),
        );
      }
      registrationInserts.push({
        appliedDiscountedPrice: null,
        appliedDiscountType: null,
        basePriceAtRegistration: manualApproval ? null : 0,
        discountAmount: manualApproval ? null : 0,
        eventId: 'event-1',
        guestCount,
        id: generatedId,
        registrationOptionId: 'option-1',
        status: manualApproval ? 'PENDING' : 'CONFIRMED',
        tenantId: 'tenant-1',
        userId: 'user-1',
      });
      return [[generatedId]];
    });

  const insertAcquisition: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      const registrationId = requireRegistrationId();
      expect(manualApproval).toBe(false);
      expectInsert(
        statement,
        getTableName(registrationAcquisitions),
        [
          'acquired_at',
          'event_id',
          'id',
          'kind',
          'operation_key',
          'ordinal',
          'owner_user_id',
          'previous_acquisition_id',
          'registration_id',
          'spot_count',
          'tenant_id',
          'transfer_id',
        ],
        [
          [
            '$1',
            '$2',
            '$3',
            '$4',
            '$5',
            '$6',
            '$7',
            'default',
            '$8',
            '$9',
            '$10',
            'default',
          ],
        ],
      );
      const acquiredAt = requireDate(parameters[0]);
      const id = requireString(parameters[2]);
      expect(parameters).toEqual([
        acquiredAt.toISOString(),
        'event-1',
        id,
        'initial',
        `registration-initial:${registrationId}`,
        0,
        'user-1',
        registrationId,
        guestCount + 1,
        'tenant-1',
      ]);
      acquisitionInserts.push({
        acquiredAt,
        eventId: 'event-1',
        id,
        kind: 'initial',
        operationKey: `registration-initial:${registrationId}`,
        ordinal: 0,
        ownerUserId: 'user-1',
        previousAcquisitionId: null,
        registrationId,
        spotCount: guestCount + 1,
        tenantId: 'tenant-1',
        transferId: null,
      });
      writeOrder.push('acquisition');
      return [];
    });

  const insertAcquisitionComponents: SqlConnection.Connection['executeValues'] =
    (statement, parameters) =>
      Effect.sync(() => {
        const registrationId = requireRegistrationId();
        expect(manualApproval).toBe(false);
        const acquisition = requireAcquisition();
        const componentId = requireString(parameters[8]);
        const registrationValues = [
          acquisition.acquiredAt.toISOString(),
          acquisition.id,
          `registration-initial:${registrationId}`,
          0,
          0,
          'EUR',
          'event-1',
          0,
          componentId,
          'registration',
          0,
          guestCount + 1,
          registrationId,
          0,
          0,
          null,
          null,
          null,
          'tenant-1',
        ];
        const rows = [
          [
            '$1',
            '$2',
            'default',
            '$3',
            '$4',
            '$5',
            '$6',
            '$7',
            '$8',
            '$9',
            '$10',
            '$11',
            'default',
            'default',
            '$12',
            '$13',
            '$14',
            '$15',
            '$16',
            '$17',
            '$18',
            '$19',
          ],
        ];
        const expectedParameters = [...registrationValues];
        const recorded: CurrentReservationComponentInsert[] = [
          {
            acquiredAt: acquisition.acquiredAt,
            acquisitionId: acquisition.id,
            acquisitionPaymentId: null,
            allocationKey: `registration-initial:${registrationId}`,
            applicationFeeAmount: 0,
            baseAmount: 0,
            currency: 'EUR',
            eventId: 'event-1',
            grossAmount: 0,
            id: componentId,
            kind: 'registration',
            netAmount: 0,
            purchaseId: null,
            purchaseLotId: null,
            quantity: guestCount + 1,
            registrationId,
            stripeFeeAmount: 0,
            taxAmount: 0,
            taxRateDisplayName: null,
            taxRateInclusive: null,
            taxRatePercentage: null,
            tenantId: 'tenant-1',
          },
        ];
        if (addon && addon.selectedQuantity > 0) {
          const purchase = requirePurchase();
          const lot = requireLot();
          const addonComponentId = requireString(parameters[27]);
          expect(addonComponentId).not.toBe(componentId);
          expect(lot.paymentAllocationFinalizedAt).toEqual(
            acquisition.acquiredAt,
          );
          expectedParameters.push(
            acquisition.acquiredAt.toISOString(),
            acquisition.id,
            `addon-lot:${lot.id}`,
            0,
            0,
            'EUR',
            'event-1',
            0,
            addonComponentId,
            'addon_lot',
            0,
            purchase.id,
            lot.id,
            addon.selectedQuantity,
            registrationId,
            0,
            0,
            null,
            null,
            null,
            'tenant-1',
          );
          rows.push([
            '$20',
            '$21',
            'default',
            '$22',
            '$23',
            '$24',
            '$25',
            '$26',
            '$27',
            '$28',
            '$29',
            '$30',
            '$31',
            '$32',
            '$33',
            '$34',
            '$35',
            '$36',
            '$37',
            '$38',
            '$39',
            '$40',
          ]);
          recorded.push({
            acquiredAt: acquisition.acquiredAt,
            acquisitionId: acquisition.id,
            acquisitionPaymentId: null,
            allocationKey: `addon-lot:${lot.id}`,
            applicationFeeAmount: 0,
            baseAmount: 0,
            currency: 'EUR',
            eventId: 'event-1',
            grossAmount: 0,
            id: addonComponentId,
            kind: 'addon_lot',
            netAmount: 0,
            purchaseId: purchase.id,
            purchaseLotId: lot.id,
            quantity: addon.selectedQuantity,
            registrationId,
            stripeFeeAmount: 0,
            taxAmount: 0,
            taxRateDisplayName: null,
            taxRateInclusive: null,
            taxRatePercentage: null,
            tenantId: 'tenant-1',
          });
        }
        expectInsert(
          statement,
          getTableName(registrationAcquisitionComponents),
          [
            'acquired_at',
            'acquisition_id',
            'acquisition_payment_id',
            'allocation_key',
            'application_fee_amount',
            'base_amount',
            'currency',
            'event_id',
            'gross_amount',
            'id',
            'kind',
            'net_amount',
            'purchase_id',
            'purchase_lot_id',
            'quantity',
            'registration_id',
            'stripe_fee_amount',
            'tax_amount',
            'tax_rate_name',
            'tax_rate_inclusive',
            'tax_rate_percentage',
            'tenant_id',
          ],
          rows,
        );
        expect(parameters).toEqual(expectedParameters);
        acquisitionComponentInserts.push(...recorded);
        writeOrder.push('acquisition-components');
        return [];
      });

  const insertEmail: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      const registrationId = requireRegistrationId();
      expect(manualApproval).toBe(false);
      expectInsert(
        statement,
        getTableName(emailOutbox),
        [
          'createdAt',
          'id',
          'updatedAt',
          'tenantId',
          'attempts',
          'claim_lease_expires_at',
          'claim_lease_id',
          'delivery_unknown_at',
          'exhausted_at',
          'from_email',
          'from_name',
          'html',
          'idempotency_key',
          'kind',
          'last_attempt_at',
          'last_error',
          'max_attempts',
          'next_attempt_at',
          'provider',
          'provider_message_id',
          'reply_to_email',
          'reply_to_name',
          'sent_at',
          'status',
          'subject',
          'suppressed_at',
          'text',
          'to_email',
        ],
        [
          [
            'default',
            '$1',
            'default',
            '$2',
            'default',
            'default',
            'default',
            'default',
            'default',
            '$3',
            '$4',
            '$5',
            '$6',
            '$7',
            'default',
            'default',
            'default',
            'default',
            'default',
            'default',
            '$8',
            '$9',
            'default',
            'default',
            '$10',
            'default',
            '$11',
            '$12',
          ],
        ],
        ' on conflict ("idempotency_key") do nothing',
      );
      const id = requireString(parameters[0]);
      const html = requireString(parameters[4]);
      const text = requireString(parameters[10]);
      const replyToEmail = emailSenderEmail?.trim() || null;
      const replyToName = replyToEmail
        ? emailSenderName?.trim() || 'Tenant'
        : null;
      expect(parameters).toEqual([
        id,
        'tenant-1',
        'no-reply@notifications.evorto.app',
        'Evorto',
        html,
        `registration-confirmed/tenant-1/${registrationId}`,
        'registrationConfirmed',
        replyToEmail,
        replyToName,
        'Registration confirmed: Approved event',
        text,
        communicationEmail,
      ]);
      expect(html).toContain('https://tenant.example.com/events/event-1');
      expect(text).toContain('https://tenant.example.com/events/event-1');
      emailInserts.push({
        html,
        id,
        idempotencyKey: `registration-confirmed/tenant-1/${registrationId}`,
        kind: 'registrationConfirmed',
        replyToEmail,
        replyToName,
        subject: 'Registration confirmed: Approved event',
        tenantId: 'tenant-1',
        text,
        toEmail: communicationEmail,
      });
      writeOrder.push('email');
      return [];
    });

  const insertAddonPurchase: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      const registrationId = requireRegistrationId();
      const configuredAddon = requireAddon();
      expectInsert(
        statement,
        getTableName(eventRegistrationAddonPurchases),
        [
          'addonId',
          'cancelled_quantity',
          'createdAt',
          'eventId',
          'id',
          'included_quantity',
          'purchased_quantity',
          'quantity',
          'redeemed_quantity',
          'refund_allocated_purchased_quantity',
          'registrationId',
          'registration_option_id',
          'tax_rate_name',
          'tax_rate_inclusive',
          'tax_rate_percentage',
          'tenantId',
          'unit_price',
          'updatedAt',
        ],
        [
          [
            '$1',
            'default',
            'default',
            '$2',
            '$3',
            '$4',
            '$5',
            '$6',
            '$7',
            '$8',
            '$9',
            '$10',
            'default',
            'default',
            'default',
            '$11',
            '$12',
            'default',
          ],
        ],
      );
      const id = requireString(parameters[2]);
      const quantity =
        configuredAddon.includedQuantity + configuredAddon.selectedQuantity;
      expect(parameters).toEqual([
        'addon-1',
        'event-1',
        id,
        configuredAddon.includedQuantity,
        configuredAddon.selectedQuantity,
        quantity,
        0,
        0,
        registrationId,
        'option-1',
        'tenant-1',
        0,
      ]);
      addonPurchaseInserts.push({
        addonId: 'addon-1',
        eventId: 'event-1',
        id,
        includedQuantity: configuredAddon.includedQuantity,
        purchasedQuantity: configuredAddon.selectedQuantity,
        quantity,
        redeemedQuantity: 0,
        refundAllocatedPurchasedQuantity: 0,
        registrationId,
        registrationOptionId: 'option-1',
        taxRateDisplayName: null,
        taxRateInclusive: null,
        taxRatePercentage: null,
        tenantId: 'tenant-1',
        unitPrice: 0,
      });
      writeOrder.push('addon-purchase');
      return [];
    });

  const insertAddonLot: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      const registrationId = requireRegistrationId();
      const configuredAddon = requireAddon();
      const purchase = requirePurchase();
      expect(configuredAddon.selectedQuantity).toBeGreaterThan(0);
      expectInsert(
        statement,
        getTableName(eventRegistrationAddonPurchaseLots),
        [
          'application_fee_amount',
          'base_amount',
          'cancelled_quantity',
          'createdAt',
          'currency',
          'eventId',
          'gross_amount',
          'id',
          'net_amount',
          'payment_allocation_finalized_at',
          'purchaseId',
          'quantity',
          'redeemed_quantity',
          'refund_allocated_application_fee_amount',
          'refund_allocated_gross_amount',
          'refund_allocated_net_amount',
          'refund_allocated_quantity',
          'registrationId',
          'registration_option_id',
          'source_line_key',
          'source_transaction_id',
          'stripe_fee_amount',
          'tax_amount',
          'tax_rate_name',
          'tax_rate_inclusive',
          'tax_rate_percentage',
          'tenantId',
          'unit_price',
          'updatedAt',
        ],
        [
          [
            '$1',
            '$2',
            'default',
            'default',
            '$3',
            '$4',
            '$5',
            '$6',
            '$7',
            '$8',
            '$9',
            '$10',
            'default',
            'default',
            'default',
            'default',
            'default',
            '$11',
            '$12',
            '$13',
            'default',
            '$14',
            '$15',
            'default',
            'default',
            'default',
            '$16',
            '$17',
            'default',
          ],
        ],
      );
      const id = requireString(parameters[5]);
      const paymentAllocationFinalizedAt = requireDate(parameters[7]);
      expect(id).not.toBe(purchase.id);
      expect(parameters).toEqual([
        0,
        0,
        'EUR',
        'event-1',
        0,
        id,
        0,
        paymentAllocationFinalizedAt.toISOString(),
        purchase.id,
        configuredAddon.selectedQuantity,
        registrationId,
        'option-1',
        `addon-lot:${id}`,
        0,
        0,
        'tenant-1',
        0,
      ]);
      addonLotInserts.push({
        applicationFeeAmount: 0,
        baseAmount: 0,
        currency: 'EUR',
        eventId: 'event-1',
        grossAmount: 0,
        id,
        netAmount: 0,
        paymentAllocationFinalizedAt,
        purchaseId: purchase.id,
        quantity: configuredAddon.selectedQuantity,
        registrationId,
        registrationOptionId: 'option-1',
        sourceLineKey: `addon-lot:${id}`,
        sourceTransactionId: null,
        stripeFeeAmount: 0,
        taxAmount: 0,
        taxRateDisplayName: null,
        taxRateInclusive: null,
        taxRatePercentage: null,
        tenantId: 'tenant-1',
        unitPrice: 0,
      });
      writeOrder.push('addon-lot');
      return [];
    });

  return {
    acquisitionComponentInserts,
    acquisitionInserts,
    addonLotInserts,
    addonPurchaseInserts,
    emailInserts,
    insertAcquisition,
    insertAcquisitionComponents,
    insertAddonLot,
    insertAddonPurchase,
    insertEmail,
    insertRegistration,
    registrationInserts,
    requireRegistrationId,
    writeOrder,
  };
};

type CurrentReservationAddonStockUpdate = Pick<
  typeof eventAddons.$inferSelect,
  'eventId' | 'updatedAt'
> & {
  addonId: typeof eventAddons.$inferSelect.id;
  quantity: typeof eventAddons.$inferSelect.totalAvailableQuantity;
};

type CurrentReservationAvailableAddon = Pick<
  typeof addonToEventRegistrationOptions.$inferSelect,
  'includedQuantity' | 'optionalPurchaseQuantity'
> &
  Pick<
    typeof eventAddons.$inferSelect,
    | 'allowMultiple'
    | 'allowPurchaseDuringRegistration'
    | 'isPaid'
    | 'maxQuantityPerUser'
    | 'price'
    | 'stripeTaxRateId'
    | 'title'
    | 'totalAvailableQuantity'
  > & {
    addOnId: typeof eventAddons.$inferSelect.id;
    taxRateDisplayName: typeof tenantStripeTaxRates.$inferSelect.displayName;
    taxRateInclusive: null | typeof tenantStripeTaxRates.$inferSelect.inclusive;
    taxRatePercentage: typeof tenantStripeTaxRates.$inferSelect.percentage;
  };

type CurrentReservationCapacityUpdate = Pick<
  typeof eventRegistrationOptions.$inferSelect,
  'eventId' | 'updatedAt'
> & {
  registrationOptionId: typeof eventRegistrationOptions.$inferSelect.id;
  spotCount: typeof eventRegistrationOptions.$inferSelect.confirmedSpots;
};

type CurrentReservationDatabaseStep =
  | 'BEGIN'
  | 'COMMIT'
  | 'insertAcquisition'
  | 'insertAcquisitionComponents'
  | 'insertAddonLot'
  | 'insertAddonPurchase'
  | 'insertAnswers'
  | 'insertEmail'
  | 'insertRegistration'
  | 'insertRegistrationUniqueViolation'
  | 'lockMembership'
  | 'lockQuestionEvent'
  | 'lockQuestionTenant'
  | 'loseAddonStock'
  | 'loseCapacity'
  | 'readAcquisitions'
  | 'readActiveFutureRegistration'
  | 'readActiveRegistration'
  | 'readAddons'
  | 'readConcurrentRegistration'
  | 'readCurrentAddons'
  | 'readCurrentOption'
  | 'readEmailTenant'
  | 'readExistingRegistration'
  | 'readLockedQuestions'
  | 'readNotificationUser'
  | 'readOption'
  | 'reserveAddonStock'
  | 'reserveCapacity'
  | 'ROLLBACK';

const currentReservationInitialReadSteps: readonly CurrentReservationDatabaseStep[] =
  [
    'readExistingRegistration',
    'readOption',
    'readAddons',
    'BEGIN',
    'lockQuestionTenant',
    'lockQuestionEvent',
    'readLockedQuestions',
    'readCurrentOption',
    'readCurrentAddons',
    'lockMembership',
  ];

const currentReservationFreeConfirmationSteps: readonly CurrentReservationDatabaseStep[] =
  [
    'readAcquisitions',
    'insertAcquisition',
    'insertAcquisitionComponents',
    'insertEmail',
    'COMMIT',
  ];

const createCurrentReservationDatabaseFixture = ({
  addon,
  communicationEmail = 'alice@example.com',
  emailSenderEmail = null,
  emailSenderName = null,
  guestCount = 0,
  option = approvedRegistrationOption,
  steps,
  stripeAccountId = '',
}: {
  addon?: CurrentReservationAvailableAddon;
  communicationEmail?: string;
  emailSenderEmail?: null | string;
  emailSenderName?: null | string;
  guestCount?: number;
  option?: ReadWaitlistOption;
  steps: readonly CurrentReservationDatabaseStep[];
  stripeAccountId?: string;
}) =>
  Effect.gen(function* () {
    const writes = createCurrentReservationWriteFixtures({
      ...(addon && {
        addon: {
          includedQuantity: addon.includedQuantity,
          selectedQuantity: 1,
        },
      }),
      communicationEmail,
      emailSenderEmail,
      emailSenderName,
      guestCount,
      manualApproval: option.registrationMode === 'application',
      throwUniqueViolation: steps.includes('insertRegistrationUniqueViolation'),
    });
    const lockMembership = vi.fn();
    const selectActiveFutureRegistrations = vi.fn();
    const updateOptionCounters = vi.fn();
    const insertRegistration = vi.fn();
    const insertAddonPurchase =
      vi.fn<(values: CurrentReservationAddonPurchaseInsert) => void>();
    const insertAddonLot =
      vi.fn<(values: CurrentReservationAddonLotInsert) => void>();
    const findEmailTenant = vi.fn<SqlConnection.Connection['executeValues']>(
      (statement, parameters) =>
        Effect.sync(() => {
          expect(statement).toBe(
            'select "d0"."email_sender_email" as "emailSenderEmail", "d0"."email_sender_name" as "emailSenderName", "d0"."id" as "id", "d0"."name" as "name" from "tenants" as "d0" where "d0"."id" = $1 limit $2',
          );
          expect(parameters).toEqual(['tenant-1', 1]);
          return [[emailSenderEmail, emailSenderName, 'tenant-1', 'Tenant']];
        }),
    );
    const findNotificationUser = vi.fn<
      SqlConnection.Connection['executeValues']
    >((statement, parameters) =>
      Effect.sync(() => {
        expect(statement).toBe(
          'select "d0"."communicationEmail" as "communicationEmail" from "users" as "d0" where "d0"."id" = $1 limit $2',
        );
        expect(parameters).toEqual(['user-1', 1]);
        return [[' ' + communicationEmail + ' ']];
      }),
    );
    const operations: CurrentReservationDatabaseStep[] = [];
    const transactionCommands: ('BEGIN' | 'COMMIT' | 'ROLLBACK')[] = [];
    let transactionOpen = false;
    let emailInsertedWhileTransactionOpen = false;
    const capacityUpdates: CurrentReservationCapacityUpdate[] = [];
    const answerInserts: ScopedRegistrationAnswerInsert[] = [];
    const addonStockUpdates: CurrentReservationAddonStockUpdate[] = [];
    const registrationTable = getTableName(eventRegistrations);
    const optionTable = getTableName(eventRegistrationOptions);
    const eventTable = getTableName(eventInstances);
    const addonTable = getTableName(eventAddons);
    const attachmentTable = getTableName(addonToEventRegistrationOptions);
    const taxTable = getTableName(tenantStripeTaxRates);
    const membershipTable = getTableName(usersToTenants);
    const acquisitionTable = getTableName(registrationAcquisitions);
    const sqlDate = (value: Date) => value.toISOString().replace('Z', '');
    const requireUpdatedAt = (value: unknown) => {
      const text = Schema.decodeUnknownSync(Schema.String)(value);
      const date = new Date(text);
      expect(Number.isNaN(date.getTime())).toBe(false);
      expect(date.toISOString()).toBe(text);
      return date;
    };
    const expectActiveRegistrationRead = (
      statement: string,
      parameters: readonly unknown[],
      first: boolean,
    ) => {
      expect(statement).toBe(
        `select "d0"."id" as "id"${first ? ', "d0"."registrationOptionId" as "registrationOptionId", "d0"."status" as "status"' : ''} from "${registrationTable}" as "d0" where (("d0"."eventId" = $1) and (not ("d0"."status" = $2)) and ("d0"."tenantId" = $3) and ("d0"."userId" = $4))${first ? ' limit $5' : ''}`,
      );
      expect(parameters).toEqual([
        'event-1',
        'CANCELLED',
        'tenant-1',
        'user-1',
        ...(first ? [1] : []),
      ]);
    };
    const executeValues: SqlConnection.Connection['executeValues'] = (
      statement,
      parameters,
    ) =>
      Effect.gen(function* () {
        const step = steps[operations.length];
        if (
          !step ||
          step === 'BEGIN' ||
          step === 'COMMIT' ||
          step === 'ROLLBACK'
        ) {
          throw new Error(
            `Unexpected reservation SQL while expecting ${step ?? 'end'}: ${statement}`,
          );
        }
        expect(transactionOpen).toBe(
          step !== 'readExistingRegistration' &&
            step !== 'readOption' &&
            step !== 'readAddons',
        );
        // Admit this named statement before it can fail, so ROLLBACK is the next
        // expected command when the real Drizzle INSERT reports a unique violation.
        operations.push(step);
        switch (step) {
          case 'insertAcquisition': {
            return yield* writes.insertAcquisition(statement, parameters);
          }
          case 'insertAcquisitionComponents': {
            return yield* writes.insertAcquisitionComponents(
              statement,
              parameters,
            );
          }
          case 'insertAddonLot': {
            const result = yield* writes.insertAddonLot(statement, parameters);
            const values = writes.addonLotInserts.at(-1);
            if (!values)
              throw new Error('Missing current reservation add-on lot');
            insertAddonLot(values);
            return result;
          }
          case 'insertAddonPurchase': {
            const result = yield* writes.insertAddonPurchase(
              statement,
              parameters,
            );
            const values = writes.addonPurchaseInserts.at(-1);
            if (!values)
              throw new Error('Missing current reservation add-on purchase');
            insertAddonPurchase(values);
            return result;
          }
          case 'insertAnswers': {
            answerInserts.push(
              expectScopedRegistrationAnswerInsert(
                statement,
                parameters,
                writes.requireRegistrationId(),
              ),
            );
            return [];
          }
          case 'insertEmail': {
            emailInsertedWhileTransactionOpen = transactionOpen;
            return yield* writes.insertEmail(statement, parameters);
          }
          case 'insertRegistration':
          case 'insertRegistrationUniqueViolation': {
            insertRegistration();
            return yield* writes.insertRegistration(statement, parameters);
          }
          case 'lockMembership': {
            const membership: Pick<typeof usersToTenants.$inferSelect, 'id'> = {
              id: 'tenant-user-1',
            };
            expect(statement).toBe(
              `select "id" from "${membershipTable}" where (("${membershipTable}"."tenantId" = $1) and ("${membershipTable}"."userId" = $2)) for update`,
            );
            expect(parameters).toEqual(['tenant-1', 'user-1']);
            lockMembership();
            return [[membership.id]];
          }
          case 'lockQuestionEvent': {
            expect(statement).toBe(questionSetLockSql.event);
            expect(parameters).toEqual(['event-1', 'tenant-1']);
            return [['event-1']];
          }
          case 'lockQuestionTenant': {
            expect(statement).toBe(questionSetLockSql.tenant);
            expect(parameters).toEqual(['tenant-1']);
            return [['tenant-1']];
          }
          case 'loseAddonStock':
          case 'reserveAddonStock': {
            if (!addon)
              throw new Error(
                'CurrentReservation fixture has no configured add-on',
              );
            const quantity = addon.includedQuantity + 1;
            const updatedAt = requireUpdatedAt(parameters[1]);
            expect(statement).toBe(
              `update "${addonTable}" set "totalAvailableQuantity" = "${addonTable}"."totalAvailableQuantity" - $1, "updatedAt" = $2 where (("${addonTable}"."id" = $3) and ("${addonTable}"."eventId" = $4) and ("${addonTable}"."totalAvailableQuantity" >= $5)) returning "id"`,
            );
            expect(parameters).toEqual([
              quantity,
              updatedAt.toISOString(),
              'addon-1',
              'event-1',
              quantity,
            ]);
            addonStockUpdates.push({
              addonId: addon.addOnId,
              eventId: 'event-1',
              quantity,
              updatedAt,
            });
            return step === 'reserveAddonStock' ? [[addon.addOnId]] : [];
          }
          case 'loseCapacity':
          case 'reserveCapacity': {
            const spotCount = guestCount + 1;
            const updatedAt = requireUpdatedAt(parameters[1]);
            expect(statement).toBe(
              `update "${optionTable}" set "confirmedSpots" = "${optionTable}"."confirmedSpots" + $1, "updatedAt" = $2 where (("${optionTable}"."id" = $3) and ("${optionTable}"."eventId" = $4) and ("${optionTable}"."confirmedSpots" + "${optionTable}"."reservedSpots" + $5 <= "${optionTable}"."spots")) returning "id"`,
            );
            expect(parameters).toEqual([
              spotCount,
              updatedAt.toISOString(),
              'option-1',
              'event-1',
              spotCount,
            ]);
            updateOptionCounters();
            capacityUpdates.push({
              eventId: 'event-1',
              registrationOptionId: 'option-1',
              spotCount,
              updatedAt,
            });
            return step === 'reserveCapacity' ? [['option-1']] : [];
          }
          case 'readAcquisitions': {
            expect(statement).toBe(
              `select "acquired_at"::text, "event_id", "id", "kind", "operation_key", "ordinal", "owner_user_id", "previous_acquisition_id", "registration_id", "spot_count", "tenant_id", "transfer_id" from "${acquisitionTable}" where (("${acquisitionTable}"."tenant_id" = $1) and ("${acquisitionTable}"."registration_id" = $2)) order by "${acquisitionTable}"."ordinal" desc for update`,
            );
            expect(parameters).toEqual([
              'tenant-1',
              writes.requireRegistrationId(),
            ]);
            return [];
          }
          case 'readActiveFutureRegistration': {
            const existing: Pick<typeof eventRegistrations.$inferSelect, 'id'> =
              { id: 'active-registration-1' };
            expect(statement).toBe(
              `select "${registrationTable}"."id" from "${registrationTable}" inner join "${eventTable}" on "${eventTable}"."id" = "${registrationTable}"."eventId" where (("${registrationTable}"."tenantId" = $1) and ("${registrationTable}"."userId" = $2) and ("${registrationTable}"."status" <> 'CANCELLED') and ("${eventTable}"."start" > $3)) limit $4`,
            );
            expect(parameters).toEqual([
              'tenant-1',
              'user-1',
              new Date('2026-09-15T12:00:00.000Z'),
              1,
            ]);
            selectActiveFutureRegistrations();
            return [[existing.id]];
          }
          case 'readActiveRegistration': {
            expectActiveRegistrationRead(statement, parameters, false);
            return [];
          }
          case 'readAddons': {
            expect(statement).toBe(
              `select "${addonTable}"."id", "${addonTable}"."allowMultiple", "${addonTable}"."allowPurchaseDuringRegistration", "${attachmentTable}"."included_quantity", "${addonTable}"."isPaid", "${addonTable}"."maxQuantityPerUser", "${attachmentTable}"."optional_purchase_quantity", "${addonTable}"."price", "${addonTable}"."stripeTaxRateId", "${taxTable}"."displayName", "${taxTable}"."inclusive", "${taxTable}"."percentage", "${addonTable}"."title", "${addonTable}"."totalAvailableQuantity" from "${addonTable}" inner join "${attachmentTable}" on "${attachmentTable}"."addonId" = "${addonTable}"."id" left join "${taxTable}" on (("${taxTable}"."stripeTaxRateId" = "${addonTable}"."stripeTaxRateId") and ("${taxTable}"."tenantId" = $1) and ("${taxTable}"."stripeAccountId" = $2) and ("${taxTable}"."active" = $3) and ("${taxTable}"."inclusive" = $4)) where (("${addonTable}"."eventId" = $5) and ("${attachmentTable}"."registrationOptionId" = $6))`,
            );
            expect(parameters).toEqual([
              'tenant-1',
              stripeAccountId,
              true,
              true,
              'event-1',
              'option-1',
            ]);
            return addon
              ? [
                  [
                    addon.addOnId,
                    addon.allowMultiple,
                    addon.allowPurchaseDuringRegistration,
                    addon.includedQuantity,
                    addon.isPaid,
                    addon.maxQuantityPerUser,
                    addon.optionalPurchaseQuantity,
                    addon.price,
                    addon.stripeTaxRateId,
                    addon.taxRateDisplayName,
                    addon.taxRateInclusive,
                    addon.taxRatePercentage,
                    addon.title,
                    addon.totalAvailableQuantity,
                  ],
                ]
              : [];
          }
          case 'readConcurrentRegistration': {
            const existing: Pick<typeof eventRegistrations.$inferSelect, 'id'> =
              { id: 'concurrent-registration' };
            expectActiveRegistrationRead(statement, parameters, false);
            return [[existing.id]];
          }
          case 'readCurrentAddons': {
            const rows = readRegistrationSnapshotAddonsFixture({
              addOns: addon ? [addon] : [],
              parameters,
              statement,
              transactionOpen,
            });
            if (!rows) {
              throw new Error(`Unexpected current add-on SQL: ${statement}`);
            }
            return rows;
          }
          case 'readCurrentOption': {
            const rows = readRegistrationSnapshotFixture({
              option,
              parameters,
              statement,
              transactionOpen,
            });
            if (!rows) {
              throw new Error(`Unexpected current option SQL: ${statement}`);
            }
            return rows;
          }
          case 'readEmailTenant': {
            return yield* findEmailTenant(statement, parameters);
          }
          case 'readExistingRegistration': {
            expectActiveRegistrationRead(statement, parameters, true);
            return [];
          }
          case 'readLockedQuestions': {
            expect(statement).toBe(questionSetLockSql.questions);
            expect(parameters).toEqual(['event-1', 'option-1']);
            return (option.questions ?? []).map((question) => [
              question.id,
              question.required,
            ]);
          }
          case 'readNotificationUser': {
            return yield* findNotificationUser(statement, parameters);
          }
          case 'readOption': {
            // RQB owns nested JSON joins. Verify every selected root column and
            // both related selections, plus the complete event/option parameters.
            const scalarColumns = [
              'closeRegistrationTime',
              'confirmedSpots',
              'eventId',
              'id',
              'isPaid',
              'openRegistrationTime',
              'organizingRegistration',
              'price',
              'registrationMode',
              'reservedSpots',
              'roleIds',
              'spots',
              'stripeTaxRateId',
            ];
            const rootSelection = scalarColumns
              .map(
                (column) =>
                  `"d0"."${column}"${column === 'closeRegistrationTime' || column === 'openRegistrationTime' ? '::text' : ''} as "${column}"`,
              )
              .join(', ');
            expect(
              statement.startsWith(
                `select ${rootSelection}, "event"."r" as "event", "questions"."r" as "questions" from "${optionTable}" as "d0" `,
              ),
            ).toBe(true);
            expect(statement).toContain(
              `select "d1"."start"::text as "start", "d1"."status" as "status", "d1"."tenantId" as "tenantId", "d1"."title" as "title" from "${eventTable}" as "d1"`,
            );
            expect(statement).toContain(
              `select "d1"."id" as "id", "d1"."required" as "required" from "${getTableName(eventRegistrationQuestions)}" as "d1"`,
            );
            expect(statement).toContain(
              `where (("d0"."eventId" = $2) and ("d0"."id" = $3)) limit $4`,
            );
            expect(parameters).toEqual([1, 'event-1', 'option-1', 1]);
            return [
              [
                sqlDate(option.closeRegistrationTime),
                option.confirmedSpots,
                option.eventId,
                option.id,
                option.isPaid,
                sqlDate(option.openRegistrationTime),
                option.organizingRegistration,
                option.price,
                option.registrationMode,
                option.reservedSpots,
                [...option.roleIds],
                option.spots,
                option.stripeTaxRateId,
                {
                  ...option.event,
                  start: option.event.start
                    ? sqlDate(option.event.start)
                    : null,
                },
                (option.questions ?? []).map((question) => ({ ...question })),
              ],
            ];
          }
        }
      });
    const databaseContext = yield* Layer.build(
      createRegistrationDatabaseTestLayer({
        executeValues,
        transactionControl: (command) =>
          Effect.sync(() => {
            expect(steps[operations.length]).toBe(command);
            expect(transactionOpen).toBe(command !== 'BEGIN');
            transactionOpen = command === 'BEGIN';
            operations.push(command);
            transactionCommands.push(command);
          }),
      }),
    );
    return {
      ...writes,
      addonStockUpdates,
      answerInserts,
      capacityUpdates,
      database: Context.get(databaseContext, Database),
      get emailInsertedWhileTransactionOpen() {
        return emailInsertedWhileTransactionOpen;
      },
      expectComplete: () => {
        expect(operations).toEqual(steps);
        expect(transactionOpen).toBe(false);
      },
      findEmailTenant,
      findNotificationUser,
      insertAddonLot,
      insertAddonPurchase,
      insertRegistration,
      lockMembership,
      operations,
      get registrationId() {
        return writes.requireRegistrationId();
      },
      selectActiveFutureRegistrations,
      transactionCommands,
      updateOptionCounters,
    };
  });

describe('EventRegistrationService', () => {
  for (const flow of ['manual approval', 'direct registration']) {
    for (const scenario of [
      { name: 'missing tenant', tenantRecord: undefined },
      {
        name: 'null provider settings',
        tenantRecord: { discountProviders: null },
      },
      {
        name: 'incomplete provider settings',
        tenantRecord: { discountProviders: {} },
      },
    ]) {
      it.effect(
        `${flow} rejects ${scenario.name} before claiming capacity or creating Checkout`,
        () =>
          Effect.gen(function* () {
            const fixture = yield* flow === 'manual approval'
              ? createManualApprovalDatabase({
                  discountSettings: { tenantRecord: scenario.tenantRecord },
                })
              : createDirectCheckoutDatabase({
                  discountSettings: { tenantRecord: scenario.tenantRecord },
                });
            const stripe = createStripeTestClient();
            const exit = yield* Effect.exit(
              Effect.gen(function* () {
                if (flow === 'manual approval') {
                  yield* runManualApproval({
                    database: fixture.database,
                    stripe,
                  });
                } else {
                  yield* runDirectCheckout({
                    database: fixture.database,
                    stripe,
                  });
                }
              }),
            );
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isSuccess(exit))
              throw new Error(
                'Expected unavailable tenant settings to reject registration',
              );
            if (scenario.tenantRecord === undefined) {
              expect(Cause.hasDies(exit.cause)).toBe(false);
              const failure = exit.cause.reasons.find((reason) =>
                Cause.isFailReason(reason),
              );
              expect(failure).toBeDefined();
              if (!failure)
                throw new Error('Expected a typed missing registration error');
              expect(failure.error).toBeInstanceOf(
                EventRegistrationNotFoundError,
              );
            } else {
              expect(Cause.hasDies(exit.cause)).toBe(true);
              const defect = exit.cause.reasons.find((reason) =>
                Cause.isDieReason(reason),
              );
              expect(defect).toBeDefined();
              if (!defect)
                throw new Error(
                  'Expected a schema defect for persisted settings',
                );
              expect(Schema.isSchemaError(defect.defect)).toBe(true);
            }
            expect(fixture.tenantSettingsReadCount()).toBe(1);
            expect(fixture.operationOrder).toEqual([]);
            expect(fixture.claimInsertCount()).toBe(0);
            expect(fixture.reservationUpdateCount()).toBe(0);
            expect(fixture.bindingUpdateCount()).toBe(0);
            expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
            expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
          }),
      );
    }
  }

  describe('ensureCurrentRegistrationSnapshot', () => {
    const currentOption: RegistrationSnapshotOption = {
      ...approvedRegistrationOption,
      isPaid: true,
      price: 1000,
      roleIds: ['role-a', 'role-b'],
      stripeTaxRateId: 'txr_19',
    };
    const admission = {
      closeRegistrationTime: approvedRegistrationOption.closeRegistrationTime,
      now: new Date('2026-09-15T12:00:00.000Z'),
      openRegistrationTime: approvedRegistrationOption.openRegistrationTime,
      organizingRegistration: false,
      roleIds: ['role-a', 'role-b'],
    };
    const pricing = {
      discounts: [{ discountedPrice: 500, discountType: 'esnCard' }],
      eventStart: approvedRegistrationOption.event.start,
      isPaid: true,
      price: 1000,
      stripeTaxRateId: 'txr_19',
    } satisfies NonNullable<
      Parameters<typeof ensureCurrentRegistrationSnapshot>[1]['pricing']
    >;
    const capturedAddOn = {
      addOnId: 'addon-1',
      allowMultiple: true,
      allowPurchaseDuringRegistration: true,
      includedQuantity: 1,
      isPaid: true,
      maxQuantityPerUser: 3,
      optionalPurchaseQuantity: 2,
      price: 300,
      stripeTaxRateId: 'txr_19',
      taxRateDisplayName: 'VAT',
      taxRateInclusive: true,
      taxRatePercentage: '19',
      title: 'Lunch',
      totalAvailableQuantity: 10,
    } satisfies Parameters<
      typeof validateRegistrationAddons
    >[0]['availableAddOns'][number];
    const input: Parameters<typeof ensureCurrentRegistrationSnapshot>[1] = {
      admission,
      eventId: 'event-1',
      pricing,
      registrationMode: 'fcfs',
      registrationOptionId: 'option-1',
      tenantId: 'tenant-1',
    };
    const createSnapshotDatabase = ({
      addOns = [],
      cards = [],
      discounts = pricing.discounts,
      option = currentOption,
      providerEnabled = true,
    }: {
      addOns?: readonly RegistrationSnapshotAddon[];
      cards?: readonly RegistrationDiscountCard[];
      discounts?: readonly Pick<
        typeof eventRegistrationOptionDiscounts.$inferSelect,
        'discountedPrice' | 'discountType'
      >[];
      option?: null | RegistrationSnapshotOption;
      providerEnabled?: boolean;
    } = {}) =>
      Effect.gen(function* () {
        let transactionOpen = false;
        const reads: (
          'addons' | 'cards' | 'discounts' | 'option' | 'providers'
        )[] = [];
        const transactionCommands: ('BEGIN' | 'COMMIT' | 'ROLLBACK')[] = [];
        const context = yield* Layer.build(
          createRegistrationDatabaseTestLayer({
            executeValues: (statement, parameters) =>
              Effect.sync(() => {
                const rows = readRegistrationSnapshotFixture({
                  option,
                  parameters,
                  statement,
                  transactionOpen,
                });
                if (rows) {
                  reads.push('option');
                  return rows;
                }
                const addonRows = readRegistrationSnapshotAddonsFixture({
                  addOns,
                  parameters,
                  statement,
                  transactionOpen,
                });
                if (addonRows) {
                  expect(reads).toEqual(['option']);
                  reads.push('addons');
                  return addonRows;
                }
                if (
                  statement.includes(
                    ' from "event_registration_option_discounts" as "d0"',
                  )
                ) {
                  expect(transactionOpen).toBe(true);
                  expect(reads).toEqual(
                    reads.includes('addons')
                      ? ['option', 'addons']
                      : ['option'],
                  );
                  expect(statement).toBe(
                    'select "d0"."discountedPrice" as "discountedPrice", "d0"."discountType" as "discountType" from "event_registration_option_discounts" as "d0" where "d0"."registrationOptionId" = $1',
                  );
                  expect(parameters).toEqual(['option-1']);
                  reads.push('discounts');
                  return discounts.map((discount) => [
                    discount.discountedPrice,
                    discount.discountType,
                  ]);
                }
                if (statement === registrationDiscountProvidersSql) {
                  expect(transactionOpen).toBe(true);
                  expect(reads.at(-1)).toBe('discounts');
                  expect(parameters).toEqual(['tenant-1', 1]);
                  reads.push('providers');
                  return [
                    [
                      {
                        esnCard: {
                          config: {},
                          status: providerEnabled ? 'enabled' : 'disabled',
                        },
                      },
                    ],
                  ];
                }
                if (statement === registrationDiscountCardsSql) {
                  expect(transactionOpen).toBe(true);
                  expect(reads.at(-1)).toBe('providers');
                  expect(parameters).toEqual(['tenant-1', 'user-1']);
                  reads.push('cards');
                  return cards.map((card) => [
                    card.status,
                    card.type,
                    card.validFrom?.toISOString().replace('Z', '') ?? null,
                    card.validTo?.toISOString().replace('Z', '') ?? null,
                  ]);
                }
                throw new Error(
                  `Unexpected registration snapshot fixture SQL: ${statement}`,
                );
              }),
            transactionControl: (command) =>
              Effect.sync(() => {
                expect(transactionOpen).toBe(command !== 'BEGIN');
                transactionOpen = command === 'BEGIN';
                transactionCommands.push(command);
              }),
          }),
        );
        return {
          database: Context.get(context, Database),
          reads,
          transactionCommands,
        };
      });

    const discountedResolution = {
      appliedDiscountedPrice: 500,
      appliedDiscountType: 'esnCard',
      discountAmount: 500,
      effectivePrice: 500,
    } satisfies NonNullable<
      NonNullable<
        Parameters<typeof ensureCurrentRegistrationSnapshot>[1]['pricing']
      >['discountEligibility']
    >['resolution'];
    const undiscountedResolution = {
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      discountAmount: null,
      effectivePrice: 1000,
    };
    const verifiedCard: RegistrationDiscountCard = {
      status: 'verified',
      type: 'esnCard',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validTo: new Date('2026-12-31T00:00:00.000Z'),
    };
    const eligibilityChanges: readonly {
      cards: readonly RegistrationDiscountCard[];
      name: string;
      previouslyUndiscounted?: boolean;
      providerEnabled?: boolean;
    }[] = [
      { cards: [], name: 'removed verified card' },
      {
        cards: [
          {
            ...verifiedCard,
            status: 'invalid',
            validFrom: null,
            validTo: null,
          },
        ],
        name: 'invalidated card',
      },
      {
        cards: [{ ...verifiedCard, status: 'expired' }],
        name: 'expired provider status',
      },
      {
        cards: [
          {
            ...verifiedCard,
            status: 'unverified',
            validFrom: null,
            validTo: null,
          },
        ],
        name: 'unverified provider status',
      },
      {
        cards: [
          { ...verifiedCard, validFrom: new Date('2026-09-19T10:00:00.000Z') },
        ],
        name: 'validity begins after event',
      },
      {
        cards: [{ ...verifiedCard, validTo: pricing.eventStart }],
        name: 'validity ends at event',
      },
      {
        cards: [verifiedCard],
        name: 'disabled provider',
        providerEnabled: false,
      },
      {
        cards: [verifiedCard],
        name: 'first eligible card with no captured discount rows',
        previouslyUndiscounted: true,
      },
    ];
    for (const scenario of eligibilityChanges) {
      it.effect(
        `rejects ${scenario.name} before recording stale discount terms`,
        () =>
          Effect.gen(function* () {
            const fixture = yield* createSnapshotDatabase(scenario);
            const capturedPricing = scenario.previouslyUndiscounted
              ? {
                  eventStart: pricing.eventStart,
                  isPaid: pricing.isPaid,
                  price: pricing.price,
                  stripeTaxRateId: pricing.stripeTaxRateId,
                }
              : pricing;
            const error = yield* fixture.database
              .transaction((tx) =>
                ensureCurrentRegistrationSnapshot(tx, {
                  ...input,
                  pricing: {
                    ...capturedPricing,
                    discountEligibility: {
                      resolution: scenario.previouslyUndiscounted
                        ? undiscountedResolution
                        : discountedResolution,
                      userId: 'user-1',
                    },
                  },
                }),
              )
              .pipe(Effect.flip);
            expect(error).toBeInstanceOf(EventRegistrationConflictError);
            expect(error.message).toBe(
              'Sign-up details changed while this request was being processed. Nothing was saved. Review the current details and try again.',
            );
            expect(fixture.reads).toEqual([
              'option',
              'discounts',
              'providers',
              'cards',
            ]);
            expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
          }),
      );
    }

    it.effect(
      'accepts a refreshed validity window that preserves the economic resolution',
      () =>
        Effect.gen(function* () {
          const fixture = yield* createSnapshotDatabase({
            cards: [
              {
                ...verifiedCard,
                validFrom: new Date('2026-09-01T00:00:00.000Z'),
                validTo: new Date('2026-10-01T00:00:00.000Z'),
              },
            ],
          });
          yield* fixture.database.transaction((tx) =>
            ensureCurrentRegistrationSnapshot(tx, {
              ...input,
              pricing: {
                ...pricing,
                discountEligibility: {
                  resolution: discountedResolution,
                  userId: 'user-1',
                },
              },
            }),
          );
          expect(fixture.reads).toEqual([
            'option',
            'discounts',
            'providers',
            'cards',
          ]);
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
        }),
    );
    it.effect(
      'locks unverified cards with no validity window without treating them as eligible',
      () =>
        Effect.gen(function* () {
          const fixture = yield* createSnapshotDatabase({
            cards: [
              {
                ...verifiedCard,
                status: 'unverified',
                validFrom: null,
                validTo: null,
              },
            ],
          });
          yield* fixture.database.transaction((tx) =>
            ensureCurrentRegistrationSnapshot(tx, {
              ...input,
              pricing: {
                ...pricing,
                discountEligibility: {
                  resolution: undiscountedResolution,
                  userId: 'user-1',
                },
              },
            }),
          );
          expect(fixture.reads).toEqual([
            'option',
            'discounts',
            'providers',
            'cards',
          ]);
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
        }),
    );
    it.effect(
      'rechecks eligibility even when the captured discount makes the price zero',
      () =>
        Effect.gen(function* () {
          const discounts = [
            { discountedPrice: 0, discountType: 'esnCard' },
          ] satisfies typeof pricing.discounts;
          const fixture = yield* createSnapshotDatabase({
            cards: [verifiedCard],
            discounts,
          });
          yield* fixture.database.transaction((tx) =>
            ensureCurrentRegistrationSnapshot(tx, {
              ...input,
              pricing: {
                ...pricing,
                discountEligibility: {
                  resolution: {
                    appliedDiscountedPrice: 0,
                    appliedDiscountType: 'esnCard',
                    discountAmount: 1000,
                    effectivePrice: 0,
                  },
                  userId: 'user-1',
                },
                discounts,
              },
            }),
          );
          expect(fixture.reads).toEqual([
            'option',
            'discounts',
            'providers',
            'cards',
          ]);
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
        }),
    );

    it.effect(
      'accepts unchanged admission and pricing from the current graph',
      () =>
        Effect.gen(function* () {
          const fixture = yield* createSnapshotDatabase();
          const current = yield* fixture.database.transaction((tx) =>
            ensureCurrentRegistrationSnapshot(tx, input),
          );
          expect(current).toMatchObject({
            event: {
              start: pricing.eventStart,
              status: 'APPROVED',
              tenantId: 'tenant-1',
            },
            id: 'option-1',
            isPaid: true,
            price: 1000,
            stripeTaxRateId: 'txr_19',
          });
          expect(fixture.reads).toEqual(['option', 'discounts']);
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
        }),
    );

    it.effect('ignores role order while preserving both role collections', () =>
      Effect.gen(function* () {
        const reorderedRoles = ['role-b', 'role-a'];
        const fixture = yield* createSnapshotDatabase({
          option: { ...currentOption, roleIds: reorderedRoles },
        });
        const current = yield* fixture.database.transaction((tx) =>
          ensureCurrentRegistrationSnapshot(tx, input),
        );
        expect(current).toMatchObject({ roleIds: ['role-b', 'role-a'] });
        expect(reorderedRoles).toEqual(['role-b', 'role-a']);
        expect(admission.roleIds).toEqual(['role-a', 'role-b']);
        expect(fixture.reads).toEqual(['option', 'discounts']);
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
    );

    it.effect('accepts unchanged selected add-on commercial terms', () =>
      Effect.gen(function* () {
        const fixture = yield* createSnapshotDatabase({
          addOns: [capturedAddOn],
        });
        const current = yield* fixture.database.transaction((tx) =>
          ensureCurrentRegistrationSnapshot(tx, {
            ...input,
            addOns: [capturedAddOn],
          }),
        );
        expect(current).toMatchObject({ id: 'option-1' });
        expect(fixture.reads).toEqual(['option', 'addons', 'discounts']);
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
    );

    it.effect(
      'accepts reordered mapped add-ons without changing captured order',
      () =>
        Effect.gen(function* () {
          const first = { ...capturedAddOn, addOnId: 'addon-a' };
          const second = { ...capturedAddOn, addOnId: 'addon-b' };
          const captured = [first, second];
          const mapped = [second, first];
          const fixture = yield* createSnapshotDatabase({ addOns: mapped });
          yield* fixture.database.transaction((tx) =>
            ensureCurrentRegistrationSnapshot(tx, {
              ...input,
              addOns: captured,
            }),
          );
          expect(captured.map((addOn) => addOn.addOnId)).toEqual([
            'addon-a',
            'addon-b',
          ]);
          expect(mapped.map((addOn) => addOn.addOnId)).toEqual([
            'addon-b',
            'addon-a',
          ]);
          expect(fixture.reads).toEqual(['option', 'addons', 'discounts']);
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
        }),
    );

    const changedAddonTerms = [
      { change: { price: 450 }, name: 'price' },
      {
        change: { isPaid: false, price: 0, stripeTaxRateId: null },
        name: 'paid status',
      },
      { change: { stripeTaxRateId: 'txr_other' }, name: 'tax binding' },
      { change: { includedQuantity: 2 }, name: 'included quantity' },
      { change: { optionalPurchaseQuantity: 0 }, name: 'optional quantity' },
      {
        change: { allowMultiple: false },
        name: 'multiple purchase permission',
      },
      {
        change: { allowPurchaseDuringRegistration: false },
        name: 'registration purchase permission',
      },
      { change: { maxQuantityPerUser: 1 }, name: 'per-user quantity limit' },
    ] satisfies readonly {
      change: Partial<RegistrationSnapshotAddon>;
      name: string;
    }[];
    for (const scenario of changedAddonTerms) {
      it.effect(`rejects a changed selected add-on ${scenario.name}`, () =>
        Effect.gen(function* () {
          const fixture = yield* createSnapshotDatabase({
            addOns: [{ ...capturedAddOn, ...scenario.change }],
          });
          const error = yield* fixture.database
            .transaction((tx) =>
              ensureCurrentRegistrationSnapshot(tx, {
                ...input,
                addOns: [capturedAddOn],
              }),
            )
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(EventRegistrationConflictError);
          expect(error.message).toContain('Nothing was saved');
          expect(fixture.reads).toEqual(['option', 'addons']);
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
        }),
      );
    }

    it.effect('rejects a selected add-on removed from the option mapping', () =>
      Effect.gen(function* () {
        const fixture = yield* createSnapshotDatabase({ addOns: [] });
        const error = yield* fixture.database
          .transaction((tx) =>
            ensureCurrentRegistrationSnapshot(tx, {
              ...input,
              addOns: [capturedAddOn],
            }),
          )
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(fixture.reads).toEqual(['option', 'addons']);
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
    );

    it.effect(
      'rejects newly included add-ons even when none were initially selected',
      () =>
        Effect.gen(function* () {
          const fixture = yield* createSnapshotDatabase({
            addOns: [capturedAddOn],
          });
          const error = yield* fixture.database
            .transaction((tx) =>
              ensureCurrentRegistrationSnapshot(tx, { ...input, addOns: [] }),
            )
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(EventRegistrationConflictError);
          expect(fixture.reads).toEqual(['option', 'addons']);
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
        }),
    );

    it.effect(
      'ignores newly offered optional add-ons that were not selected',
      () =>
        Effect.gen(function* () {
          const fixture = yield* createSnapshotDatabase({
            addOns: [{ ...capturedAddOn, includedQuantity: 0 }],
          });
          yield* fixture.database.transaction((tx) =>
            ensureCurrentRegistrationSnapshot(tx, { ...input, addOns: [] }),
          );
          expect(fixture.reads).toEqual(['option', 'addons', 'discounts']);
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
        }),
    );

    it.effect(
      'leaves stock to atomic reservation and ignores display metadata',
      () =>
        Effect.gen(function* () {
          const currentAddOn = {
            ...capturedAddOn,
            taxRateDisplayName: 'Updated VAT label',
            taxRateInclusive: false,
            taxRatePercentage: '20',
            title: 'Updated lunch label',
            totalAvailableQuantity: 0,
          };
          const fixture = yield* createSnapshotDatabase({
            addOns: [currentAddOn],
          });
          yield* fixture.database.transaction((tx) =>
            ensureCurrentRegistrationSnapshot(tx, {
              ...input,
              addOns: [capturedAddOn],
            }),
          );
          expect(fixture.reads).toEqual(['option', 'addons', 'discounts']);
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
        }),
    );

    const changedOptions = [
      { name: 'missing option', option: null },
      {
        name: 'missing event',
        option: { ...currentOption, event: null },
      },
      {
        name: 'foreign event tenant',
        option: {
          ...currentOption,
          event: { ...approvedRegistrationOption.event, tenantId: 'tenant-2' },
        },
      },
      {
        name: 'unpublished event',
        option: {
          ...currentOption,
          event: { ...approvedRegistrationOption.event, status: 'DRAFT' },
        },
      },
      {
        name: 'registration mode',
        option: { ...currentOption, registrationMode: 'application' },
      },
      {
        name: 'opening time',
        option: {
          ...currentOption,
          openRegistrationTime: new Date('2026-09-11T10:00:00.000Z'),
        },
      },
      {
        name: 'closing time',
        option: {
          ...currentOption,
          closeRegistrationTime: new Date('2026-09-19T10:00:00.000Z'),
        },
      },
      {
        name: 'organizer option',
        option: { ...currentOption, organizingRegistration: true },
      },
      {
        name: 'role membership',
        option: { ...currentOption, roleIds: ['role-a', 'role-c'] },
      },
      {
        name: 'role count',
        option: { ...currentOption, roleIds: ['role-a'] },
      },
      {
        name: 'paid status',
        option: { ...currentOption, isPaid: false, price: 0 },
      },
      {
        name: 'base price',
        option: { ...currentOption, price: 1200 },
      },
      {
        name: 'tax rate binding',
        option: { ...currentOption, stripeTaxRateId: 'txr_other' },
      },
      {
        name: 'event start',
        option: {
          ...currentOption,
          event: {
            ...approvedRegistrationOption.event,
            start: new Date('2026-09-19T10:00:00.000Z'),
          },
        },
      },
    ] satisfies readonly {
      name: string;
      option: null | RegistrationSnapshotOption;
    }[];

    for (const scenario of changedOptions) {
      it.effect(
        `rejects changed ${scenario.name} before reading discount terms`,
        () =>
          Effect.gen(function* () {
            const fixture = yield* createSnapshotDatabase({
              option: scenario.option,
            });
            const error = yield* fixture.database
              .transaction((tx) => ensureCurrentRegistrationSnapshot(tx, input))
              .pipe(Effect.flip);
            expect(error).toBeInstanceOf(EventRegistrationConflictError);
            expect(error.message).toContain('Nothing was saved');
            expect(fixture.reads).toEqual(['option']);
            expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
          }),
      );
    }

    for (const scenario of [
      {
        discounts: [{ discountedPrice: 750, discountType: 'esnCard' }],
        name: 'changed discount price',
      },
      { discounts: [], name: 'removed discount' },
    ] satisfies readonly {
      discounts: readonly Pick<
        typeof eventRegistrationOptionDiscounts.$inferSelect,
        'discountedPrice' | 'discountType'
      >[];
      name: string;
    }[]) {
      it.effect(`rejects a ${scenario.name} used by the captured price`, () =>
        Effect.gen(function* () {
          const fixture = yield* createSnapshotDatabase({
            discounts: scenario.discounts,
          });
          const error = yield* fixture.database
            .transaction((tx) => ensureCurrentRegistrationSnapshot(tx, input))
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(EventRegistrationConflictError);
          expect(fixture.reads).toEqual(['option', 'discounts']);
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
        }),
      );
    }

    it.effect(
      'rejects a newly added discount after capturing an empty set',
      () =>
        Effect.gen(function* () {
          const fixture = yield* createSnapshotDatabase();
          const error = yield* fixture.database
            .transaction((tx) =>
              ensureCurrentRegistrationSnapshot(tx, {
                ...input,
                pricing: { ...pricing, discounts: [] },
              }),
            )
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(EventRegistrationConflictError);
          expect(fixture.reads).toEqual(['option', 'discounts']);
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
        }),
    );

    it.effect(
      'rejects an unchanged window that expired while locks were awaited',
      () =>
        Effect.gen(function* () {
          const fixture = yield* createSnapshotDatabase();
          const error = yield* fixture.database
            .transaction((tx) =>
              ensureCurrentRegistrationSnapshot(tx, {
                ...input,
                admission: {
                  ...admission,
                  now: new Date(admission.closeRegistrationTime.getTime() + 1),
                },
              }),
            )
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(EventRegistrationConflictError);
          expect(fixture.reads).toEqual(['option']);
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
        }),
    );

    for (const boundary of [
      'openRegistrationTime',
      'closeRegistrationTime',
    ] as const) {
      it.effect(`accepts the inclusive ${boundary} boundary`, () =>
        Effect.gen(function* () {
          const fixture = yield* createSnapshotDatabase();
          yield* fixture.database.transaction((tx) =>
            ensureCurrentRegistrationSnapshot(tx, {
              ...input,
              admission: { ...admission, now: admission[boundary] },
            }),
          );
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
        }),
      );
    }

    it.effect('does not apply admission windows to manual approval', () =>
      Effect.gen(function* () {
        const fixture = yield* createSnapshotDatabase({
          option: {
            ...currentOption,
            closeRegistrationTime: new Date('2026-09-12T10:00:00.000Z'),
            registrationMode: 'application',
          },
        });
        yield* fixture.database.transaction((tx) =>
          ensureCurrentRegistrationSnapshot(tx, {
            eventId: input.eventId,
            pricing,
            registrationMode: 'application',
            registrationOptionId: input.registrationOptionId,
            tenantId: input.tenantId,
          }),
        );
        expect(fixture.reads).toEqual(['option', 'discounts']);
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
    );

    it.effect(
      'checks waitlist admission without reading unused discount prices',
      () =>
        Effect.gen(function* () {
          const fixture = yield* createSnapshotDatabase({
            option: { ...currentOption, price: 1200 },
          });
          const current = yield* fixture.database.transaction((tx) =>
            ensureCurrentRegistrationSnapshot(tx, {
              admission,
              eventId: input.eventId,
              registrationMode: input.registrationMode,
              registrationOptionId: input.registrationOptionId,
              tenantId: input.tenantId,
            }),
          );
          expect(current).toMatchObject({
            event: {
              start: pricing.eventStart,
              status: 'APPROVED',
              tenantId: 'tenant-1',
            },
            id: 'option-1',
            price: 1200,
            registrationMode: 'fcfs',
          });
          expect(fixture.reads).toEqual(['option']);
          expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
        }),
    );
  });

  describe('decodeRegistrationCheckoutSnapshot', () => {
    const validSnapshot = {
      customerEmail: 'checkout@example.com',
      eventTitle: 'Stored event',
      eventUrl: 'https://tenant.example.com/events/event-1',
      expiresAt: 1_900_000_000,
      lineItems: [
        {
          name: 'Registration fee',
          quantity: 1,
          unitAmount: 1000,
        },
      ],
      notificationEmail: 'notify@example.com',
    };

    it.effect('decodes a persisted checkout request', () =>
      Effect.gen(function* () {
        expect(
          yield* decodeRegistrationCheckoutSnapshot(
            validSnapshot,
            'Invalid persisted checkout request',
          ),
        ).toEqual(validSnapshot);
      }),
    );

    it.effect('maps a malformed persisted request to an internal error', () =>
      Effect.gen(function* () {
        const error = yield* decodeRegistrationCheckoutSnapshot(
          { ...validSnapshot, lineItems: 'not-an-array' },
          'Invalid persisted checkout request',
        ).pipe(Effect.flip);

        expect(error).toBeInstanceOf(EventRegistrationInternalError);
        expect(error).toMatchObject({
          cause: { _tag: 'SchemaError' },
          message: 'Invalid persisted checkout request',
        });
      }),
    );
  });

  describe('lockCurrentRegistrationTaxConfiguration', () => {
    const createDatabase = ({
      addOnStripeTaxRateId = 'txr_addon',
      stripeAccountId = 'acct_current',
      taxRates = [
        {
          displayName: 'Registration VAT',
          inclusive: true,
          percentage: '19',
          stripeTaxRateId: 'txr_registration',
        },
        {
          displayName: 'Add-on VAT',
          inclusive: true,
          percentage: '7',
          stripeTaxRateId: 'txr_addon',
        },
      ],
    }: {
      addOnStripeTaxRateId?: typeof eventAddons.$inferSelect.stripeTaxRateId;
      stripeAccountId?: typeof tenantStripeTaxRates.$inferSelect.stripeAccountId;
      taxRates?: readonly Pick<
        typeof tenantStripeTaxRates.$inferSelect,
        'displayName' | 'inclusive' | 'percentage' | 'stripeTaxRateId'
      >[];
    } = {}) =>
      Effect.gen(function* () {
        const lockOrder: string[] = [];
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: (statement, parameters) =>
            Effect.sync(() => {
              expect(statement).toContain(' for update');
              if (
                statement.startsWith('select ') &&
                statement.includes(
                  ` from "${getTableName(eventRegistrationOptions)}"`,
                )
              ) {
                expect(statement).toMatch(/^select "stripeTaxRateId" from /);
                expect(parameters).toEqual(['option-1', 'event-1']);
                lockOrder.push('option');
                return [['txr_registration']];
              }
              if (
                statement.startsWith('select ') &&
                statement.includes(` from "${getTableName(eventAddons)}"`)
              ) {
                expect(statement).toMatch(
                  /^select "id", "stripeTaxRateId" from /,
                );
                expect(statement).toContain('order by "event_addons"."id"');
                expect(parameters).toEqual(['event-1', 'addon-1']);
                lockOrder.push('addon');
                return [['addon-1', addOnStripeTaxRateId]];
              }
              if (
                statement.startsWith('select ') &&
                statement.includes(
                  ` from "${getTableName(tenantStripeTaxRates)}"`,
                )
              ) {
                expect(statement).toMatch(
                  /^select "displayName", "inclusive", "percentage", "stripeTaxRateId" from /,
                );
                expect(statement).toContain(
                  'order by "tenant_stripe_tax_rates"."stripeTaxRateId"',
                );
                expect(parameters).toEqual([
                  'tenant-1',
                  stripeAccountId,
                  true,
                  true,
                  'txr_registration',
                  'txr_addon',
                ]);
                lockOrder.push('tax-rate');
                return taxRates.map((rate) => [
                  rate.displayName,
                  rate.inclusive,
                  rate.percentage,
                  rate.stripeTaxRateId,
                ]);
              }
              throw new Error(
                `Unexpected tax configuration fixture SQL: ${statement}`,
              );
            }),
        });
        const context = yield* Layer.build(databaseLayer);
        return { database: Context.get(context, Database), lockOrder };
      });

    it.effect(
      'locks the complete graph and returns only current-account tax snapshots',
      () =>
        Effect.gen(function* () {
          const fixture = yield* createDatabase();
          const result = yield* lockCurrentRegistrationTaxConfiguration(
            fixture.database,
            {
              addOns: [
                {
                  addOnId: 'addon-1',
                  requiresTaxRate: true,
                  stripeTaxRateId: 'txr_addon',
                },
              ],
              eventId: 'event-1',
              optionRequiresTaxRate: true,
              optionStripeTaxRateId: 'txr_registration',
              registrationOptionId: 'option-1',
              stripeAccountId: 'acct_current',
              tenantId: 'tenant-1',
            },
          );

          expect(fixture.lockOrder).toEqual(['option', 'addon', 'tax-rate']);
          expect(result.get('txr_registration')).toMatchObject({
            displayName: 'Registration VAT',
            percentage: '19',
          });
          expect(result.get('txr_addon')).toMatchObject({
            displayName: 'Add-on VAT',
            percentage: '7',
          });
        }),
    );

    it.effect(
      'fails closed when the add-on tax ID changes before reservation',
      () =>
        Effect.gen(function* () {
          const fixture = yield* createDatabase({
            addOnStripeTaxRateId: 'txr_replaced',
          });
          const error = yield* lockCurrentRegistrationTaxConfiguration(
            fixture.database,
            {
              addOns: [
                {
                  addOnId: 'addon-1',
                  requiresTaxRate: true,
                  stripeTaxRateId: 'txr_addon',
                },
              ],
              eventId: 'event-1',
              optionRequiresTaxRate: true,
              optionStripeTaxRateId: 'txr_registration',
              registrationOptionId: 'option-1',
              stripeAccountId: 'acct_current',
              tenantId: 'tenant-1',
            },
          ).pipe(Effect.flip);

          expect(error).toBeInstanceOf(EventRegistrationConflictError);
          expect(error.message).toContain('tax configuration changed');
          expect(fixture.lockOrder).toEqual(['option', 'addon']);
        }),
    );

    it.effect(
      'fails closed when referenced rates are absent from the locked account',
      () =>
        Effect.gen(function* () {
          const fixture = yield* createDatabase({
            stripeAccountId: 'acct_replacement',
            taxRates: [],
          });
          const error = yield* lockCurrentRegistrationTaxConfiguration(
            fixture.database,
            {
              addOns: [
                {
                  addOnId: 'addon-1',
                  requiresTaxRate: true,
                  stripeTaxRateId: 'txr_addon',
                },
              ],
              eventId: 'event-1',
              optionRequiresTaxRate: true,
              optionStripeTaxRateId: 'txr_registration',
              registrationOptionId: 'option-1',
              stripeAccountId: 'acct_replacement',
              tenantId: 'tenant-1',
            },
          ).pipe(Effect.flip);

          expect(error).toBeInstanceOf(EventRegistrationConflictError);
          expect(error.message).toContain('tax configuration changed');
          expect(fixture.lockOrder).toEqual(['option', 'addon', 'tax-rate']);
        }),
    );
  });

  describe('isDefinitiveCheckoutSessionCreateFailure', () => {
    const invalidRequest = (overrides: Record<string, unknown> = {}) =>
      new Stripe.errors.StripeInvalidRequestError({
        headers: {},
        message: 'Invalid checkout parameters',
        requestId: 'req_123',
        statusCode: 400,
        type: 'invalid_request_error',
        ...overrides,
      });

    it('accepts only complete, non-retryable Stripe validation responses', () => {
      expect(isDefinitiveCheckoutSessionCreateFailure(invalidRequest())).toBe(
        true,
      );
      expect(
        isDefinitiveCheckoutSessionCreateFailure(
          invalidRequest({ requestId: undefined }),
        ),
      ).toBe(false);
      expect(
        isDefinitiveCheckoutSessionCreateFailure(
          invalidRequest({ statusCode: 404 }),
        ),
      ).toBe(false);
      expect(
        isDefinitiveCheckoutSessionCreateFailure(
          invalidRequest({ type: 'api_error' }),
        ),
      ).toBe(false);
      expect(
        isDefinitiveCheckoutSessionCreateFailure(
          invalidRequest({ code: 'idempotency_key_in_use' }),
        ),
      ).toBe(false);
      expect(
        isDefinitiveCheckoutSessionCreateFailure(
          invalidRequest({ headers: { 'stripe-should-retry': 'true' } }),
        ),
      ).toBe(false);
      expect(
        isDefinitiveCheckoutSessionCreateFailure(
          new Stripe.errors.StripeConnectionError({
            message: 'Connection reset',
          }),
        ),
      ).toBe(false);
      expect(
        isDefinitiveCheckoutSessionCreateFailure(new Error('unknown')),
      ).toBe(false);
    });
  });

  describe('validateRegistrationAddons', () => {
    const availableAddOn = {
      addOnId: 'addon-1',
      allowMultiple: true,
      allowPurchaseDuringRegistration: true,
      includedQuantity: 0,
      isPaid: true,
      maxQuantityPerUser: 2,
      optionalPurchaseQuantity: 2,
      price: 500,
      quantity: 2,
      stripeTaxRateId: 'txr_1',
      taxRateDisplayName: 'VAT',
      taxRateInclusive: true,
      taxRatePercentage: '19',
      title: 'Lunch',
      totalAvailableQuantity: 5,
    } as const;

    it('orders reversed selections by add-on ID code units', () => {
      const uppercaseAddOn = {
        ...availableAddOn,
        addOnId: 'addon-Z',
        title: 'Early add-on',
      };
      const lowercaseAddOn = {
        ...availableAddOn,
        addOnId: 'addon-a',
        title: 'Later add-on',
      };

      const validatedAddOns = validateRegistrationAddons({
        addOns: [
          { addOnId: lowercaseAddOn.addOnId, quantity: 1 },
          { addOnId: uppercaseAddOn.addOnId, quantity: 1 },
        ],
        availableAddOns: [lowercaseAddOn, uppercaseAddOn],
      });

      expect(validatedAddOns.map((addOn) => addOn.addOnId)).toEqual([
        'addon-Z',
        'addon-a',
      ]);
    });
  });

  describe('orderRegistrationAddonPurchases', () => {
    it('orders reversed persisted rows by add-on ID without mutating the query result', () => {
      const purchases = [
        { addonId: 'addon-a', quantity: 1 },
        { addonId: 'addon-Z', quantity: 2 },
      ] as const;

      const orderedPurchases = orderRegistrationAddonPurchases(purchases);

      expect(orderedPurchases.map((purchase) => purchase.addonId)).toEqual([
        'addon-Z',
        'addon-a',
      ]);
      expect(purchases.map((purchase) => purchase.addonId)).toEqual([
        'addon-a',
        'addon-Z',
      ]);
    });
  });

  it.effect(
    'fails paid manual approval inside the locked claim transaction when Stripe is not configured',
    () =>
      Effect.gen(function* () {
        const approvalDatabase = yield* createManualApprovalDatabase({
          lockedStripeAccountId: null,
        });
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        );

        const error = yield* runManualApproval({
          database: approvalDatabase.database,
          stripe: checkoutStripeClient,
          stripeAccountId: undefined,
        }).pipe(Effect.flip);

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe('Stripe account not found');
        expect(approvalDatabase.claimInsertCount()).toBe(0);
        expect(approvalDatabase.reservationUpdateCount()).toBe(0);
        expect(approvalDatabase.operationOrder).toEqual([]);
        expect(createSession).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'persists a manual approval payment claim before creating and binding Stripe Checkout',
    () =>
      Effect.gen(function* () {
        const approvalDatabase = yield* createManualApprovalDatabase();
        const createSession = vi.fn(() => {
          approvalDatabase.operationOrder.push('stripe');
          return Promise.resolve(
            checkoutSessionResponse({
              id: 'cs_test_1',
              paymentIntent: null,
              url: 'https://checkout.stripe.test/session',
            }),
          );
        });
        const checkoutStripeClient = createStripeTestClient();
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(createSession);

        yield* runManualApproval({
          database: approvalDatabase.database,
          stripe: checkoutStripeClient,
        });

        expect(approvalDatabase.operationOrder).toEqual([
          'claim',
          'reserve',
          'registration',
          'stripe',
          'bind',
          'email',
        ]);
        expect(approvalDatabase.claimInsertValues()).toEqual(
          expect.objectContaining({
            amount: 1000,
            eventRegistrationId: 'registration-1',
            method: 'stripe',
            status: 'pending',
            type: 'registration',
          }),
        );
        expect(approvalDatabase.claimInsertValues()).not.toHaveProperty(
          'stripeCheckoutSessionId',
        );
        expect(createSession).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'expires checkout without binding or emailing when registration is cancelled before bind',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = yield* createPaidManualApprovalDatabase({
          operationOrder,
          registrationStatuses: ['PENDING', 'CANCELLED'],
        });
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.fn(() => {
          operationOrder.push('stripe');
          return Promise.resolve(
            checkoutSessionResponse({
              id: 'cs_test_1',
              paymentIntent: null,
              url: 'https://checkout.stripe.test/session',
            }),
          );
        });
        const expireSession = vi.fn(() => {
          operationOrder.push('expire');
          return Promise.resolve({
            ...checkoutSessionResponse({
              id: 'cs_test_1',
              paymentIntent: null,
              url: 'https://checkout.stripe.test/expired',
            }),
            status: 'expired' as const,
          });
        });
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(createSession);
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        ).mockImplementation(expireSession);

        const error = yield* approveManualRegistrationForTest({
          eventId: 'event-1',
          registrationId: 'registration-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            emailSenderEmail: null,
            emailSenderName: null,
            id: 'tenant-1',
            name: 'Tenant',
            stripeAccountId: 'acct_123',
          },
          user: { id: 'organizer-1' },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe(
          'Registration is no longer awaiting payment',
        );
        expect(operationOrder).toEqual([
          'claim',
          'reserve',
          'registration',
          'stripe',
          'expire',
        ]);
        expect(createSession).toHaveBeenCalledOnce();
        expect(expireSession).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'expires an unbound checkout before releasing its manual approval claim and capacity',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = yield* createPaidManualApprovalDatabase({
          bindingSucceeds: false,
          operationOrder,
        });
        const checkoutStripeClient = createStripeTestClient();
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('stripe');
            return Promise.resolve(
              checkoutSessionResponse({
                id: 'cs_test_1',
                paymentIntent: null,
                url: 'https://checkout.stripe.test/session',
              }),
            );
          }),
        );
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('expire');
            return Promise.resolve({
              ...checkoutSessionResponse({
                id: 'cs_test_1',
                paymentIntent: null,
                url: 'https://checkout.stripe.test/expired',
              }),
              status: 'expired' as const,
            });
          }),
        );

        const error = yield* approveManualRegistrationForTest({
          eventId: 'event-1',
          registrationId: 'registration-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            emailSenderEmail: null,
            emailSenderName: null,
            id: 'tenant-1',
            name: 'Tenant',
            stripeAccountId: 'acct_123',
          },
          user: { id: 'organizer-1' },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe('Failed to bind stripe checkout session');
        expect(operationOrder).toEqual([
          'claim',
          'reserve',
          'registration',
          'stripe',
          'bind',
          'expire',
          'release-claim',
          'release-capacity',
        ]);
      }),
  );

  it.effect(
    'accepts an exactly bound approval claim after an ambiguous binding commit',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = yield* createPaidManualApprovalDatabase({
          bindingCommitAmbiguous: true,
          operationOrder,
        });
        const checkoutStripeClient = createStripeTestClient();
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('stripe');
            return Promise.resolve(
              checkoutSessionResponse({
                id: 'cs_test_1',
                paymentIntent: null,
                url: 'https://checkout.stripe.test/session',
              }),
            );
          }),
        );
        const expireSession = vi.fn(() => {
          operationOrder.push('expire');
          return Promise.resolve({
            ...checkoutSessionResponse({
              id: 'cs_test_1',
              paymentIntent: null,
              url: 'https://checkout.stripe.test/expired',
            }),
            status: 'expired' as const,
          });
        });
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        ).mockImplementation(expireSession);

        const exit = yield* Effect.exit(
          approveManualRegistrationForTest({
            eventId: 'event-1',
            registrationId: 'registration-1',
            tenant: {
              ...tenantPublicOrigin,
              currency: 'EUR',
              emailSenderEmail: null,
              emailSenderName: null,
              id: 'tenant-1',
              name: 'Tenant',
              stripeAccountId: 'acct_123',
            },
            user: { id: 'organizer-1' },
          }).pipe(
            Effect.provide(EventRegistrationService.Default),
            Effect.provide(Layer.succeed(Database, database)),
            Effect.provideService(StripeClient, checkoutStripeClient),
            Effect.provide(configProviderLayer),
          ),
        );

        expect(exit._tag).toBe('Success');
        expect(operationOrder).toEqual([
          'claim',
          'reserve',
          'registration',
          'stripe',
          'bind',
          'email',
        ]);
        expect(expireSession).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'fails closed when an ambiguous bound approval has no exact outbox record',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = yield* createPaidManualApprovalDatabase({
          bindingCommitAmbiguous: true,
          operationOrder,
          persistCommittedEmail: false,
        });
        const checkoutStripeClient = createStripeTestClient();
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('stripe');
            return Promise.resolve(
              checkoutSessionResponse({
                id: 'cs_test_1',
                paymentIntent: null,
                url: 'https://checkout.stripe.test/session',
              }),
            );
          }),
        );
        const expireSession = vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        );

        const exit = yield* Effect.exit(
          approveManualRegistrationForTest({
            eventId: 'event-1',
            registrationId: 'registration-1',
            tenant: {
              ...tenantPublicOrigin,
              currency: 'EUR',
              emailSenderEmail: null,
              emailSenderName: null,
              id: 'tenant-1',
              name: 'Tenant',
              stripeAccountId: 'acct_123',
            },
            user: { id: 'organizer-1' },
          }).pipe(
            Effect.provide(EventRegistrationService.Default),
            Effect.provide(Layer.succeed(Database, database)),
            Effect.provideService(StripeClient, checkoutStripeClient),
            Effect.provide(configProviderLayer),
          ),
        );

        expect(exit._tag).toBe('Failure');
        expect(operationOrder).toEqual([
          'claim',
          'reserve',
          'registration',
          'stripe',
          'bind',
          'email',
        ]);
        expect(expireSession).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'retains the approval claim when expiring an unbound checkout is ambiguous',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = yield* createPaidManualApprovalDatabase({
          bindingSucceeds: false,
          operationOrder,
        });
        const checkoutStripeClient = createStripeTestClient();
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('stripe');
            return Promise.resolve(
              checkoutSessionResponse({
                id: 'cs_test_1',
                paymentIntent: null,
                url: 'https://checkout.stripe.test/session',
              }),
            );
          }),
        );
        const expireSession = vi.fn(() => {
          operationOrder.push('expire');
          return Promise.reject(new Error('Stripe expiry connection reset'));
        });
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        ).mockImplementation(expireSession);

        const error = yield* approveManualRegistrationForTest({
          eventId: 'event-1',
          registrationId: 'registration-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            emailSenderEmail: null,
            emailSenderName: null,
            id: 'tenant-1',
            name: 'Tenant',
            stripeAccountId: 'acct_123',
          },
          user: { id: 'organizer-1' },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe('Failed to bind stripe checkout session');
        expect(operationOrder).toEqual([
          'claim',
          'reserve',
          'registration',
          'stripe',
          'bind',
          'expire',
        ]);
        expect(expireSession).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    'releases a manual approval claim after a definitive Stripe validation failure',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = yield* createPaidManualApprovalDatabase({
          operationOrder,
        });
        const checkoutStripeClient = createStripeTestClient();
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('stripe');
            return Promise.reject(
              new Stripe.errors.StripeInvalidRequestError({
                headers: {},
                message: 'Invalid tax rate',
                requestId: 'req_invalid_manual',
                statusCode: 400,
                type: 'invalid_request_error',
              }),
            );
          }),
        );
        const expire = vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        );

        const error = yield* approveManualRegistrationForTest({
          eventId: 'event-1',
          registrationId: 'registration-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            emailSenderEmail: null,
            emailSenderName: null,
            id: 'tenant-1',
            name: 'Tenant',
            stripeAccountId: 'acct_123',
          },
          user: { id: 'organizer-1' },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(operationOrder).toEqual([
          'claim',
          'reserve',
          'registration',
          'stripe',
          'release-claim',
          'release-capacity',
        ]);
        expect(expire).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'retains the payment claim when Stripe creation has an ambiguous failure',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = yield* createPaidManualApprovalDatabase({
          operationOrder,
        });
        const checkoutStripeClient = createStripeTestClient();
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn((parameters?: Stripe.Checkout.SessionCreateParams) => {
            if (!parameters)
              throw new Error('Expected Stripe Checkout parameters');
            operationOrder.push('stripe');
            expect(parameters.expires_at).toBeGreaterThanOrEqual(
              Math.floor(Date.now() / 1000) + 30 * 60,
            );
            return Promise.reject(
              new Stripe.errors.StripeConnectionError({
                message: 'connection reset after request',
              }),
            );
          }),
        );
        const expire = vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        );

        const error = yield* approveManualRegistrationForTest({
          eventId: 'event-1',
          registrationId: 'registration-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            emailSenderEmail: null,
            emailSenderName: null,
            id: 'tenant-1',
            name: 'Tenant',
            stripeAccountId: 'acct_123',
          },
          user: { id: 'organizer-1' },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe(
          'Payment setup is still pending. Retry approval or cancel the registration.',
        );
        expect(operationOrder).toEqual([
          'claim',
          'reserve',
          'registration',
          'stripe',
        ]);
        expect(expire).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'keeps a direct option free when its disabled paid flag retains a stale price',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = yield* createPaidDirectRegistrationDatabase({
          bindingSucceeds: true,
          operationOrder,
          registrationOption: { isPaid: false, price: 1000 },
        });
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        );

        yield* EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 1,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            emailSenderEmail: null,
            emailSenderName: null,
            id: 'tenant-1',
            name: 'Tenant',
            stripeAccountId: null,
          },
          user: {
            communicationEmail: 'alice@example.com',
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(operationOrder).toEqual([
          'confirm-capacity',
          'confirm-registration',
        ]);
        expect(createSession).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'releases a direct claim after a definitive Stripe validation failure',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = yield* createPaidDirectRegistrationDatabase({
          bindingSucceeds: true,
          operationOrder,
        });
        const checkoutStripeClient = createStripeTestClient();
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('stripe');
            return Promise.reject(
              new Stripe.errors.StripeInvalidRequestError({
                headers: {},
                message: 'Invalid amount',
                requestId: 'req_invalid_direct',
                statusCode: 400,
                type: 'invalid_request_error',
              }),
            );
          }),
        );
        const expire = vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        );

        const error = yield* EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: 'acct_123',
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(operationOrder).toEqual([
          'reserve',
          'registration',
          'claim',
          'stripe',
          'release-claim',
          'cancel-registration',
          'release-capacity',
        ]);
        expect(expire).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'retains a direct registration claim when Stripe creation is ambiguous',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = yield* createPaidDirectRegistrationDatabase({
          bindingSucceeds: true,
          operationOrder,
        });
        const checkoutStripeClient = createStripeTestClient();
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn((parameters?: Stripe.Checkout.SessionCreateParams) => {
            if (!parameters)
              throw new Error('Expected Stripe Checkout parameters');
            operationOrder.push('stripe');
            expect(parameters.expires_at).toBeGreaterThanOrEqual(
              Math.floor(Date.now() / 1000) + 30 * 60,
            );
            return Promise.reject(
              new Stripe.errors.StripeConnectionError({
                message: 'connection reset after request',
              }),
            );
          }),
        );
        const expire = vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        );

        const error = yield* EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: 'acct_123',
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe(
          'Payment setup is still pending. Retry registration or cancel it.',
        );
        expect(operationOrder).toEqual([
          'reserve',
          'registration',
          'claim',
          'stripe',
        ]);
        expect(expire).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'expires a direct checkout before releasing a failed binding claim',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = yield* createPaidDirectRegistrationDatabase({
          bindingSucceeds: false,
          operationOrder,
        });
        const checkoutStripeClient = createStripeTestClient();
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('stripe');
            return Promise.resolve(
              checkoutSessionResponse({
                id: 'cs_direct_1',
                paymentIntent: null,
                url: 'https://checkout.stripe.test/direct',
              }),
            );
          }),
        );
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('expire');
            return Promise.resolve({
              ...checkoutSessionResponse({
                id: 'cs_direct_1',
                paymentIntent: null,
                url: 'https://checkout.stripe.test/expired',
              }),
              status: 'expired' as const,
            });
          }),
        );

        const error = yield* EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: 'acct_123',
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe('Failed to bind stripe checkout session');
        expect(operationOrder).toEqual([
          'reserve',
          'registration',
          'claim',
          'stripe',
          'bind',
          'expire',
          'release-claim',
          'cancel-registration',
          'release-capacity',
        ]);
      }),
  );

  it.effect(
    'retains a direct binding claim when checkout expiry is ambiguous',
    () =>
      Effect.gen(function* () {
        const operationOrder: string[] = [];
        const database = yield* createPaidDirectRegistrationDatabase({
          bindingSucceeds: false,
          operationOrder,
        });
        const checkoutStripeClient = createStripeTestClient();
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('stripe');
            return Promise.resolve(
              checkoutSessionResponse({
                id: 'cs_direct_1',
                paymentIntent: null,
                url: 'https://checkout.stripe.test/direct',
              }),
            );
          }),
        );
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('expire');
            return Promise.reject(new Error('expiry response lost'));
          }),
        );

        const error = yield* EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: 'acct_123',
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, database)),
          Effect.provideService(StripeClient, checkoutStripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe('Failed to bind stripe checkout session');
        expect(operationOrder).toEqual([
          'reserve',
          'registration',
          'claim',
          'stripe',
          'bind',
          'expire',
        ]);
      }),
  );
});

describe('EventRegistrationService', () => {
  describe('isUserEligibleForRegistrationOption', () => {
    it('treats an empty role list as open to all users', () => {
      expect(
        isUserEligibleForRegistrationOption({
          optionRoleIds: [],
          userRoleIds: ['role-2'],
        }),
      ).toBe(true);
    });

    it('requires at least one matching role when the option has role constraints', () => {
      expect(
        isUserEligibleForRegistrationOption({
          optionRoleIds: ['role-1'],
          userRoleIds: ['role-2'],
        }),
      ).toBe(false);
    });
  });

  describe('validateRegistrationAddons', () => {
    const availableAddOn = {
      addOnId: 'addon-1',
      allowMultiple: true,
      allowPurchaseDuringRegistration: true,
      includedQuantity: 2,
      isPaid: true,
      maxQuantityPerUser: 2,
      optionalPurchaseQuantity: 2,
      price: 500,
      stripeTaxRateId: 'txr_1',
      taxRateDisplayName: 'VAT',
      taxRateInclusive: true,
      taxRatePercentage: '19',
      title: 'Lunch',
      totalAvailableQuantity: 5,
    } as const;

    it('normalizes selected registration add-ons', () => {
      expect(
        validateRegistrationAddons({
          addOns: [
            {
              addOnId: 'addon-1',
              quantity: 1,
            },
            {
              addOnId: 'addon-1',
              quantity: 1,
            },
          ],
          availableAddOns: [availableAddOn],
        }),
      ).toEqual([
        {
          ...availableAddOn,
          fulfilledQuantity: 4,
          selectedQuantity: 2,
        },
      ]);
    });

    it('rejects add-ons that are not available during registration', () => {
      expect(() =>
        validateRegistrationAddons({
          addOns: [
            {
              addOnId: 'other-addon',
              quantity: 1,
            },
          ],
          availableAddOns: [availableAddOn],
        }),
      ).toThrow('Add-on is not available for this registration option');

      expect(() =>
        validateRegistrationAddons({
          addOns: [{ addOnId: 'addon-1', quantity: 1 }],
          availableAddOns: [
            { ...availableAddOn, allowPurchaseDuringRegistration: false },
          ],
        }),
      ).toThrow('Add-on is not available during registration');
    });

    it('rejects quantities above the per-user limit or remaining availability', () => {
      expect(() =>
        validateRegistrationAddons({
          addOns: [
            {
              addOnId: 'addon-1',
              quantity: 3,
            },
          ],
          availableAddOns: [availableAddOn],
        }),
      ).toThrow('Add-on quantity exceeds the per-user limit');

      expect(() =>
        validateRegistrationAddons({
          addOns: [
            {
              addOnId: 'addon-1',
              quantity: 2,
            },
          ],
          availableAddOns: [
            {
              ...availableAddOn,
              maxQuantityPerUser: 5,
              totalAvailableQuantity: 3,
            },
          ],
        }),
      ).toThrow('Add-on quantity is no longer available');
    });
  });

  describe('validateRegistrationQuestionAnswers', () => {
    it('trims submitted answers and ignores blank optional answers', () => {
      expect(
        validateRegistrationQuestionAnswers({
          answers: [
            {
              answer: '  Alice  ',
              questionId: 'question-1',
            },
            {
              answer: ' '.repeat(3),
              questionId: 'question-2',
            },
          ],
          questions: [
            {
              id: 'question-1',
              required: true,
            },
            {
              id: 'question-2',
              required: false,
            },
          ],
        }),
      ).toEqual([
        {
          answer: 'Alice',
          questionId: 'question-1',
        },
      ]);
    });

    it('rejects missing required answers', () => {
      expect(() =>
        validateRegistrationQuestionAnswers({
          answers: [],
          questions: [
            {
              id: 'question-1',
              required: true,
            },
          ],
        }),
      ).toThrow('Required registration question is missing');
    });

    it('rejects answers for questions outside the selected option', () => {
      expect(() =>
        validateRegistrationQuestionAnswers({
          answers: [
            {
              answer: 'Alice',
              questionId: 'other-question',
            },
          ],
          questions: [
            {
              id: 'question-1',
              required: false,
            },
          ],
        }),
      ).toThrow('Registration question does not belong to this option');
    });
  });

  it.effect(
    'rejects an invalid tenant domain before reading or writing registration data',
    () =>
      Effect.gen(function* () {
        const { database: mockDatabase, findRegistration } =
          yield* createReadEligibilityDatabaseFixture({
            option: null,
          });

        const error = yield* EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            currency: 'EUR',
            domain: 'tenant.example.com/path',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe('Invalid tenant domain configuration');
        expect(findRegistration).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rejects a second registration for the same event before looking up another option',
    () =>
      Effect.gen(function* () {
        const { database: mockDatabase, findRegistrationOption } =
          yield* createReadEligibilityDatabaseFixture({
            existingRegistration: {
              id: 'existing-registration',
              registrationOptionId: 'option-1',
              status: 'CONFIRMED',
            },
            option: null,
          });

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'organizer-option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('User is already registered for this event');
        expect(findRegistrationOption).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'queries registration options with explicit projection columns',
    () =>
      Effect.gen(function* () {
        const { database: mockDatabase, findRegistrationOption } =
          yield* createReadEligibilityDatabaseFixture({
            option: null,
          });

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationNotFoundError');
        expect(findRegistrationOption).toHaveBeenCalledWith(
          expect.objectContaining({
            columns: expect.objectContaining({
              closeRegistrationTime: true,
              confirmedSpots: true,
              eventId: true,
              id: true,
              isPaid: true,
              openRegistrationTime: true,
              organizingRegistration: true,
              price: true,
              registrationMode: true,
              reservedSpots: true,
              roleIds: true,
              spots: true,
              stripeTaxRateId: true,
            }),
          }),
        );
      }),
  );

  it.effect('rejects registration for an unpublished event', () =>
    Effect.gen(function* () {
      const { database: mockDatabase } =
        yield* createReadEligibilityDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            event: { ...approvedRegistrationOption.event, status: 'DRAFT' },
          },
        });

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 0,
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe('Event is not open for registration');
    }),
  );

  it.effect(
    'rejects registration outside the server-side registration window',
    () =>
      Effect.gen(function* () {
        const { database: mockDatabase } =
          yield* createReadEligibilityDatabaseFixture({
            option: {
              ...approvedRegistrationOption,
              openRegistrationTime: new Date('2026-09-20T10:00:00.000Z'),
            },
          });

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('Registration is not open');
      }),
  );

  it.effect('rejects registration when user roles are not eligible', () =>
    Effect.gen(function* () {
      const { database: mockDatabase } =
        yield* createReadEligibilityDatabaseFixture({
          option: approvedRegistrationOption,
        });

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 0,
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-2'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'User is not eligible for this registration option',
      );
    }),
  );

  it.effect('rejects registration for another tenant event', () =>
    Effect.gen(function* () {
      const { database: mockDatabase } =
        yield* createReadEligibilityDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            event: {
              ...approvedRegistrationOption.event,
              tenantId: 'tenant-2',
            },
          },
        });

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 0,
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationNotFoundError');
      expect(error.message).toBe('Registration option not found');
    }),
  );

  it.effect('rejects registration when the selected option is full', () =>
    Effect.gen(function* () {
      const { database: mockDatabase } =
        yield* createReadEligibilityDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            confirmedSpots: 8,
            reservedSpots: 2,
          },
        });

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 0,
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe('Registration option has no available spots');
    }),
  );

  it.effect(
    'stores guest count when registering multiple participant spots',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createCurrentReservationDatabaseFixture({
          guestCount: 2,
          steps: [
            ...currentReservationInitialReadSteps,
            'readActiveRegistration',
            'reserveCapacity',
            'insertRegistration',
            ...currentReservationFreeConfirmationSteps,
          ],
        });

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 2,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            emailSenderEmail: null,
            emailSenderName: null,
            id: 'tenant-1',
            name: 'Tenant',
            stripeAccountId: undefined,
          },
          user: {
            communicationEmail: 'alice@example.com',
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        yield* program;
        const insertedRegistration = fixture.registrationInserts[0];
        const insertedAcquisition = fixture.acquisitionInserts[0];
        expect(insertedRegistration).toEqual(
          expect.objectContaining({
            appliedDiscountedPrice: null,
            appliedDiscountType: null,
            basePriceAtRegistration: 0,
            discountAmount: 0,
            guestCount: 2,
            status: 'CONFIRMED',
          }),
        );
        expect(insertedAcquisition).toEqual(
          expect.objectContaining({
            kind: 'initial',
            operationKey: `registration-initial:${fixture.registrationId}`,
            ordinal: 0,
            ownerUserId: 'user-1',
            spotCount: 3,
          }),
        );
        fixture.expectComplete();
      }),
  );

  it.effect(
    'saves a direct registration answer with its complete question and registration owner tuple',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createCurrentReservationDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            questions: [{ id: 'question-1', required: true }],
          },
          steps: [
            ...currentReservationInitialReadSteps,
            'readActiveRegistration',
            'reserveCapacity',
            'insertRegistration',
            'insertAnswers',
            ...currentReservationFreeConfirmationSteps,
          ],
        });
        yield* EventRegistrationService.registerForEvent({
          answers: [{ answer: '  Vegetarian  ', questionId: 'question-1' }],
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            emailSenderEmail: null,
            emailSenderName: null,
            id: 'tenant-1',
            name: 'Tenant',
            stripeAccountId: undefined,
          },
          user: {
            communicationEmail: 'alice@example.com',
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );
        expect(fixture.answerInserts).toEqual([
          {
            answer: 'Vegetarian',
            eventId: 'event-1',
            id: expect.any(String),
            questionId: 'question-1',
            registrationId: fixture.registrationId,
            registrationOptionId: 'option-1',
            tenantId: 'tenant-1',
          },
        ]);
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
        fixture.expectComplete();
      }),
  );

  it.effect(
    'transactionally enqueues a direct free confirmation to the communication email',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createCurrentReservationDatabaseFixture({
          communicationEmail: 'preferred@example.com',
          emailSenderEmail: 'events@tenant.example',
          emailSenderName: 'Events Team',
          steps: [
            ...currentReservationInitialReadSteps,
            'readActiveRegistration',
            'reserveCapacity',
            'insertRegistration',
            'readAcquisitions',
            'insertAcquisition',
            'insertAcquisitionComponents',
            'readEmailTenant',
            'readNotificationUser',
            'insertEmail',
            'COMMIT',
          ],
        });
        const { findEmailTenant, findNotificationUser } = fixture;

        yield* EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'login@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const emailInsert = fixture.emailInserts[0];
        const emailInsertedWhileTransactionOpen =
          fixture.emailInsertedWhileTransactionOpen;
        const operationOrder = fixture.writeOrder.filter(
          (operation) => operation === 'registration' || operation === 'email',
        );
        expect(findEmailTenant).toHaveBeenCalledOnce();
        expect(findNotificationUser).toHaveBeenCalledOnce();
        expect(emailInsertedWhileTransactionOpen).toBe(true);
        expect(operationOrder).toEqual(['registration', 'email']);
        expect(emailInsert).toEqual(
          expect.objectContaining({
            idempotencyKey: `registration-confirmed/tenant-1/${fixture.registrationId}`,
            kind: 'registrationConfirmed',
            replyToEmail: 'events@tenant.example',
            replyToName: 'Events Team',
            subject: 'Registration confirmed: Approved event',
            tenantId: 'tenant-1',
            toEmail: 'preferred@example.com',
          }),
        );
        expect(
          Schema.decodeUnknownSync(Schema.String)(emailInsert?.['html']),
        ).toContain('https://tenant.example.com/events/event-1');
        fixture.expectComplete();
      }),
  );

  it.effect('rejects guest registration when not enough spots remain', () =>
    Effect.gen(function* () {
      const { database: mockDatabase } =
        yield* createReadEligibilityDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            confirmedSpots: 8,
            reservedSpots: 0,
          },
        });

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 2,
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe('Registration option has no available spots');
    }),
  );

  it.effect('rejects guest spots for organizer/helper registration', () =>
    Effect.gen(function* () {
      const { database: mockDatabase } =
        yield* createReadEligibilityDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            organizingRegistration: true,
          },
        });

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 1,
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Guest spots are only available for participant options',
      );
    }),
  );

  it.effect('rejects registration for unsupported registration modes', () =>
    Effect.gen(function* () {
      const { database: mockDatabase, updateOptionCounters } =
        yield* createReadEligibilityDatabaseFixture({
          option: { ...approvedRegistrationOption, registrationMode: 'random' },
        });

      const program = EventRegistrationService.registerForEvent({
        eventId: 'event-1',
        guestCount: 0,
        registrationOptionId: 'option-1',
        tenant: {
          ...tenantPublicOrigin,
          currency: 'EUR',
          id: 'tenant-1',
          stripeAccountId: undefined,
        },
        user: {
          email: 'alice@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase)),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe('Registration option mode is not supported');
      expect(updateOptionCounters).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    'creates manual approval applications without reserving capacity',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createCurrentReservationDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            confirmedSpots: 10,
            registrationMode: 'application',
            reservedSpots: 0,
          },
          steps: [
            ...currentReservationInitialReadSteps,
            'readActiveRegistration',
            'insertRegistration',
            'COMMIT',
          ],
        });
        const { updateOptionCounters } = fixture;

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        yield* program;
        const insertedRegistration = fixture.registrationInserts[0];
        expect(insertedRegistration).toEqual(
          expect.objectContaining({
            status: 'PENDING',
          }),
        );
        expect(updateOptionCounters).not.toHaveBeenCalled();
        fixture.expectComplete();
      }),
  );

  it.effect('confirms an approved free application without Stripe', () =>
    Effect.gen(function* () {
      const approvalDatabase = yield* createManualApprovalDatabase({
        registration: freeManualApprovalRegistration,
      });
      const checkoutStripeClient = createStripeTestClient();
      const createSession = vi.fn(() =>
        Promise.resolve(
          checkoutSessionResponse({
            id: 'cs_test_unexpected',
            paymentIntent: null,
            url: 'https://checkout.stripe.test/unexpected',
          }),
        ),
      );
      vi.spyOn(
        checkoutStripeClient.checkout.sessions,
        'create',
      ).mockImplementation(createSession);

      const result = yield* runManualApproval({
        database: approvalDatabase.database,
        stripe: checkoutStripeClient,
        stripeAccountId: undefined,
      });

      expect(result).toEqual({ status: 'confirmed' });
      expect(approvalDatabase.registrationUpdateValues()).toEqual(
        expect.objectContaining({
          appliedDiscountedPrice: null,
          appliedDiscountType: null,
          basePriceAtRegistration: 0,
          discountAmount: 0,
          status: 'CONFIRMED',
        }),
      );
      expect(createSession).not.toHaveBeenCalled();
      expect(approvalDatabase.claimInsertCount()).toBe(0);
      expect(approvalDatabase.reservationUpdateCount()).toBe(1);
      expect(approvalDatabase.emailInsertCount()).toBe(1);
      expect(approvalDatabase.emailKinds).toEqual(['manualApproval']);
      expect(approvalDatabase.acquisitionInsertValues()).toEqual(
        expect.objectContaining({
          kind: 'initial',
          operationKey: 'registration-initial:registration-1',
          ordinal: 0,
          ownerUserId: 'user-1',
          registrationId: 'registration-1',
          spotCount: 1,
        }),
      );
      expect(approvalDatabase.acquisitionComponentInsertValues()).toEqual([
        expect.objectContaining({
          allocationKey: 'registration-initial:registration-1',
          grossAmount: 0,
          kind: 'registration',
          netAmount: 0,
        }),
      ]);
    }),
  );

  it.effect(
    'persists a paid approval claim before Stripe and returns payment pending',
    () =>
      Effect.gen(function* () {
        const approvalDatabase = yield* createManualApprovalDatabase();
        let auditedTransition: unknown;
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.fn(() => {
          approvalDatabase.operationOrder.push('stripe');
          return Promise.resolve(
            checkoutSessionResponse({
              id: 'cs_test_1',
              paymentIntent: null,
              url: 'https://checkout.stripe.test/session',
            }),
          );
        });
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(createSession);

        const result = yield* runManualApproval({
          database: approvalDatabase.database,
          executiveUserId: null,
          onApproved: (_tx, transition) => {
            auditedTransition = transition;
            approvalDatabase.operationOrder.push('audit');
            return Effect.void;
          },
          stripe: checkoutStripeClient,
        });

        expect(result).toEqual({ status: 'paymentPending' });
        expect(approvalDatabase.operationOrder).toEqual([
          'claim',
          'reserve',
          'registration',
          'audit',
          'stripe',
          'bind',
          'email',
        ]);
        expect(approvalDatabase.claimInsertCount()).toBe(1);
        expect(approvalDatabase.claimExecutiveUserId()).toBeNull();
        expect(auditedTransition).toEqual({
          eventId: 'event-1',
          guestCount: 0,
          registrationId: 'registration-1',
          registrationOptionId: 'option-1',
          statusAfter: 'PENDING',
          statusBefore: 'PENDING',
          transactionId: expect.any(String),
          transactionStatus: 'pending',
          userId: 'user-1',
        });
        expect(approvalDatabase.reservationUpdateCount()).toBe(1);
        expect(approvalDatabase.bindingUpdateCount()).toBe(1);
        expect(approvalDatabase.emailInsertCount()).toBe(1);
        expect(approvalDatabase.getClaim()).toEqual(
          expect.objectContaining({
            appFee: 35,
            id: expect.any(String),
            stripeCheckoutRequest: expect.objectContaining({
              eventUrl: 'https://tenant.example.com/events/event-1',
              lineItems: [
                expect.objectContaining({
                  name: 'Registration fee for Approved event',
                  quantity: 1,
                  taxRateId: 'txr_19',
                  unitAmount: 1000,
                }),
              ],
            }),
            stripeCheckoutSessionId: 'cs_test_1',
            stripeCheckoutUrl: 'https://checkout.stripe.test/session',
          }),
        );
      }),
  );

  it.effect(
    'resumes an incomplete claim with its stored snapshot and no second reservation',
    () =>
      Effect.gen(function* () {
        const storedSnapshot = Schema.decodeUnknownSync(
          RegistrationCheckoutSnapshotSchema,
        )({
          customerEmail: 'stored-customer@example.com',
          eventTitle: 'Stored event title',
          eventUrl: 'https://stored.example/events/event-1',
          expiresAt: 1_900_000_000,
          lineItems: [
            {
              name: 'Stored registration line',
              quantity: 2,
              taxRateId: 'txr_stored',
              unitAmount: 4321,
            },
          ],
          notificationEmail: 'stored-notification@example.com',
        });
        const existingClaim = {
          appFee: 151,
          currency: 'CZK',
          id: 'transaction-existing',
          stripeAccountId: 'acct_stored',
          stripeCheckoutRequest: storedSnapshot,
          stripeCheckoutSessionId: null,
          stripeCheckoutUrl: null,
        } satisfies ManualApprovalClaim;
        const approvalDatabase = yield* createManualApprovalDatabase({
          existingClaim,
        });
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.fn(() => {
          approvalDatabase.operationOrder.push('stripe');
          return Promise.resolve(
            checkoutSessionResponse({
              id: 'cs_test_existing',
              paymentIntent: null,
              url: 'https://checkout.stripe.test/existing',
            }),
          );
        });
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(createSession);

        const result = yield* runManualApproval({
          database: approvalDatabase.database,
          stripe: checkoutStripeClient,
        });

        expect(result).toEqual({ status: 'paymentPending' });
        expect(approvalDatabase.claimInsertCount()).toBe(0);
        expect(approvalDatabase.reservationUpdateCount()).toBe(0);
        expect(approvalDatabase.operationOrder).toEqual([
          'stripe',
          'bind',
          'email',
        ]);
        expect(createSession).toHaveBeenCalledWith(
          {
            cancel_url:
              'https://stored.example/events/event-1?registrationStatus=cancel',
            customer_email: 'stored-customer@example.com',
            expires_at: 1_900_000_000,
            line_items: [
              {
                price_data: {
                  currency: 'CZK',
                  product_data: {
                    name: 'Stored registration line',
                  },
                  unit_amount: 4321,
                },
                quantity: 2,
                tax_rates: ['txr_stored'],
              },
            ],
            metadata: {
              registrationId: 'registration-1',
              tenantId: 'tenant-1',
              transactionId: 'transaction-existing',
            },
            mode: 'payment',
            payment_intent_data: {
              application_fee_amount: 151,
            },
            success_url:
              'https://stored.example/events/event-1?registrationStatus=success',
          },
          {
            idempotencyKey:
              'registration:registration-1:transaction:transaction-existing',
            stripeAccount: 'acct_stored',
          },
        );
      }),
  );

  it.effect(
    'preserves the Stripe cause and retains an incomplete payment claim',
    () =>
      Effect.gen(function* () {
        const approvalDatabase = yield* createManualApprovalDatabase();
        const checkoutStripeClient = createStripeTestClient();
        const stripeCause = new Error('connection reset after request');
        const createSession = vi.fn(() => {
          approvalDatabase.operationOrder.push('stripe');
          return Promise.reject(stripeCause);
        });
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(createSession);

        const error = yield* runManualApproval({
          database: approvalDatabase.database,
          stripe: checkoutStripeClient,
        }).pipe(Effect.flip);

        expect(error).toBeInstanceOf(EventRegistrationInternalError);
        expect(error.message).toBe(
          'Payment setup is still pending. Retry approval or cancel the registration.',
        );
        if (error instanceof EventRegistrationInternalError) {
          expect(error.cause).toEqual(
            expect.objectContaining({
              _tag: 'StripeCheckoutError',
              cause: stripeCause,
            }),
          );
        }
        expect(approvalDatabase.operationOrder).toEqual([
          'claim',
          'reserve',
          'registration',
          'stripe',
        ]);
        expect(approvalDatabase.claimInsertCount()).toBe(1);
        expect(approvalDatabase.reservationUpdateCount()).toBe(1);
        expect(approvalDatabase.bindingUpdateCount()).toBe(0);
        expect(approvalDatabase.emailInsertCount()).toBe(0);
        expect(approvalDatabase.getClaim()).toEqual(
          expect.objectContaining({
            stripeCheckoutSessionId: null,
            stripeCheckoutUrl: null,
          }),
        );
      }),
  );

  it.effect(
    'persists a direct payment claim before Stripe and binds the returned session',
    () =>
      Effect.gen(function* () {
        const directDatabase = yield* createDirectCheckoutDatabase();
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.fn(() => {
          directDatabase.operationOrder.push('stripe');
          return Promise.resolve(
            checkoutSessionResponse({
              id: 'cs_direct_1',
              paymentIntent: 'pi_direct_1',
              url: 'https://checkout.stripe.test/direct',
            }),
          );
        });
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(createSession);

        yield* runDirectCheckout({
          database: directDatabase.database,
          stripe: checkoutStripeClient,
        });

        expect(directDatabase.operationOrder).toEqual([
          'reserve',
          'registration',
          'claim',
          'stripe',
          'bind',
        ]);
        expect(directDatabase.claimInsertCount()).toBe(1);
        expect(directDatabase.reservationUpdateCount()).toBe(1);
        expect(directDatabase.bindingUpdateCount()).toBe(1);
        const claim = directDatabase.getClaim();
        expect(claim).toEqual(
          expect.objectContaining({
            stripeCheckoutRequest: expect.objectContaining({
              customerEmail: 'alice@example.com',
              eventUrl: 'https://tenant.example.com/events/event-1',
              lineItems: [
                {
                  name: 'Registration fee for Approved event',
                  quantity: 1,
                  taxRateId: 'txr_19',
                  unitAmount: 1000,
                },
              ],
            }),
            stripeCheckoutSessionId: 'cs_direct_1',
            stripeCheckoutUrl: 'https://checkout.stripe.test/direct',
          }),
        );
        expect(createSession).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: {
              registrationId: 'registration-direct',
              tenantId: 'tenant-1',
              transactionId: claim?.id,
            },
          }),
          {
            idempotencyKey: `registration:registration-direct:transaction:${claim?.id}`,
            stripeAccount: 'acct_123',
          },
        );
      }),
  );

  it.effect(
    'creates paid Checkout on the replacement account after its tax rate is reassigned',
    () =>
      Effect.gen(function* () {
        const directDatabase = yield* createDirectCheckoutDatabase({
          configuredStripeTaxRateId: 'txr_replacement',
          lockedStripeAccountId: 'acct_replacement',
          registrationOption: {
            isPaid: true,
            price: 1000,
            stripeTaxRateId: 'txr_replacement',
          },
        });
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.fn(() =>
          Promise.resolve(
            checkoutSessionResponse({
              id: 'cs_rotated_account',
              paymentIntent: 'pi_rotated_account',
              url: 'https://checkout.stripe.test/rotated-account',
            }),
          ),
        );
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(createSession);

        yield* runDirectCheckout({
          database: directDatabase.database,
          stripe: checkoutStripeClient,
          stripeAccountId: 'acct_replacement',
        });

        expect(directDatabase.getClaim()).toEqual(
          expect.objectContaining({
            stripeAccountId: 'acct_replacement',
            stripeCheckoutRequest: expect.objectContaining({
              lineItems: [
                {
                  name: 'Registration fee for Approved event',
                  quantity: 1,
                  taxRateId: 'txr_replacement',
                  unitAmount: 1000,
                },
              ],
            }),
          }),
        );
        expect(createSession).toHaveBeenCalledWith(
          expect.objectContaining({
            line_items: [
              expect.objectContaining({
                price_data: expect.objectContaining({ unit_amount: 1000 }),
                quantity: 1,
                tax_rates: ['txr_replacement'],
              }),
            ],
          }),
          expect.objectContaining({ stripeAccount: 'acct_replacement' }),
        );
      }),
  );

  it.effect(
    'retries an ambiguous direct Checkout failure with the stored request and no second reservation',
    () =>
      Effect.gen(function* () {
        const directDatabase = yield* createDirectCheckoutDatabase();
        const checkoutStripeClient = createStripeTestClient();
        const stripeCause = new Error('connection reset after request');
        let attempt = 0;
        const createSession = vi.fn(() => {
          directDatabase.operationOrder.push('stripe');
          attempt += 1;
          return attempt === 1
            ? Promise.reject(stripeCause)
            : Promise.resolve(
                checkoutSessionResponse({
                  id: 'cs_direct_retry',
                  paymentIntent: 'pi_direct_retry',
                  url: 'https://checkout.stripe.test/direct-retry',
                }),
              );
        });
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(createSession);

        const firstError = yield* runDirectCheckout({
          database: directDatabase.database,
          stripe: checkoutStripeClient,
        }).pipe(Effect.flip);

        expect(firstError).toBeInstanceOf(EventRegistrationInternalError);
        expect(firstError.message).toBe(
          'Payment setup is still pending. Retry registration or cancel it.',
        );
        if (firstError instanceof EventRegistrationInternalError) {
          expect(firstError.cause).toEqual(
            expect.objectContaining({
              _tag: 'StripeCheckoutError',
              cause: stripeCause,
            }),
          );
        }
        expect(directDatabase.claimInsertCount()).toBe(1);
        expect(directDatabase.reservationUpdateCount()).toBe(1);
        expect(directDatabase.bindingUpdateCount()).toBe(0);

        yield* runDirectCheckout({
          database: directDatabase.database,
          stripe: checkoutStripeClient,
        });

        expect(createSession).toHaveBeenCalledTimes(2);
        expect(createSession.mock.calls[1]).toEqual(
          createSession.mock.calls[0],
        );
        expect(directDatabase.operationOrder).toEqual([
          'reserve',
          'registration',
          'claim',
          'stripe',
          'stripe',
          'bind',
        ]);
        expect(directDatabase.claimInsertCount()).toBe(1);
        expect(directDatabase.reservationUpdateCount()).toBe(1);
        expect(directDatabase.bindingUpdateCount()).toBe(1);
      }),
  );

  it.effect(
    'maps the active-registration unique constraint race to a domain conflict',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createCurrentReservationDatabaseFixture({
          steps: [
            ...currentReservationInitialReadSteps,
            'readActiveRegistration',
            'reserveCapacity',
            'insertRegistrationUniqueViolation',
            'ROLLBACK',
          ],
        });

        const error = yield* EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe('User is already registered for this event');
        fixture.expectComplete();
      }),
  );

  it.effect(
    'rejects new registrations when the tenant active registration limit is reached',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createCurrentReservationDatabaseFixture({
          steps: [
            ...currentReservationInitialReadSteps,
            'readActiveRegistration',
            'readActiveFutureRegistration',
            'COMMIT',
          ],
        });
        const {
          lockMembership,
          selectActiveFutureRegistrations,
          updateOptionCounters,
        } = fixture;

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            maxActiveRegistrationsPerUser: 1,
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('Active registration limit reached');
        expect(selectActiveFutureRegistrations).toHaveBeenCalled();
        expect(lockMembership).toHaveBeenCalledOnce();
        expect(updateOptionCounters).not.toHaveBeenCalled();
        fixture.expectComplete();
      }),
  );

  it.effect(
    'rejects when a concurrent registration appears inside the reservation transaction',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createCurrentReservationDatabaseFixture({
          steps: [
            ...currentReservationInitialReadSteps,
            'readConcurrentRegistration',
            'COMMIT',
          ],
        });
        const { updateOptionCounters } = fixture;

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('User is already registered for this event');
        expect(updateOptionCounters).not.toHaveBeenCalled();
        fixture.expectComplete();
      }),
  );

  it.effect(
    'rejects when the transactional capacity counter update loses the race',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createCurrentReservationDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            confirmedSpots: 9,
            reservedSpots: 0,
          },
          steps: [
            ...currentReservationInitialReadSteps,
            'readActiveRegistration',
            'loseCapacity',
            'COMMIT',
          ],
        });
        const { insertRegistration } = fixture;

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Registration option has no available spots',
        );
        expect(insertRegistration).not.toHaveBeenCalled();
        fixture.expectComplete();
      }),
  );

  it.effect(
    'persists the configured add-on attachment quantity for a selected add-on',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createCurrentReservationDatabaseFixture({
          addon: {
            addOnId: 'addon-1',
            allowMultiple: false,
            allowPurchaseDuringRegistration: true,
            includedQuantity: 1,
            isPaid: false,
            maxQuantityPerUser: 1,
            optionalPurchaseQuantity: 1,
            price: 0,
            stripeTaxRateId: null,
            taxRateDisplayName: null,
            taxRateInclusive: null,
            taxRatePercentage: null,
            title: 'Lunch',
            totalAvailableQuantity: 2,
          },
          steps: [
            ...currentReservationInitialReadSteps,
            'readActiveRegistration',
            'reserveCapacity',
            'insertRegistration',
            'reserveAddonStock',
            'insertAddonPurchase',
            'insertAddonLot',
            ...currentReservationFreeConfirmationSteps,
          ],
        });
        const { insertAddonLot, insertAddonPurchase } = fixture;

        yield* EventRegistrationService.registerForEvent({
          addOns: [{ addOnId: 'addon-1', quantity: 1 }],
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            emailSenderEmail: null,
            emailSenderName: null,
            id: 'tenant-1',
            name: 'Tenant',
            stripeAccountId: undefined,
          },
          user: {
            communicationEmail: 'alice@example.com',
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(insertAddonPurchase).toHaveBeenCalledWith(
          expect.objectContaining({
            addonId: 'addon-1',
            includedQuantity: 1,
            purchasedQuantity: 1,
            quantity: 2,
            registrationId: fixture.registrationId,
          }),
        );
        expect(insertAddonLot).toHaveBeenCalledWith(
          expect.objectContaining({
            baseAmount: 0,
            grossAmount: 0,
            netAmount: 0,
            paymentAllocationFinalizedAt: expect.any(Date),
            quantity: 1,
            registrationId: fixture.registrationId,
            taxAmount: 0,
            unitPrice: 0,
          }),
        );
        fixture.expectComplete();
      }),
  );

  it.effect(
    'fails the reservation transaction when add-on stock is no longer available',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createCurrentReservationDatabaseFixture({
          addon: {
            addOnId: 'addon-1',
            allowMultiple: false,
            allowPurchaseDuringRegistration: true,
            includedQuantity: 0,
            isPaid: false,
            maxQuantityPerUser: 1,
            optionalPurchaseQuantity: 1,
            price: 0,
            stripeTaxRateId: null,
            taxRateDisplayName: null,
            taxRateInclusive: null,
            taxRatePercentage: null,
            title: 'Lunch',
            totalAvailableQuantity: 1,
          },
          steps: [
            ...currentReservationInitialReadSteps,
            'readActiveRegistration',
            'reserveCapacity',
            'insertRegistration',
            'loseAddonStock',
            'ROLLBACK',
          ],
          stripeAccountId: 'acct_123',
        });
        const { insertAddonPurchase } = fixture;

        const program = EventRegistrationService.registerForEvent({
          addOns: [{ addOnId: 'addon-1', quantity: 1 }],
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            stripeAccountId: 'acct_123',
          },
          user: {
            email: 'alice@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        const isTransactionFailed =
          error instanceof EventRegistrationConflictError &&
          fixture.transactionCommands.includes('ROLLBACK');
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('Add-on quantity is no longer available');
        expect(isTransactionFailed).toBe(true);
        expect(insertAddonPurchase).not.toHaveBeenCalled();
        fixture.expectComplete();
      }),
  );

  it.effect('joins the waitlist for a full public participant option', () =>
    Effect.gen(function* () {
      const {
        database: mockDatabase,
        findActiveRegistrations,
        insertWaitlistRegistration,
        lockMembership,
        transactionCommands,
        updateWaitlistCounter,
      } = yield* createCurrentWaitlistDatabaseFixture({
        option: {
          ...approvedRegistrationOption,
          confirmedSpots: 10,
          organizingRegistration: false,
          roleIds: [],
        },
      });

      const program = EventRegistrationService.joinWaitlist({
        eventId: 'event-1',
        registrationOptionId: 'option-1',
        tenant: {
          id: 'tenant-1',
        },
        user: {
          id: 'user-1',
          roleIds: [],
        },
      }).pipe(
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase)),
        Effect.provide(configProviderLayer),
      );

      yield* program;
      expect(insertWaitlistRegistration).toHaveBeenCalled();
      expect(insertWaitlistRegistration).toHaveBeenCalledOnce();
      expect(lockMembership).toHaveBeenCalledOnce();
      expect(findActiveRegistrations).toHaveBeenCalledOnce();
      expect(updateWaitlistCounter).toHaveBeenCalledOnce();
      expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
    }),
  );

  it.effect(
    'saves a waitlist answer with its complete question and registration owner tuple',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createCurrentWaitlistDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            confirmedSpots: 10,
            questions: [{ id: 'question-1', required: true }],
            roleIds: [],
          },
        });
        yield* EventRegistrationService.joinWaitlist({
          answers: [{ answer: '  Vegetarian  ', questionId: 'question-1' }],
          eventId: 'event-1',
          registrationOptionId: 'option-1',
          tenant: { id: 'tenant-1' },
          user: { id: 'user-1', roleIds: [] },
        }).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provide(configProviderLayer),
        );
        expect(fixture.answerInserts).toEqual([
          {
            answer: 'Vegetarian',
            eventId: 'event-1',
            id: expect.any(String),
            questionId: 'question-1',
            registrationId: 'waitlist-1',
            registrationOptionId: 'option-1',
            tenantId: 'tenant-1',
          },
        ]);
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );

  it.effect(
    'maps a concurrent waitlist insert unique violation to a domain conflict',
    () =>
      Effect.gen(function* () {
        const uniqueViolation = new SqlError({
          reason: new UniqueViolation({
            cause: new Error('duplicate active registration'),
            constraint: activeEventRegistrationUniqueIndexName,
          }),
        });
        const {
          database: mockDatabase,
          insertWaitlistRegistration,
          transactionCommands,
        } = yield* createCurrentWaitlistDatabaseFixture({
          insertFailure: uniqueViolation,
          option: {
            ...approvedRegistrationOption,
            confirmedSpots: 10,
            organizingRegistration: false,
            roleIds: [],
          },
        });

        const error = yield* EventRegistrationService.joinWaitlist({
          eventId: 'event-1',
          registrationOptionId: 'option-1',
          tenant: { id: 'tenant-1' },
          user: { id: 'user-1', roleIds: [] },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase)),
          Effect.provide(configProviderLayer),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe('User is already registered for this event');
        expect(insertWaitlistRegistration).toHaveBeenCalledOnce();
        expect(transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
      }),
  );

  it.effect(
    'locks tenant membership and enforces the active limit before joining a waitlist',
    () =>
      Effect.gen(function* () {
        const {
          database: mockDatabase,
          findActiveFutureRegistrations,
          insertWaitlistRegistration,
          lockMembership,
          transactionCommands,
          updateWaitlistCounter,
        } = yield* createCurrentWaitlistDatabaseFixture({
          activeFutureRegistrationIds: ['active-registration-1'],
          option: {
            ...approvedRegistrationOption,
            confirmedSpots: 10,
            organizingRegistration: false,
            roleIds: [],
          },
        });

        const error = yield* EventRegistrationService.joinWaitlist({
          eventId: 'event-1',
          registrationOptionId: 'option-1',
          tenant: {
            id: 'tenant-1',
            maxActiveRegistrationsPerUser: 1,
          },
          user: { id: 'user-1', roleIds: [] },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase)),
          Effect.provide(configProviderLayer),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe('Active registration limit reached');
        expect(lockMembership).toHaveBeenCalledOnce();
        expect(updateWaitlistCounter).not.toHaveBeenCalled();
        expect(insertWaitlistRegistration).not.toHaveBeenCalled();
        expect(findActiveFutureRegistrations).toHaveBeenCalledOnce();
        expect(transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );

  it.effect('rejects waitlist joining while capacity remains', () =>
    Effect.gen(function* () {
      const { database: mockDatabase, transactionCommands } =
        yield* createCurrentWaitlistDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            organizingRegistration: false,
          },
        });

      const program = EventRegistrationService.joinWaitlist({
        eventId: 'event-1',
        registrationOptionId: 'option-1',
        tenant: {
          id: 'tenant-1',
        },
        user: {
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase)),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Registration option still has available spots',
      );
      expect(transactionCommands).toEqual([]);
    }),
  );

  it.effect('rejects waitlist joining for organizer/helper options', () =>
    Effect.gen(function* () {
      const { database: mockDatabase, transactionCommands } =
        yield* createCurrentWaitlistDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            confirmedSpots: 10,
            organizingRegistration: true,
          },
        });

      const program = EventRegistrationService.joinWaitlist({
        eventId: 'event-1',
        registrationOptionId: 'option-1',
        tenant: {
          id: 'tenant-1',
        },
        user: {
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase)),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Waitlist is only available for participant options',
      );
      expect(transactionCommands).toEqual([]);
    }),
  );
});
