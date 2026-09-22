import Stripe from 'stripe';

const fixtureCreatedAt = 1_900_000_000;
const fixtureAmount = 2500;
const fixtureCurrency = 'eur';
const fixturePaymentIntentId = 'pi_fixture';
const fixtureChargeId = 'ch_fixture';
const fixtureBalanceTransactionId = 'txn_fixture';

const responseMetadata = (
  id: string,
): Stripe.Response<Stripe.Checkout.Session>['lastResponse'] => ({
  headers: {},
  requestId: `req_${id}`,
  statusCode: 200,
});

export const stripeBalanceTransactionResponse = (
  overrides: Partial<Stripe.BalanceTransaction> = {},
): Stripe.Response<Stripe.BalanceTransaction> => {
  const amount = overrides.amount ?? fixtureAmount;
  const currency = overrides.currency ?? fixtureCurrency;
  const fee = overrides.fee ?? 0;
  const base: Stripe.BalanceTransaction = {
    amount,
    available_on: fixtureCreatedAt,
    balance_type: 'payments',
    created: fixtureCreatedAt,
    currency,
    description: null,
    exchange_rate: null,
    fee,
    fee_details:
      fee === 0
        ? []
        : [
            {
              amount: fee,
              application: null,
              currency,
              description: null,
              type: 'stripe_fee',
            },
          ],
    id: fixtureBalanceTransactionId,
    net: amount - fee,
    object: 'balance_transaction',
    reporting_category: 'charge',
    source: fixtureChargeId,
    status: 'available',
    type: 'charge',
  };
  const transaction = { ...base, ...overrides };
  return { ...transaction, lastResponse: responseMetadata(transaction.id) };
};

export const stripeChargeResponse = (
  overrides: Partial<Stripe.Charge> = {},
): Stripe.Response<Stripe.Charge> => {
  const amount = overrides.amount ?? fixtureAmount;
  const currency = overrides.currency ?? fixtureCurrency;
  const id = overrides.id ?? fixtureChargeId;
  const base: Stripe.Charge = {
    amount,
    amount_captured: amount,
    amount_refunded: 0,
    application: null,
    application_fee: null,
    application_fee_amount: null,
    balance_transaction: stripeBalanceTransactionResponse({
      amount,
      currency,
      source: id,
    }),
    billing_details: {
      address: null,
      email: null,
      name: null,
      phone: null,
      tax_id: null,
    },
    calculated_statement_descriptor: null,
    captured: true,
    created: fixtureCreatedAt,
    currency,
    customer: null,
    description: null,
    disputed: false,
    failure_balance_transaction: null,
    failure_code: null,
    failure_message: null,
    fraud_details: null,
    id,
    livemode: false,
    metadata: {},
    object: 'charge',
    on_behalf_of: null,
    outcome: null,
    paid: true,
    payment_intent: fixturePaymentIntentId,
    payment_method: null,
    payment_method_details: null,
    receipt_email: null,
    receipt_number: null,
    receipt_url: null,
    refunded: false,
    review: null,
    shipping: null,
    source: null,
    source_transfer: null,
    statement_descriptor: null,
    statement_descriptor_suffix: null,
    status: 'succeeded',
    transfer_data: null,
    transfer_group: null,
  };
  const charge = { ...base, ...overrides };
  return { ...charge, lastResponse: responseMetadata(charge.id) };
};

export const stripePaymentIntentResponse = (
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.Response<Stripe.PaymentIntent> => {
  const amount = overrides.amount ?? fixtureAmount;
  const base: Stripe.PaymentIntent = {
    allowed_payment_method_types: ['card'],
    amount,
    amount_capturable: 0,
    amount_received: amount,
    application: null,
    application_fee_amount: null,
    automatic_payment_methods: null,
    canceled_at: null,
    cancellation_reason: null,
    capture_method: 'automatic',
    client_secret: null,
    confirmation_method: 'automatic',
    created: fixtureCreatedAt,
    currency: fixtureCurrency,
    customer: null,
    customer_account: null,
    description: null,
    excluded_payment_method_types: null,
    id: fixturePaymentIntentId,
    last_payment_error: null,
    latest_charge: fixtureChargeId,
    livemode: false,
    managed_payments: null,
    metadata: {},
    next_action: null,
    object: 'payment_intent',
    on_behalf_of: null,
    payment_method: null,
    payment_method_configuration_details: null,
    payment_method_options: null,
    payment_method_types: ['card'],
    processing: null,
    receipt_email: null,
    review: null,
    setup_future_usage: null,
    shipping: null,
    source: null,
    statement_descriptor: null,
    statement_descriptor_suffix: null,
    status: 'succeeded',
    transfer_group: null,
  };
  const paymentIntent = { ...base, ...overrides };
  return { ...paymentIntent, lastResponse: responseMetadata(paymentIntent.id) };
};

export const stripeCheckoutSessionResponse = (
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Response<Stripe.Checkout.Session> => {
  const id = overrides.id ?? 'cs_fixture';
  const base: Stripe.Checkout.Session = {
    adaptive_pricing: null,
    after_expiration: null,
    allow_promotion_codes: null,
    amount_subtotal: fixtureAmount,
    amount_total: fixtureAmount,
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
    created: fixtureCreatedAt,
    currency: fixtureCurrency,
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
    expires_at: fixtureCreatedAt + 1800,
    id,
    integration_identifier: null,
    invoice: null,
    invoice_creation: null,
    livemode: false,
    locale: null,
    managed_payments: null,
    metadata: {},
    mode: 'payment',
    object: 'checkout.session',
    origin_context: null,
    payment_intent: fixturePaymentIntentId,
    payment_link: null,
    payment_method_collection: null,
    payment_method_configuration_details: null,
    payment_method_options: null,
    payment_method_types: ['card'],
    payment_status: 'paid',
    permissions: null,
    recovered_from: null,
    saved_payment_method_options: null,
    setup_intent: null,
    shipping_address_collection: null,
    shipping_cost: null,
    shipping_options: [],
    status: 'complete',
    submit_type: null,
    subscription: null,
    success_url: null,
    total_details: null,
    ui_mode: 'hosted_page',
    url: `https://checkout.stripe.com/c/pay/${id}`,
    wallet_options: null,
  };
  const session = { ...base, ...overrides };
  return { ...session, lastResponse: responseMetadata(session.id) };
};

export const stripeRefundResponse = (
  overrides: Partial<Stripe.Refund> = {},
): Stripe.Response<Stripe.Refund> => {
  const base: Stripe.Refund = {
    amount: fixtureAmount,
    balance_transaction: null,
    charge: fixtureChargeId,
    created: fixtureCreatedAt,
    currency: fixtureCurrency,
    customer: null,
    customer_account: null,
    id: 're_fixture',
    metadata: {},
    object: 'refund',
    payment_intent: fixturePaymentIntentId,
    payment_method: null,
    reason: null,
    receipt_number: null,
    source_transfer_reversal: null,
    status: 'succeeded',
    transfer_reversal: null,
  };
  const refund = { ...base, ...overrides };
  return { ...refund, lastResponse: responseMetadata(refund.id) };
};

class RejectingStripeHttpClient extends Stripe.HttpClient {
  override getClientName() {
    return 'evorto-rejecting-stripe-fixture';
  }

  override makeRequest() {
    return Promise.reject(new Error('Unexpected unmocked Stripe request'));
  }
}

export const createRejectingStripeClient = (): Stripe =>
  new Stripe('sk_test_fixture', {
    httpClient: new RejectingStripeHttpClient(),
    maxNetworkRetries: 0,
  });

export const stripeTaxRateFixture = (
  overrides: Partial<Stripe.TaxRate> = {},
): Stripe.TaxRate => ({
  active: true,
  country: 'DE',
  created: fixtureCreatedAt,
  description: null,
  display_name: 'VAT',
  effective_percentage: 0,
  flat_amount: null,
  id: 'txr_fixture_zero',
  inclusive: true,
  jurisdiction: null,
  jurisdiction_level: null,
  livemode: false,
  metadata: {},
  object: 'tax_rate',
  percentage: 0,
  rate_type: 'percentage',
  state: null,
  tax_type: 'vat',
  ...overrides,
});

export const stripeLineItemFixture = (
  overrides: Partial<Stripe.LineItem> = {},
): Stripe.LineItem => ({
  adjustable_quantity: null,
  amount_discount: 0,
  amount_subtotal: 1000,
  amount_tax: 0,
  amount_total: 1000,
  currency: 'eur',
  description: 'Registration',
  discounts: [],
  id: 'li_fixture',
  metadata: null,
  object: 'item',
  price: {
    active: true,
    billing_scheme: 'per_unit',
    created: fixtureCreatedAt,
    currency: 'eur',
    custom_unit_amount: null,
    id: 'price_fixture',
    livemode: false,
    lookup_key: null,
    metadata: {},
    nickname: null,
    object: 'price',
    product: 'prod_fixture',
    recurring: null,
    tax_behavior: 'inclusive',
    tiers_mode: null,
    transform_quantity: null,
    type: 'one_time',
    unit_amount: 1000,
    unit_amount_decimal: Stripe.Decimal.from('1000'),
  },
  quantity: 1,
  taxes: [
    {
      amount: 0,
      rate: stripeTaxRateFixture(),
      taxability_reason: 'zero_rated',
      taxable_amount: 1000,
    },
  ],
  ...overrides,
});
