import { and, eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import {
  eventRegistrationOptions,
  eventRegistrations,
  users,
} from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/axe-test';

test.use({ storageState: adminStateFile });

test('organizer copies the confirmed attendee email list from the overview @events', async ({
  context,
  database,
  makeAxeBuilder,
  page,
  seeded,
  tenant,
}) => {
  const confirmedRows = await database
    .select({
      email: users.email,
      eventId: eventRegistrations.eventId,
      organizingRegistration: eventRegistrationOptions.organizingRegistration,
    })
    .from(eventRegistrations)
    .innerJoin(
      eventRegistrationOptions,
      eq(eventRegistrations.registrationOptionId, eventRegistrationOptions.id),
    )
    .innerJoin(users, eq(eventRegistrations.userId, users.id))
    .where(
      and(
        eq(eventRegistrations.tenantId, tenant.id),
        eq(eventRegistrations.status, 'CONFIRMED'),
      ),
    );

  const attendeeRows = confirmedRows.filter(
    (row) => !row.organizingRegistration,
  );
  const preferredEventId = seeded.scenario.events.freeOpen.eventId;
  const eventId = attendeeRows.some((row) => row.eventId === preferredEventId)
    ? preferredEventId
    : attendeeRows[0]?.eventId;
  if (!eventId) {
    throw new Error(
      'Expected the seeded tenant to contain a confirmed attendee registration',
    );
  }

  const expectedEmails = [
    ...new Map(
      attendeeRows
        .filter((row) => row.eventId === eventId)
        .map((row) => row.email.trim())
        .map((email) => [email.toLowerCase(), email] as const),
    ).values(),
  ].toSorted();
  expect(expectedEmails.length).toBeGreaterThan(0);
  const organizerCount = confirmedRows.filter(
    (row) => row.eventId === eventId && row.organizingRegistration,
  ).length;

  await page.goto(`/events/${eventId}/organize`);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  await expect(
    page.getByRole('heading', { exact: true, name: 'Overview' }),
  ).toBeVisible();

  const scan = await makeAxeBuilder()
    .include('[aria-labelledby="event-organize-copy-emails-title"]')
    .analyze();
  expect(scan.violations).toEqual([]);

  if (organizerCount === 0) {
    await expect(
      page.getByRole('button', {
        exact: true,
        name: 'Copy organizer emails',
      }),
    ).toBeDisabled();
  }

  await page
    .getByRole('button', { exact: true, name: 'Copy attendee emails' })
    .click();
  await expect(
    page.getByText(
      expectedEmails.length === 1
        ? '1 email address copied'
        : `${expectedEmails.length} email addresses copied`,
      { exact: true },
    ),
  ).toBeVisible();

  const clipboardText = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  const copiedEmails = clipboardText.split(', ');
  expect(new Set(copiedEmails.map((email) => email.toLowerCase())).size).toBe(
    copiedEmails.length,
  );
  expect(copiedEmails.toSorted()).toEqual(expectedEmails);
});
