import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import { describe, expect, it, vi } from '@effect/vitest';
import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
  MAX_REGISTRATION_GUESTS,
  MAX_STRIPE_CHECKOUT_LINE_ITEMS,
} from '@shared/registration-quantity-limits';
import {
  MAX_REGISTRATION_ANSWER_LENGTH,
  MAX_REGISTRATION_QUESTIONS,
} from '@shared/registration-question-limits';
import { getTableName } from 'drizzle-orm';
import {
  Cause,
  ConfigProvider,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
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
  rolesToTenantUsers,
  tenants,
  tenantStripeTaxRates,
  transactions,
  userDiscountCards,
  usersToTenants,
} from '../../../../../db/schema';
import { maximumPersistedPaymentAmount } from '../../../../payments/payment-amount';
import { checkoutSessionIncidentLastError } from '../../../../registrations/checkout-session-incident';
import { validateRegistrationQuestionAnswers } from '../../../../registrations/event-question-answer-guard';
import { isUserEligibleForRegistrationOption } from '../../../../registrations/registration-eligibility';
import { StripeClient } from '../../../../stripe-client';
import { createRegistrationDatabaseTestLayer } from '../../../../testing/registration-database';
import {
  type ApproveManualRegistrationArguments,
  decodeRegistrationCheckoutSnapshot,
  ensureCurrentRegistrationSnapshot,
  EventRegistrationService,
  isDefinitiveCheckoutSessionCreateFailure,
  lockCurrentRegistrationTaxConfiguration,
  orderRegistrationAddonPurchases,
  registrationCheckoutPriceBreakdown,
  validateRegistrationAddons,
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

const directCheckoutSessionResponse = (
  parameters: Stripe.Checkout.SessionCreateParams | undefined,
  {
    id,
    url,
  }: {
    readonly id: string;
    readonly url: string;
  },
): Stripe.Response<Stripe.Checkout.Session> => {
  if (!parameters)
    throw new Error('Direct Checkout fixture requires create parameters');
  const lineItems = parameters.line_items;
  if (!lineItems || lineItems.length === 0)
    throw new Error('Direct Checkout fixture requires line items');

  let amountTotal = 0;
  for (const lineItem of lineItems) {
    const unitAmount = Schema.decodeUnknownSync(Schema.Number)(
      lineItem.price_data?.unit_amount,
    );
    const quantity = Schema.decodeUnknownSync(Schema.Number)(lineItem.quantity);
    amountTotal += unitAmount * quantity;
  }
  const currency = Schema.decodeUnknownSync(Schema.String)(
    lineItems[0]?.price_data?.currency,
  ).toLowerCase();
  const metadata = Schema.decodeUnknownSync(
    Schema.Record(Schema.String, Schema.String),
  )(parameters.metadata);

  return {
    ...checkoutSessionResponse({ id, paymentIntent: null, url }),
    amount_total: amountTotal,
    cancel_url: Schema.decodeUnknownSync(Schema.String)(parameters.cancel_url),
    currency,
    customer_email: Schema.decodeUnknownSync(Schema.String)(
      parameters.customer_email,
    ),
    expires_at: Schema.decodeUnknownSync(Schema.Number)(parameters.expires_at),
    metadata,
    success_url: Schema.decodeUnknownSync(Schema.String)(
      parameters.success_url,
    ),
  };
};

const expiredCheckoutSessionResponse = (
  id: string,
): Stripe.Response<Stripe.Checkout.Session> => ({
  ...checkoutSessionResponse({
    id,
    paymentIntent: null,
    url: `https://checkout.stripe.com/c/pay/${id}`,
  }),
  status: 'expired',
});

const stripeClient = createStripeTestClient();
const tenantPublicOrigin = {
  domain: 'tenant.example.com',
  emailSenderEmail: 'events@tenant.example',
  emailSenderName: 'Events Team',
  maxActiveRegistrationsPerUser: 0,
  name: 'Tenant',
  timezone: 'Europe/Amsterdam',
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
    'select "id" from "event_instances" where (("event_instances"."id" = $1) and ("event_instances"."tenantId" = $2)) for update',
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
  readonly event:
    | null
    | (Pick<typeof eventInstances.$inferSelect, 'status' | 'tenantId'> & {
        readonly start: Date | null;
      });
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
            start: option.event.start?.toISOString().replace('Z', '') ?? null,
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
const registrationDiscountCardOwnerLockSql =
  'select pg_advisory_xact_lock_shared(hashtextextended($1, 0))';
const registrationDiscountCardsSql =
  'select "status", "type", "validFrom"::text, "validTo"::text from "user_discount_cards" where "user_discount_cards"."userId" = $1 order by "user_discount_cards"."id" for share';
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
  if (statement === registrationDiscountCardOwnerLockSql) {
    expect(parameters).toEqual(['evorto:user-discount-cards:user-1']);
    return [];
  }
  if (statement === registrationDiscountCardsSql) {
    expect(parameters).toEqual(['user-1']);
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

type RegistrationReadOption = Omit<
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
    'status' | 'tenantId' | 'title'
  > & {
    // Keep the existing defensive test for an unusable persisted event time.
    readonly start: null | typeof eventInstances.$inferSelect.start;
  };
  readonly questions?: readonly Pick<
    typeof eventRegistrationQuestions.$inferSelect,
    'id' | 'required'
  >[];
  readonly roleIds: readonly string[];
};

const createRegistrationReadDatabaseLayer = ({
  existingRegistrationId,
  option,
}: {
  readonly existingRegistrationId?: string;
  readonly option: null | RegistrationReadOption;
}) =>
  createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        expect(statement).not.toContain(' for update');
        if (statement.includes(` from "${getTableName(eventRegistrations)}"`)) {
          expect(parameters).toEqual([
            'event-1',
            'CANCELLED',
            'tenant-1',
            'user-1',
            1,
          ]);
          return existingRegistrationId ? [[existingRegistrationId]] : [];
        }
        if (
          statement.includes(
            ` from "${getTableName(eventRegistrationOptions)}"`,
          )
        ) {
          // The first limit belongs to the single related event.
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
                start:
                  option.event.start?.toISOString().replace('Z', '') ?? null,
              },
              option.questions ?? [],
            ],
          ];
        }
        throw new Error(
          'Unexpected registration eligibility fixture SQL statement',
        );
      }),
  });

type ReservationAcquisitionInsert =
  typeof registrationAcquisitions.$inferSelect;
type ReservationAddonLotInsert = Omit<
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
type ReservationAddonPurchaseInsert = Omit<
  typeof eventRegistrationAddonPurchases.$inferSelect,
  'cancelledQuantity' | 'createdAt' | 'updatedAt'
>;
type ReservationComponentInsert =
  typeof registrationAcquisitionComponents.$inferSelect;
type ReservationEmailInsert = Pick<
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
type ReservationRegistrationInsert = Pick<
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

const createReservationWriteFixtures = ({
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
  const registrationInserts: ReservationRegistrationInsert[] = [];
  const acquisitionInserts: ReservationAcquisitionInsert[] = [];
  const acquisitionComponentInserts: ReservationComponentInsert[] = [];
  const emailInserts: ReservationEmailInsert[] = [];
  const addonPurchaseInserts: ReservationAddonPurchaseInsert[] = [];
  const addonLotInserts: ReservationAddonLotInsert[] = [];
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
      throw new Error('Reservation fixture has no inserted registration');
    return registration.id;
  };
  const requireAddon = () => {
    if (!addon) throw new Error('Reservation fixture has no configured add-on');
    return addon;
  };
  const requireAcquisition = () => {
    const acquisition = acquisitionInserts[0];
    if (!acquisition) throw new Error('Reservation fixture has no acquisition');
    return acquisition;
  };
  const requirePurchase = () => {
    const purchase = addonPurchaseInserts[0];
    if (!purchase)
      throw new Error('Reservation fixture has no add-on purchase');
    return purchase;
  };
  const requireLot = () => {
    const lot = addonLotInserts[0];
    if (!lot) throw new Error('Reservation fixture has no add-on purchase lot');
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
        const recorded: ReservationComponentInsert[] = [
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
          'html',
          'idempotency_key',
          'kind',
          'last_attempt_at',
          'last_error',
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
            '$3',
            '$4',
            '$5',
            'default',
            'default',
            'default',
            'default',
            '$6',
            '$7',
            'default',
            'default',
            '$8',
            'default',
            '$9',
            '$10',
          ],
        ],
        ' on conflict ("idempotency_key") do nothing',
      );
      const id = requireString(parameters[0]);
      const html = requireString(parameters[2]);
      const text = requireString(parameters[8]);
      const replyToEmail = emailSenderEmail?.trim() || null;
      const replyToName = replyToEmail
        ? emailSenderName?.trim() || 'Tenant'
        : null;
      expect(parameters).toEqual([
        id,
        'tenant-1',
        html,
        `registration-confirmed/tenant-1/${registrationId}`,
        'registrationConfirmed',
        replyToEmail,
        replyToName,
        'Ticket confirmed: Approved event',
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
        subject: 'Ticket confirmed: Approved event',
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

type ReservationAddonStockUpdate = Pick<
  typeof eventAddons.$inferSelect,
  'eventId' | 'updatedAt'
> & {
  addonId: typeof eventAddons.$inferSelect.id;
  quantity: typeof eventAddons.$inferSelect.totalAvailableQuantity;
};

type ReservationAvailableAddon = Pick<
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

type ReservationCapacityUpdate = Pick<
  typeof eventRegistrationOptions.$inferSelect,
  'eventId' | 'updatedAt'
> & {
  registrationOptionId: typeof eventRegistrationOptions.$inferSelect.id;
  spotCount: typeof eventRegistrationOptions.$inferSelect.confirmedSpots;
};

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

type ReservationDatabaseStep =
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
  | 'lockEligibility'
  | 'lockMembership'
  | 'lockQuestionEvent'
  | 'lockQuestionTenant'
  | 'lockRoles'
  | 'lockTenant'
  | 'loseAddonStock'
  | 'loseCapacity'
  | 'readAcquisitions'
  | 'readActiveFutureRegistration'
  | 'readActiveRegistration'
  | 'readAddons'
  | 'readConcurrentRegistration'
  | 'readCurrentAddons'
  | 'readCurrentOption'
  | 'readExistingRegistration'
  | 'readLockedQuestions'
  | 'readOption'
  | 'reserveAddonStock'
  | 'reserveCapacity'
  | 'ROLLBACK';

const reservationInitialReadSteps: readonly ReservationDatabaseStep[] = [
  'readExistingRegistration',
  'readOption',
  'readAddons',
  'BEGIN',
  'lockTenant',
  'lockQuestionTenant',
  'lockQuestionEvent',
  'readLockedQuestions',
  'lockMembership',
  'lockRoles',
  'lockEligibility',
  'readCurrentOption',
  'readCurrentAddons',
];

const reservationFreeConfirmationSteps: readonly ReservationDatabaseStep[] = [
  'readAcquisitions',
  'insertAcquisition',
  'insertAcquisitionComponents',
  'insertEmail',
  'COMMIT',
];

const createReservationDatabaseFixture = ({
  addon,
  communicationEmail = 'alice.contact@example.com',
  currentTenantLimit = 0,
  emailSenderEmail = null,
  emailSenderName = null,
  guestCount = 0,
  option = approvedRegistrationOption,
  steps,
  stripeAccountId = '',
}: {
  addon?: ReservationAvailableAddon;
  communicationEmail?: string;
  currentTenantLimit?: null | number;
  emailSenderEmail?: null | string;
  emailSenderName?: null | string;
  guestCount?: number;
  option?: RegistrationReadOption;
  steps: readonly ReservationDatabaseStep[];
  stripeAccountId?: string;
}) =>
  Effect.gen(function* () {
    const writes = createReservationWriteFixtures({
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
    const answerInserts: ScopedRegistrationAnswerInsert[] = [];
    const operations: ReservationDatabaseStep[] = [];
    const transactionCommands: ('BEGIN' | 'COMMIT' | 'ROLLBACK')[] = [];
    let transactionOpen = false;
    let currentTenantLimitReads = 0;
    let emailInsertedWhileTransactionOpen = false;
    const capacityUpdates: ReservationCapacityUpdate[] = [];
    const addonStockUpdates: ReservationAddonStockUpdate[] = [];
    const registrationTable = getTableName(eventRegistrations);
    const optionTable = getTableName(eventRegistrationOptions);
    const eventTable = getTableName(eventInstances);
    const addonTable = getTableName(eventAddons);
    const attachmentTable = getTableName(addonToEventRegistrationOptions);
    const taxTable = getTableName(tenantStripeTaxRates);
    const membershipTable = getTableName(usersToTenants);
    const roleTable = getTableName(rolesToTenantUsers);
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
        `select "d0"."id" as "id" from "${registrationTable}" as "d0" where (("d0"."eventId" = $1) and (not ("d0"."status" = $2)) and ("d0"."tenantId" = $3) and ("d0"."userId" = $4))${first ? ' limit $5' : ''}`,
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
        if (
          statement ===
          `select "max_active_registrations_per_user" from "${getTableName(tenants)}" where "${getTableName(tenants)}"."id" = $1`
        ) {
          expect(transactionOpen).toBe(true);
          expect(operations).toContain('lockTenant');
          expect(operations).toContain('lockMembership');
          expect(currentTenantLimitReads).toBe(0);
          expect(parameters).toEqual(['tenant-1']);
          currentTenantLimitReads++;
          return currentTenantLimit === null ? [] : [[currentTenantLimit]];
        }
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
            return yield* writes.insertAddonLot(statement, parameters);
          }
          case 'insertAddonPurchase': {
            return yield* writes.insertAddonPurchase(statement, parameters);
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
            return yield* writes.insertRegistration(statement, parameters);
          }
          case 'lockEligibility': {
            expect(statement).toBe(
              `select "${optionTable}"."closeRegistrationTime"::text, "${eventTable}"."status", "${optionTable}"."openRegistrationTime"::text, "${optionTable}"."organizingRegistration", "${optionTable}"."registrationMode", "${optionTable}"."roleIds" from "${optionTable}" inner join "${eventTable}" on (("${eventTable}"."id" = "${optionTable}"."eventId") and ("${eventTable}"."tenantId" = $1)) where (("${optionTable}"."id" = $2) and ("${optionTable}"."eventId" = $3)) for update of "${optionTable}"`,
            );
            expect(parameters).toEqual(['tenant-1', 'option-1', 'event-1']);
            return [
              [
                sqlDate(option.closeRegistrationTime),
                option.event.status,
                sqlDate(option.openRegistrationTime),
                option.organizingRegistration,
                option.registrationMode,
                [...option.roleIds],
              ],
            ];
          }
          case 'lockMembership': {
            const membership: Pick<typeof usersToTenants.$inferSelect, 'id'> = {
              id: 'tenant-user-1',
            };
            expect(statement).toBe(
              `select "id" from "${membershipTable}" where (("${membershipTable}"."tenantId" = $1) and ("${membershipTable}"."userId" = $2)) for update`,
            );
            expect(parameters).toEqual(['tenant-1', 'user-1']);
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
          case 'lockRoles': {
            const assignment: Pick<
              typeof rolesToTenantUsers.$inferSelect,
              'roleId'
            > = { roleId: 'role-1' };
            expect(statement).toBe(
              `select "roleId" from "${roleTable}" where (("${roleTable}"."tenantId" = $1) and ("${roleTable}"."userTenantId" = $2)) for update`,
            );
            expect(parameters).toEqual(['tenant-1', 'tenant-user-1']);
            return [[assignment.roleId]];
          }
          case 'lockTenant': {
            expect(statement).toBe(
              `select "id" from "${getTableName(tenants)}" where "${getTableName(tenants)}"."id" = $1 for key share`,
            );
            expect(parameters).toEqual(['tenant-1']);
            return [['tenant-1']];
          }
          case 'loseAddonStock':
          case 'reserveAddonStock': {
            if (!addon)
              throw new Error('Reservation fixture has no configured add-on');
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
              `select "${registrationTable}"."id" from "${registrationTable}" inner join "${eventTable}" on "${eventTable}"."id" = "${registrationTable}"."eventId" where (("${registrationTable}"."tenantId" = $1) and ("${registrationTable}"."userId" = $2) and ("${registrationTable}"."status" in ($3, $4)) and ("${eventTable}"."start" > $5)) limit $6`,
            );
            expect(parameters).toEqual([
              'tenant-1',
              'user-1',
              'PENDING',
              'CONFIRMED',
              new Date('2026-09-15T12:00:00.000Z'),
              1,
            ]);
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
      get currentTenantLimitReads() {
        return currentTenantLimitReads;
      },
      database: Context.get(databaseContext, Database),
      get emailInsertedWhileTransactionOpen() {
        return emailInsertedWhileTransactionOpen;
      },
      expectComplete: () => {
        expect(operations).toEqual(steps);
        expect(transactionOpen).toBe(false);
      },
      operations,
      get registrationId() {
        return writes.requireRegistrationId();
      },
      transactionCommands,
    };
  });

const createWaitlistDatabaseFixture = ({
  insertFailure,
  lockedRoleIds,
  option,
}: {
  readonly insertFailure?: SqlError;
  readonly lockedRoleIds?: readonly string[];
  readonly option: RegistrationReadOption;
}) =>
  Effect.gen(function* () {
    let inTransaction = false;
    let registrationId: string | undefined;
    const answerInserts: ScopedRegistrationAnswerInsert[] = [];
    const transactionCommands: ('BEGIN' | 'COMMIT' | 'ROLLBACK')[] = [];
    const lockMembership = vi.fn<SqlConnection.Connection['executeValues']>(
      (statement, parameters) =>
        Effect.sync(() => {
          expect(statement).toContain(
            `select "id" from "${getTableName(usersToTenants)}"`,
          );
          expect(parameters).toEqual(['tenant-1', 'user-1']);
          return [['membership-1']];
        }),
    );
    const selectRegistrationState = vi.fn<
      SqlConnection.Connection['executeValues']
    >((statement, parameters) =>
      Effect.suspend(() => {
        expect(inTransaction).toBe(true);
        expect(statement).toContain(' for update');
        if (statement.includes(` from "${getTableName(usersToTenants)}"`))
          return lockMembership(statement, parameters);
        return Effect.sync(() => {
          if (
            statement.includes(` from "${getTableName(rolesToTenantUsers)}"`)
          ) {
            expect(parameters).toEqual(['tenant-1', 'membership-1']);
            return (lockedRoleIds ?? option.roleIds).map((roleId) => [roleId]);
          }
          expect(statement).toContain(
            ` from "${getTableName(eventRegistrationOptions)}"`,
          );
          expect(statement).toContain(
            ` inner join "${getTableName(eventInstances)}"`,
          );
          expect(statement).toContain(
            ` for update of "${getTableName(eventRegistrationOptions)}"`,
          );
          expect(parameters).toEqual(['tenant-1', 'option-1', 'event-1']);
          return [
            [
              option.closeRegistrationTime.toISOString().replace('Z', ''),
              option.event.status,
              option.openRegistrationTime.toISOString().replace('Z', ''),
              option.organizingRegistration,
              option.registrationMode,
              [...option.roleIds],
            ],
          ];
        });
      }),
    );
    const findActiveRegistrations = vi.fn<
      SqlConnection.Connection['executeValues']
    >((statement, parameters) =>
      Effect.sync(() => {
        expect(inTransaction).toBe(true);
        expect(statement).toContain(
          ` from "${getTableName(eventRegistrations)}"`,
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
    const updateWaitlistCounter = vi.fn<
      SqlConnection.Connection['executeValues']
    >((statement, parameters) =>
      Effect.sync(() => {
        expect(inTransaction).toBe(true);
        expect(statement).toContain(
          '"waitlistSpots" = "event_registration_options"."waitlistSpots" + 1',
        );
        expect(statement).toContain(
          '"confirmedSpots" + "event_registration_options"."reservedSpots" >= "event_registration_options"."spots"',
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
        registrationId = Schema.decodeUnknownSync(Schema.String)(parameters[0]);
        return [[registrationId]];
      }),
    );
    const layer = createRegistrationDatabaseTestLayer({
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
        if (statement.startsWith(`select "id" from "${getTableName(tenants)}"`))
          return Effect.sync(() => {
            expect(inTransaction).toBe(true);
            expect(statement).toContain(' for key share');
            expect(parameters).toEqual(['tenant-1']);
            return [['tenant-1']];
          });

        if (
          statement.startsWith(
            `insert into "${getTableName(eventRegistrationQuestionAnswers)}"`,
          )
        ) {
          return Effect.sync(() => {
            expect(inTransaction).toBe(true);
            if (!registrationId)
              throw new Error('Answer insert preceded waitlist registration');
            answerInserts.push(
              expectScopedRegistrationAnswerInsert(
                statement,
                parameters,
                registrationId,
              ),
            );
            return [];
          });
        }

        if (
          statement.startsWith('select ') &&
          statement.includes(' for update')
        )
          return selectRegistrationState(statement, parameters);
        if (
          statement.startsWith(
            `update "${getTableName(eventRegistrationOptions)}"`,
          )
        )
          return updateWaitlistCounter(statement, parameters);
        if (
          statement.startsWith(
            `insert into "${getTableName(eventRegistrations)}"`,
          )
        )
          return insertWaitlistRegistration(statement, parameters);
        if (
          statement.includes(
            ` from "${getTableName(eventRegistrations)}" as "d0"`,
          )
        ) {
          if (inTransaction)
            return findActiveRegistrations(statement, parameters);
          return Effect.sync(() => {
            expect(parameters).toEqual([
              'event-1',
              'CANCELLED',
              'tenant-1',
              'user-1',
              1,
            ]);
            return [];
          });
        }
        if (
          statement.includes(
            ` from "${getTableName(eventRegistrationOptions)}" as "d0"`,
          )
        )
          return Effect.sync(() => {
            expect(inTransaction).toBe(false);
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
                {
                  status: option.event.status,
                  tenantId: option.event.tenantId,
                },
                option.questions ?? [],
              ],
            ];
          });
        return Effect.die(
          new Error(`Unexpected waitlist fixture SQL: ${statement}`),
        );
      },
      transactionControl: (command) =>
        Effect.sync(() => {
          expect(inTransaction).toBe(command !== 'BEGIN');
          inTransaction = command === 'BEGIN';
          transactionCommands.push(command);
        }),
    });
    const context = yield* Layer.build(layer);
    return {
      answerInserts,
      database: Context.get(context, Database),
      findActiveRegistrations,
      insertWaitlistRegistration,
      lockMembership,
      get registrationId() {
        return registrationId;
      },
      selectRegistrationState,
      transactionCommands,
      updateWaitlistCounter,
    };
  });

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
    communicationEmail: 'alice.contact@example.com',
    email: 'alice.login@example.com',
  },
  userId: 'user-1',
} as const;

interface ManualApprovalAddonPurchaseFixture {
  readonly addOn: {
    readonly stripeTaxRateId: null | string;
    readonly title: string;
  };
  readonly addonId: string;
  readonly id: string;
  readonly purchasedQuantity: number;
  readonly quantity: number;
  readonly taxRateDisplayName: null | string;
  readonly taxRateInclusive: boolean | null;
  readonly taxRatePercentage: null | string;
  readonly unitPrice: number;
}

type ManualApprovalRegistrationFixture = Omit<
  typeof paidManualApprovalRegistration,
  'addonPurchases' | 'registrationOption'
> & {
  readonly addonPurchases: readonly ManualApprovalAddonPurchaseFixture[];
  readonly registrationOption: {
    readonly eventId: string;
    readonly id: string;
    readonly isPaid: boolean;
    readonly price: number;
    readonly registrationMode: 'application';
    readonly stripeTaxRateId: null | string;
  };
};

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
  }).pipe(Effect.map(({ database }) => database));

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
  }).pipe(Effect.map(({ database }) => database));

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
  | 'amount'
  | 'appFee'
  | 'currency'
  | 'id'
  | 'stripeAccountId'
  | 'stripeCheckoutIncidentSessionId'
  | 'stripeCheckoutRequest'
  | 'stripeCheckoutSessionId'
  | 'stripeCheckoutUrl'
  | 'targetUserId'
>;

const createManualApprovalDatabase = ({
  bindingCommitAmbiguous = false,
  bindingSucceeds = true,
  discountSettings,
  existingClaim = null,
  lockedApplicantRoleIds = ['role-1'],
  lockedEventStatus = 'APPROVED',
  lockedOptionRoleIds = ['role-1'],
  lockedStripeAccountId = 'acct_123',
  notificationTenantAvailable = true,
  operationOrder = [],
  persistCommittedEmail = true,
  registration = paidManualApprovalRegistration,
  registrationStatuses = ['PENDING'],
  registrationUser = paidManualApprovalRegistration.user,
}: {
  bindingCommitAmbiguous?: boolean;
  bindingSucceeds?: boolean;
  discountSettings?: {
    tenantRecord: undefined | { discountProviders: null | object };
  };
  existingClaim?: ManualApprovalClaim | null;
  lockedApplicantRoleIds?: readonly string[];
  lockedEventStatus?: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW';
  lockedOptionRoleIds?: readonly string[];
  lockedStripeAccountId?: null | string;
  notificationTenantAvailable?: boolean;
  operationOrder?: string[];
  persistCommittedEmail?: boolean;
  registration?: ManualApprovalRegistrationFixture;
  registrationStatuses?: readonly ('CANCELLED' | 'PENDING')[];
  registrationUser?: null | typeof paidManualApprovalRegistration.user;
} = {}) =>
  Effect.gen(function* () {
    let bindingUpdateCount = 0;
    let tenantSettingsReadCount = 0;
    let tenantLockObserved = false;
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
    const emailRecipients: string[] = [];
    let reservationUpdateCount = 0;
    let registrationLockCount = 0;
    let transactionCount = 0;
    let transactionOpen = false;
    let persistedEmail = false;
    let releasedClaimId: string | undefined;
    const claimRows = () =>
      claim
        ? [
            [
              claim.amount,
              claim.appFee,
              claim.currency,
              claim.id,
              claim.stripeAccountId,
              claim.stripeCheckoutIncidentSessionId,
              claim.stripeCheckoutRequest,
              claim.stripeCheckoutSessionId,
              claim.stripeCheckoutUrl,
              claim.targetUserId,
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
          if (
            statement ===
            'select "id" from "tenants" where "tenants"."id" = $1 for update'
          )
            tenantLockObserved = true;
          if (
            statement.startsWith(
              'select "email_sender_email", "email_sender_name", "id", "name", "timezone" from "tenants"',
            )
          ) {
            expect(transactionOpen).toBe(true);
            expect(tenantLockObserved).toBe(true);
            expect(parameters).toEqual(['tenant-1']);
            return notificationTenantAvailable
              ? [[null, null, 'tenant-1', 'Tenant', 'Europe/Amsterdam']]
              : [];
          }
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
              event: { ...registration.event, status: lockedEventStatus },
              roleIds: lockedOptionRoleIds,
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
                registrationUser,
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
            expect(parameters).toEqual(['verified', 'user-1']);
            return discountSettings
              ? [['esnCard', '2026-12-31T00:00:00.000']]
              : [];
          }
          if (
            statement.startsWith('select ') &&
            statement.includes(` from "${getTableName(usersToTenants)}"`)
          ) {
            expect(statement).toContain(' for update');
            expect(parameters).toEqual(['tenant-1', 'user-1']);
            return [['tenant-user-1']];
          }
          if (
            statement.startsWith('select ') &&
            statement.includes(` from "${getTableName(rolesToTenantUsers)}"`)
          ) {
            expect(statement).toContain(' for update');
            expect(parameters).toEqual(['tenant-1', 'tenant-user-1']);
            return lockedApplicantRoleIds.map((roleId) => [roleId]);
          }
          if (
            statement.startsWith('select ') &&
            statement.includes(
              ` from "${getTableName(eventRegistrationOptions)}"`,
            )
          ) {
            expect(statement).toContain(' for update');
            if (
              statement.includes(
                ` inner join "${getTableName(eventInstances)}"`,
              )
            ) {
              expect(statement).toContain(
                ` for update of "${getTableName(eventRegistrationOptions)}"`,
              );
              expect(parameters).toEqual(['tenant-1', 'option-1', 'event-1']);
              return [
                [
                  '2026-09-20T10:00:00.000',
                  lockedEventStatus,
                  '2026-09-10T10:00:00.000',
                  false,
                  'application',
                  [...lockedOptionRoleIds],
                ],
              ];
            }
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
            if (statement.startsWith('select "id" ')) {
              expect(statement).toMatch(/ for (?:key share|update)$/);
              expect(parameters).toEqual(['tenant-1']);
              return [['tenant-1']];
            }
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
            if (statement.startsWith('select "amount", ')) {
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
            expect(parameters).toEqual(
              expect.arrayContaining([
                'tenant-1',
                'event-1',
                'registration-1',
                'user-1',
              ]),
            );
            if (!claim) return [];
            if (statement.startsWith('select "method", '))
              return [
                [
                  'stripe',
                  'pending',
                  null,
                  claim.stripeCheckoutIncidentSessionId,
                  claim.stripeCheckoutSessionId,
                  'registration',
                ],
              ];
            if (statement.startsWith('select "status", '))
              return [
                [
                  'pending',
                  null,
                  claim.stripeCheckoutIncidentSessionId,
                  claim.stripeCheckoutSessionId,
                  claim.stripeCheckoutUrl,
                ],
              ];
            if (
              statement.startsWith(
                'select "stripe_checkout_cancellation_requested_at"::text, "stripe_checkout_incident_session_id", ',
              )
            )
              return [
                [
                  null,
                  claim.stripeCheckoutIncidentSessionId,
                  claim.stripeCheckoutSessionId,
                  claim.stripeCheckoutUrl,
                ],
              ];
            if (
              statement.startsWith(
                'select "stripe_checkout_cancellation_requested_at"::text, "stripeCheckoutSessionId", ',
              )
            )
              return [
                [null, claim.stripeCheckoutSessionId, claim.stripeCheckoutUrl],
              ];
            throw new Error(
              `Unexpected manual approval transaction selection: ${statement}`,
            );
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
              amount,
              appFee,
              currency,
              id,
              stripeAccountId,
              stripeCheckoutIncidentSessionId: null,
              stripeCheckoutRequest,
              stripeCheckoutSessionId: null,
              stripeCheckoutUrl: null,
              targetUserId,
            };
            return claimRows();
          }
          if (
            statement.startsWith(`insert into "${getTableName(emailOutbox)}"`)
          ) {
            expect(statement).toContain(
              'on conflict ("idempotency_key") do nothing',
            );
            expect(parameters).toHaveLength(10);
            expect(parameters[1]).toBe('tenant-1');
            expect(parameters[4]).toBe('manualApproval');
            emailInsertCount += 1;
            persistedEmail = persistCommittedEmail;
            emailKinds.push(string(parameters[4]));
            emailRecipients.push(string(parameters[9]));
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
            if (
              statement.includes('"stripe_checkout_incident_session_id" = ')
            ) {
              operationOrder.push('incident');
              claim = {
                ...claim,
                stripeCheckoutIncidentSessionId: string(parameters[1]),
              };
              expect(parameters).toContain(checkoutSessionIncidentLastError);
              return [[claim.id]];
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
      emailRecipients,
      getClaim: () => claim,
      operationOrder,
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
  beforeBind = Effect.void,
  bindingSucceeds = true,
  configuredStripeTaxRateId = 'txr_19',
  discountSettings,
  existingClaim = null,
  lockedEventStatus = 'APPROVED',
  lockedOptionRoleIds = ['role-1'],
  lockedStripeAccountId = 'acct_123',
  lockedUserRoleIds = ['role-1'],
  operationOrder = [],
  registrationOption = {},
}: {
  beforeBind?: Effect.Effect<void>;
  bindingSucceeds?: boolean;
  configuredStripeTaxRateId?: string;
  discountSettings?: {
    tenantRecord: undefined | { discountProviders: null | object };
  };
  existingClaim?: ManualApprovalClaim | null;
  lockedEventStatus?: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW';
  lockedOptionRoleIds?: readonly string[];
  lockedStripeAccountId?: string;
  lockedUserRoleIds?: readonly string[];
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
  let claim: ManualApprovalClaim | null = existingClaim;
  let claimInsertCount = 0;
  let claimStatus: 'cancelled' | 'pending' = 'pending';
  let makeUnavailableAfterNextClaimPreflight = false;
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
    | undefined = existingClaim
    ? {
        eventId: 'event-1',
        guestCount: 0,
        id: 'registration-direct',
        registrationOptionId: 'option-1',
        status: 'PENDING',
        userId: 'user-1',
      }
    : undefined;
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
    current.amount,
    current.appFee,
    current.currency,
    current.id,
    current.stripeAccountId,
    current.stripeCheckoutIncidentSessionId,
    current.stripeCheckoutRequest,
    current.stripeCheckoutSessionId,
    current.stripeCheckoutUrl,
    current.targetUserId,
  ];
  const claimTupleParameters = () => {
    const current = requireClaim();
    return [
      current.id,
      current.amount,
      current.appFee,
      current.currency,
      'event-1',
      requireRegistration().id,
      'stripe',
      current.stripeAccountId,
      JSON.stringify(current.stripeCheckoutRequest),
      current.targetUserId,
      'tenant-1',
      'registration',
    ];
  };
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
                  registration.userId,
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
      expect(parameters).toEqual([
        'event-1',
        'CANCELLED',
        'tenant-1',
        'user-1',
        ...(transactionSnapshot ? [] : [1]),
      ]);
      return registration && registration.status !== 'CANCELLED'
        ? [[registration.id]]
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
      if (statement.includes(' inner join ')) {
        expect(statement).toContain(
          ` for update of "${getTableName(eventRegistrationOptions)}"`,
        );
        expect(parameters).toEqual(['tenant-1', 'option-1', 'event-1']);
        return [
          [
            '2026-09-20T10:00:00.000',
            lockedEventStatus,
            '2026-09-10T10:00:00.000',
            false,
            'fcfs',
            [...lockedOptionRoleIds],
          ],
        ];
      }
      expect(parameters).toEqual(['option-1', 'event-1']);
      return [[effectiveStripeTaxRateId]];
    });

  const readDirectClaim: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      if (statement.includes(' left join ')) {
        expect(statement).not.toContain(' for update');
        expect(parameters).toEqual([
          requireRegistration().id,
          'stripe',
          'pending',
          'tenant-1',
          'registration',
        ]);
        const rows =
          claim && claimStatus === 'pending' ? [claimRow(claim)] : [];
        // Snapshot the read before modelling the separate cancellation racing it.
        if (makeUnavailableAfterNextClaimPreflight && registration && claim) {
          registration = { ...registration, status: 'CANCELLED' };
          claimStatus = 'cancelled';
          makeUnavailableAfterNextClaimPreflight = false;
        }
        return rows;
      }
      assertLockedRead(statement);
      const current = requireClaim();
      if (statement.startsWith('select "method",')) {
        expect(parameters).toEqual([
          ...claimTupleParameters(),
          'tenant-1',
          requireRegistration().id,
        ]);
        return [
          [
            'stripe',
            claimStatus,
            null,
            current.stripeCheckoutIncidentSessionId,
            current.stripeCheckoutSessionId,
            'registration',
          ],
        ];
      }
      if (statement.startsWith('select "status",')) {
        expect(parameters).toEqual(claimTupleParameters());
        return [
          [
            claimStatus,
            null,
            current.stripeCheckoutIncidentSessionId,
            current.stripeCheckoutSessionId,
            current.stripeCheckoutUrl,
          ],
        ];
      }
      expect(parameters).toEqual([...claimTupleParameters(), 'pending']);
      const projection = statement.slice(0, statement.indexOf(' from '));
      expect(projection).toContain(
        '"stripe_checkout_cancellation_requested_at"',
      );
      expect(projection).toContain('"stripeCheckoutSessionId"');
      expect(projection).toContain('"stripeCheckoutUrl"');
      if (projection.includes('"stripe_checkout_incident_session_id"')) {
        return claimStatus === 'pending'
          ? [
              [
                null,
                current.stripeCheckoutIncidentSessionId,
                current.stripeCheckoutSessionId,
                current.stripeCheckoutUrl,
              ],
            ]
          : [];
      }
      return claimStatus === 'pending' &&
        current.stripeCheckoutIncidentSessionId === null
        ? [[null, current.stripeCheckoutSessionId, current.stripeCheckoutUrl]]
        : [];
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
      // Return the inserted identity so every dependent statement must use it.
      registration = {
        eventId: 'event-1',
        guestCount,
        id: Schema.decodeUnknownSync(Schema.String)(parameters[3]),
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
        ' returning "amount", "appFee", "currency", "id"',
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
        amount,
        appFee: Math.round(amount * 0.035),
        currency: 'EUR',
        id,
        stripeAccountId: lockedStripeAccountId,
        stripeCheckoutIncidentSessionId: null,
        stripeCheckoutRequest: request,
        stripeCheckoutSessionId: null,
        stripeCheckoutUrl: null,
        targetUserId: 'user-1',
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
    Effect.gen(function* () {
      const current = requireClaim();
      expect(statement).toContain(' returning "id"');
      const update = statement.slice(0, statement.indexOf(' where '));
      if (update.includes('"status" =')) {
        expect(transactionSnapshot).toBeDefined();
        expect(parameters).toEqual([
          expect.any(String),
          'cancelled',
          ...claimTupleParameters(),
          'tenant-1',
          requireRegistration().id,
          'stripe',
          'pending',
          'registration',
          ...(parameters.length === 20 ? [expect.any(String)] : []),
        ]);
        expect(statement).toContain(
          '"stripe_checkout_incident_session_id" is null',
        );
        expect(statement).toContain(
          '"stripe_checkout_cancellation_requested_at" is null',
        );
        expect(statement).toContain('"stripeCheckoutSessionId" is null');
        expect(claimStatus).toBe('pending');
        expect(current.stripeCheckoutIncidentSessionId).toBeNull();
        if (current.stripeCheckoutSessionId !== null) {
          expect(parameters.at(-1)).toBe(current.stripeCheckoutSessionId);
        }
        operationOrder.push('release-claim');
        claimStatus = 'cancelled';
        claim = null;
        return [[current.id]];
      }
      if (update.includes('"stripe_checkout_incident_session_id" =')) {
        const sessionId = Schema.decodeUnknownSync(Schema.String)(
          parameters[1],
        );
        expect(parameters).toEqual([
          expect.any(String),
          sessionId,
          checkoutSessionIncidentLastError,
          null,
          null,
          null,
          current.id,
          'tenant-1',
          requireRegistration().id,
          'event-1',
          current.targetUserId,
          'registration',
          'stripe',
          current.amount,
          current.currency,
          current.appFee,
          current.stripeAccountId,
          JSON.stringify(current.stripeCheckoutRequest),
        ]);
        expect(current.stripeCheckoutSessionId).toBeNull();
        expect(current.stripeCheckoutUrl).toBeNull();
        expect(current.stripeCheckoutIncidentSessionId).toBeNull();
        expect(statement).toContain('"stripeCheckoutSessionId" is null');
        expect(statement).toContain('"stripeCheckoutUrl" is null');
        expect(statement).toContain(
          '"stripe_checkout_incident_session_id" is null',
        );
        operationOrder.push('incident');
        claim = { ...current, stripeCheckoutIncidentSessionId: sessionId };
        return [[current.id]];
      }
      expect(transactionSnapshot).toBeDefined();
      const sessionId = Schema.decodeUnknownSync(Schema.String)(parameters[6]);
      const url = Schema.decodeUnknownSync(Schema.String)(parameters[7]);
      expect(parameters).toEqual([
        expect.any(String),
        0,
        null,
        null,
        null,
        expect.any(String),
        sessionId,
        url,
        ...claimTupleParameters(),
        'pending',
      ]);
      expect(statement).toContain(
        '"stripe_checkout_cancellation_requested_at" is null',
      );
      expect(statement).toContain(
        '"stripe_checkout_incident_session_id" is null',
      );
      expect(statement).toContain('"stripeCheckoutSessionId" is null');
      expect(statement).toContain('"stripeCheckoutUrl" is null');
      expect(claimStatus).toBe('pending');
      expect(current.stripeCheckoutSessionId).toBeNull();
      expect(current.stripeCheckoutUrl).toBeNull();
      expect(current.stripeCheckoutIncidentSessionId).toBeNull();
      bindingUpdateCount += 1;
      operationOrder.push('bind');
      if (!bindingSucceeds) return [];
      yield* beforeBind;
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
      if (
        statement ===
        `select "max_active_registrations_per_user" from "${getTableName(tenants)}" where "${getTableName(tenants)}"."id" = $1`
      ) {
        expect(transactionSnapshot).toBeDefined();
        expect(parameters).toEqual(['tenant-1']);
        return [[0]];
      }
      const questionSetRows = readQuestionSetLockFixture({
        parameters,
        statement,
        transactionOpen: transactionSnapshot !== undefined,
      });
      if (questionSetRows) return questionSetRows;
      const snapshotRows = readRegistrationSnapshotFixture({
        option: {
          ...option,
          event: { ...option.event, status: lockedEventStatus },
          roleIds: lockedOptionRoleIds,
        },
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
          expect.any(String),
          `registration-confirmed/tenant-1/${requireRegistration().id}`,
          'registrationConfirmed',
          null,
          null,
          'Ticket confirmed: Approved event',
          expect.any(String),
          'alice.contact@example.com',
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
        expect(parameters).toEqual(['verified', 'user-1']);
        return discountSettings ? [['esnCard', '2026-12-31T00:00:00.000']] : [];
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
      if (statement.startsWith(`select "id" from "${getTableName(tenants)}"`)) {
        expect(transactionSnapshot).toBeDefined();
        expect(statement).toMatch(/ for (?:key share|update)$/);
        expect(parameters).toEqual(['tenant-1']);
        return [['tenant-1']];
      }
      assertLockedRead(statement);
      if (statement.includes(` from "${getTableName(usersToTenants)}"`)) {
        expect(parameters).toEqual(['tenant-1', 'user-1']);
        return [['tenant-user-1']];
      }
      if (statement.includes(` from "${getTableName(rolesToTenantUsers)}"`)) {
        expect(parameters).toEqual(['tenant-1', 'tenant-user-1']);
        return lockedUserRoleIds.map((roleId) => [roleId]);
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
      scheduleUnavailableDuringNextClaimPreflight: () => {
        makeUnavailableAfterNextClaimPreflight = true;
      },
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
      communicationEmail: 'alice.contact@example.com',
      email: 'alice.contact@example.com',
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
          | 'addons'
          | 'card-owner-lock'
          | 'cards'
          | 'discounts'
          | 'option'
          | 'providers'
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
                if (statement === registrationDiscountCardOwnerLockSql) {
                  expect(transactionOpen).toBe(true);
                  expect(reads.at(-1)).toBe('providers');
                  expect(parameters).toEqual([
                    'evorto:user-discount-cards:user-1',
                  ]);
                  reads.push('card-owner-lock');
                  return [];
                }
                if (statement === registrationDiscountCardsSql) {
                  expect(transactionOpen).toBe(true);
                  expect(reads.at(-1)).toBe('card-owner-lock');
                  expect(parameters).toEqual(['user-1']);
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
              'card-owner-lock',
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
            'card-owner-lock',
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
            'card-owner-lock',
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
            'card-owner-lock',
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
          message: 'Invalid persisted checkout request',
        });
        expect(error).not.toHaveProperty('cause');
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
      addOnStripeTaxRateId?: null | string;
      stripeAccountId?: string;
      taxRates?: readonly {
        displayName: null | string;
        inclusive: boolean;
        percentage: null | string;
        stripeTaxRateId: string;
      }[];
    } = {}) => {
      const lockOrder: string[] = [];
      const select = vi.fn<SqlConnection.Connection['executeValues']>(
        (statement, parameters) =>
          Effect.sync(() => {
            expect(statement).toContain(' for update');
            if (
              statement.includes(
                ` from "${getTableName(eventRegistrationOptions)}"`,
              )
            ) {
              expect(parameters).toEqual(['option-1', 'event-1']);
              lockOrder.push('option');
              return [['txr_registration']];
            }
            if (statement.includes(` from "${getTableName(eventAddons)}"`)) {
              expect(parameters).toEqual(['event-1', 'addon-1']);
              expect(statement).toContain(' order by ');
              lockOrder.push('addon');
              return [['addon-1', addOnStripeTaxRateId]];
            }
            if (
              statement.includes(
                ` from "${getTableName(tenantStripeTaxRates)}"`,
              )
            ) {
              expect(parameters).toEqual([
                'tenant-1',
                stripeAccountId,
                true,
                true,
                'txr_registration',
                'txr_addon',
              ]);
              expect(statement).toContain(' order by ');
              lockOrder.push('tax-rate');
              return taxRates.map(
                ({ displayName, inclusive, percentage, stripeTaxRateId }) => [
                  displayName,
                  inclusive,
                  percentage,
                  stripeTaxRateId,
                ],
              );
            }
            throw new Error('Unexpected tax configuration SQL statement');
          }),
      );
      const layer = createRegistrationDatabaseTestLayer({
        executeValues: select,
      });
      return {
        lockOrder,
        run: (
          input: Parameters<typeof lockCurrentRegistrationTaxConfiguration>[1],
        ) =>
          Database.use((database) =>
            lockCurrentRegistrationTaxConfiguration(database, input),
          ).pipe(Effect.provide(layer)),
        select,
      };
    };

    it.effect(
      'locks the complete graph and returns only current-account tax snapshots',
      () =>
        Effect.gen(function* () {
          const fixture = createDatabase();
          const result = yield* fixture.run({
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
          });

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
          const fixture = createDatabase({
            addOnStripeTaxRateId: 'txr_replaced',
          });
          const error = yield* fixture
            .run({
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
            })
            .pipe(Effect.flip);

          expect(error).toBeInstanceOf(EventRegistrationConflictError);
          expect(error.message).toContain('payment details changed');
          expect(fixture.lockOrder).toEqual(['option', 'addon']);
        }),
    );

    it.effect.each([null, '', ' '.repeat(3), '\t\n'])(
      'rejects a locked tax rate without a usable percentage (%s)',
      (percentage) =>
        Effect.gen(function* () {
          const fixture = createDatabase({
            taxRates: [
              {
                displayName: 'Registration VAT',
                inclusive: true,
                percentage: '19',
                stripeTaxRateId: 'txr_registration',
              },
              {
                displayName: 'Add-on VAT',
                inclusive: true,
                percentage,
                stripeTaxRateId: 'txr_addon',
              },
            ],
          });
          const error = yield* fixture
            .run({
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
            })
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(EventRegistrationConflictError);
          expect(fixture.lockOrder).toEqual(['option', 'addon', 'tax-rate']);
        }),
    );

    it.effect(
      'fails closed when referenced rates are absent from the locked account',
      () =>
        Effect.gen(function* () {
          const fixture = createDatabase({
            stripeAccountId: 'acct_configured',
            taxRates: [],
          });
          const error = yield* fixture
            .run({
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
              stripeAccountId: 'acct_configured',
              tenantId: 'tenant-1',
            })
            .pipe(Effect.flip);

          expect(error).toBeInstanceOf(EventRegistrationConflictError);
          expect(error.message).toContain('payment details changed');
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
        expect(error.message).toBe(
          'The payment account could not be found. No sign-up was completed.',
        );
        expect(approvalDatabase.claimInsertCount()).toBe(0);
        expect(approvalDatabase.reservationUpdateCount()).toBe(0);
        expect(approvalDatabase.operationOrder).toEqual([]);
        expect(createSession).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'aborts approval when the required registration user relation is missing',
    () =>
      Effect.gen(function* () {
        const approvalDatabase = yield* createManualApprovalDatabase({
          registrationUser: null,
        });
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        );

        const error = yield* runManualApproval({
          database: approvalDatabase.database,
          stripe: checkoutStripeClient,
        }).pipe(Effect.flip);

        expect(error).toBeInstanceOf(EventRegistrationInternalError);
        expect(error.message).toBe(
          'The ticket owner could not be verified. No approval or payment was started. Reopen the sign-up request and try again.',
        );
        expect(approvalDatabase.transactionCount()).toBe(0);
        expect(approvalDatabase.emailInsertCount()).toBe(0);
        expect(createSession).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rejects manual approval when the applicant loses the required role before the locked transition',
    () =>
      Effect.gen(function* () {
        const approvalDatabase = yield* createManualApprovalDatabase({
          lockedApplicantRoleIds: [],
        });
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        );

        const error = yield* runManualApproval({
          database: approvalDatabase.database,
          stripe: checkoutStripeClient,
        }).pipe(Effect.flip);

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe(
          "The applicant's access in this organization no longer includes this sign-up choice. No approval or payment was started. Check their access before approving again.",
        );
        expect(approvalDatabase.claimInsertCount()).toBe(0);
        expect(approvalDatabase.reservationUpdateCount()).toBe(0);
        expect(createSession).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'does not approve or create payment when the locked organization email context is missing',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createManualApprovalDatabase({
          notificationTenantAvailable: false,
        });
        const stripe = createStripeTestClient();
        const error = yield* runManualApproval({
          database: fixture.database,
          stripe,
        }).pipe(Effect.flip);
        expect(error).toBeInstanceOf(EventRegistrationInternalError);
        expect(error.message).toContain(
          'organization email settings could not be verified',
        );
        expect(fixture.claimInsertCount()).toBe(0);
        expect(fixture.emailInsertCount()).toBe(0);
        expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'persists a manual approval payment claim before creating and binding Stripe Checkout',
    () =>
      Effect.gen(function* () {
        const approvalDatabase = yield* createManualApprovalDatabase();
        const createSession = vi.fn(
          (parameters?: Stripe.Checkout.SessionCreateParams) => {
            approvalDatabase.operationOrder.push('stripe');
            return Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_test_1',
                url: 'https://checkout.stripe.com/c/pay/cs_test_1',
              }),
            );
          },
        );
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
    'rejects an oversized Checkout before reserving capacity or add-on stock',
    () =>
      Effect.gen(function* () {
        const registration: ManualApprovalRegistrationFixture = {
          ...paidManualApprovalRegistration,
          addonPurchases: Array.from({ length: 100 }, (_, index) => ({
            addOn: {
              stripeTaxRateId: null,
              title: `Add-on ${index}`,
            },
            addonId: `addon-${index}`,
            id: `purchase-${index}`,
            purchasedQuantity: 1,
            quantity: 1,
            taxRateDisplayName: null,
            taxRateInclusive: null,
            taxRatePercentage: null,
            unitPrice: 100,
          })),
        };
        const approvalDatabase = yield* createManualApprovalDatabase({
          registration,
        });
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        );

        const error = yield* runManualApproval({
          database: approvalDatabase.database,
          stripe: checkoutStripeClient,
        }).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: 'EventRegistrationConflictError',
          message:
            'This sign-up includes too many different charges for one payment. Reduce the selected add-ons and try again.',
        });
        expect(approvalDatabase.transactionCount()).toBe(0);
        expect(approvalDatabase.claimInsertCount()).toBe(0);
        expect(approvalDatabase.reservationUpdateCount()).toBe(0);
        expect(approvalDatabase.operationOrder).toEqual([]);
        expect(createSession).not.toHaveBeenCalled();
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
        const createSession = vi.fn(
          (parameters?: Stripe.Checkout.SessionCreateParams) => {
            operationOrder.push('stripe');
            return Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_test_1',
                url: 'https://checkout.stripe.com/c/pay/cs_test_1',
              }),
            );
          },
        );
        const expireSession = vi.fn(() => {
          operationOrder.push('expire');
          return Promise.resolve(expiredCheckoutSessionResponse('cs_test_1'));
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
          vi.fn((parameters?: Stripe.Checkout.SessionCreateParams) => {
            operationOrder.push('stripe');
            return Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_test_1',
                url: 'https://checkout.stripe.com/c/pay/cs_test_1',
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
            return Promise.resolve(expiredCheckoutSessionResponse('cs_test_1'));
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
    'preserves an exactly bound approval claim while surfacing its ambiguous commit failure',
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
          vi.fn((parameters?: Stripe.Checkout.SessionCreateParams) => {
            operationOrder.push('stripe');
            return Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_test_1',
                url: 'https://checkout.stripe.com/c/pay/cs_test_1',
              }),
            );
          }),
        );
        const expireSession = vi.fn(() => {
          operationOrder.push('expire');
          return Promise.resolve(expiredCheckoutSessionResponse('cs_test_1'));
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
          vi.fn((parameters?: Stripe.Checkout.SessionCreateParams) => {
            operationOrder.push('stripe');
            return Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_test_1',
                url: 'https://checkout.stripe.com/c/pay/cs_test_1',
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
        const retryError = yield* runManualApproval({
          database,
          stripe: checkoutStripeClient,
        }).pipe(Effect.flip);
        expect(retryError).toMatchObject({
          _tag: 'EventRegistrationInternalError',
          message:
            'The approval notification could not be confirmed. Contact an organizer before trying again.',
        });
        expect(
          checkoutStripeClient.checkout.sessions.create,
        ).toHaveBeenCalledTimes(1);
        expect(
          operationOrder.filter((operation) => operation === 'email'),
        ).toHaveLength(1);
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
          vi.fn((parameters?: Stripe.Checkout.SessionCreateParams) => {
            operationOrder.push('stripe');
            return Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_test_1',
                url: 'https://checkout.stripe.com/c/pay/cs_test_1',
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
          'incident',
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
            operationOrder.push('stripe');
            expect(parameters?.expires_at).toBeGreaterThanOrEqual(
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
          'The payment could not be prepared. Contact an organizer before trying again.',
        );
        expect(error).not.toHaveProperty('cause');
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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
    'rejects direct registration when a required role is removed before the locked reservation',
    () =>
      Effect.gen(function* () {
        const directDatabase = yield* createDirectCheckoutDatabase({
          lockedUserRoleIds: [],
        });
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        );

        const error = yield* runDirectCheckout({
          database: directDatabase.database,
          stripe: checkoutStripeClient,
        }).pipe(Effect.flip);

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe(
          'Your access in this organization no longer includes this sign-up choice. No sign-up or payment was started. Choose another sign-up choice or contact the organizer.',
        );
        expect(directDatabase.claimInsertCount()).toBe(0);
        expect(directDatabase.reservationUpdateCount()).toBe(0);
        expect(directDatabase.operationOrder).toEqual([]);
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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
            operationOrder.push('stripe');
            expect(parameters?.expires_at).toBeGreaterThanOrEqual(
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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
          'The payment could not be prepared. Contact an organizer before trying again.',
        );
        expect(error).not.toHaveProperty('cause');
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
          vi.fn((parameters?: Stripe.Checkout.SessionCreateParams) => {
            operationOrder.push('stripe');
            return Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_direct_1',
                url: 'https://checkout.stripe.com/c/pay/cs_direct_1',
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
            return Promise.resolve(
              expiredCheckoutSessionResponse('cs_direct_1'),
            );
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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
          vi.fn((parameters?: Stripe.Checkout.SessionCreateParams) => {
            operationOrder.push('stripe');
            return Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_direct_1',
                url: 'https://checkout.stripe.com/c/pay/cs_direct_1',
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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
          'incident',
        ]);
      }),
  );
});

describe('EventRegistrationService', () => {
  describe('registrationCheckoutPriceBreakdown', () => {
    it.effect(
      'accepts the persisted registration amount boundary and rejects the next cent',
      () =>
        Effect.gen(function* () {
          const atLimit = yield* registrationCheckoutPriceBreakdown({
            addOns: [],
            effectivePrice: maximumPersistedPaymentAmount,
            guestCount: 0,
            guestUnitPrice: 0,
          });
          expect(atLimit.registrationBaseAmount).toBe(
            maximumPersistedPaymentAmount,
          );
          expect(atLimit.totalPrice).toBe(maximumPersistedPaymentAmount);

          const error = yield* registrationCheckoutPriceBreakdown({
            addOns: [],
            effectivePrice: 1,
            guestCount: 1,
            guestUnitPrice: maximumPersistedPaymentAmount,
          }).pipe(Effect.flip);
          expect(error).toBeInstanceOf(EventRegistrationConflictError);
          expect(error.message).toBe(
            'The sign-up price is too high to pay online. Contact the organizer.',
          );
        }),
    );

    it.effect(
      'accepts the persisted add-on lot boundary and rejects an overflowing lot',
      () =>
        Effect.gen(function* () {
          const atLimit = yield* registrationCheckoutPriceBreakdown({
            addOns: [
              {
                key: 'addon-1',
                quantity: 1,
                unitPrice: maximumPersistedPaymentAmount,
              },
            ],
            effectivePrice: 0,
            guestCount: 0,
            guestUnitPrice: 0,
          });
          expect(atLimit.addOnBaseAmounts.get('addon-1')).toBe(
            maximumPersistedPaymentAmount,
          );
          expect(atLimit.selectedAddonTotalPrice).toBe(
            maximumPersistedPaymentAmount,
          );

          const error = yield* registrationCheckoutPriceBreakdown({
            addOns: [
              {
                key: 'addon-1',
                quantity: 2,
                unitPrice: maximumPersistedPaymentAmount,
              },
            ],
            effectivePrice: 0,
            guestCount: 0,
            guestUnitPrice: 0,
          }).pipe(Effect.flip);
          expect(error).toBeInstanceOf(EventRegistrationConflictError);
          expect(error.message).toBe(
            'One selected add-on costs too much to pay online. Contact the organizer.',
          );
        }),
    );

    it.effect(
      'rejects overflowing add-on and complete checkout aggregates',
      () =>
        Effect.gen(function* () {
          const addOnAggregateError = yield* registrationCheckoutPriceBreakdown(
            {
              addOns: [
                {
                  key: 'addon-1',
                  quantity: 1,
                  unitPrice: maximumPersistedPaymentAmount,
                },
                { key: 'addon-2', quantity: 1, unitPrice: 1 },
              ],
              effectivePrice: 0,
              guestCount: 0,
              guestUnitPrice: 0,
            },
          ).pipe(Effect.flip);
          expect(addOnAggregateError).toBeInstanceOf(
            EventRegistrationConflictError,
          );
          expect(addOnAggregateError.message).toBe(
            'The selected add-ons cost too much to pay online. Contact the organizer.',
          );

          const checkoutAggregateError =
            yield* registrationCheckoutPriceBreakdown({
              addOns: [{ key: 'addon-1', quantity: 1, unitPrice: 1 }],
              effectivePrice: maximumPersistedPaymentAmount,
              guestCount: 0,
              guestUnitPrice: 0,
            }).pipe(Effect.flip);
          expect(checkoutAggregateError).toBeInstanceOf(
            EventRegistrationConflictError,
          );
          expect(checkoutAggregateError.message).toBe(
            'The total price is too high to pay online. Contact the organizer.',
          );
        }),
    );
  });

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

    it('rejects duplicate question answers instead of silently overwriting', () => {
      expect(() =>
        validateRegistrationQuestionAnswers({
          answers: [
            { answer: 'First', questionId: 'question-1' },
            { answer: 'Second', questionId: 'question-1' },
          ],
          questions: [{ id: 'question-1', required: false }],
        }),
      ).toThrow('Answer each sign-up question only once');
    });

    it('rejects excessive answer counts and answer text', () => {
      expect(() =>
        validateRegistrationQuestionAnswers({
          answers: Array.from(
            { length: MAX_REGISTRATION_QUESTIONS + 1 },
            (_, index) => ({
              answer: 'Answer',
              questionId: `question-${index}`,
            }),
          ),
          questions: [],
        }),
      ).toThrow(
        `You can answer up to ${MAX_REGISTRATION_QUESTIONS} sign-up questions`,
      );

      expect(() =>
        validateRegistrationQuestionAnswers({
          answers: [
            {
              answer: 'a'.repeat(MAX_REGISTRATION_ANSWER_LENGTH + 1),
              questionId: 'question-1',
            },
          ],
          questions: [{ id: 'question-1', required: false }],
        }),
      ).toThrow(
        `Each answer must be ${MAX_REGISTRATION_ANSWER_LENGTH} characters or fewer`,
      );
    });
  });

  it.effect(
    'rejects an invalid tenant domain before reading or writing registration data',
    () =>
      Effect.gen(function* () {
        const findRegistration = vi.fn<
          SqlConnection.Connection['executeValues']
        >(() =>
          Effect.die(
            new Error('Invalid tenant domain must prevent database access'),
          ),
        );
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: findRegistration,
        });

        const error = yield* EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            domain: 'tenant.example.com/path',
            id: 'tenant-1',
            stripeAccountId: undefined,
          },
          user: {
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(databaseLayer),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error['_tag']).toBe('EventRegistrationInternalError');
        expect(error.message).toBe(
          'The event link could not be prepared. No sign-up was created. Contact an organizer.',
        );
        expect(findRegistration).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rejects a second registration for the same event before looking up another option',
    () =>
      Effect.gen(function* () {
        const context = yield* Layer.build(
          createRegistrationReadDatabaseLayer({
            existingRegistrationId: 'existing-registration',
            option: null,
          }),
        );
        const mockDatabase = Context.get(context, Database);
        const findRegistrationOption = vi.spyOn(
          mockDatabase.query.eventRegistrationOptions,
          'findFirst',
        );

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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
        expect(error.message).toBe('You are already signed up for this event.');
        expect(findRegistrationOption).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'queries registration options with explicit projection columns',
    () =>
      Effect.gen(function* () {
        const context = yield* Layer.build(
          createRegistrationReadDatabaseLayer({
            option: null,
          }),
        );
        const mockDatabase = Context.get(context, Database);
        const findRegistrationOption = vi.spyOn(
          mockDatabase.query.eventRegistrationOptions,
          'findFirst',
        );

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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
        expect(error.message).toBe(
          'The selected sign-up choice is no longer available.',
        );
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
      const databaseLayer = createRegistrationReadDatabaseLayer({
        option: {
          ...approvedRegistrationOption,
          event: {
            ...approvedRegistrationOption.event,
            status: 'DRAFT',
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
          communicationEmail: 'alice.contact@example.com',
          email: 'alice.contact@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(databaseLayer),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe('This event is not open for sign-ups.');
    }),
  );

  it.effect('rejects registration when the event has no start time', () =>
    Effect.gen(function* () {
      const databaseLayer = createRegistrationReadDatabaseLayer({
        option: {
          ...approvedRegistrationOption,
          event: {
            ...approvedRegistrationOption.event,
            start: null,
          },
        },
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
          communicationEmail: 'alice.contact@example.com',
          email: 'alice.contact@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(databaseLayer),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      expect(error).toBeInstanceOf(EventRegistrationConflictError);
      expect(error.message).toBe(
        'This event does not have a start time, so sign-ups are unavailable. Contact an organizer.',
      );
    }),
  );

  it.effect(
    'rejects registration outside the server-side registration window',
    () =>
      Effect.gen(function* () {
        const databaseLayer = createRegistrationReadDatabaseLayer({
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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(databaseLayer),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('Sign-ups are not open at this time.');
      }),
  );

  it.effect('rejects registration when user roles are not eligible', () =>
    Effect.gen(function* () {
      const databaseLayer = createRegistrationReadDatabaseLayer({
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
          communicationEmail: 'alice.contact@example.com',
          email: 'alice.contact@example.com',
          id: 'user-1',
          roleIds: ['role-2'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(databaseLayer),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Your access in this organization does not include this sign-up choice. No sign-up or payment was started. Choose another sign-up choice or contact the organizer.',
      );
    }),
  );

  it.effect('rejects registration for another tenant event', () =>
    Effect.gen(function* () {
      const databaseLayer = createRegistrationReadDatabaseLayer({
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
          communicationEmail: 'alice.contact@example.com',
          email: 'alice.contact@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(databaseLayer),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationNotFoundError');
      expect(error.message).toBe(
        'The selected sign-up choice is no longer available.',
      );
    }),
  );

  it.effect('rejects registration when the selected option is full', () =>
    Effect.gen(function* () {
      const databaseLayer = createRegistrationReadDatabaseLayer({
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
          communicationEmail: 'alice.contact@example.com',
          email: 'alice.contact@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(databaseLayer),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'There are not enough places left for this sign-up choice.',
      );
    }),
  );

  it.effect(
    'stores guest count when registering multiple participant spots',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createReservationDatabaseFixture({
          guestCount: 2,
          steps: [
            ...reservationInitialReadSteps,
            'readActiveRegistration',
            'reserveCapacity',
            'insertRegistration',
            ...reservationFreeConfirmationSteps,
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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
        expect(fixture.registrationInserts[0]).toEqual(
          expect.objectContaining({
            guestCount: 2,
            status: 'CONFIRMED',
          }),
        );
        expect(fixture.acquisitionInserts[0]).toEqual(
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
    'transactionally enqueues a direct free confirmation to the communication email',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createReservationDatabaseFixture({
          communicationEmail: 'preferred@example.com',
          emailSenderEmail: 'events@tenant.example',
          emailSenderName: 'Events Team',
          steps: [
            ...reservationInitialReadSteps,
            'readActiveRegistration',
            'reserveCapacity',
            'insertRegistration',
            ...reservationFreeConfirmationSteps,
          ],
        });

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
            communicationEmail: 'preferred@example.com',
            email: 'preferred@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(fixture.emailInsertedWhileTransactionOpen).toBe(true);
        expect(
          fixture.writeOrder.filter(
            (operation) =>
              operation === 'registration' || operation === 'email',
          ),
        ).toEqual(['registration', 'email']);
        expect(fixture.emailInserts[0]).toEqual(
          expect.objectContaining({
            idempotencyKey: `registration-confirmed/tenant-1/${fixture.registrationId}`,
            kind: 'registrationConfirmed',
            replyToEmail: 'events@tenant.example',
            replyToName: 'Events Team',
            subject: 'Ticket confirmed: Approved event',
            tenantId: 'tenant-1',
            toEmail: 'preferred@example.com',
          }),
        );
        expect(
          Schema.decodeUnknownSync(Schema.String)(
            fixture.emailInserts[0]?.html,
          ),
        ).toContain('https://tenant.example.com/events/event-1');
        fixture.expectComplete();
      }),
  );

  it.effect('rejects guest registration when not enough spots remain', () =>
    Effect.gen(function* () {
      const databaseLayer = createRegistrationReadDatabaseLayer({
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
          communicationEmail: 'alice.contact@example.com',
          email: 'alice.contact@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(databaseLayer),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'There are not enough places left for this sign-up choice.',
      );
    }),
  );

  it.effect('rejects guest spots for organizer/helper registration', () =>
    Effect.gen(function* () {
      const databaseLayer = createRegistrationReadDatabaseLayer({
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
          communicationEmail: 'alice.contact@example.com',
          email: 'alice.contact@example.com',
          id: 'user-1',
          roleIds: ['role-1'],
        },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(databaseLayer),
        Effect.provideService(StripeClient, stripeClient),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Guests can only be added to attendee sign-ups.',
      );
    }),
  );

  it.effect(
    'creates manual approval applications without reserving capacity',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createReservationDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            confirmedSpots: 10,
            registrationMode: 'application',
            reservedSpots: 0,
          },
          steps: [
            ...reservationInitialReadSteps,
            'readActiveRegistration',
            'insertRegistration',
            'COMMIT',
          ],
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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
        expect(fixture.registrationInserts[0]).toEqual(
          expect.objectContaining({
            status: 'PENDING',
          }),
        );
        expect(fixture.capacityUpdates).toHaveLength(0);
        fixture.expectComplete();
      }),
  );

  it.effect('confirms an approved free application without Stripe', () =>
    Effect.gen(function* () {
      const approvalDatabase = yield* createManualApprovalDatabase({
        registration: freeManualApprovalRegistration,
      });
      const checkoutStripeClient = createStripeTestClient();
      const createSession = vi.fn(
        (parameters?: Stripe.Checkout.SessionCreateParams) =>
          Promise.resolve(
            directCheckoutSessionResponse(parameters, {
              id: 'cs_test_unexpected',
              url: 'https://checkout.stripe.com/c/pay/cs_test_unexpected',
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
      expect(createSession).not.toHaveBeenCalled();
      expect(approvalDatabase.claimInsertCount()).toBe(0);
      expect(approvalDatabase.reservationUpdateCount()).toBe(1);
      expect(approvalDatabase.emailInsertCount()).toBe(1);
      expect(approvalDatabase.emailKinds).toEqual(['manualApproval']);
      expect(approvalDatabase.emailRecipients).toEqual([
        'alice.contact@example.com',
      ]);
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
        const createSession = vi.fn(
          (parameters?: Stripe.Checkout.SessionCreateParams) => {
            approvalDatabase.operationOrder.push('stripe');
            return Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_test_1',
                url: 'https://checkout.stripe.com/c/pay/cs_test_1',
              }),
            );
          },
        );
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
        expect(approvalDatabase.emailRecipients).toEqual([
          'alice.contact@example.com',
        ]);
        expect(approvalDatabase.getClaim()).toEqual(
          expect.objectContaining({
            appFee: 35,
            id: expect.any(String),
            stripeCheckoutRequest: expect.objectContaining({
              customerEmail: 'alice.contact@example.com',
              eventUrl: 'https://tenant.example.com/events/event-1',
              lineItems: [
                expect.objectContaining({
                  name: 'Registration fee for Approved event',
                  quantity: 1,
                  taxRateId: 'txr_19',
                  unitAmount: 1000,
                }),
              ],
              notificationEmail: 'alice.contact@example.com',
            }),
            stripeCheckoutSessionId: 'cs_test_1',
            stripeCheckoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
          }),
        );
      }),
  );

  for (const lineCount of [
    MAX_STRIPE_CHECKOUT_LINE_ITEMS,
    MAX_STRIPE_CHECKOUT_LINE_ITEMS + 1,
  ]) {
    it.effect(
      `approval resume validates ${lineCount} persisted checkout lines before Stripe`,
      () =>
        Effect.gen(function* () {
          const snapshot = {
            customerEmail: 'stored@example.com',
            eventTitle: 'Stored event',
            eventUrl: 'https://tenant.example.com/events/event-1',
            expiresAt: 1_900_000_000,
            lineItems: Array.from({ length: lineCount }, (_, index) => ({
              name: `Stored item ${index}`,
              quantity: 1,
              taxRateId: 'txr_19',
              unitAmount: 1000,
            })),
            notificationEmail: 'stored@example.com',
          };
          const existingClaim: ManualApprovalClaim = {
            amount: lineCount * 1000,
            appFee: 35,
            currency: 'EUR',
            id: 'transaction-existing',
            stripeAccountId: 'acct_123',
            stripeCheckoutIncidentSessionId: null,
            stripeCheckoutRequest: snapshot,
            stripeCheckoutSessionId: null,
            stripeCheckoutUrl: null,
            targetUserId: 'user-1',
          };
          const fixture = yield* createManualApprovalDatabase({
            existingClaim,
          });
          const stripe = createStripeTestClient();
          const createSession = vi
            .spyOn(stripe.checkout.sessions, 'create')
            .mockResolvedValue(
              checkoutSessionResponse({
                id: 'cs_stored',
                paymentIntent: null,
                url: 'https://checkout.stripe.test/stored',
              }),
            );
          const run = runManualApproval({ database: fixture.database, stripe });
          if (lineCount > MAX_STRIPE_CHECKOUT_LINE_ITEMS) {
            const error = yield* run.pipe(Effect.flip);
            expect(error).toBeInstanceOf(EventRegistrationInternalError);
            expect(createSession).not.toHaveBeenCalled();
            expect(fixture.bindingUpdateCount()).toBe(0);
            expect(fixture.getClaim()?.stripeCheckoutRequest).toEqual(snapshot);
          } else {
            const decoded = yield* decodeRegistrationCheckoutSnapshot(
              snapshot,
              'Invalid stored snapshot',
            );
            expect(decoded.lineItems).toHaveLength(
              MAX_STRIPE_CHECKOUT_LINE_ITEMS,
            );
            const error = yield* run.pipe(Effect.flip);
            expect(error).toBeInstanceOf(EventRegistrationConflictError);
            expect(error.message).toContain('Contact an organizer');
            expect(createSession).not.toHaveBeenCalled();
            expect(fixture.bindingUpdateCount()).toBe(0);
          }
          expect(fixture.claimInsertCount()).toBe(0);
          expect(fixture.reservationUpdateCount()).toBe(0);
        }),
    );
  }

  it.effect(
    'retains an incomplete approval claim without another Stripe create or reservation',
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
          amount: 8642,
          appFee: 151,
          currency: 'CZK',
          id: 'transaction-existing',
          stripeAccountId: 'acct_stored',
          stripeCheckoutIncidentSessionId: null,
          stripeCheckoutRequest: storedSnapshot,
          stripeCheckoutSessionId: null,
          stripeCheckoutUrl: null,
          targetUserId: 'user-1',
        } satisfies ManualApprovalClaim;
        const approvalDatabase = yield* createManualApprovalDatabase({
          existingClaim,
        });
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.fn(
          (parameters?: Stripe.Checkout.SessionCreateParams) => {
            approvalDatabase.operationOrder.push('stripe');
            return Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_test_existing',
                url: 'https://checkout.stripe.com/c/pay/cs_test_existing',
              }),
            );
          },
        );
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(createSession);

        const error = yield* runManualApproval({
          database: approvalDatabase.database,
          stripe: checkoutStripeClient,
        }).pipe(Effect.flip);
        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toContain('Contact an organizer');
        expect(approvalDatabase.claimInsertCount()).toBe(0);
        expect(approvalDatabase.reservationUpdateCount()).toBe(0);
        expect(approvalDatabase.getClaim()).toEqual(existingClaim);
        expect(createSession).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'redacts the Stripe cause and retains an incomplete payment claim',
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
          'The payment could not be prepared. Contact an organizer before trying again.',
        );
        expect(error).not.toHaveProperty('cause');
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
        const createSession = vi.fn(
          (parameters?: Stripe.Checkout.SessionCreateParams) => {
            directDatabase.operationOrder.push('stripe');
            return Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_direct_1',
                url: 'https://checkout.stripe.com/c/pay/cs_direct_1',
              }),
            );
          },
        );
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
              customerEmail: 'alice.contact@example.com',
              eventUrl: 'https://tenant.example.com/events/event-1',
              lineItems: [
                {
                  name: 'Registration fee for Approved event',
                  quantity: 1,
                  taxRateId: 'txr_19',
                  unitAmount: 1000,
                },
              ],
              notificationEmail: 'alice.contact@example.com',
            }),
            stripeCheckoutSessionId: 'cs_direct_1',
            stripeCheckoutUrl: 'https://checkout.stripe.com/c/pay/cs_direct_1',
          }),
        );
        expect(createSession).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: {
              registrationId: directDatabase.getRegistrationId(),
              tenantId: 'tenant-1',
              transactionId: claim?.id,
              userId: 'user-1',
            },
          }),
          {
            idempotencyKey: `registration:${directDatabase.getRegistrationId()}:transaction:${claim?.id}`,
            stripeAccount: 'acct_123',
          },
        );
      }),
  );

  it.effect(
    'creates paid Checkout with the configured account and its tax rate',
    () =>
      Effect.gen(function* () {
        const directDatabase = yield* createDirectCheckoutDatabase({
          configuredStripeTaxRateId: 'txr_configured',
          lockedStripeAccountId: 'acct_configured',
          registrationOption: {
            isPaid: true,
            price: 1000,
            stripeTaxRateId: 'txr_configured',
          },
        });
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.fn(
          (parameters?: Stripe.Checkout.SessionCreateParams) =>
            Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_configured_account',
                url: 'https://checkout.stripe.com/c/pay/cs_configured_account',
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
          stripeAccountId: 'acct_configured',
        });

        expect(directDatabase.getClaim()).toEqual(
          expect.objectContaining({
            stripeAccountId: 'acct_configured',
            stripeCheckoutRequest: expect.objectContaining({
              lineItems: [
                {
                  name: 'Registration fee for Approved event',
                  quantity: 1,
                  taxRateId: 'txr_configured',
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
                tax_rates: ['txr_configured'],
              }),
            ],
          }),
          expect.objectContaining({ stripeAccount: 'acct_configured' }),
        );
      }),
  );

  it.effect(
    'retains an uncertain direct claim without a second provider create or stock release',
    () =>
      Effect.gen(function* () {
        const lockedUserRoleIds = ['role-1'];
        const directDatabase = yield* createDirectCheckoutDatabase({
          lockedUserRoleIds,
        });
        const stripe = createStripeTestClient();
        const createSession = vi
          .spyOn(stripe.checkout.sessions, 'create')
          .mockRejectedValue(new Error('response lost'));
        const firstError = yield* runDirectCheckout({
          database: directDatabase.database,
          stripe,
        }).pipe(Effect.flip);
        expect(firstError).toBeInstanceOf(EventRegistrationInternalError);
        for (const removeRole of [false, true]) {
          if (removeRole) lockedUserRoleIds.length = 0;
          const retryError = yield* runDirectCheckout({
            database: directDatabase.database,
            stripe,
          }).pipe(Effect.flip);
          expect(retryError).toBeInstanceOf(EventRegistrationConflictError);
          expect(retryError.message).toBe(
            'You are already signed up for this event.',
          );
        }
        expect(createSession).toHaveBeenCalledOnce();
        expect(directDatabase.getClaim()).toEqual(
          expect.objectContaining({
            stripeCheckoutIncidentSessionId: null,
            stripeCheckoutSessionId: null,
          }),
        );
        expect(directDatabase.claimInsertCount()).toBe(1);
        expect(directDatabase.reservationUpdateCount()).toBe(1);
        expect(directDatabase.bindingUpdateCount()).toBe(0);
      }),
  );

  it.effect('rejects repeat sign-up after a direct Checkout is bound', () =>
    Effect.gen(function* () {
      const directDatabase = yield* createDirectCheckoutDatabase();
      const stripe = createStripeTestClient();
      const createSession = vi
        .spyOn(stripe.checkout.sessions, 'create')
        .mockImplementation((parameters) =>
          Promise.resolve(
            directCheckoutSessionResponse(parameters, {
              id: 'cs_bound',
              url: 'https://checkout.stripe.com/c/pay/cs_bound',
            }),
          ),
        );
      yield* runDirectCheckout({ database: directDatabase.database, stripe });
      const repeatError = yield* runDirectCheckout({
        database: directDatabase.database,
        stripe,
      }).pipe(Effect.flip);
      expect(repeatError).toBeInstanceOf(EventRegistrationConflictError);
      expect(repeatError.message).toBe(
        'You are already signed up for this event.',
      );
      expect(createSession).toHaveBeenCalledOnce();
      expect(directDatabase.bindingUpdateCount()).toBe(1);
    }),
  );

  it.effect(
    'keeps a known unbound session visible after expiry failure and blocks retry',
    () =>
      Effect.gen(function* () {
        const directDatabase = yield* createDirectCheckoutDatabase({
          bindingSucceeds: false,
        });
        const stripe = createStripeTestClient();
        const createSession = vi
          .spyOn(stripe.checkout.sessions, 'create')
          .mockImplementation((parameters) =>
            Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_incident',
                url: 'https://checkout.stripe.com/c/pay/cs_incident',
              }),
            ),
          );
        vi.spyOn(stripe.checkout.sessions, 'expire').mockRejectedValue(
          new Error('expiry response lost'),
        );
        yield* runDirectCheckout({
          database: directDatabase.database,
          stripe,
        }).pipe(Effect.flip);
        const retryError = yield* runDirectCheckout({
          database: directDatabase.database,
          stripe,
        }).pipe(Effect.flip);
        expect(retryError.message).toBe(
          'You are already signed up for this event.',
        );
        expect(createSession).toHaveBeenCalledOnce();
        expect(directDatabase.getClaim()).toEqual(
          expect.objectContaining({
            stripeCheckoutIncidentSessionId: 'cs_incident',
            stripeCheckoutSessionId: null,
          }),
        );
        expect(directDatabase.reservationUpdateCount()).toBe(1);
      }),
  );

  it.effect(
    'finishes binding a known session when the request is interrupted',
    () =>
      Effect.gen(function* () {
        const bindingStarted = yield* Deferred.make<undefined>();
        const releaseBinding = yield* Deferred.make<undefined>();
        const directDatabase = yield* createDirectCheckoutDatabase({
          beforeBind: Deferred.succeed(bindingStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseBinding)),
          ),
        });
        const stripe = createStripeTestClient();
        const createSession = vi
          .spyOn(stripe.checkout.sessions, 'create')
          .mockImplementation((parameters) =>
            Promise.resolve(
              directCheckoutSessionResponse(parameters, {
                id: 'cs_interrupted',
                url: 'https://checkout.stripe.com/c/pay/cs_interrupted',
              }),
            ),
          );
        const registrationFiber = yield* runDirectCheckout({
          database: directDatabase.database,
          stripe,
        }).pipe(Effect.forkChild);
        yield* Deferred.await(bindingStarted);
        const interruption = yield* Fiber.interrupt(registrationFiber).pipe(
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        yield* Deferred.succeed(releaseBinding, undefined);
        yield* Fiber.join(interruption);
        expect(createSession).toHaveBeenCalledOnce();
        expect(directDatabase.getClaim()).toEqual(
          expect.objectContaining({
            stripeCheckoutIncidentSessionId: null,
            stripeCheckoutSessionId: 'cs_interrupted',
          }),
        );
        expect(directDatabase.reservationUpdateCount()).toBe(1);
        expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'records an incident when a mismatched created session cannot be proven expired',
    () =>
      Effect.gen(function* () {
        const directDatabase = yield* createDirectCheckoutDatabase();
        const stripe = createStripeTestClient();
        vi.spyOn(stripe.checkout.sessions, 'create').mockImplementation(
          (parameters) =>
            Promise.resolve({
              ...directCheckoutSessionResponse(parameters, {
                id: 'cs_mismatch',
                url: 'https://checkout.stripe.com/c/pay/cs_mismatch',
              }),
              amount_total: 999,
            }),
        );
        vi.spyOn(stripe.checkout.sessions, 'expire').mockResolvedValue(
          expiredCheckoutSessionResponse('cs_wrong_identity'),
        );
        const error = yield* runDirectCheckout({
          database: directDatabase.database,
          stripe,
        }).pipe(Effect.flip);
        expect(error.message).toContain('Contact an organizer');
        expect(directDatabase.bindingUpdateCount()).toBe(0);
        expect(directDatabase.getClaim()).toEqual(
          expect.objectContaining({
            stripeCheckoutIncidentSessionId: 'cs_mismatch',
            stripeCheckoutSessionId: null,
          }),
        );
        expect(directDatabase.reservationUpdateCount()).toBe(1);
      }),
  );

  it.effect(
    'maps the active-registration unique constraint race to a domain conflict',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createReservationDatabaseFixture({
          steps: [
            ...reservationInitialReadSteps,
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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
        expect(error.message).toBe('You are already signed up for this event.');
        fixture.expectComplete();
      }),
  );

  it.effect(
    'rejects registration under the current lower limit despite an unlimited request snapshot',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createReservationDatabaseFixture({
          currentTenantLimit: 1,
          steps: [
            ...reservationInitialReadSteps,
            'readActiveRegistration',
            'readActiveFutureRegistration',
            'COMMIT',
          ],
        });

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            maxActiveRegistrationsPerUser: 0,
            stripeAccountId: undefined,
          },
          user: {
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
          'This organization has reached its limit for current sign-ups. Contact an administrator.',
        );
        expect(fixture.currentTenantLimitReads).toBe(1);
        expect(fixture.operations).toContain('readActiveFutureRegistration');
        expect(
          fixture.operations.filter(
            (operation) => operation === 'lockMembership',
          ),
        ).toHaveLength(1);
        expect(fixture.capacityUpdates).toHaveLength(0);
        fixture.expectComplete();
      }),
  );

  it.effect(
    'admits registration after the current limit becomes unlimited despite the old request limit',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createReservationDatabaseFixture({
          currentTenantLimit: 0,
          steps: [
            ...reservationInitialReadSteps,
            'readActiveRegistration',
            'reserveCapacity',
            'insertRegistration',
            ...reservationFreeConfirmationSteps,
          ],
        });
        const stripe = createStripeTestClient();
        yield* EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            emailSenderEmail: null,
            emailSenderName: null,
            id: 'tenant-1',
            maxActiveRegistrationsPerUser: 1,
            name: 'Tenant',
            stripeAccountId: undefined,
          },
          user: {
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripe),
          Effect.provide(configProviderLayer),
        );
        expect(fixture.currentTenantLimitReads).toBe(1);
        expect(fixture.capacityUpdates).toHaveLength(1);
        expect(fixture.registrationInserts).toHaveLength(1);
        expect(fixture.operations).not.toContain(
          'readActiveFutureRegistration',
        );
        expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
        fixture.expectComplete();
      }),
  );

  it.effect(
    'rejects admission when current organization settings are missing without using the request limit',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createReservationDatabaseFixture({
          currentTenantLimit: null,
          steps: [...reservationInitialReadSteps, 'ROLLBACK'],
        });
        const stripe = createStripeTestClient();
        const error = yield* EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: 0,
          registrationOptionId: 'option-1',
          tenant: {
            ...tenantPublicOrigin,
            currency: 'EUR',
            id: 'tenant-1',
            maxActiveRegistrationsPerUser: 0,
            stripeAccountId: undefined,
          },
          user: {
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripe),
          Effect.provide(configProviderLayer),
        );
        expect(error).toBeInstanceOf(EventRegistrationNotFoundError);
        expect(error.message).toBe(
          'This organization is no longer available. No sign-up was completed.',
        );
        expect(fixture.currentTenantLimitReads).toBe(1);
        expect(fixture.capacityUpdates).toHaveLength(0);
        expect(fixture.registrationInserts).toHaveLength(0);
        expect(fixture.operations).not.toContain('readActiveRegistration');
        expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
        fixture.expectComplete();
      }),
  );

  it.effect(
    'rejects when a concurrent registration appears inside the reservation transaction',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createReservationDatabaseFixture({
          steps: [
            ...reservationInitialReadSteps,
            'readConcurrentRegistration',
            'COMMIT',
          ],
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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
        expect(error.message).toBe('You are already signed up for this event.');
        expect(fixture.capacityUpdates).toHaveLength(0);
        fixture.expectComplete();
      }),
  );

  it.effect(
    'rejects when the transactional capacity counter update loses the race',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createReservationDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            confirmedSpots: 9,
            reservedSpots: 0,
          },
          steps: [
            ...reservationInitialReadSteps,
            'readActiveRegistration',
            'loseCapacity',
            'COMMIT',
          ],
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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
          'There are not enough places left for this sign-up choice.',
        );
        expect(fixture.registrationInserts).toHaveLength(0);
        fixture.expectComplete();
      }),
  );

  it.effect.each([null, '', ' '.repeat(3), '\t\n', '0', '19'])(
    'checks selected paid add-on tax details before starting payment (%s)',
    (percentage) =>
      Effect.gen(function* () {
        const fixture = yield* createReservationDatabaseFixture({
          addon: {
            addOnId: 'addon-1',
            allowMultiple: false,
            allowPurchaseDuringRegistration: true,
            includedQuantity: 0,
            isPaid: true,
            maxQuantityPerUser: 1,
            optionalPurchaseQuantity: 1,
            price: 500,
            stripeTaxRateId: 'txr_addon',
            taxRateDisplayName: 'VAT',
            taxRateInclusive: true,
            taxRatePercentage: percentage,
            title: 'Lunch',
            totalAvailableQuantity: 1,
          },
          steps: ['readExistingRegistration', 'readOption', 'readAddons'],
        });
        const stripe = createStripeTestClient();
        const error = yield* EventRegistrationService.registerForEvent({
          addOns: [{ addOnId: 'addon-1', quantity: 1 }],
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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripe),
          Effect.provide(configProviderLayer),
        );

        // Usable rates reach the separate payment-account check, including 0%.
        expect(error).toMatchObject(
          percentage === '0' || percentage === '19'
            ? {
                _tag: 'EventRegistrationInternalError',
                message: 'Stripe account not found',
              }
            : {
                _tag: 'EventRegistrationConflictError',
                message:
                  "Online payment cannot be started because a selected add-on's tax details are no longer available. No sign-up or payment was started. Contact the organizer.",
              },
        );
        expect(fixture.transactionCommands).toEqual([]);
        expect(fixture.registrationInserts).toHaveLength(0);
        expect(fixture.addonStockUpdates).toHaveLength(0);
        expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
        fixture.expectComplete();
      }),
  );

  it.effect(
    'persists the configured add-on attachment quantity for a selected add-on',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createReservationDatabaseFixture({
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
            ...reservationInitialReadSteps,
            'readActiveRegistration',
            'reserveCapacity',
            'insertRegistration',
            'reserveAddonStock',
            'insertAddonPurchase',
            'insertAddonLot',
            ...reservationFreeConfirmationSteps,
          ],
        });

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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
            id: 'user-1',
            roleIds: ['role-1'],
          },
        }).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, fixture.database)),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(fixture.addonPurchaseInserts).toContainEqual(
          expect.objectContaining({
            addonId: 'addon-1',
            includedQuantity: 1,
            purchasedQuantity: 1,
            quantity: 2,
            registrationId: fixture.registrationId,
          }),
        );
        expect(fixture.addonLotInserts).toContainEqual(
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
        const fixture = yield* createReservationDatabaseFixture({
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
            ...reservationInitialReadSteps,
            'readActiveRegistration',
            'reserveCapacity',
            'insertRegistration',
            'loseAddonStock',
            'ROLLBACK',
          ],
          stripeAccountId: 'acct_123',
        });

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
            communicationEmail: 'alice.contact@example.com',
            email: 'alice.contact@example.com',
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
        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'There are not enough of one selected add-on left.',
        );
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'ROLLBACK']);
        expect(fixture.addonPurchaseInserts).toHaveLength(0);
        fixture.expectComplete();
      }),
  );

  it.effect('joins the waitlist for a full public participant option', () =>
    Effect.gen(function* () {
      const { database: mockDatabase, insertWaitlistRegistration } =
        yield* createWaitlistDatabaseFixture({
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
    }),
  );

  it.effect(
    'rejects waitlist creation when a required role is removed before the locked insert',
    () =>
      Effect.gen(function* () {
        const {
          database: mockDatabase,
          findActiveRegistrations,
          insertWaitlistRegistration,
          updateWaitlistCounter,
        } = yield* createWaitlistDatabaseFixture({
          lockedRoleIds: [],
          option: {
            ...approvedRegistrationOption,
            confirmedSpots: 10,
            organizingRegistration: false,
          },
        });

        const error = yield* EventRegistrationService.joinWaitlist({
          eventId: 'event-1',
          registrationOptionId: 'option-1',
          tenant: { id: 'tenant-1' },
          user: { id: 'user-1', roleIds: ['role-1'] },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase)),
          Effect.provide(configProviderLayer),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe(
          'Your access in this organization no longer includes this sign-up choice. You were not added to the waitlist. Choose another sign-up choice or contact the organizer.',
        );
        expect(insertWaitlistRegistration).not.toHaveBeenCalled();
        expect(updateWaitlistCounter).not.toHaveBeenCalled();
        expect(findActiveRegistrations).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'maps a concurrent waitlist insert unique violation to a domain conflict',
    () =>
      Effect.gen(function* () {
        const { database: mockDatabase } = yield* createWaitlistDatabaseFixture(
          {
            insertFailure: new SqlError({
              reason: new UniqueViolation({
                cause: new Error('duplicate active registration'),
                constraint: activeEventRegistrationUniqueIndexName,
              }),
            }),
            option: {
              ...approvedRegistrationOption,
              confirmedSpots: 10,
              organizingRegistration: false,
              roleIds: [],
            },
          },
        );

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
        expect(error.message).toBe('You are already signed up for this event.');
      }),
  );

  it.effect(
    'locks current eligibility without charging waitlists against the active limit',
    () =>
      Effect.gen(function* () {
        const {
          database: mockDatabase,
          insertWaitlistRegistration,
          lockMembership,
          selectRegistrationState,
          updateWaitlistCounter,
        } = yield* createWaitlistDatabaseFixture({
          option: {
            ...approvedRegistrationOption,
            confirmedSpots: 10,
            organizingRegistration: false,
            roleIds: [],
          },
        });

        yield* EventRegistrationService.joinWaitlist({
          eventId: 'event-1',
          registrationOptionId: 'option-1',
          tenant: { id: 'tenant-1' },
          user: { id: 'user-1', roleIds: [] },
        }).pipe(
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(Layer.succeed(Database, mockDatabase)),
          Effect.provide(configProviderLayer),
        );
        expect(lockMembership).toHaveBeenCalledOnce();
        expect(selectRegistrationState).toHaveBeenCalledTimes(3);
        expect(updateWaitlistCounter).toHaveBeenCalledOnce();
        expect(insertWaitlistRegistration).toHaveBeenCalledOnce();
      }),
  );

  it.effect('rejects waitlist joining while capacity remains', () =>
    Effect.gen(function* () {
      const { database: mockDatabase } = yield* createWaitlistDatabaseFixture({
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
        'Places are still available, so you can sign up now instead.',
      );
    }),
  );

  it.effect('rejects waitlist joining for organizer/helper options', () =>
    Effect.gen(function* () {
      const { database: mockDatabase } = yield* createWaitlistDatabaseFixture({
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
        'Only attendee sign-up choices can have a waitlist.',
      );
    }),
  );

  it.effect('explains when a sign-up choice has no waitlist', () =>
    Effect.gen(function* () {
      const { database: mockDatabase } = yield* createWaitlistDatabaseFixture({
        option: {
          ...approvedRegistrationOption,
          confirmedSpots: 10,
          registrationMode: 'application',
        },
      });

      const error = yield* EventRegistrationService.joinWaitlist({
        eventId: 'event-1',
        registrationOptionId: 'option-1',
        tenant: { id: 'tenant-1' },
        user: { id: 'user-1', roleIds: ['role-1'] },
      }).pipe(
        Effect.flip,
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(Layer.succeed(Database, mockDatabase)),
        Effect.provide(configProviderLayer),
      );

      expect(error).toBeInstanceOf(EventRegistrationConflictError);
      expect(error.message).toBe(
        'This sign-up choice does not have a waitlist.',
      );
    }),
  );
  it.effect(
    'saves a direct registration answer with its complete question and registration owner tuple',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createReservationDatabaseFixture({
          communicationEmail: 'alice@example.com',
          option: {
            ...approvedRegistrationOption,
            questions: [{ id: 'question-1', required: true }],
          },
          steps: [
            ...reservationInitialReadSteps,
            'readActiveRegistration',
            'reserveCapacity',
            'insertRegistration',
            'insertAnswers',
            ...reservationFreeConfirmationSteps,
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
    'saves a waitlist answer with its complete question and registration owner tuple',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createWaitlistDatabaseFixture({
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
            registrationId: fixture.registrationId,
            registrationOptionId: 'option-1',
            tenantId: 'tenant-1',
          },
        ]);
        expect(fixture.transactionCommands).toEqual(['BEGIN', 'COMMIT']);
      }),
  );
});

describe('retained registration input bounds', () => {
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
  it('bounds implicit included add-on types even with no submitted selections', () => {
    const availableAddOns = Array.from(
      { length: MAX_EVENT_ADDON_TYPES + 1 },
      (_, index) => ({
        ...availableAddOn,
        addOnId: `included-${index}`,
        includedQuantity: 1,
      }),
    );
    expect(
      validateRegistrationAddons({
        addOns: [],
        availableAddOns: availableAddOns.slice(0, MAX_EVENT_ADDON_TYPES),
      }),
    ).toHaveLength(MAX_EVENT_ADDON_TYPES);
    expect(() =>
      validateRegistrationAddons({ addOns: [], availableAddOns }),
    ).toThrow(EventRegistrationConflictError);
  });

  it('rejects an oversized stored question set even when no answers are required', () => {
    const questions = Array.from(
      { length: MAX_REGISTRATION_QUESTIONS + 1 },
      (_, index) => ({ id: `question-${index}`, required: false }),
    );
    expect(
      validateRegistrationQuestionAnswers({
        answers: [],
        questions: questions.slice(0, MAX_REGISTRATION_QUESTIONS),
      }),
    ).toEqual([]);
    expect(() =>
      validateRegistrationQuestionAnswers({ answers: [], questions }),
    ).toThrow(EventRegistrationConflictError);
  });

  it('accepts the answer count and raw text caps and rejects their overflow', () => {
    const answers = Array.from(
      { length: MAX_REGISTRATION_QUESTIONS },
      (_, index) => ({
        answer: 'a'.repeat(MAX_REGISTRATION_ANSWER_LENGTH),
        questionId: `question-${index}`,
      }),
    );
    const questions = answers.map(({ questionId }) => ({
      id: questionId,
      required: true,
    }));
    expect(validateRegistrationQuestionAnswers({ answers, questions })).toEqual(
      answers,
    );
    expect(() =>
      validateRegistrationQuestionAnswers({
        answers: [...answers, { answer: 'extra', questionId: 'extra' }],
        questions,
      }),
    ).toThrow('You can answer up to 25 sign-up questions');
    expect(() =>
      validateRegistrationQuestionAnswers({
        answers: [
          {
            answer: ` ${answers[0].answer}`,
            questionId: answers[0].questionId,
          },
        ],
        questions: [questions[0]],
      }),
    ).toThrow('Each answer must be 2000 characters or fewer');
  });
  it('rejects invalid individual quantities before combining repeated add-on selections', () => {
    for (const quantity of [
      -1,
      0.5,
      Infinity,
      NaN,
      MAX_REGISTRATION_ADDON_QUANTITY + 1,
    ]) {
      expect(() =>
        validateRegistrationAddons({
          addOns: [{ addOnId: availableAddOn.addOnId, quantity }],
          availableAddOns: [availableAddOn],
        }),
      ).toThrow('Choose between 0 and 10 of each add-on');
    }
  });
  it.effect(
    'rejects invalid guest quantities before database or payment work',
    () =>
      Effect.gen(function* () {
        const executeValues = vi.fn<SqlConnection.Connection['executeValues']>(
          () =>
            Effect.die(
              new Error(
                'Unexpected database operation for invalid guest count',
              ),
            ),
        );
        const transactionControl = vi.fn(() =>
          Effect.die(
            new Error('Unexpected transaction for invalid guest count'),
          ),
        );
        const boundaryStripeClient = createStripeTestClient();
        for (const guestCount of [
          -1,
          0.5,
          Infinity,
          NaN,
          MAX_REGISTRATION_GUESTS + 1,
        ]) {
          const error = yield* EventRegistrationService.registerForEvent({
            eventId: 'event-1',
            guestCount,
            registrationOptionId: 'option-1',
            tenant: {
              ...tenantPublicOrigin,
              currency: 'EUR',
              id: 'tenant-1',
              name: 'Tenant',
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
            Effect.provide(
              createRegistrationDatabaseTestLayer({
                executeValues,
                transactionControl,
              }),
            ),
            Effect.provideService(StripeClient, boundaryStripeClient),
            Effect.provide(configProviderLayer),
          );
          expect(error).toMatchObject({
            _tag: 'EventRegistrationConflictError',
            message: 'Choose between 0 and 10 guests',
          });
        }
        expect(executeValues).not.toHaveBeenCalled();
        expect(transactionControl).not.toHaveBeenCalled();
        expect(
          boundaryStripeClient.checkout.sessions.create,
        ).not.toHaveBeenCalled();
      }),
  );
  it('accepts the add-on type cap and rejects cap plus one', () => {
    const availableAddOns = Array.from(
      { length: MAX_EVENT_ADDON_TYPES + 1 },
      (_, index) => ({
        ...availableAddOn,
        addOnId: `addon-${index}`,
        includedQuantity: 0,
      }),
    );
    const addOns = availableAddOns.map(({ addOnId }) => ({
      addOnId,
      quantity: 1,
    }));
    expect(
      validateRegistrationAddons({
        addOns: addOns.slice(0, MAX_EVENT_ADDON_TYPES),
        availableAddOns: availableAddOns.slice(0, MAX_EVENT_ADDON_TYPES),
      }),
    ).toHaveLength(MAX_EVENT_ADDON_TYPES);
    expect(() =>
      validateRegistrationAddons({ addOns, availableAddOns }),
    ).toThrow('Choose no more than 20 different add-ons');
  });
  it.effect(
    'accepts the guest cap and reserves the participant plus all guests',
    () =>
      Effect.gen(function* () {
        const fixture = yield* createReservationDatabaseFixture({
          communicationEmail: 'alice@example.com',
          guestCount: MAX_REGISTRATION_GUESTS,
          option: {
            ...approvedRegistrationOption,
            spots: MAX_REGISTRATION_GUESTS + 1,
          },
          steps: [
            ...reservationInitialReadSteps,
            'readActiveRegistration',
            'reserveCapacity',
            'insertRegistration',
            ...reservationFreeConfirmationSteps,
          ],
        });

        const program = EventRegistrationService.registerForEvent({
          eventId: 'event-1',
          guestCount: MAX_REGISTRATION_GUESTS,
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
            guestCount: MAX_REGISTRATION_GUESTS,
            status: 'CONFIRMED',
          }),
        );
        expect(insertedAcquisition).toEqual(
          expect.objectContaining({
            kind: 'initial',
            operationKey: `registration-initial:${fixture.registrationId}`,
            ordinal: 0,
            ownerUserId: 'user-1',
            spotCount: MAX_REGISTRATION_GUESTS + 1,
          }),
        );
        fixture.expectComplete();
      }),
  );
  it('accepts the combined item cap and rejects one more included or selected item', () => {
    const addOn = {
      ...availableAddOn,
      includedQuantity: 2,
      maxQuantityPerUser: MAX_REGISTRATION_ADDON_QUANTITY,
      optionalPurchaseQuantity: MAX_REGISTRATION_ADDON_QUANTITY - 2,
      totalAvailableQuantity: 30,
    };
    const addOns = [
      {
        addOnId: addOn.addOnId,
        quantity: MAX_REGISTRATION_ADDON_QUANTITY - addOn.includedQuantity,
      },
    ];
    expect(
      validateRegistrationAddons({ addOns, availableAddOns: [addOn] }),
    ).toMatchObject([
      {
        fulfilledQuantity: MAX_REGISTRATION_ADDON_QUANTITY,
        selectedQuantity: MAX_REGISTRATION_ADDON_QUANTITY - 2,
      },
    ]);
    expect(() =>
      validateRegistrationAddons({
        addOns: [
          { ...addOns[0], quantity: MAX_REGISTRATION_ADDON_QUANTITY - 1 },
        ],
        availableAddOns: [addOn],
      }),
    ).toThrow('Add-on quantity exceeds this registration option limit');
  });

  it.each([
    { includedQuantity: 1, optionalPurchaseQuantity: 10 },
    { includedQuantity: 0, optionalPurchaseQuantity: 11 },
  ])(
    'rejects an oversized stored mapping before selecting any quantity: %j',
    (mapping) => {
      expect(() =>
        validateRegistrationAddons({
          addOns: [],
          availableAddOns: [
            {
              ...availableAddOn,
              ...mapping,
              maxQuantityPerUser: MAX_REGISTRATION_ADDON_QUANTITY,
              totalAvailableQuantity: 30,
            },
          ],
        }),
      ).toThrow(EventRegistrationConflictError);
    },
  );

  it('accepts the stored combined quantity boundary with no optional selections', () => {
    expect(
      validateRegistrationAddons({
        addOns: [],
        availableAddOns: [
          {
            ...availableAddOn,
            includedQuantity: 1,
            maxQuantityPerUser: MAX_REGISTRATION_ADDON_QUANTITY,
            optionalPurchaseQuantity: MAX_REGISTRATION_ADDON_QUANTITY - 1,
            totalAvailableQuantity: 30,
          },
        ],
      }),
    ).toMatchObject([{ fulfilledQuantity: 1, selectedQuantity: 0 }]);
  });
});
