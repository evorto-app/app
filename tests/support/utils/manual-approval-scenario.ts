import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { and, eq, inArray } from 'drizzle-orm';
import { Schema } from 'effect';
import Stripe from 'stripe';

import type { SeedTenantResult } from '../../../helpers/seed-tenant';

import { usersToAuthenticate } from '../../../helpers/user-data';
import { createId } from '../../../src/db/create-id';
import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';
import { deleteRegistrationAcquisitionLedger } from './registration-acquisition-cleanup';
import { futureServerEventWindow } from './server-test-clock';

export { waitForRegistrationPage as waitForRegistrationStatus } from './event-registration-page';

type TestDatabase = NodePgDatabase<typeof relations>;

export interface ManualApprovalScenario {
  cleanup: () => Promise<void>;
  eventId: string;
  eventTitle: string;
  kind: 'free' | 'paid';
  optionId: string;
  optionTitle: string;
  participant: {
    communicationEmail: null | string;
    email: string;
    firstName: string;
    id: string;
    lastName: string;
  };
  prepareUncertainPaymentClaim: (input: {
    baseUrl: string;
    registrationId: string;
  }) => Promise<string>;
  tenant: {
    currency: 'AUD' | 'CZK' | 'EUR';
    domain: string;
    id: string;
    name: string;
    stripeAccountId: null | string;
    timezone: string;
  };
}

const requiredTestUser = (role: 'admin' | 'user') => {
  const user = usersToAuthenticate.find(
    (candidate) => candidate.roles === role,
  );
  if (!user) {
    throw new Error(`Expected canonical ${role} test user`);
  }
  return user;
};

export const seedManualApprovalScenario = async ({
  database,
  kind,
  registerCleanup,
  seeded,
}: {
  database: TestDatabase;
  kind: 'free' | 'paid';
  registerCleanup?: (cleanup: () => Promise<void>) => void;
  seeded: SeedTenantResult;
}): Promise<ManualApprovalScenario> => {
  const scenarioHandle =
    kind === 'free'
      ? seeded.scenario.events.freeOpen
      : seeded.scenario.events.paidOpen;
  const participantFixture = requiredTestUser('user');
  requiredTestUser('admin');

  const event = await database.query.eventInstances.findFirst({
    where: {
      id: scenarioHandle.eventId,
      tenantId: seeded.tenant.id,
    },
  });
  const option = await database.query.eventRegistrationOptions.findFirst({
    where: {
      eventId: scenarioHandle.eventId,
      id: scenarioHandle.optionId,
    },
  });
  const participant = await database.query.users.findFirst({
    columns: {
      communicationEmail: true,
      email: true,
      firstName: true,
      id: true,
      lastName: true,
    },
    where: { id: participantFixture.id },
  });
  const tenant = await database.query.tenants.findFirst({
    columns: {
      currency: true,
      domain: true,
      id: true,
      name: true,
      stripeAccountId: true,
      timezone: true,
    },
    where: { id: seeded.tenant.id },
  });

  if (!event || !option || !participant || !tenant) {
    throw new Error(`Expected seeded ${kind} manual approval scenario records`);
  }
  if (option.organizingRegistration || option.isPaid !== (kind === 'paid')) {
    throw new Error(
      `Seeded ${kind} scenario did not resolve a participant option`,
    );
  }
  if (kind === 'paid' && !tenant.stripeAccountId) {
    throw new Error('Paid manual approval scenario requires a Stripe account');
  }
  const selectedTaxRate =
    option.stripeTaxRateId && tenant.stripeAccountId
      ? await database.query.tenantStripeTaxRates.findFirst({
          columns: {
            displayName: true,
            inclusive: true,
            percentage: true,
            stripeTaxRateId: true,
          },
          where: {
            active: true,
            inclusive: true,
            stripeAccountId: tenant.stripeAccountId,
            stripeTaxRateId: option.stripeTaxRateId,
            tenantId: tenant.id,
          },
        })
      : undefined;
  if (
    option.stripeTaxRateId &&
    (!selectedTaxRate || selectedTaxRate.percentage === null)
  ) {
    throw new Error(`Seeded ${kind} scenario tax configuration is unavailable`);
  }

  const originalRegistrations =
    await database.query.eventRegistrations.findMany({
      columns: {
        id: true,
        status: true,
      },
      where: {
        registrationOptionId: option.id,
        tenantId: tenant.id,
      },
    });
  const originalRegistrationIds = new Set(
    originalRegistrations.map((registration) => registration.id),
  );
  const eventWindow = futureServerEventWindow();

  const cleanup = async (): Promise<void> => {
    const currentRegistrations =
      await database.query.eventRegistrations.findMany({
        columns: { id: true },
        where: {
          registrationOptionId: option.id,
          tenantId: tenant.id,
        },
      });
    const createdRegistrationIds = currentRegistrations
      .map((registration) => registration.id)
      .filter((registrationId) => !originalRegistrationIds.has(registrationId));

    if (createdRegistrationIds.length > 0) {
      const exactOutboxKeys = createdRegistrationIds.flatMap(
        (registrationId) => [
          `registration-cancelled/${tenant.id}/${registrationId}`,
          `registration-confirmed/${tenant.id}/${registrationId}`,
        ],
      );
      const relatedOutboxRows = await database.query.emailOutbox.findMany({
        columns: {
          id: true,
          idempotencyKey: true,
        },
        where: { tenantId: tenant.id },
      });
      const relatedOutboxIds = relatedOutboxRows
        .filter(
          (row) =>
            exactOutboxKeys.includes(row.idempotencyKey) ||
            createdRegistrationIds.some((registrationId) =>
              row.idempotencyKey.includes(`/${registrationId}/`),
            ),
        )
        .map((row) => row.id);

      if (relatedOutboxIds.length > 0) {
        await database
          .delete(schema.emailOutbox)
          .where(inArray(schema.emailOutbox.id, relatedOutboxIds));
      }
      await deleteRegistrationAcquisitionLedger({
        database,
        registrationIds: createdRegistrationIds,
        tenantId: tenant.id,
      });
      await database
        .delete(schema.transactions)
        .where(
          and(
            eq(schema.transactions.tenantId, tenant.id),
            inArray(
              schema.transactions.eventRegistrationId,
              createdRegistrationIds,
            ),
          ),
        );
      await database
        .delete(schema.eventRegistrations)
        .where(inArray(schema.eventRegistrations.id, createdRegistrationIds));
    }

    for (const registration of originalRegistrations) {
      await database
        .update(schema.eventRegistrations)
        .set({ status: registration.status })
        .where(eq(schema.eventRegistrations.id, registration.id));
    }
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        checkedInSpots: option.checkedInSpots,
        closeRegistrationTime: option.closeRegistrationTime,
        confirmedSpots: option.confirmedSpots,
        openRegistrationTime: option.openRegistrationTime,
        registrationMode: option.registrationMode,
        reservedSpots: option.reservedSpots,
        waitlistSpots: option.waitlistSpots,
      })
      .where(eq(schema.eventRegistrationOptions.id, option.id));
    await database
      .update(schema.eventInstances)
      .set({
        end: event.end,
        start: event.start,
        status: event.status,
      })
      .where(eq(schema.eventInstances.id, event.id));
  };

  registerCleanup?.(cleanup);
  await database.transaction(async (transaction) => {
    if (originalRegistrations.length > 0) {
      await transaction
        .update(schema.eventRegistrations)
        .set({ status: 'CANCELLED' })
        .where(
          and(
            eq(schema.eventRegistrations.registrationOptionId, option.id),
            eq(schema.eventRegistrations.tenantId, tenant.id),
          ),
        );
    }
    await transaction
      .update(schema.eventRegistrationOptions)
      .set({
        checkedInSpots: 0,
        closeRegistrationTime: eventWindow.closeRegistrationTime,
        confirmedSpots: 0,
        openRegistrationTime: eventWindow.openRegistrationTime,
        registrationMode: 'application',
        reservedSpots: 0,
        waitlistSpots: 0,
      })
      .where(eq(schema.eventRegistrationOptions.id, option.id));
    await transaction
      .update(schema.eventInstances)
      .set({
        end: eventWindow.end,
        start: eventWindow.start,
        status: 'APPROVED',
      })
      .where(eq(schema.eventInstances.id, event.id));
  });

  return {
    cleanup,
    eventId: event.id,
    eventTitle: event.title,
    kind,
    optionId: option.id,
    optionTitle: option.title,
    participant,
    prepareUncertainPaymentClaim: async ({ baseUrl, registrationId }) => {
      if (kind !== 'paid' || !tenant.stripeAccountId) {
        throw new Error(
          'An uncertain payment claim requires a paid scenario with a Stripe account',
        );
      }
      const transactionId = createId();
      const eventUrl = new URL(
        `/events/${encodeURIComponent(event.id)}`,
        baseUrl,
      ).toString();

      await database.transaction(async (transaction) => {
        await transaction
          .update(schema.eventRegistrationOptions)
          .set({ reservedSpots: 1 })
          .where(eq(schema.eventRegistrationOptions.id, option.id));
        const updatedRegistrations = await transaction
          .update(schema.eventRegistrations)
          .set({
            appliedDiscountedPrice: null,
            appliedDiscountType: null,
            basePriceAtRegistration: option.price,
            discountAmount: 0,
            ...(selectedTaxRate && {
              stripeTaxRateId: selectedTaxRate.stripeTaxRateId,
              taxRateDisplayName: selectedTaxRate.displayName,
              taxRateInclusive: selectedTaxRate.inclusive,
              taxRatePercentage: selectedTaxRate.percentage,
            }),
          })
          .where(
            and(
              eq(schema.eventRegistrations.id, registrationId),
              eq(schema.eventRegistrations.registrationOptionId, option.id),
              eq(schema.eventRegistrations.tenantId, tenant.id),
            ),
          )
          .returning({ id: schema.eventRegistrations.id });
        if (updatedRegistrations.length !== 1) {
          throw new Error(
            'Payment retry fixture registration must match its option and tenant',
          );
        }
        await transaction.insert(schema.transactions).values({
          amount: option.price,
          appFee: Math.round(option.price * 0.035),
          comment: `Uncertain payment setup for ${event.title}`,
          currency: tenant.currency,
          eventId: event.id,
          eventRegistrationId: registrationId,
          executiveUserId: requiredTestUser('admin').id,
          id: transactionId,
          method: 'stripe',
          status: 'pending',
          stripeAccountId: tenant.stripeAccountId,
          stripeCheckoutRequest: {
            customerEmail: participant.communicationEmail ?? participant.email,
            eventTitle: event.title,
            eventUrl,
            expiresAt: Math.floor(Date.now() / 1000) + 23 * 60 * 60,
            lineItems: [
              {
                name: `Registration fee for ${event.title}`,
                quantity: 1,
                ...(option.stripeTaxRateId && {
                  taxRateId: option.stripeTaxRateId,
                }),
                unitAmount: option.price,
              },
            ],
            notificationEmail:
              participant.communicationEmail ?? participant.email,
          },
          targetUserId: participant.id,
          tenantId: tenant.id,
          type: 'registration',
        });
      });

      return transactionId;
    },
    tenant: {
      currency: tenant.currency,
      domain: tenant.domain,
      id: tenant.id,
      name: tenant.name,
      stripeAccountId: tenant.stripeAccountId,
      timezone: tenant.timezone,
    },
  };
};

/** The fixture owns one unpaid test-mode page; recovery itself only reads Stripe. */
export const seedCheckoutRecoveryScenario = async ({
  baseUrl,
  database,
  registerCleanup,
  seeded,
}: {
  baseUrl: string;
  database: TestDatabase;
  registerCleanup: (cleanup: () => Promise<void>) => void;
  seeded: SeedTenantResult;
}) => {
  const apiKey = process.env['STRIPE_API_KEY']?.trim();
  if (!apiKey || !/^[rs]k_test_/u.test(apiKey))
    throw new Error(
      'Checkout recovery fixtures require a Stripe test-mode API key',
    );
  const scenario = await seedManualApprovalScenario({
    database,
    kind: 'paid',
    registerCleanup,
    seeded,
  });
  const registrationId = createId();
  await database.insert(schema.eventRegistrations).values({
    id: registrationId,
    eventId: scenario.eventId,
    registrationOptionId: scenario.optionId,
    tenantId: scenario.tenant.id,
    userId: scenario.participant.id,
    status: 'PENDING',
  });
  const transactionId = await scenario.prepareUncertainPaymentClaim({
    baseUrl,
    registrationId,
  });
  const claim = await database.query.transactions.findFirst({
    where: { id: transactionId, tenantId: scenario.tenant.id },
  });
  if (!claim?.stripeAccountId || claim.appFee === null)
    throw new Error('Expected the exact pending test Checkout claim');
  const snapshot = Schema.decodeUnknownSync(
    schema.RegistrationCheckoutSnapshotSchema,
  )(claim.stripeCheckoutRequest);
  const stripe = new Stripe(apiKey, {
    apiVersion: '2026-08-26.dahlia',
    maxNetworkRetries: 0,
  });
  const account = claim.stripeAccountId;
  const metadata = {
    registrationId,
    tenantId: scenario.tenant.id,
    transactionId,
    userId: scenario.participant.id,
  };
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      customer_email: snapshot.customerEmail,
      expires_at: snapshot.expiresAt,
      success_url: `${snapshot.eventUrl}?registrationStatus=success`,
      cancel_url: `${snapshot.eventUrl}?registrationStatus=cancel`,
      metadata,
      payment_intent_data: { application_fee_amount: claim.appFee },
      line_items: snapshot.lineItems.map((line) => ({
        price_data: {
          currency: claim.currency.toLowerCase(),
          product_data: { name: line.name },
          unit_amount: line.unitAmount,
        },
        quantity: line.quantity,
        ...(line.taxRateId && { tax_rates: [line.taxRateId] }),
      })),
    },
    {
      stripeAccount: account,
      idempotencyKey: `evorto-recovery-fixture:${transactionId}`,
    },
  );
  registerCleanup(async () => {
    const current = await stripe.checkout.sessions.retrieve(
      session.id,
      undefined,
      { stripeAccount: account },
    );
    if (
      current.livemode ||
      current.id !== session.id ||
      Object.entries(metadata).some(
        ([key, value]) => current.metadata?.[key] !== value,
      )
    )
      throw new Error(
        'Refusing to clean up a Checkout outside this test fixture',
      );
    if (current.status === 'open')
      await stripe.checkout.sessions.expire(session.id, undefined, {
        stripeAccount: account,
        idempotencyKey: `evorto-recovery-fixture-expire:${transactionId}`,
      });
    else if (current.status !== 'expired')
      throw new Error(
        'Expected an unpaid Checkout fixture to remain open or expired',
      );
  });
  if (session.livemode || !session.url || session.status !== 'open')
    throw new Error('Expected an open unpaid test-mode Checkout');
  await database
    .update(schema.transactions)
    .set({
      stripeCheckoutIncidentSessionId: session.id,
      stripeCheckoutReconcileLastError:
        'Test fixture: original Checkout returned but binding acknowledgement was uncertain',
    })
    .where(
      and(
        eq(schema.transactions.id, transactionId),
        eq(schema.transactions.tenantId, scenario.tenant.id),
      ),
    );
  const reason = `Restore original payment setup ${transactionId}`;
  registerCleanup(async () => {
    await database
      .delete(schema.platformAuditEntries)
      .where(
        and(
          eq(schema.platformAuditEntries.targetTenantId, scenario.tenant.id),
          eq(schema.platformAuditEntries.reason, reason),
        ),
      );
  });
  return {
    ...scenario,
    checkoutUrl: session.url,
    reason,
    registrationId,
    sessionId: session.id,
    transactionId,
  };
};
