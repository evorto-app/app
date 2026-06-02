import { and, eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';

test.setTimeout(120_000);

test.use({ storageState: userStateFile });

test('regular user transfers an unpaid confirmed registration by email', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  const targetUser = usersToAuthenticate.find(
    (user) => user.email === 'organizer@evorto.app',
  );
  if (!regularUser || !targetUser) {
    throw new Error('Expected regular and organizer user fixtures');
  }

  const targetEventId = seeded.scenario.events.freeOpen.eventId;
  const targetOptionId = seeded.scenario.events.freeOpen.optionId;
  const registrationId = getId();
  const serverEventWindow = futureServerEventWindow();
  const originalRegistrations = await database
    .select({
      id: schema.eventRegistrations.id,
      status: schema.eventRegistrations.status,
    })
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.eventId, targetEventId),
        eq(schema.eventRegistrations.tenantId, tenant.id),
        inArray(schema.eventRegistrations.userId, [
          regularUser.id,
          targetUser.id,
        ]),
      ),
    );
  const originalEventInstance = await database.query.eventInstances.findFirst({
    where: { id: targetEventId },
  });
  if (!originalEventInstance) {
    throw new Error('Expected seeded event instance');
  }

  try {
    await database
      .update(schema.eventRegistrations)
      .set({ status: 'CANCELLED' })
      .where(
        and(
          eq(schema.eventRegistrations.eventId, targetEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          inArray(schema.eventRegistrations.userId, [
            regularUser.id,
            targetUser.id,
          ]),
        ),
      );
    await database.insert(schema.eventRegistrations).values({
      eventId: targetEventId,
      id: registrationId,
      registrationOptionId: targetOptionId,
      status: 'CONFIRMED',
      tenantId: tenant.id,
      userId: regularUser.id,
    });
    await database
      .update(schema.eventInstances)
      .set({
        end: serverEventWindow.end,
        start: serverEventWindow.start,
      })
      .where(eq(schema.eventInstances.id, targetEventId));

    await page.goto(`/events/${targetEventId}`);
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'detached' });

    await expect(page.getByText('You are registered')).toBeVisible();
    await expect(
      page.getByText(
        'You can transfer this unpaid registration to another eligible tenant member by email.',
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Transfer registration' }).click();

    const dialog = page.getByRole('dialog', { name: 'Transfer registration' });
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel('New participant email')
      .fill(` ${targetUser.email} `);
    await dialog.getByRole('button', { name: 'Transfer registration' }).click();
    await expect(dialog).not.toBeVisible();

    await expect
      .poll(async () => {
        const transferredRegistration =
          await database.query.eventRegistrations.findFirst({
            where: {
              id: registrationId,
              tenantId: tenant.id,
            },
          });
        return transferredRegistration?.userId;
      })
      .toBe(targetUser.id);
    const transferredRegistration =
      await database.query.eventRegistrations.findFirst({
        where: {
          id: registrationId,
          tenantId: tenant.id,
        },
      });
    expect(transferredRegistration?.status).toBe('CONFIRMED');
  } finally {
    await database
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.id, registrationId));
    for (const registration of originalRegistrations) {
      await database
        .update(schema.eventRegistrations)
        .set({ status: registration.status })
        .where(eq(schema.eventRegistrations.id, registration.id));
    }
    await database
      .update(schema.eventInstances)
      .set({
        end: originalEventInstance.end,
        start: originalEventInstance.start,
      })
      .where(eq(schema.eventInstances.id, targetEventId));
  }
});

test('regular user can create a paid transfer link for direct resale handoff', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular user fixture');
  }

  const targetEventId = seeded.scenario.events.paidOpen.eventId;
  const targetOptionId = seeded.scenario.events.paidOpen.optionId;
  const serverFutureEventStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const serverFutureEventEnd = new Date(
    serverFutureEventStart.getTime() + 2 * 60 * 60 * 1000,
  );
  const targetOption = await database.query.eventRegistrationOptions.findFirst({
    where: {
      eventId: targetEventId,
      id: targetOptionId,
    },
  });
  if (!targetOption || targetOption.price <= 0) {
    throw new Error('Expected seeded paid registration option');
  }

  const registrationId = getId();
  const transactionId = getId();
  const originalRegistrations = await database
    .select({
      id: schema.eventRegistrations.id,
      status: schema.eventRegistrations.status,
    })
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.eventId, targetEventId),
        eq(schema.eventRegistrations.tenantId, tenant.id),
        eq(schema.eventRegistrations.userId, regularUser.id),
      ),
    );
  const originalEventInstance = await database.query.eventInstances.findFirst({
    where: { id: targetEventId },
  });
  if (!originalEventInstance) {
    throw new Error('Expected seeded event instance');
  }

  try {
    await database
      .update(schema.eventRegistrations)
      .set({ status: 'CANCELLED' })
      .where(
        and(
          eq(schema.eventRegistrations.eventId, targetEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      );
    await database.insert(schema.eventRegistrations).values({
      eventId: targetEventId,
      id: registrationId,
      registrationOptionId: targetOptionId,
      status: 'CONFIRMED',
      tenantId: tenant.id,
      userId: regularUser.id,
    });
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        confirmedSpots: targetOption.confirmedSpots + 1,
      })
      .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
    await database.insert(schema.transactions).values({
      amount: targetOption.price,
      comment: 'Registration transfer paid-block coverage',
      currency: 'EUR',
      eventId: targetEventId,
      eventRegistrationId: registrationId,
      id: transactionId,
      method: 'stripe',
      status: 'successful',
      targetUserId: regularUser.id,
      tenantId: tenant.id,
      type: 'registration',
    });
    await database
      .update(schema.eventInstances)
      .set({
        end: serverFutureEventEnd,
        start: serverFutureEventStart,
      })
      .where(eq(schema.eventInstances.id, targetEventId));

    await page.goto(`/events/${targetEventId}`);
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'detached' });

    await expect(page.getByText('You are registered')).toBeVisible();
    await expect(
      page.getByText(
        'Create a 24-hour transfer link and code for this paid registration. Share it with the replacement participant for direct transfer or resale; after replacement checkout succeeds, Evorto cancels this registration and handles the source refund path.',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Transfer registration' }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Create transfer link' }).click();
    await expect(page.getByText('Transfer code')).toBeVisible();

    await expect
      .poll(async () =>
        database.query.registrationTransferIntents.findFirst({
          where: {
            sourceRegistrationId: registrationId,
            status: 'pending',
            tenantId: tenant.id,
          },
        }),
      )
      .not.toBeNull();
    const persistedTransferIntent =
      await database.query.registrationTransferIntents.findFirst({
        where: {
          sourceRegistrationId: registrationId,
          status: 'pending',
          tenantId: tenant.id,
        },
      });
    expect(persistedTransferIntent?.code).toEqual(expect.any(String));
    await expect(
      page.getByText(persistedTransferIntent?.code ?? 'missing-transfer-code'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Open transfer link' }),
    ).toHaveAttribute(
      'href',
      `/events/${targetEventId}?transferCode=${encodeURIComponent(
        persistedTransferIntent?.code ?? '',
      )}`,
    );

    const paidRegistration = await database.query.eventRegistrations.findFirst({
      where: {
        id: registrationId,
        tenantId: tenant.id,
      },
    });
    if (!paidRegistration) {
      throw new Error('Expected paid registration after transfer-blocked flow');
    }
    expect(paidRegistration.userId).toBe(regularUser.id);
    expect(paidRegistration.status).toBe('CONFIRMED');
  } finally {
    await database
      .delete(schema.registrationTransferIntents)
      .where(
        and(
          eq(
            schema.registrationTransferIntents.sourceRegistrationId,
            registrationId,
          ),
          eq(schema.registrationTransferIntents.tenantId, tenant.id),
        ),
      );
    await database
      .delete(schema.transactions)
      .where(eq(schema.transactions.id, transactionId));
    await database
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.id, registrationId));
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        confirmedSpots: targetOption.confirmedSpots,
      })
      .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
    for (const registration of originalRegistrations) {
      await database
        .update(schema.eventRegistrations)
        .set({ status: registration.status })
        .where(eq(schema.eventRegistrations.id, registration.id));
    }
    await database
      .update(schema.eventInstances)
      .set({
        end: originalEventInstance.end,
        start: originalEventInstance.start,
      })
      .where(eq(schema.eventInstances.id, targetEventId));
  }
});

test('regular user cancellation records a pending manual refund for a paid confirmed registration', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular user fixture');
  }

  const targetEventId = seeded.scenario.events.paidOpen.eventId;
  const targetOptionId = seeded.scenario.events.paidOpen.optionId;
  const serverFutureEventStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const serverFutureEventEnd = new Date(
    serverFutureEventStart.getTime() + 2 * 60 * 60 * 1000,
  );
  const targetOption = await database.query.eventRegistrationOptions.findFirst({
    where: {
      eventId: targetEventId,
      id: targetOptionId,
    },
  });
  if (!targetOption || targetOption.price <= 0) {
    throw new Error('Expected seeded paid registration option');
  }

  const registrationId = getId();
  const transactionId = getId();
  const originalRegistrations = await database
    .select({
      id: schema.eventRegistrations.id,
      status: schema.eventRegistrations.status,
    })
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.eventId, targetEventId),
        eq(schema.eventRegistrations.tenantId, tenant.id),
        eq(schema.eventRegistrations.userId, regularUser.id),
      ),
    );
  const originalEventInstance = await database.query.eventInstances.findFirst({
    where: { id: targetEventId },
  });
  if (!originalEventInstance) {
    throw new Error('Expected seeded event instance');
  }

  try {
    await database
      .update(schema.eventRegistrations)
      .set({ status: 'CANCELLED' })
      .where(
        and(
          eq(schema.eventRegistrations.eventId, targetEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      );
    await database.insert(schema.eventRegistrations).values({
      eventId: targetEventId,
      id: registrationId,
      registrationOptionId: targetOptionId,
      status: 'CONFIRMED',
      tenantId: tenant.id,
      userId: regularUser.id,
    });
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        confirmedSpots: targetOption.confirmedSpots + 1,
      })
      .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
    await database.insert(schema.transactions).values({
      amount: targetOption.price,
      comment: 'Registration paid-cancellation refund coverage',
      currency: 'EUR',
      eventId: targetEventId,
      eventRegistrationId: registrationId,
      id: transactionId,
      method: 'stripe',
      status: 'successful',
      targetUserId: regularUser.id,
      tenantId: tenant.id,
      type: 'registration',
    });
    await database
      .update(schema.eventInstances)
      .set({
        end: serverFutureEventEnd,
        start: serverFutureEventStart,
      })
      .where(eq(schema.eventInstances.id, targetEventId));

    await page.goto(`/events/${targetEventId}`);
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'detached' });

    await expect(page.getByText('You are registered')).toBeVisible();
    await expect(
      page.getByText(
        'If this was paid, Evorto submits a Stripe refund when the original payment reference is available; otherwise it creates a pending manual refund record for organizers.',
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel registration' }).click();

    await expect
      .poll(async () => {
        const cancelledRegistration =
          await database.query.eventRegistrations.findFirst({
            where: {
              id: registrationId,
              tenantId: tenant.id,
            },
          });
        return cancelledRegistration?.status;
      })
      .toBe('CANCELLED');

    const refundTransaction = await database.query.transactions.findFirst({
      where: {
        eventRegistrationId: registrationId,
        tenantId: tenant.id,
        type: 'refund',
      },
    });
    expect(refundTransaction).toEqual(
      expect.objectContaining({
        amount: -Math.abs(targetOption.price),
        currency: 'EUR',
        eventId: targetEventId,
        eventRegistrationId: registrationId,
        manuallyCreated: true,
        method: 'stripe',
        status: 'pending',
        targetUserId: regularUser.id,
        tenantId: tenant.id,
        type: 'refund',
      }),
    );
    expect(refundTransaction?.comment).toContain(
      'Pending registration refund record',
    );
  } finally {
    await database
      .delete(schema.transactions)
      .where(
        and(
          eq(schema.transactions.eventRegistrationId, registrationId),
          eq(schema.transactions.tenantId, tenant.id),
        ),
      );
    await database
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.id, registrationId));
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        confirmedSpots: targetOption.confirmedSpots,
      })
      .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
    for (const registration of originalRegistrations) {
      await database
        .update(schema.eventRegistrations)
        .set({ status: registration.status })
        .where(eq(schema.eventRegistrations.id, registration.id));
    }
    await database
      .update(schema.eventInstances)
      .set({
        end: originalEventInstance.end,
        start: originalEventInstance.start,
      })
      .where(eq(schema.eventInstances.id, targetEventId));
  }
});
