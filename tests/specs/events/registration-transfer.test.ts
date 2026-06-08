import { and, eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

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
  try {
    await database.insert(schema.eventRegistrations).values({
      eventId: targetEventId,
      id: registrationId,
      registrationOptionId: targetOptionId,
      status: 'CONFIRMED',
      tenantId: tenant.id,
      userId: regularUser.id,
    });

    await page.goto(`/events/${targetEventId}`);
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'detached' });

    await expect(
      page.getByText('Your registration is confirmed'),
    ).toBeVisible();
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

    const transferredRegistration =
      await database.query.eventRegistrations.findFirst({
        where: {
          id: registrationId,
          tenantId: tenant.id,
        },
      });
    if (!transferredRegistration) {
      throw new Error('Expected transferred registration after transfer flow');
    }
    expect(transferredRegistration.userId).toBe(targetUser.id);
    expect(transferredRegistration.status).toBe('CONFIRMED');
  } finally {
    await database
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.id, registrationId));
  }
});
