import { usersToAuthenticate } from '../../../helpers/user-data';
import { and, eq } from 'drizzle-orm';
import { DEFAULT_E2E_NOW_ISO } from '../../../helpers/testing/deterministic-test-defaults';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

const futureServerEventWindow = (): {
  closeRegistrationTime: Date;
  end: Date;
  openRegistrationTime: Date;
  start: Date;
} => {
  const serverNow = new Date(
    process.env['E2E_NOW_ISO']?.trim() || DEFAULT_E2E_NOW_ISO,
  );
  if (Number.isNaN(serverNow.getTime())) {
    throw new Error('Invalid E2E_NOW_ISO value for free registration test');
  }
  const wallNow = new Date();
  const latestNow =
    serverNow.getTime() > wallNow.getTime() ? serverNow : wallNow;
  const earliestNow =
    serverNow.getTime() < wallNow.getTime() ? serverNow : wallNow;
  const start = new Date(latestNow.getTime() + 7 * 24 * 60 * 60 * 1000);

  return {
    closeRegistrationTime: new Date(
      latestNow.getTime() + 5 * 24 * 60 * 60 * 1000,
    ),
    end: new Date(start.getTime() + 2 * 60 * 60 * 1000),
    openRegistrationTime: new Date(earliestNow.getTime() - 24 * 60 * 60 * 1000),
    start,
  };
};

test.use({
  storageState: usersToAuthenticate.find((u) => u.roles === 'user')!.stateFile,
});

test('register for a free event as regular user', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
  const user = usersToAuthenticate.find((u) => u.roles === 'user')!;
  const targetEventId = seeded.scenario.events.freeOpen.eventId;
  const targetOptionId = seeded.scenario.events.freeOpen.optionId;
  const serverEventWindow = futureServerEventWindow();
  const [targetEvent] = await database
    .select()
    .from(schema.eventInstances)
    .where(eq(schema.eventInstances.id, targetEventId))
    .limit(1);
  if (!targetEvent) {
    throw new Error(
      'Expected seeded freeOpen event for free registration flow',
    );
  }
  const [targetOption] = await database
    .select()
    .from(schema.eventRegistrationOptions)
    .where(
      and(
        eq(schema.eventRegistrationOptions.eventId, targetEventId),
        eq(schema.eventRegistrationOptions.id, targetOptionId),
      ),
    )
    .limit(1);
  if (!targetOption) {
    throw new Error(
      'Expected seeded freeOpen event registration option for free registration flow',
    );
  }
  const originalRegistrations = await database
    .select()
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.eventId, targetEventId),
        eq(schema.eventRegistrations.tenantId, tenant.id),
        eq(schema.eventRegistrations.userId, user.id),
      ),
    );

  try {
    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, targetEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, user.id),
        ),
      );
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        closeRegistrationTime: serverEventWindow.closeRegistrationTime,
        confirmedSpots: 0,
        openRegistrationTime: serverEventWindow.openRegistrationTime,
        reservedSpots: 0,
        waitlistSpots: 0,
      })
      .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: serverEventWindow.end,
        start: serverEventWindow.start,
      })
      .where(eq(schema.eventInstances.id, targetEventId));

    // Capture confirmedSpots before
    const [before] = await database
      .select()
      .from(schema.eventRegistrationOptions)
      .where(eq(schema.eventRegistrationOptions.id, targetOptionId))
      .limit(1);
    if (!before) {
      throw new Error(
        'Expected seeded freeOpen registration option after resetting counts',
      );
    }
    const confirmedBefore = before.confirmedSpots;

    // Navigate to event and register
    await page.goto(`/events/${targetEventId}`);
    await expect(page).toHaveURL(`/events/${targetEventId}`);
    // wait until loading state is gone before interacting
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Register' }).first().click();

    // After registering, the status refetches; wait for the loading indicator
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'attached', timeout: 2000 })
      .catch(() => {});
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'detached' });

    // Confirm a success state is rendered after the registration status refetch.
    await expect(
      page
        .getByText(/You are registered|Your registration is confirmed/)
        .first(),
    ).toBeVisible({ timeout: 20_000 });

    // Verify DB registration exists and counts updated
    const [registration] = await database
      .select()
      .from(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, targetEventId),
          eq(schema.eventRegistrations.registrationOptionId, targetOptionId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, user.id),
          eq(schema.eventRegistrations.status, 'CONFIRMED'),
        ),
      )
      .limit(1);
    if (!registration) {
      throw new Error(
        'Expected free registration flow to persist a confirmed registration',
      );
    }

    const [after] = await database
      .select()
      .from(schema.eventRegistrationOptions)
      .where(eq(schema.eventRegistrationOptions.id, targetOptionId))
      .limit(1);
    if (!after) {
      throw new Error(
        'Expected seeded freeOpen registration option after registering',
      );
    }
    expect(after.confirmedSpots).toBeGreaterThanOrEqual(confirmedBefore + 1);
  } finally {
    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, targetEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, user.id),
        ),
      );
    if (originalRegistrations.length) {
      await database
        .insert(schema.eventRegistrations)
        .values(originalRegistrations);
    }
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        checkedInSpots: targetOption.checkedInSpots,
        closeRegistrationTime: targetOption.closeRegistrationTime,
        confirmedSpots: targetOption.confirmedSpots,
        openRegistrationTime: targetOption.openRegistrationTime,
        reservedSpots: targetOption.reservedSpots,
        waitlistSpots: targetOption.waitlistSpots,
      })
      .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: targetEvent.end,
        start: targetEvent.start,
      })
      .where(eq(schema.eventInstances.id, targetEventId));
  }
});
