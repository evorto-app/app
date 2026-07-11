import { createId } from '@db/create-id';
import * as schema from '@db/schema';
import type { Page } from '@playwright/test';
import { and, eq, inArray } from 'drizzle-orm';

import {
  adminStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { waitForRegistrationPage } from '../../support/utils/event-registration-page';
import {
  earliestServerOrWallNow,
  futureServerEventWindow,
} from '../../support/utils/server-test-clock';

test.use({ trace: 'retain-on-failure' });

const requireUserFixture = (
  role: (typeof usersToAuthenticate)[number]['roles'],
) => {
  const user = usersToAuthenticate.find(
    (candidate) => candidate.roles === role,
  );
  if (!user) {
    throw new Error(`Expected the ${role} user fixture`);
  }

  return user;
};

const openEventFromNormalNavigation = async (
  page: Page,
  eventTitle: string,
): Promise<void> => {
  await page.goto('.');
  const eventsLink = page
    .getByRole('link', { exact: true, name: 'Events' })
    .first();
  await expect(eventsLink).toBeVisible();
  await eventsLink.click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Events' }).first(),
  ).toBeVisible();

  const eventLink = page.getByRole('link', { name: eventTitle }).first();
  await expect(eventLink).toBeVisible({ timeout: 20_000 });
  await eventLink.click();
  await expect(
    page.getByRole('heading', { level: 1, name: eventTitle }),
  ).toBeVisible({ timeout: 15_000 });
  await waitForRegistrationPage(page);
};

test.describe('Participant registration cancellation', () => {
  test.use({ storageState: userStateFile });

  test('Cancel a confirmed paid registration and understand its refund', async ({
    database,
    page,
    seeded,
    tenant,
  }, testInfo) => {
    const participant = requireUserFixture('user');
    const eventCreator = requireUserFixture('organizer');
    const waitlistedParticipant = requireUserFixture('admin');
    const template = seeded.templates[0];
    if (!template) {
      throw new Error('Expected a seeded template for cancellation docs');
    }
    const waitlistedParticipantRecord = await database.query.users.findFirst({
      where: { id: waitlistedParticipant.id },
    });
    const participantRecord = await database.query.users.findFirst({
      where: { id: participant.id },
    });
    if (!participantRecord) {
      throw new Error('Expected the cancelling participant record');
    }
    if (!waitlistedParticipantRecord) {
      throw new Error('Expected the waitlisted participant record');
    }

    const eventId = createId();
    const optionId = createId();
    const registrationId = createId();
    const waitlistRegistrationId = createId();
    const sourceTransactionId = createId();
    const eventTitle = 'Paid registration cancellation guide';
    const eventWindow = futureServerEventWindow();
    const cancellationEmailKey = `registration-cancelled/${tenant.id}/${registrationId}`;
    const waitlistEmailKey = `waitlist-spot-available/${tenant.id}/${waitlistRegistrationId}/cancellation-${registrationId}`;

    try {
      await database.insert(schema.eventInstances).values({
        creatorId: eventCreator.id,
        description:
          'A confirmed paid registration used to explain cancellation and refund handling.',
        end: eventWindow.end,
        icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
        id: eventId,
        start: eventWindow.start,
        status: 'APPROVED',
        templateId: template.id,
        tenantId: tenant.id,
        title: eventTitle,
        unlisted: false,
      });
      await database.insert(schema.eventRegistrationOptions).values({
        cancellationDeadlineHoursBeforeStart: 0,
        closeRegistrationTime: eventWindow.closeRegistrationTime,
        confirmedSpots: 2,
        eventId,
        id: optionId,
        isPaid: true,
        openRegistrationTime: eventWindow.openRegistrationTime,
        organizingRegistration: false,
        price: 2400,
        registrationMode: 'fcfs',
        roleIds: [],
        spots: 2,
        title: 'Paid participant',
        waitlistSpots: 1,
      });
      await database.insert(schema.eventRegistrations).values([
        {
          basePriceAtRegistration: 2400,
          eventId,
          guestCount: 1,
          id: registrationId,
          registrationOptionId: optionId,
          status: 'CONFIRMED',
          tenantId: tenant.id,
          userId: participant.id,
        },
        {
          eventId,
          id: waitlistRegistrationId,
          registrationOptionId: optionId,
          status: 'WAITLIST',
          tenantId: tenant.id,
          userId: waitlistedParticipant.id,
        },
      ]);
      await database.insert(schema.transactions).values({
        amount: 2400,
        currency: tenant.currency,
        eventId,
        eventRegistrationId: registrationId,
        id: sourceTransactionId,
        method: 'cash',
        status: 'successful',
        targetUserId: participant.id,
        tenantId: tenant.id,
        type: 'registration',
      });

      await testInfo.attach('markdown', {
        body: `
{% callout type="note" title="Before you start" %}
This guide is for a signed-in participant cancelling their own confirmed registration. The account, event, registration, and original payment must all belong to the same tenant. Ordinary self-service cancellation needs no organizer permission, but it is available only before the event and before the participant cancellation deadline configured on the registration option or tenant.

This example has one guest, so cancelling releases two occupied spots. It uses a completed non-Stripe payment to show the deterministic manual-refund path. A completed Stripe payment instead needs a valid payment reference, fee allocation, and connected-account match before Evorto will cancel anything.

This generated journey does not call a live Stripe account and therefore does not certify provider-side refund delivery. It proves the local manual-refund obligation, while Stripe refund processing and recovery require the separate payment-provider verification appropriate to that environment.
{% /callout %}

# Cancel a confirmed registration

1. Sign in as the participant who owns the ticket.
2. Open **Events** from the main navigation.
3. Select the event, then find the confirmed registration on its details page.
4. Read the cancellation explanation before selecting **Cancel registration**.
`,
      });

      await openEventFromNormalNavigation(page, eventTitle);
      const activeRegistration = page.locator('app-event-active-registration');
      await expect(activeRegistration).toBeVisible();
      await expect(
        activeRegistration.getByText('Your registration is confirmed'),
      ).toBeVisible();
      await expect(
        activeRegistration.getByText(
          'This cancels your confirmed registration and releases all selected spots. If this was paid, Evorto submits a Stripe refund when the original payment reference is available; otherwise it creates a pending manual refund record for organizers.',
          { exact: true },
        ),
      ).toBeVisible();
      const cancelRegistration = activeRegistration.getByRole('button', {
        exact: true,
        name: 'Cancel registration',
      });
      await expect(cancelRegistration).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await testInfo.attach('markdown', {
        body: `
{% callout type="warning" title="Review the confirmation carefully" %}
Selecting **Cancel registration** opens a confirmation that explains the capacity and refund impact. **Keep registration** is focused by default so an accidental Enter key does not cancel the ticket. Continue only when you intend to give up the participant and guest spots and start the applicable refund process.
{% /callout %}

For a paid ticket, cancellation is deliberately fail-closed. If payment ownership, fee allocation, an add-on payment, an active transfer, or Stripe Checkout state cannot be proven safe, Evorto leaves the registration, refund records, and capacity unchanged and shows a recovery message instead. The confirmed status and payment state are also checked again under the server lock; if either changed while this dialog was open, refresh the event and review the new consequences before confirming again.
`,
      });
      await takeScreenshot(
        testInfo,
        activeRegistration,
        page,
        'Review a confirmed paid registration before cancelling',
      );

      // The server-rendered action is visible before Angular attaches its live
      // handler. Event replay removes this marker once the click is safe.
      await expect(cancelRegistration).not.toHaveAttribute(
        'jsaction',
        /click/,
        { timeout: 20_000 },
      );
      await cancelRegistration.click();
      const cancellationDialog = page.getByRole('dialog');
      await expect(cancellationDialog).toBeVisible();
      await expect(
        cancellationDialog.getByRole('heading', {
          name: 'Cancel your registration?',
        }),
      ).toBeVisible();
      await expect(cancellationDialog).toContainText(
        'If a payment exists, Evorto starts the applicable refund workflow',
      );
      const keepRegistration = cancellationDialog.getByRole('button', {
        name: 'Keep registration',
      });
      await expect(keepRegistration).toBeFocused();
      await expect(activeRegistration).toBeVisible();
      await takeScreenshot(
        testInfo,
        cancellationDialog,
        page,
        'Confirm the participant cancellation and refund impact',
      );
      await cancellationDialog
        .getByRole('button', { name: 'Confirm cancellation' })
        .click();
      await expect(activeRegistration).toHaveCount(0, { timeout: 15_000 });
      await expect(
        page.getByRole('button', { name: /Pay .* and register/ }).first(),
      ).toBeVisible();

      const persistedRegistration =
        await database.query.eventRegistrations.findFirst({
          where: { id: registrationId, tenantId: tenant.id },
        });
      const persistedOption =
        await database.query.eventRegistrationOptions.findFirst({
          columns: {
            confirmedSpots: true,
            waitlistSpots: true,
          },
          where: { id: optionId },
        });
      const manualRefunds = await database.query.transactions.findMany({
        where: {
          sourceTransactionId,
          tenantId: tenant.id,
          type: 'refund',
        },
      });
      const cancellationEmail = await database.query.emailOutbox.findFirst({
        where: {
          idempotencyKey: cancellationEmailKey,
          kind: 'registrationCancelled',
          tenantId: tenant.id,
        },
      });
      const waitlistEmail = await database.query.emailOutbox.findFirst({
        where: {
          idempotencyKey: waitlistEmailKey,
          kind: 'waitlistSpotAvailable',
          tenantId: tenant.id,
        },
      });

      expect(persistedRegistration?.status).toBe('CANCELLED');
      expect(persistedOption).toEqual({
        confirmedSpots: 0,
        waitlistSpots: 1,
      });
      expect(manualRefunds).toHaveLength(1);
      expect(manualRefunds[0]).toMatchObject({
        amount: -2400,
        currency: tenant.currency,
        eventId,
        eventRegistrationId: registrationId,
        executiveUserId: participant.id,
        manuallyCreated: true,
        method: 'cash',
        refundOperationKey: `registration-cancellation:${registrationId}:${sourceTransactionId}`,
        sourceTransactionId,
        status: 'pending',
        targetUserId: participant.id,
        tenantId: tenant.id,
        type: 'refund',
      });
      expect(cancellationEmail).toMatchObject({
        idempotencyKey: cancellationEmailKey,
        kind: 'registrationCancelled',
        tenantId: tenant.id,
        toEmail: participantRecord.communicationEmail,
      });
      expect(cancellationEmail?.text).toContain(
        `You cancelled your registration for ${eventTitle}.`,
      );
      expect(cancellationEmail?.text).toContain(`/events/${eventId}`);
      expect(waitlistEmail).toMatchObject({
        idempotencyKey: waitlistEmailKey,
        kind: 'waitlistSpotAvailable',
        tenantId: tenant.id,
        toEmail: waitlistedParticipantRecord.communicationEmail,
      });
      expect(waitlistEmail?.text).toContain(
        `A spot may now be available for ${eventTitle}.`,
      );
      expect(waitlistEmail?.text).toContain(
        'This message is informational and does not reserve a spot.',
      );

      await testInfo.attach('markdown', {
        body: `
## What completion means

The confirmed ticket disappears and the event offers registration again because the cancellation committed. The durable readback proves that Evorto:

- marks the registration **CANCELLED**;
- releases both the participant and guest spots;
- creates one pending manual refund linked to the original non-Stripe payment;
- queues a cancellation email for the former ticket owner; and
- tells the waitlisted participant that capacity may be available.

The waitlist message is not a reservation or automatic promotion. A waitlisted participant must open the event, leave the waitlist, and register while capacity is still available.

The participant page does not currently expose refund controls or manual-refund completion. **Pending manual refund** means organizer follow-up is still required; it does not mean money has already been returned. Do not register again merely to retry the refund.
`,
      });
      await takeScreenshot(
        testInfo,
        page
          .locator('section')
          .filter({
            has: page.getByRole('heading', {
              level: 2,
              name: 'Registration',
            }),
          })
          .first(),
        page,
        'Registration options after confirmed cancellation',
      );
    } finally {
      await database
        .delete(schema.emailOutbox)
        .where(
          inArray(schema.emailOutbox.idempotencyKey, [
            cancellationEmailKey,
            waitlistEmailKey,
          ]),
        );
      await database
        .delete(schema.transactions)
        .where(
          and(
            eq(schema.transactions.eventRegistrationId, registrationId),
            eq(schema.transactions.type, 'refund'),
          ),
        );
      await database
        .delete(schema.transactions)
        .where(eq(schema.transactions.id, sourceTransactionId));
      await database
        .delete(schema.eventRegistrations)
        .where(
          inArray(schema.eventRegistrations.id, [
            registrationId,
            waitlistRegistrationId,
          ]),
        );
      await database
        .delete(schema.eventRegistrationOptions)
        .where(eq(schema.eventRegistrationOptions.id, optionId));
      await database
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.id, eventId));
    }
  });

  test('Understand a participant cancellation deadline block', async ({
    database,
    page,
    seeded,
    tenant,
  }, testInfo) => {
    const participant = requireUserFixture('user');
    const eventCreator = requireUserFixture('admin');
    const template = seeded.templates[0];
    if (!template) {
      throw new Error('Expected a seeded template for cancellation docs');
    }

    const eventId = createId();
    const optionId = createId();
    const registrationId = createId();
    const sourceTransactionId = createId();
    const eventTitle = 'Cancellation deadline recovery guide';
    const eventWindow = futureServerEventWindow();
    const passedDeadlineHours = Math.max(
      1,
      Math.ceil(
        (eventWindow.start.getTime() - earliestServerOrWallNow().getTime()) /
          (60 * 60 * 1000),
      ) + 24,
    );
    const cancellationEmailKey = `registration-cancelled/${tenant.id}/${registrationId}`;
    const deadlineMessage =
      'The participant cancellation deadline has passed, so this request did not cancel the registration, create a refund, or release its spots.';

    try {
      await database.insert(schema.eventInstances).values({
        creatorId: eventCreator.id,
        description:
          'A paid registration whose participant cancellation deadline has passed.',
        end: eventWindow.end,
        icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
        id: eventId,
        start: eventWindow.start,
        status: 'APPROVED',
        templateId: template.id,
        tenantId: tenant.id,
        title: eventTitle,
        unlisted: false,
      });
      await database.insert(schema.eventRegistrationOptions).values({
        cancellationDeadlineHoursBeforeStart: passedDeadlineHours,
        closeRegistrationTime: eventWindow.closeRegistrationTime,
        confirmedSpots: 1,
        eventId,
        id: optionId,
        isPaid: true,
        openRegistrationTime: eventWindow.openRegistrationTime,
        organizingRegistration: false,
        price: 1200,
        registrationMode: 'fcfs',
        roleIds: [],
        spots: 5,
        title: 'Deadline-controlled participant',
      });
      await database.insert(schema.eventRegistrations).values({
        basePriceAtRegistration: 1200,
        eventId,
        id: registrationId,
        registrationOptionId: optionId,
        status: 'CONFIRMED',
        tenantId: tenant.id,
        userId: participant.id,
      });
      await database.insert(schema.transactions).values({
        amount: 1200,
        currency: tenant.currency,
        eventId,
        eventRegistrationId: registrationId,
        id: sourceTransactionId,
        method: 'cash',
        status: 'successful',
        targetUserId: participant.id,
        tenantId: tenant.id,
        type: 'registration',
      });

      await testInfo.attach('markdown', {
        body: `
# When self-service cancellation is closed

The registration option can override the tenant's default cancellation deadline. In this example, the option's deadline is deliberately set before the current server time, so participant cancellation has already closed.

Open **Events**, select the event, and review the confirmed ticket. Select **Cancel registration**, review the impact, then select **Confirm cancellation**. The server rechecks the current deadline only after that confirmation and rejects the request without changing the ticket.
`,
      });
      await openEventFromNormalNavigation(page, eventTitle);
      const activeRegistration = page.locator('app-event-active-registration');
      const cancelRegistration = activeRegistration.getByRole('button', {
        exact: true,
        name: 'Cancel registration',
      });
      await expect(cancelRegistration).toBeVisible();
      await expect(cancelRegistration).not.toHaveAttribute(
        'jsaction',
        /click/,
        { timeout: 20_000 },
      );
      await cancelRegistration.click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Confirm cancellation' })
        .click();

      const deadlineAlert = page.getByRole('alert').filter({
        hasText: deadlineMessage,
      });
      await expect(deadlineAlert).toBeVisible();
      await expect(activeRegistration).toBeVisible();
      await expect(
        activeRegistration.getByText('Your registration is confirmed'),
      ).toBeVisible();

      const persistedRegistration =
        await database.query.eventRegistrations.findFirst({
          where: { id: registrationId, tenantId: tenant.id },
        });
      const persistedOption =
        await database.query.eventRegistrationOptions.findFirst({
          columns: { confirmedSpots: true },
          where: { id: optionId },
        });
      const refunds = await database.query.transactions.findMany({
        where: {
          eventRegistrationId: registrationId,
          tenantId: tenant.id,
          type: 'refund',
        },
      });
      const cancellationEmail = await database.query.emailOutbox.findFirst({
        where: {
          idempotencyKey: cancellationEmailKey,
          tenantId: tenant.id,
        },
      });

      expect(persistedRegistration?.status).toBe('CONFIRMED');
      expect(persistedOption).toEqual({ confirmedSpots: 1 });
      expect(refunds).toEqual([]);
      expect(cancellationEmail).toBeUndefined();

      await testInfo.attach('markdown', {
        body: `
{% callout type="warning" title="Nothing was partially changed" %}
The deadline alert means the ticket remains confirmed, the occupied spot remains counted, no refund record exists, and no cancellation email was queued. Refreshing or repeatedly selecting the same action does not override the policy.
{% /callout %}

Contact an event organizer if the registration still needs operational handling. An organizer who can organize this event and has **Cancel registrations and add-ons** access may cancel an unchecked registration before the event starts; participant deadline expiry alone does not grant the participant an override.

Other recoverable messages are equally literal: when payment fees are still reconciling, retry later; when pending Stripe Checkout cancellation cannot be confirmed, refresh before retrying; and when an add-on payment or transfer is active, finish or resolve that workflow first. Evorto keeps the registration and capacity intact until the prerequisite is proven.

Self-service cancellation is always scoped to the signed-in user's own registration and current tenant. Changing a URL or registration identifier does not grant access to another participant's ticket. Organizer cancellation is rechecked on the server for the event, tenant, organizer relationship, and explicit cancellation permission.
`,
      });
      await takeScreenshot(
        testInfo,
        deadlineAlert,
        page,
        'Participant cancellation blocked after the deadline',
      );
    } finally {
      await database
        .delete(schema.emailOutbox)
        .where(eq(schema.emailOutbox.idempotencyKey, cancellationEmailKey));
      await database
        .delete(schema.transactions)
        .where(
          and(
            eq(schema.transactions.eventRegistrationId, registrationId),
            eq(schema.transactions.type, 'refund'),
          ),
        );
      await database
        .delete(schema.transactions)
        .where(eq(schema.transactions.id, sourceTransactionId));
      await database
        .delete(schema.eventRegistrations)
        .where(eq(schema.eventRegistrations.id, registrationId));
      await database
        .delete(schema.eventRegistrationOptions)
        .where(eq(schema.eventRegistrationOptions.id, optionId));
      await database
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.id, eventId));
    }
  });
});

test.describe('Organizer registration cancellation', () => {
  test.use({ storageState: adminStateFile });

  test('Cancel a participant registration from the organizer overview', async ({
    database,
    page,
    seeded,
    tenant,
  }, testInfo) => {
    const organizer = requireUserFixture('admin');
    const participant = requireUserFixture('user');
    const template = seeded.templates[0];
    if (!template) {
      throw new Error('Expected a seeded template for cancellation docs');
    }
    const participantRecord = await database.query.users.findFirst({
      where: { id: participant.id },
    });
    if (!participantRecord) {
      throw new Error('Expected the organizer-cancellation participant');
    }

    const eventId = createId();
    const optionId = createId();
    const registrationId = createId();
    const eventTitle = 'Organizer cancellation guide';
    const eventWindow = futureServerEventWindow();
    const passedDeadlineHours = Math.max(
      1,
      Math.ceil(
        (eventWindow.start.getTime() - earliestServerOrWallNow().getTime()) /
          (60 * 60 * 1000),
      ) + 24,
    );
    const cancellationEmailKey = `registration-cancelled/${tenant.id}/${registrationId}`;
    const participantName = `${participantRecord.firstName} ${participantRecord.lastName}`;

    try {
      await database.insert(schema.eventInstances).values({
        creatorId: organizer.id,
        description:
          'An event used to explain an organizer cancelling a participant registration.',
        end: eventWindow.end,
        icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
        id: eventId,
        start: eventWindow.start,
        status: 'APPROVED',
        templateId: template.id,
        tenantId: tenant.id,
        title: eventTitle,
        unlisted: false,
      });
      await database.insert(schema.eventRegistrationOptions).values({
        cancellationDeadlineHoursBeforeStart: passedDeadlineHours,
        closeRegistrationTime: eventWindow.closeRegistrationTime,
        confirmedSpots: 2,
        eventId,
        id: optionId,
        isPaid: false,
        openRegistrationTime: eventWindow.openRegistrationTime,
        organizingRegistration: false,
        price: 0,
        registrationMode: 'fcfs',
        roleIds: [],
        spots: 10,
        title: 'Participant',
      });
      await database.insert(schema.eventRegistrations).values({
        basePriceAtRegistration: 0,
        eventId,
        guestCount: 1,
        id: registrationId,
        registrationOptionId: optionId,
        status: 'CONFIRMED',
        tenantId: tenant.id,
        userId: participant.id,
      });

      await testInfo.attach('markdown', {
        body: `
{% callout type="note" title="Organizer prerequisites" %}
Use an account that can organize this exact event and has **Cancel registrations and add-ons** access. Route access by itself is insufficient: Evorto checks the current tenant, event-organizer relationship, and cancellation permission again for the mutation.

The target registration must belong to this event and tenant, remain unchecked, and precede the event start. This example is free and includes one guest. A participant cancellation deadline has already passed, but that participant deadline does not prevent an authorized organizer from handling the registration.
{% /callout %}

# Cancel from the organizer overview

1. Open **Events** from the main navigation.
2. Select the event.
3. Select **Organize this event**.
4. Under **Participants**, find the correct person and registration option.
5. Verify that the attendee has not checked in, then select **Cancel registration**.
`,
      });

      await openEventFromNormalNavigation(page, eventTitle);
      const organizeEvent = page.getByRole('link', {
        exact: true,
        name: 'Organize this event',
      });
      await expect(organizeEvent).toBeVisible();
      await organizeEvent.click();
      await expect(page).toHaveURL(`/events/${eventId}/organize`);
      await expect(
        page.getByRole('heading', { level: 1, name: eventTitle }),
      ).toBeVisible();

      const participantRow = page
        .locator('div.bg-surface-container-high')
        .filter({ hasText: participantName });
      await expect(participantRow).toHaveCount(1);
      const cancelRegistration = participantRow.getByRole('button', {
        exact: true,
        name: 'Cancel registration',
      });
      await expect(cancelRegistration).toBeEnabled();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await testInfo.attach('markdown', {
        body: `
The participant name and registration option are the first review context. Selecting the organizer action opens a second confirmation naming the participant and explaining that capacity is released and a payment may require refund follow-up. **Keep registration** is focused by default. Checked-in registrations show cancellation as disabled and are rejected by the server as well.
`,
      });
      await takeScreenshot(
        testInfo,
        participantRow,
        page,
        'Review the participant before organizer cancellation',
      );
      await expect(cancelRegistration).not.toHaveAttribute(
        'jsaction',
        /click/,
        { timeout: 20_000 },
      );
      await cancelRegistration.click();
      const cancellationDialog = page.getByRole('dialog');
      await expect(cancellationDialog).toBeVisible();
      await expect(
        cancellationDialog.getByRole('heading', {
          name: `Cancel ${participantName}'s registration?`,
        }),
      ).toBeVisible();
      await expect(cancellationDialog).toContainText(
        'If a payment exists, Evorto starts the applicable refund workflow',
      );
      await expect(
        cancellationDialog.getByRole('button', {
          name: 'Keep registration',
        }),
      ).toBeFocused();
      await takeScreenshot(
        testInfo,
        cancellationDialog,
        page,
        'Confirm the organizer cancellation for the named participant',
      );
      await cancellationDialog
        .getByRole('button', { name: 'Confirm cancellation' })
        .click();

      await expect(
        page.getByText('Registration cancelled', { exact: true }),
      ).toBeVisible();
      await expect(participantRow).toHaveCount(0, { timeout: 15_000 });

      const persistedRegistration =
        await database.query.eventRegistrations.findFirst({
          where: { id: registrationId, tenantId: tenant.id },
        });
      const persistedOption =
        await database.query.eventRegistrationOptions.findFirst({
          columns: { confirmedSpots: true },
          where: { id: optionId },
        });
      const refunds = await database.query.transactions.findMany({
        where: {
          eventRegistrationId: registrationId,
          tenantId: tenant.id,
          type: 'refund',
        },
      });
      const cancellationEmail = await database.query.emailOutbox.findFirst({
        where: {
          idempotencyKey: cancellationEmailKey,
          kind: 'registrationCancelled',
          tenantId: tenant.id,
        },
      });

      expect(persistedRegistration?.status).toBe('CANCELLED');
      expect(persistedOption).toEqual({ confirmedSpots: 0 });
      expect(refunds).toEqual([]);
      expect(cancellationEmail).toMatchObject({
        idempotencyKey: cancellationEmailKey,
        kind: 'registrationCancelled',
        tenantId: tenant.id,
        toEmail: participantRecord.communicationEmail,
      });
      expect(cancellationEmail?.text).toContain(
        `An organizer cancelled your registration for ${eventTitle}.`,
      );

      await testInfo.attach('markdown', {
        body: `
## Organizer completion and recovery

The success message and disappearing participant row show the organizer write completed. The persisted registration is **CANCELLED**, both participant and guest spots are released, and the participant receives an email that identifies the organizer cancellation. This free registration creates no refund.

For a paid confirmed registration, Evorto must first prove the original payment and add-on allocations. A valid Stripe source creates a durable refund claim and attempts it immediately; if that attempt fails, the existing claim remains pending for the retry worker rather than cancelling the ticket twice. A supported non-Stripe source creates a pending manual refund for organizer follow-up. Ambiguous payment ownership or amounts block the entire cancellation, leaving the ticket and inventory unchanged for reconciliation.

This organizer example is free and does not certify a live Stripe refund. Use the persisted refund status and the environment's provider-certification evidence before telling a participant that money has been returned.

An active transfer, pending add-on Checkout, checked-in attendee, started event, cross-tenant identifier, or missing cancellation permission also blocks the operation. The server also rejects a status or payment-state change that happened while the confirmation was open, so the organizer must refresh and review the updated participant state. Resolve the specific state shown by Evorto; do not work around it by editing identifiers or creating a duplicate refund.
`,
      });
      await takeScreenshot(
        testInfo,
        page.locator('section').filter({
          has: page.getByRole('heading', {
            level: 2,
            name: 'Participants',
          }),
        }),
        page,
        'Organizer overview after participant cancellation',
      );
    } finally {
      await database
        .delete(schema.emailOutbox)
        .where(eq(schema.emailOutbox.idempotencyKey, cancellationEmailKey));
      await database
        .delete(schema.transactions)
        .where(eq(schema.transactions.eventRegistrationId, registrationId));
      await database
        .delete(schema.eventRegistrations)
        .where(eq(schema.eventRegistrations.id, registrationId));
      await database
        .delete(schema.eventRegistrationOptions)
        .where(eq(schema.eventRegistrationOptions.id, optionId));
      await database
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.id, eventId));
    }
  });
});
