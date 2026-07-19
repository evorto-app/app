import { describe, expect, it, vi } from '@effect/vitest';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Cause, ConfigProvider, Effect, Layer, Schema } from 'effect';
import { SqlError, UniqueViolation } from 'effect/unstable/sql/SqlError';
import Stripe from 'stripe';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  activeEventRegistrationUniqueIndexName,
  emailOutbox,
  eventAddons,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  registrationAcquisitionComponents,
  registrationAcquisitions,
  RegistrationCheckoutSnapshotSchema,
  tenants,
  tenantStripeTaxRates,
  transactions,
  usersToTenants,
} from '../../../../../db/schema';
import { StripeClient } from '../../../../stripe-client';
import {
  type ApproveManualRegistrationArguments,
  decodeRegistrationCheckoutSnapshot,
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
} from './events.errors';

const createStripeTestClient = (): Stripe => {
  const client = new Stripe('sk_test_123');
  vi.spyOn(client.checkout.sessions, 'create').mockRejectedValue(
    new Error('Unexpected unmocked Stripe Checkout create request'),
  );
  vi.spyOn(client.checkout.sessions, 'expire').mockRejectedValue(
    new Error('Unexpected unmocked Stripe Checkout expire request'),
  );
  return client;
};

const stripeClient = createStripeTestClient();
const tenantPublicOrigin = {
  domain: 'tenant.example.com',
} as const;
const selectLockedTenantMembership = () => ({
  from: (table: unknown) => ({
    where: () =>
      table === registrationAcquisitions
        ? {
            orderBy: () => ({
              for: () => Effect.succeed([]),
            }),
          }
        : {
            for: () => Effect.succeed([{ id: 'tenant-user-1' }]),
          },
  }),
});
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
  }).database;

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
  }).database;

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

const emptyRegistrationAddonSelect = () => ({
  from: (table: unknown) => {
    if (table !== eventAddons) {
      throw new Error('Unexpected registration add-on select table');
    }
    return {
      innerJoin: () => ({
        leftJoin: () => ({
          where: () => Effect.succeed([]),
        }),
      }),
    };
  },
});

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
  existingClaim = null,
  lockedStripeAccountId = 'acct_123',
  operationOrder = [],
  persistCommittedEmail = true,
  registration = paidManualApprovalRegistration,
  registrationStatuses = ['PENDING'],
}: {
  bindingCommitAmbiguous?: boolean;
  bindingSucceeds?: boolean;
  existingClaim?: ManualApprovalClaim | null;
  lockedStripeAccountId?: null | string;
  operationOrder?: string[];
  persistCommittedEmail?: boolean;
  registration?:
    | typeof freeManualApprovalRegistration
    | typeof paidManualApprovalRegistration;
  registrationStatuses?: readonly ('CANCELLED' | 'PENDING')[];
} = {}) => {
  let bindingUpdateCount = 0;
  let acquisitionComponentInsertValues: unknown;
  let acquisitionInsertValues: unknown;
  let claim: ManualApprovalClaim | null = existingClaim;
  let claimExecutiveUserId: null | string | undefined;
  let claimInsertValues: Record<string, unknown> | undefined;
  let claimInsertCount = 0;
  let emailInsertCount = 0;
  const emailKinds: string[] = [];
  let reservationUpdateCount = 0;
  let registrationLockCount = 0;
  let transactionCount = 0;
  let persistedEmail = false;

  const createTransaction = (binding: boolean) => {
    let transactionSelectCount = 0;

    return {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          if (table === transactions) {
            return {
              onConflictDoNothing: () => ({
                returning: () => {
                  claimInsertCount += 1;
                  operationOrder.push('claim');
                  claimInsertValues = values;
                  claimExecutiveUserId = Schema.decodeUnknownSync(
                    Schema.NullOr(Schema.String),
                  )(values['executiveUserId']);
                  claim = {
                    appFee: Schema.decodeUnknownSync(
                      Schema.NullOr(Schema.Number),
                    )(values['appFee']),
                    currency: Schema.decodeUnknownSync(
                      transactionCurrencySchema,
                    )(values['currency']),
                    id: Schema.decodeUnknownSync(Schema.String)(values['id']),
                    stripeAccountId: Schema.decodeUnknownSync(
                      Schema.NullOr(Schema.String),
                    )(values['stripeAccountId']),
                    stripeCheckoutRequest: Schema.decodeUnknownSync(
                      Schema.NullOr(RegistrationCheckoutSnapshotSchema),
                    )(values['stripeCheckoutRequest']),
                    stripeCheckoutSessionId: null,
                    stripeCheckoutUrl: null,
                  };
                  return Effect.succeed([claim]);
                },
              }),
            };
          }

          if (table === emailOutbox) {
            return {
              onConflictDoNothing: () => {
                emailInsertCount += 1;
                persistedEmail = persistCommittedEmail;
                emailKinds.push(
                  Schema.decodeUnknownSync(Schema.String)(values['kind']),
                );
                operationOrder.push('email');
                return Effect.succeed([]);
              },
            };
          }

          if (
            table === registrationAcquisitions ||
            table === registrationAcquisitionComponents
          ) {
            if (table === registrationAcquisitions) {
              acquisitionInsertValues = values;
            } else {
              acquisitionComponentInsertValues = values;
            }
            return Effect.void;
          }

          throw new Error('Unexpected manual approval insert table');
        },
      }),
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === eventRegistrations) {
              const status =
                registrationStatuses[
                  Math.min(
                    registrationLockCount,
                    registrationStatuses.length - 1,
                  )
                ] ?? 'PENDING';
              registrationLockCount += 1;
              return {
                for: () => Effect.succeed([{ status }]),
              };
            }

            if (table === tenants) {
              return {
                for: () =>
                  Effect.succeed([{ stripeAccountId: lockedStripeAccountId }]),
              };
            }

            if (table === emailOutbox) {
              return {
                for: () =>
                  Effect.succeed(persistedEmail ? [{ id: 'email-1' }] : []),
              };
            }

            if (table === eventRegistrationAddonPurchaseLots) {
              return {
                for: () => Effect.succeed([]),
              };
            }

            if (table === eventRegistrationOptions) {
              return {
                for: () =>
                  Effect.succeed([
                    {
                      stripeTaxRateId:
                        registration.registrationOption.stripeTaxRateId,
                    },
                  ]),
              };
            }

            if (table === tenantStripeTaxRates) {
              return {
                orderBy: () => ({
                  for: () =>
                    Effect.succeed([
                      {
                        displayName: 'VAT',
                        inclusive: true,
                        percentage: '19',
                        stripeTaxRateId: 'txr_19',
                      },
                    ]),
                }),
              };
            }

            if (table === registrationAcquisitions) {
              return {
                orderBy: () => ({
                  for: () => Effect.succeed([]),
                }),
              };
            }

            if (table !== transactions) {
              throw new Error('Unexpected manual approval select table');
            }

            transactionSelectCount += 1;
            const claimRows = claim
              ? [
                  {
                    ...claim,
                    method: 'stripe' as const,
                    status: 'pending' as const,
                    stripeCheckoutCancellationRequestedAt: null,
                    type: 'registration' as const,
                  },
                ]
              : [];
            if (binding || transactionSelectCount === 1) {
              return {
                for: () => Effect.succeed(claimRows),
              };
            }
            return Effect.succeed(claimRows);
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: () =>
            table === eventRegistrationAddonPurchaseLots
              ? Effect.void
              : {
                  returning: () => {
                    if (table === eventRegistrationOptions) {
                      reservationUpdateCount += 1;
                      operationOrder.push(
                        reservationUpdateCount === 1
                          ? 'reserve'
                          : 'release-capacity',
                      );
                      return Effect.succeed([{ id: 'option-1' }]);
                    }

                    if (table === eventRegistrations) {
                      operationOrder.push('registration');
                      return Effect.succeed([{ id: 'registration-1' }]);
                    }

                    if (table === transactions && claim) {
                      if (values['status'] === 'cancelled') {
                        operationOrder.push('release-claim');
                        const releasedClaimId = claim.id;
                        claim = null;
                        return Effect.succeed([{ id: releasedClaimId }]);
                      }
                      bindingUpdateCount += 1;
                      operationOrder.push('bind');
                      if (!bindingSucceeds) {
                        return Effect.succeed([]);
                      }
                      claim = {
                        ...claim,
                        stripeCheckoutSessionId: Schema.decodeUnknownSync(
                          Schema.String,
                        )(values['stripeCheckoutSessionId']),
                        stripeCheckoutUrl: Schema.decodeUnknownSync(
                          Schema.String,
                        )(values['stripeCheckoutUrl']),
                      };
                      return Effect.succeed([{ id: claim.id }]);
                    }

                    throw new Error('Unexpected manual approval update table');
                  },
                },
        }),
      }),
    };
  };

  const database = {
    query: {
      eventRegistrations: {
        findFirst: () => Effect.succeed(registration),
      },
      tenantStripeTaxRates: {
        findFirst: () =>
          Effect.succeed({
            active: true,
            displayName: 'VAT',
            inclusive: true,
            percentage: '19',
          }),
      },
      userDiscountCards: {
        findMany: () => Effect.succeed([]),
      },
    },
    transaction: (
      callback: (
        transaction: ReturnType<typeof createTransaction>,
      ) => Effect.Effect<unknown, unknown, unknown>,
    ) => {
      transactionCount += 1;
      const result = callback(createTransaction(transactionCount > 1));
      return bindingCommitAmbiguous && transactionCount === 2
        ? result.pipe(
            Effect.andThen(
              Effect.die(new Error('binding commit acknowledgement lost')),
            ),
          )
        : result;
    },
  };

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
    reservationUpdateCount: () => reservationUpdateCount,
  };
};

const runManualApproval = ({
  database,
  executiveUserId = 'organizer-1',
  onApproved,
  stripe,
  stripeAccountId = 'acct_123',
}: {
  database: object;
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
    Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
    Effect.provideService(StripeClient, stripe),
    Effect.provide(configProviderLayer),
  );

const createDirectCheckoutDatabase = ({
  bindingSucceeds = true,
  configuredStripeTaxRateId = 'txr_19',
  lockedStripeAccountId = 'acct_123',
  operationOrder = [],
  registrationOption = {},
}: {
  bindingSucceeds?: boolean;
  configuredStripeTaxRateId?: string;
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
  let bindingUpdateCount = 0;
  let claim: ManualApprovalClaim | null = null;
  let claimInsertCount = 0;
  let registration:
    | undefined
    | {
        guestCount: number;
        id: string;
        registrationOptionId: string;
        status: 'CANCELLED' | 'CONFIRMED' | 'PENDING';
      };
  let reservationUpdateCount = 0;

  const transaction = (
    callback: (tx: {
      insert: (table: unknown) => {
        values: (values: Record<string, unknown>) => {
          onConflictDoNothing?: () => Effect.Effect<void>;
          returning?: (
            selection?: unknown,
          ) => Effect.Effect<ManualApprovalClaim[] | { id: string }[]>;
        };
      };
      query: {
        eventRegistrations: {
          findMany: () => Effect.Effect<[]>;
        };
      };
      select: () => {
        from: (table: unknown) => {
          where: () => {
            for: () => Effect.Effect<unknown[]>;
          };
        };
      };
      update: (table: unknown) => {
        set: (values: Record<string, unknown>) => {
          where: () => {
            returning: () => Effect.Effect<{ id: string }[]>;
          };
        };
      };
    }) => Effect.Effect<unknown, unknown>,
  ) =>
    callback({
      insert: (table) => ({
        values: (values) => {
          if (table === eventRegistrations) {
            return {
              returning: () => {
                const status = Schema.decodeUnknownSync(
                  Schema.Literals(['CONFIRMED', 'PENDING']),
                )(values['status']);
                operationOrder.push(
                  status === 'CONFIRMED'
                    ? 'confirm-registration'
                    : 'registration',
                );
                registration = {
                  guestCount: Schema.decodeUnknownSync(Schema.Number)(
                    values['guestCount'],
                  ),
                  id: 'registration-direct',
                  registrationOptionId: 'option-1',
                  status,
                };
                return Effect.succeed([{ id: registration.id }]);
              },
            };
          }
          if (table === transactions) {
            return {
              returning: () => {
                claimInsertCount += 1;
                operationOrder.push('claim');
                claim = {
                  appFee: Schema.decodeUnknownSync(
                    Schema.NullOr(Schema.Number),
                  )(values['appFee']),
                  currency: Schema.decodeUnknownSync(transactionCurrencySchema)(
                    values['currency'],
                  ),
                  id: Schema.decodeUnknownSync(Schema.String)(values['id']),
                  stripeAccountId: Schema.decodeUnknownSync(
                    Schema.NullOr(Schema.String),
                  )(values['stripeAccountId']),
                  stripeCheckoutRequest: Schema.decodeUnknownSync(
                    Schema.NullOr(RegistrationCheckoutSnapshotSchema),
                  )(values['stripeCheckoutRequest']),
                  stripeCheckoutSessionId: null,
                  stripeCheckoutUrl: null,
                };
                return Effect.succeed([claim]);
              },
            };
          }
          if (table === emailOutbox) {
            return {
              onConflictDoNothing: () => Effect.void,
            };
          }
          if (
            table === registrationAcquisitions ||
            table === registrationAcquisitionComponents
          ) {
            return Effect.void;
          }
          return {};
        },
      }),
      query: {
        eventRegistrations: {
          findMany: () => Effect.succeed([]),
        },
      },
      select: () => ({
        from: (table) => ({
          where: () =>
            table === registrationAcquisitions
              ? {
                  orderBy: () => ({
                    for: () => Effect.succeed([]),
                  }),
                }
              : {
                  for: () => {
                    if (table === usersToTenants) {
                      return Effect.succeed([{ id: 'tenant-user-1' }]);
                    }
                    if (table === tenants) {
                      return Effect.succeed([
                        { stripeAccountId: lockedStripeAccountId },
                      ]);
                    }
                    if (table === eventRegistrationOptions) {
                      return Effect.succeed([
                        {
                          stripeTaxRateId: effectiveStripeTaxRateId,
                        },
                      ]);
                    }
                    if (table === eventRegistrations) {
                      return Effect.succeed(registration ? [registration] : []);
                    }
                    if (table === eventRegistrationAddonPurchases) {
                      return Effect.succeed([]);
                    }
                    if (table === transactions && claim) {
                      return Effect.succeed([
                        {
                          ...claim,
                          method: 'stripe' as const,
                          status: 'pending' as const,
                          stripeCheckoutCancellationRequestedAt: null,
                          type: 'registration' as const,
                        },
                      ]);
                    }
                    return Effect.succeed([]);
                  },
                  orderBy: () => ({
                    for: () =>
                      table === tenantStripeTaxRates
                        ? Effect.succeed([
                            {
                              displayName: 'VAT',
                              inclusive: true,
                              percentage: '19',
                              stripeTaxRateId: configuredStripeTaxRateId,
                            },
                          ])
                        : Effect.succeed([]),
                  }),
                },
        }),
      }),
      update: (table) => ({
        set: (values) => ({
          where: () => ({
            returning: () => {
              if (table === eventRegistrationOptions) {
                reservationUpdateCount += 1;
                operationOrder.push(
                  'confirmedSpots' in values
                    ? 'confirm-capacity'
                    : reservationUpdateCount === 1
                      ? 'reserve'
                      : 'release-capacity',
                );
                return Effect.succeed([{ id: 'option-1' }]);
              }
              if (table === transactions && claim) {
                if (values['status'] === 'cancelled') {
                  operationOrder.push('release-claim');
                  const releasedClaimId = claim.id;
                  claim = null;
                  return Effect.succeed([{ id: releasedClaimId }]);
                }
                bindingUpdateCount += 1;
                operationOrder.push('bind');
                if (!bindingSucceeds) {
                  return Effect.succeed([]);
                }
                claim = {
                  ...claim,
                  stripeCheckoutSessionId: Schema.decodeUnknownSync(
                    Schema.String,
                  )(values['stripeCheckoutSessionId']),
                  stripeCheckoutUrl: Schema.decodeUnknownSync(Schema.String)(
                    values['stripeCheckoutUrl'],
                  ),
                };
                return Effect.succeed([{ id: claim.id }]);
              }
              if (table === eventRegistrations && registration) {
                operationOrder.push('cancel-registration');
                registration = {
                  ...registration,
                  status: 'CANCELLED',
                };
                return Effect.succeed([{ id: registration.id }]);
              }
              if (table === eventAddons) {
                return Effect.succeed([{ id: 'addon-1' }]);
              }
              throw new Error('Unexpected direct checkout update table');
            },
          }),
        }),
      }),
    });

  const database = {
    query: {
      eventRegistrationOptions: {
        findFirst: () =>
          Effect.succeed({
            ...approvedRegistrationOption,
            isPaid: true,
            price: 1000,
            stripeTaxRateId: effectiveStripeTaxRateId,
            ...registrationOption,
          }),
      },
      eventRegistrations: {
        findFirst: () => Effect.succeed(registration),
      },
      tenantStripeTaxRates: {
        findFirst: () =>
          Effect.succeed({
            active: true,
            displayName: 'VAT',
            inclusive: true,
            percentage: '19',
          }),
      },
      userDiscountCards: {
        findMany: () => Effect.succeed([]),
      },
    },
    select: () => ({
      from: (table: unknown) =>
        table === eventAddons
          ? {
              innerJoin: () => ({
                leftJoin: () => ({
                  where: () => Effect.succeed([]),
                }),
              }),
            }
          : {
              where: () =>
                Effect.succeed(table === transactions && claim ? [claim] : []),
            },
    }),
    transaction,
  };

  return {
    bindingUpdateCount: () => bindingUpdateCount,
    claimInsertCount: () => claimInsertCount,
    database,
    getClaim: () => claim,
    operationOrder,
    reservationUpdateCount: () => reservationUpdateCount,
  };
};

const runDirectCheckout = ({
  database,
  stripe,
  stripeAccountId = 'acct_123',
}: {
  database: object;
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
    Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
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
      taxRates?: readonly {
        displayName: null | string;
        inclusive: boolean;
        percentage: null | string;
        stripeTaxRateId: string;
      }[];
    } = {}) => {
      const lockOrder: string[] = [];
      const select = vi.fn(() => ({
        from: (table: unknown) => ({
          where: () => ({
            for: () => {
              lockOrder.push('option');
              return Effect.succeed([{ stripeTaxRateId: 'txr_registration' }]);
            },
            orderBy: () => ({
              for: () => {
                if (table === eventAddons) {
                  lockOrder.push('addon');
                  return Effect.succeed([
                    {
                      addOnId: 'addon-1',
                      stripeTaxRateId: addOnStripeTaxRateId,
                    },
                  ]);
                }
                if (table === tenantStripeTaxRates) {
                  lockOrder.push('tax-rate');
                  return Effect.succeed(taxRates);
                }
                return Effect.die(
                  new Error('Unexpected tax configuration table'),
                );
              },
            }),
          }),
        }),
      }));
      return { database: { select }, lockOrder, select };
    };

    it.effect(
      'locks the complete graph and returns only current-account tax snapshots',
      () =>
        Effect.gen(function* () {
          const fixture = createDatabase();
          const result = yield* lockCurrentRegistrationTaxConfiguration(
            fixture.database as never,
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
          const fixture = createDatabase({
            addOnStripeTaxRateId: 'txr_replaced',
          });
          const error = yield* lockCurrentRegistrationTaxConfiguration(
            fixture.database as never,
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
          const fixture = createDatabase({ taxRates: [] });
          const error = yield* lockCurrentRegistrationTaxConfiguration(
            fixture.database as never,
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
            type: 'api_connection_error',
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
        const approvalDatabase = createManualApprovalDatabase({
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
        const approvalDatabase = createManualApprovalDatabase();
        const createSession = vi.fn(() => {
          approvalDatabase.operationOrder.push('stripe');
          return Promise.resolve({
            id: 'cs_test_1',
            payment_intent: null,
            url: 'https://checkout.stripe.test/session',
          });
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
        const database = createPaidManualApprovalDatabase({
          operationOrder,
          registrationStatuses: ['PENDING', 'CANCELLED'],
        });
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.fn(() => {
          operationOrder.push('stripe');
          return Promise.resolve({
            id: 'cs_test_1',
            payment_intent: null,
            url: 'https://checkout.stripe.test/session',
          });
        });
        const expireSession = vi.fn(() => {
          operationOrder.push('expire');
          return Promise.resolve({ id: 'cs_test_1', status: 'expired' });
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
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
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
        const database = createPaidManualApprovalDatabase({
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
            return Promise.resolve({
              id: 'cs_test_1',
              payment_intent: null,
              url: 'https://checkout.stripe.test/session',
            });
          }),
        );
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('expire');
            return Promise.resolve({ id: 'cs_test_1', status: 'expired' });
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
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
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
        const database = createPaidManualApprovalDatabase({
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
            return Promise.resolve({
              id: 'cs_test_1',
              payment_intent: null,
              url: 'https://checkout.stripe.test/session',
            });
          }),
        );
        const expireSession = vi.fn(() => {
          operationOrder.push('expire');
          return Promise.resolve({ id: 'cs_test_1', status: 'expired' });
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
            Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
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
        const database = createPaidManualApprovalDatabase({
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
            return Promise.resolve({
              id: 'cs_test_1',
              payment_intent: null,
              url: 'https://checkout.stripe.test/session',
            });
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
            Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
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
        const database = createPaidManualApprovalDatabase({
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
            return Promise.resolve({
              id: 'cs_test_1',
              payment_intent: null,
              url: 'https://checkout.stripe.test/session',
            });
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
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
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
        const database = createPaidManualApprovalDatabase({ operationOrder });
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
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
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
        const database = createPaidManualApprovalDatabase({ operationOrder });
        const checkoutStripeClient = createStripeTestClient();
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn((parameters: Stripe.Checkout.SessionCreateParams) => {
            operationOrder.push('stripe');
            expect(parameters.expires_at).toBeGreaterThanOrEqual(
              Math.floor(Date.now() / 1000) + 30 * 60,
            );
            return Promise.reject(
              new Stripe.errors.StripeConnectionError({
                message: 'connection reset after request',
                type: 'api_connection_error',
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
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
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
        const database = createPaidDirectRegistrationDatabase({
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
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
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
        const database = createPaidDirectRegistrationDatabase({
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
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
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
        const database = createPaidDirectRegistrationDatabase({
          bindingSucceeds: true,
          operationOrder,
        });
        const checkoutStripeClient = createStripeTestClient();
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'create',
        ).mockImplementation(
          vi.fn((parameters: Stripe.Checkout.SessionCreateParams) => {
            operationOrder.push('stripe');
            expect(parameters.expires_at).toBeGreaterThanOrEqual(
              Math.floor(Date.now() / 1000) + 30 * 60,
            );
            return Promise.reject(
              new Stripe.errors.StripeConnectionError({
                message: 'connection reset after request',
                type: 'api_connection_error',
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
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
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
        const database = createPaidDirectRegistrationDatabase({
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
            return Promise.resolve({
              id: 'cs_direct_1',
              payment_intent: null,
              url: 'https://checkout.stripe.test/direct',
            });
          }),
        );
        vi.spyOn(
          checkoutStripeClient.checkout.sessions,
          'expire',
        ).mockImplementation(
          vi.fn(() => {
            operationOrder.push('expire');
            return Promise.resolve({
              id: 'cs_direct_1',
              status: 'expired',
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
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
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
        const database = createPaidDirectRegistrationDatabase({
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
            return Promise.resolve({
              id: 'cs_direct_1',
              payment_intent: null,
              url: 'https://checkout.stripe.test/direct',
            });
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
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
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
        const findRegistration = vi.fn(() => Effect.succeed(null));
        const mockDatabase = {
          query: {
            eventRegistrations: {
              findFirst: findRegistration,
            },
          },
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
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
        const findRegistrationOption = vi.fn(() => Effect.succeed(null));
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: findRegistrationOption,
            },
            eventRegistrations: {
              findFirst: () =>
                Effect.succeed({
                  id: 'existing-registration',
                }),
            },
          },
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
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
        const findRegistrationOption = vi.fn(() => Effect.succeed(null));
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: findRegistrationOption,
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
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
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                event: {
                  ...approvedRegistrationOption.event,
                  status: 'DRAFT',
                },
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () =>
                Effect.succeed({
                  ...approvedRegistrationOption,
                  openRegistrationTime: new Date('2026-09-20T10:00:00.000Z'),
                }),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
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
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () => Effect.succeed(approvedRegistrationOption),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                event: {
                  ...approvedRegistrationOption.event,
                  tenantId: 'tenant-2',
                },
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                confirmedSpots: 8,
                reservedSpots: 2,
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
        let insertedAcquisition: unknown;
        let insertedRegistration: unknown;
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () => Effect.succeed(approvedRegistrationOption),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          select: emptyRegistrationAddonSelect,
          transaction: (
            callback: (tx: {
              insert: (table: unknown) => {
                values: (value: unknown) => {
                  onConflictDoNothing?: () => Effect.Effect<[]>;
                  returning?: () => Effect.Effect<{ id: string }[]>;
                };
              };
              query: {
                eventRegistrations: {
                  findMany: () => Effect.Effect<[]>;
                };
              };
              select: typeof selectLockedTenantMembership;
              update: () => {
                set: () => {
                  where: () => {
                    returning: () => Effect.Effect<{ id: string }[]>;
                  };
                };
              };
            }) => Effect.Effect<unknown>,
          ) =>
            callback({
              insert: (table) => ({
                values: (value) => {
                  if (table === emailOutbox) {
                    return {
                      onConflictDoNothing: () => Effect.succeed([]),
                    };
                  }
                  if (table === eventRegistrations) {
                    insertedRegistration = value;
                  }
                  if (
                    table === registrationAcquisitions ||
                    table === registrationAcquisitionComponents
                  ) {
                    if (table === registrationAcquisitions) {
                      insertedAcquisition = value;
                    }
                    return Effect.void;
                  }
                  return {
                    returning: () => Effect.succeed([{ id: 'registration-1' }]),
                  };
                },
              }),
              query: {
                eventRegistrations: {
                  findMany: () => Effect.succeed([]),
                },
              },
              select: selectLockedTenantMembership,
              update: () => ({
                set: () => ({
                  where: () => ({
                    returning: () => Effect.succeed([{ id: 'option-1' }]),
                  }),
                }),
              }),
            }),
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        yield* program;
        expect(insertedRegistration).toEqual(
          expect.objectContaining({
            guestCount: 2,
            status: 'CONFIRMED',
          }),
        );
        expect(insertedAcquisition).toEqual(
          expect.objectContaining({
            kind: 'initial',
            operationKey: 'registration-initial:registration-1',
            ordinal: 0,
            ownerUserId: 'user-1',
            spotCount: 3,
          }),
        );
      }),
  );

  it.effect(
    'transactionally enqueues a direct free confirmation to the communication email',
    () =>
      Effect.gen(function* () {
        let emailInsert: Record<string, unknown> | undefined;
        let emailInsertedWhileTransactionOpen = false;
        let transactionOpen = false;
        const operationOrder: string[] = [];
        const findEmailTenant = vi.fn(() =>
          Effect.succeed({
            emailSenderEmail: 'events@tenant.example',
            emailSenderName: 'Events Team',
            id: 'tenant-1',
            name: 'Tenant',
          }),
        );
        const findNotificationUser = vi.fn(() =>
          Effect.succeed({
            communicationEmail: ' preferred@example.com ',
          }),
        );
        const transaction = {
          insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => {
              if (table === eventRegistrations) {
                operationOrder.push('registration');
                return {
                  returning: () =>
                    Effect.succeed([{ id: 'registration-free' }]),
                };
              }
              if (table === emailOutbox) {
                emailInsert = values;
                emailInsertedWhileTransactionOpen = transactionOpen;
                operationOrder.push('email');
                return {
                  onConflictDoNothing: () => Effect.succeed([]),
                };
              }
              if (
                table === registrationAcquisitions ||
                table === registrationAcquisitionComponents
              ) {
                return Effect.void;
              }
              throw new Error('Unexpected direct free insert table');
            },
          }),
          query: {
            eventRegistrations: {
              findMany: () => Effect.succeed([]),
            },
            tenants: {
              findFirst: findEmailTenant,
            },
            users: {
              findFirst: findNotificationUser,
            },
          },
          select: selectLockedTenantMembership,
          update: () => ({
            set: () => ({
              where: () => ({
                returning: () => Effect.succeed([{ id: 'option-1' }]),
              }),
            }),
          }),
        };
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () => Effect.succeed(approvedRegistrationOption),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          select: emptyRegistrationAddonSelect,
          transaction: (
            callback: (
              tx: typeof transaction,
            ) => Effect.Effect<unknown, unknown>,
          ) =>
            Effect.gen(function* () {
              transactionOpen = true;
              const result = yield* callback(transaction);
              transactionOpen = false;
              return result;
            }),
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(findEmailTenant).toHaveBeenCalledOnce();
        expect(findNotificationUser).toHaveBeenCalledOnce();
        expect(emailInsertedWhileTransactionOpen).toBe(true);
        expect(operationOrder).toEqual(['registration', 'email']);
        expect(emailInsert).toEqual(
          expect.objectContaining({
            idempotencyKey: 'registration-confirmed/tenant-1/registration-free',
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
      }),
  );

  it.effect('rejects guest registration when not enough spots remain', () =>
    Effect.gen(function* () {
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                confirmedSpots: 8,
                reservedSpots: 0,
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                organizingRegistration: true,
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
      const updateOptionCounters = vi.fn();
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                registrationMode: 'random',
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
        update: updateOptionCounters,
      };

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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
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
        let insertedRegistration: unknown;
        const updateOptionCounters = vi.fn();
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () =>
                Effect.succeed({
                  ...approvedRegistrationOption,
                  confirmedSpots: 10,
                  registrationMode: 'application',
                  reservedSpots: 0,
                }),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          select: emptyRegistrationAddonSelect,
          transaction: (
            callback: (tx: {
              insert: (table: unknown) => {
                values: (value: unknown) => {
                  returning: () => Effect.Effect<{ id: string }[]>;
                };
              };
              query: {
                eventRegistrations: {
                  findMany: () => Effect.Effect<[]>;
                };
              };
              select: typeof selectLockedTenantMembership;
              update: ReturnType<typeof vi.fn>;
            }) => Effect.Effect<unknown>,
          ) =>
            callback({
              insert: (table) => ({
                values: (value) => {
                  if (table === eventRegistrations) {
                    insertedRegistration = value;
                  }
                  return {
                    returning: () => Effect.succeed([{ id: 'registration-1' }]),
                  };
                },
              }),
              query: {
                eventRegistrations: {
                  findMany: () => Effect.succeed([]),
                },
              },
              select: selectLockedTenantMembership,
              update: updateOptionCounters,
            }),
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        yield* program;
        expect(insertedRegistration).toEqual(
          expect.objectContaining({
            status: 'PENDING',
          }),
        );
        expect(updateOptionCounters).not.toHaveBeenCalled();
      }),
  );

  it.effect('confirms an approved free application without Stripe', () =>
    Effect.gen(function* () {
      const approvalDatabase = createManualApprovalDatabase({
        registration: freeManualApprovalRegistration,
      });
      const checkoutStripeClient = createStripeTestClient();
      const createSession = vi.fn(() =>
        Promise.resolve({
          id: 'cs_test_unexpected',
          payment_intent: null,
          url: 'https://checkout.stripe.test/unexpected',
        }),
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
        const approvalDatabase = createManualApprovalDatabase();
        let auditedTransition: unknown;
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.fn(() => {
          approvalDatabase.operationOrder.push('stripe');
          return Promise.resolve({
            id: 'cs_test_1',
            payment_intent: null,
            url: 'https://checkout.stripe.test/session',
          });
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
        const approvalDatabase = createManualApprovalDatabase({
          existingClaim,
        });
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.fn(() => {
          approvalDatabase.operationOrder.push('stripe');
          return Promise.resolve({
            id: 'cs_test_existing',
            payment_intent: null,
            url: 'https://checkout.stripe.test/existing',
          });
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
        const approvalDatabase = createManualApprovalDatabase();
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
        const directDatabase = createDirectCheckoutDatabase();
        const checkoutStripeClient = createStripeTestClient();
        const createSession = vi.fn(() => {
          directDatabase.operationOrder.push('stripe');
          return Promise.resolve({
            id: 'cs_direct_1',
            payment_intent: 'pi_direct_1',
            url: 'https://checkout.stripe.test/direct',
          } as Stripe.Checkout.Session);
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
        const directDatabase = createDirectCheckoutDatabase({
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
          Promise.resolve({
            id: 'cs_rotated_account',
            payment_intent: 'pi_rotated_account',
            url: 'https://checkout.stripe.test/rotated-account',
          } as Stripe.Checkout.Session),
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
        const directDatabase = createDirectCheckoutDatabase();
        const checkoutStripeClient = createStripeTestClient();
        const stripeCause = new Error('connection reset after request');
        let attempt = 0;
        const createSession = vi.fn(() => {
          directDatabase.operationOrder.push('stripe');
          attempt += 1;
          return attempt === 1
            ? Promise.reject(stripeCause)
            : Promise.resolve({
                id: 'cs_direct_retry',
                payment_intent: 'pi_direct_retry',
                url: 'https://checkout.stripe.test/direct-retry',
              } as Stripe.Checkout.Session);
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
        const uniqueViolation = new EffectDrizzleQueryError({
          cause: Cause.fail(
            new SqlError({
              reason: new UniqueViolation({
                cause: new Error('duplicate active registration'),
                constraint: activeEventRegistrationUniqueIndexName,
              }),
            }),
          ),
          params: [],
          query: 'insert into event_registrations ...',
        });
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () => Effect.succeed(approvedRegistrationOption),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          select: emptyRegistrationAddonSelect,
          transaction: () => Effect.fail(uniqueViolation),
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe('User is already registered for this event');
      }),
  );

  it.effect(
    'rejects new registrations when the tenant active registration limit is reached',
    () =>
      Effect.gen(function* () {
        const updateOptionCounters = vi.fn();
        const lockMembership = vi.fn(() =>
          Effect.succeed([{ id: 'membership-1' }]),
        );
        const selectActiveFutureRegistrations = vi.fn(() => ({
          from: (table: unknown) =>
            table === usersToTenants
              ? {
                  where: () => ({
                    for: lockMembership,
                  }),
                }
              : {
                  innerJoin: () => ({
                    where: () => ({
                      limit: () =>
                        Effect.succeed([
                          {
                            id: 'active-registration-1',
                          },
                        ]),
                    }),
                  }),
                },
        }));
        const transaction = {
          query: {
            eventRegistrations: {
              findMany: () => Effect.succeed([]),
            },
          },
          select: selectActiveFutureRegistrations,
          update: updateOptionCounters,
        };
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () => Effect.succeed(approvedRegistrationOption),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          select: emptyRegistrationAddonSelect,
          transaction: (
            callback: (tx: typeof transaction) => Effect.Effect<unknown>,
          ) => callback(transaction),
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('Active registration limit reached');
        expect(selectActiveFutureRegistrations).toHaveBeenCalled();
        expect(lockMembership).toHaveBeenCalledOnce();
        expect(updateOptionCounters).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rejects when a concurrent registration appears inside the reservation transaction',
    () =>
      Effect.gen(function* () {
        const updateOptionCounters = vi.fn();
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () => Effect.succeed(approvedRegistrationOption),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          select: emptyRegistrationAddonSelect,
          transaction: (
            callback: (tx: {
              query: {
                eventRegistrations: {
                  findMany: () => Effect.Effect<{ id: string }[]>;
                };
              };
              select: typeof selectLockedTenantMembership;
              update: ReturnType<typeof vi.fn>;
            }) => Effect.Effect<unknown>,
          ) =>
            callback({
              query: {
                eventRegistrations: {
                  findMany: () =>
                    Effect.succeed([{ id: 'concurrent-registration' }]),
                },
              },
              select: selectLockedTenantMembership,
              update: updateOptionCounters,
            }),
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('User is already registered for this event');
        expect(updateOptionCounters).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'rejects when the transactional capacity counter update loses the race',
    () =>
      Effect.gen(function* () {
        const insertRegistration = vi.fn();
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () =>
                Effect.succeed({
                  ...approvedRegistrationOption,
                  confirmedSpots: 9,
                  reservedSpots: 0,
                }),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          select: emptyRegistrationAddonSelect,
          transaction: (
            callback: (tx: {
              insert: ReturnType<typeof vi.fn>;
              query: {
                eventRegistrations: {
                  findMany: () => Effect.Effect<[]>;
                };
              };
              select: typeof selectLockedTenantMembership;
              update: () => {
                set: () => {
                  where: () => {
                    returning: () => Effect.Effect<[]>;
                  };
                };
              };
            }) => Effect.Effect<unknown>,
          ) =>
            callback({
              insert: insertRegistration,
              query: {
                eventRegistrations: {
                  findMany: () => Effect.succeed([]),
                },
              },
              select: selectLockedTenantMembership,
              update: () => ({
                set: () => ({
                  where: () => ({
                    returning: () => Effect.succeed([]),
                  }),
                }),
              }),
            }),
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe(
          'Registration option has no available spots',
        );
        expect(insertRegistration).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'persists the configured add-on attachment quantity for a selected add-on',
    () =>
      Effect.gen(function* () {
        const insertAddonLot = vi.fn();
        const insertAddonPurchase = vi.fn();
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () => Effect.succeed(approvedRegistrationOption),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          select: () => ({
            from: () => ({
              innerJoin: () => ({
                leftJoin: () => ({
                  where: () =>
                    Effect.succeed([
                      {
                        addOnId: 'addon-1',
                        allowMultiple: false,
                        allowPurchaseDuringRegistration: true,
                        includedQuantity: 1,
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
                    ]),
                }),
              }),
            }),
          }),
          transaction: (
            callback: (tx: {
              insert: (table: unknown) => {
                values: (value: unknown) => {
                  onConflictDoNothing?: () => Effect.Effect<[]>;
                  returning?: () => Effect.Effect<{ id: string }[]>;
                };
              };
              query: {
                eventRegistrations: {
                  findMany: () => Effect.Effect<[]>;
                };
              };
              select: typeof selectLockedTenantMembership;
              update: () => {
                set: () => {
                  where: () => {
                    returning: () => Effect.Effect<{ id: string }[]>;
                  };
                };
              };
            }) => Effect.Effect<unknown, unknown>,
          ) =>
            callback({
              insert: (table) => ({
                values: (value) => {
                  if (table === eventRegistrations) {
                    return {
                      returning: () =>
                        Effect.succeed([{ id: 'registration-1' }]),
                    };
                  }
                  if (table === eventRegistrationAddonPurchases) {
                    insertAddonPurchase(value);
                  }
                  if (table === eventRegistrationAddonPurchaseLots) {
                    insertAddonLot(value);
                  }
                  if (table === emailOutbox) {
                    return {
                      onConflictDoNothing: () => Effect.succeed([]),
                    };
                  }
                  return Effect.void;
                },
              }),
              query: {
                eventRegistrations: {
                  findMany: () => Effect.succeed([]),
                },
              },
              select: selectLockedTenantMembership,
              update: () => ({
                set: () => ({
                  where: () => ({
                    returning: () => Effect.succeed([{ id: 'updated' }]),
                  }),
                }),
              }),
            }),
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        expect(insertAddonPurchase).toHaveBeenCalledWith(
          expect.objectContaining({
            addonId: 'addon-1',
            includedQuantity: 1,
            purchasedQuantity: 1,
            quantity: 2,
            registrationId: 'registration-1',
          }),
        );
        expect(insertAddonLot).toHaveBeenCalledWith(
          expect.objectContaining({
            baseAmount: 0,
            grossAmount: 0,
            netAmount: 0,
            paymentAllocationFinalizedAt: expect.any(Date),
            quantity: 1,
            registrationId: 'registration-1',
            taxAmount: 0,
            unitPrice: 0,
          }),
        );
      }),
  );

  it.effect(
    'fails the reservation transaction when add-on stock is no longer available',
    () =>
      Effect.gen(function* () {
        let isTransactionFailed = false;
        const insertAddonPurchase = vi.fn();
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () => Effect.succeed(approvedRegistrationOption),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          select: () => ({
            from: () => ({
              innerJoin: () => ({
                leftJoin: () => ({
                  where: () =>
                    Effect.succeed([
                      {
                        addOnId: 'addon-1',
                        allowMultiple: false,
                        allowPurchaseDuringRegistration: true,
                        includedQuantity: 0,
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
                    ]),
                }),
              }),
            }),
          }),
          transaction: (
            callback: (tx: {
              insert: (table: unknown) => {
                values: (value: unknown) => {
                  returning?: () => Effect.Effect<{ id: string }[]>;
                };
              };
              query: {
                eventRegistrations: {
                  findMany: () => Effect.Effect<[]>;
                };
              };
              select: () => {
                from: () => {
                  where: () => {
                    for: () => Effect.Effect<{ stripeAccountId: string }[]>;
                  };
                };
              };
              update: (table: unknown) => {
                set: () => {
                  where: () => {
                    returning: () => Effect.Effect<{ id: string }[]>;
                  };
                };
              };
            }) => Effect.Effect<unknown, unknown>,
          ) =>
            callback({
              insert: (table) => ({
                values: (value) => {
                  if (table !== eventRegistrations) {
                    insertAddonPurchase(value);
                    return {};
                  }

                  return {
                    returning: () => Effect.succeed([{ id: 'registration-1' }]),
                  };
                },
              }),
              query: {
                eventRegistrations: {
                  findMany: () => Effect.succeed([]),
                },
              },
              select: () => ({
                from: () => ({
                  where: () => ({
                    for: () =>
                      Effect.succeed([{ stripeAccountId: 'acct_123' }]),
                  }),
                }),
              }),
              update: (table) => ({
                set: () => ({
                  where: () => ({
                    returning: () =>
                      Effect.succeed(
                        table === eventAddons ? [] : [{ id: 'option-1' }],
                      ),
                  }),
                }),
              }),
            }).pipe(
              Effect.tapError((error) =>
                Effect.sync(() => {
                  isTransactionFailed =
                    error instanceof EventRegistrationConflictError;
                }),
              ),
            ),
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provideService(StripeClient, stripeClient),
          Effect.provide(configProviderLayer),
        );

        const error = yield* program;
        expect(error['_tag']).toBe('EventRegistrationConflictError');
        expect(error.message).toBe('Add-on quantity is no longer available');
        expect(isTransactionFailed).toBe(true);
        expect(insertAddonPurchase).not.toHaveBeenCalled();
      }),
  );

  it.effect('joins the waitlist for a full public participant option', () =>
    Effect.gen(function* () {
      const insertWaitlistRegistration = vi.fn(() => ({
        values: vi.fn((values) => ({
          returning: vi.fn(() =>
            Effect.succeed([
              {
                id: values.status === 'WAITLIST' ? 'waitlist-1' : undefined,
              },
            ]),
          ),
        })),
      }));
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                confirmedSpots: 10,
                organizingRegistration: false,
                roleIds: [],
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
        transaction: (
          callback: (tx: {
            insert: ReturnType<typeof vi.fn>;
            query: {
              eventRegistrations: {
                findMany: () => Effect.Effect<[]>;
              };
            };
            select: typeof selectLockedTenantMembership;
            update: () => {
              set: (values: unknown) => {
                where: () => {
                  returning: () => Effect.Effect<{ id: string }[]>;
                };
              };
            };
          }) => Effect.Effect<unknown>,
        ) =>
          callback({
            insert: insertWaitlistRegistration,
            query: {
              eventRegistrations: {
                findMany: () => Effect.succeed([]),
              },
            },
            select: selectLockedTenantMembership,
            update: () => ({
              set: () => ({
                where: () => ({
                  returning: () => Effect.succeed([{ id: 'option-1' }]),
                }),
              }),
            }),
          }),
      };

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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
        Effect.provide(configProviderLayer),
      );

      yield* program;
      expect(insertWaitlistRegistration).toHaveBeenCalled();
    }),
  );

  it.effect(
    'maps a concurrent waitlist insert unique violation to a domain conflict',
    () =>
      Effect.gen(function* () {
        const uniqueViolation = new EffectDrizzleQueryError({
          cause: Cause.fail(
            new SqlError({
              reason: new UniqueViolation({
                cause: new Error('duplicate active registration'),
                constraint: activeEventRegistrationUniqueIndexName,
              }),
            }),
          ),
          params: [],
          query: 'insert into event_registrations ...',
        });
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () =>
                Effect.succeed({
                  ...approvedRegistrationOption,
                  confirmedSpots: 10,
                  organizingRegistration: false,
                  roleIds: [],
                }),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          transaction: () => Effect.fail(uniqueViolation),
        };

        const error = yield* EventRegistrationService.joinWaitlist({
          eventId: 'event-1',
          registrationOptionId: 'option-1',
          tenant: { id: 'tenant-1' },
          user: { id: 'user-1', roleIds: [] },
        }).pipe(
          Effect.flip,
          Effect.provide(EventRegistrationService.Default),
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provide(configProviderLayer),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe('User is already registered for this event');
      }),
  );

  it.effect(
    'locks tenant membership and enforces the active limit before joining a waitlist',
    () =>
      Effect.gen(function* () {
        const insertWaitlistRegistration = vi.fn();
        const updateWaitlistCounter = vi.fn();
        const lockMembership = vi.fn(() =>
          Effect.succeed([{ id: 'membership-1' }]),
        );
        const selectRegistrationState = vi.fn(() => ({
          from: (table: unknown) =>
            table === usersToTenants
              ? {
                  where: () => ({ for: lockMembership }),
                }
              : {
                  innerJoin: () => ({
                    where: () => ({
                      limit: () =>
                        Effect.succeed([{ id: 'active-registration-1' }]),
                    }),
                  }),
                },
        }));
        const transaction = {
          insert: insertWaitlistRegistration,
          query: {
            eventRegistrations: {
              findMany: () => Effect.succeed([]),
            },
          },
          select: selectRegistrationState,
          update: updateWaitlistCounter,
        };
        const mockDatabase = {
          query: {
            eventRegistrationOptions: {
              findFirst: () =>
                Effect.succeed({
                  ...approvedRegistrationOption,
                  confirmedSpots: 10,
                  organizingRegistration: false,
                  roleIds: [],
                }),
            },
            eventRegistrations: {
              findFirst: () => Effect.succeed(null),
            },
          },
          transaction: (
            callback: (tx: typeof transaction) => Effect.Effect<unknown>,
          ) => callback(transaction),
        };

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
          Effect.provide(
            Layer.succeed(Database, mockDatabase as DatabaseClient),
          ),
          Effect.provide(configProviderLayer),
        );

        expect(error).toBeInstanceOf(EventRegistrationConflictError);
        expect(error.message).toBe('Active registration limit reached');
        expect(lockMembership).toHaveBeenCalledOnce();
        expect(updateWaitlistCounter).not.toHaveBeenCalled();
        expect(insertWaitlistRegistration).not.toHaveBeenCalled();
      }),
  );

  it.effect('rejects waitlist joining while capacity remains', () =>
    Effect.gen(function* () {
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                organizingRegistration: false,
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Registration option still has available spots',
      );
    }),
  );

  it.effect('rejects waitlist joining for organizer/helper options', () =>
    Effect.gen(function* () {
      const mockDatabase = {
        query: {
          eventRegistrationOptions: {
            findFirst: () =>
              Effect.succeed({
                ...approvedRegistrationOption,
                confirmedSpots: 10,
                organizingRegistration: true,
              }),
          },
          eventRegistrations: {
            findFirst: () => Effect.succeed(null),
          },
        },
      };

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
        Effect.provide(Layer.succeed(Database, mockDatabase as DatabaseClient)),
        Effect.provide(configProviderLayer),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('EventRegistrationConflictError');
      expect(error.message).toBe(
        'Waitlist is only available for participant options',
      );
    }),
  );
});
