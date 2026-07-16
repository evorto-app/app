import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { and, eq, inArray } from 'drizzle-orm';

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
    email: string;
    firstName: string;
    id: string;
    lastName: string;
  };
  preparePaymentSetupRetry: (input: {
    baseUrl: string;
    registrationId: string;
  }) => Promise<string>;
  tenant: {
    currency: 'AUD' | 'CZK' | 'EUR';
    domain: string;
    id: string;
    stripeAccountId: null | string;
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
  seeded,
}: {
  database: TestDatabase;
  kind: 'free' | 'paid';
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
      stripeAccountId: true,
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

  if (originalRegistrations.length > 0) {
    await database
      .update(schema.eventRegistrations)
      .set({ status: 'CANCELLED' })
      .where(
        and(
          eq(schema.eventRegistrations.registrationOptionId, option.id),
          eq(schema.eventRegistrations.tenantId, tenant.id),
        ),
      );
  }
  await database
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
  await database
    .update(schema.eventInstances)
    .set({
      end: eventWindow.end,
      start: eventWindow.start,
      status: 'APPROVED',
    })
    .where(eq(schema.eventInstances.id, event.id));

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

  return {
    cleanup,
    eventId: event.id,
    eventTitle: event.title,
    kind,
    optionId: option.id,
    optionTitle: option.title,
    participant,
    preparePaymentSetupRetry: async ({ baseUrl, registrationId }) => {
      if (kind !== 'paid' || !tenant.stripeAccountId) {
        throw new Error(
          'Payment setup recovery requires a paid scenario with a Stripe account',
        );
      }
      const transactionId = createId();
      const eventUrl = new URL(
        `/events/${encodeURIComponent(event.id)}`,
        baseUrl,
      ).toString();

      await database
        .update(schema.eventRegistrationOptions)
        .set({ reservedSpots: 1 })
        .where(eq(schema.eventRegistrationOptions.id, option.id));
      await database.insert(schema.transactions).values({
        amount: option.price,
        appFee: Math.round(option.price * 0.035),
        comment: `Recover payment setup for ${event.title}`,
        currency: tenant.currency,
        eventId: event.id,
        eventRegistrationId: registrationId,
        executiveUserId: requiredTestUser('admin').id,
        id: transactionId,
        method: 'stripe',
        status: 'pending',
        stripeAccountId: tenant.stripeAccountId,
        stripeCheckoutRequest: {
          customerEmail: participant.email,
          eventTitle: event.title,
          eventUrl,
          expiresAt: Math.floor(Date.now() / 1000) + 23 * 60 * 60,
          lineItems: [
            {
              name: `Registration fee for ${event.title}`,
              quantity: 1,
              unitAmount: option.price,
            },
          ],
          notificationEmail: participant.email,
        },
        targetUserId: participant.id,
        tenantId: tenant.id,
        type: 'registration',
      });

      return transactionId;
    },
    tenant: {
      currency: tenant.currency,
      domain: tenant.domain,
      id: tenant.id,
      stripeAccountId: tenant.stripeAccountId,
    },
  };
};
