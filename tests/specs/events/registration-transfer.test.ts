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

test('regular user cannot self-transfer a paid confirmed registration', async ({
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
        'Self-service transfer is only available for unpaid, not-yet-checked-in registrations before the event starts. Paid registration transfer and resale are not automatic yet.',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Transfer unavailable' }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Transfer registration' }),
    ).toHaveCount(0);

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
      .delete(schema.transactions)
      .where(eq(schema.transactions.id, transactionId));
    await database
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.id, registrationId));
    for (const registration of originalRegistrations) {
      await database
        .update(schema.eventRegistrations)
        .set({ status: registration.status })
        .where(eq(schema.eventRegistrations.id, registration.id));
    }
  }
});
