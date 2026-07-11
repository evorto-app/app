import { usersToAuthenticate } from '../../../helpers/user-data';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { waitForRegistrationPage } from '../../support/utils/event-registration-page';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';

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
  let createdRegistrationId: string | undefined;
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
    await waitForRegistrationPage(page);
    const registerButton = page
      .getByRole('button', { name: 'Register' })
      .first();
    await expect(registerButton).toBeEnabled({ timeout: 20_000 });
    await registerButton.click();

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

    // Confirm success copy is rendered (seed sets registeredDescription: "You are registered")
    await expect(page.getByText('You are registered')).toBeVisible();

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
    createdRegistrationId = registration.id;
    const registrationEmail = await database.query.emailOutbox.findFirst({
      where: {
        idempotencyKey: `registration-confirmed/${tenant.id}/${registration.id}`,
        kind: 'registrationConfirmed',
        tenantId: tenant.id,
      },
    });
    const registrationUser = await database.query.users.findFirst({
      columns: {
        communicationEmail: true,
      },
      where: { id: user.id },
    });
    expect(registrationEmail).toMatchObject({
      kind: 'registrationConfirmed',
      toEmail: registrationUser?.communicationEmail,
    });
    expect(registrationEmail?.html).toContain(`/events/${targetEventId}`);
    expect(registrationEmail?.text).toContain('not a bearer credential');

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
    if (createdRegistrationId) {
      await database
        .delete(schema.emailOutbox)
        .where(
          eq(
            schema.emailOutbox.idempotencyKey,
            `registration-confirmed/${tenant.id}/${createdRegistrationId}`,
          ),
        );
    }
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
