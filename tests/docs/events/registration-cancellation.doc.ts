import { createId } from '@db/create-id';
import * as schema from '@db/schema';
import type { Page } from '@playwright/test';
import { allocateAcquisitionComponentQuantity } from '@server/registrations/registration-acquisition-refund';
import { and, eq, inArray } from 'drizzle-orm';

import {
  adminStateFile,
  gaStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import { waitForRegistrationPage } from '../../support/utils/event-registration-page';
import { seedPostRegistrationAddonPurchaseScenario } from '../../support/utils/post-registration-addon-purchase-scenario';
import { deliverRegistrationRefundWebhook } from '../../support/utils/registration-checkout-webhook';
import { deleteRegistrationAcquisitionLedger } from '../../support/utils/registration-acquisition-cleanup';
import { waitForScannerAddonFulfillment } from '../../support/utils/scanner-result-page';
import {
  earliestServerOrWallNow,
  futureServerEventWindow,
} from '../../support/utils/server-test-clock';

test.use({ trace: 'off' });

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

const openProfileEventCard = async (page: Page, eventTitle: string) => {
  const eventsSection = page.getByRole('button', {
    exact: true,
    name: 'Events',
  });
  await expect(eventsSection).toBeVisible();
  await expect(page.locator('[ngh]')).toHaveCount(0, { timeout: 20_000 });
  await eventsSection.click();
  await expect(
    page.getByRole('heading', { name: 'Your Event Registrations' }),
  ).toBeVisible();
  const card = page.locator('article').filter({ hasText: eventTitle });
  await expect(card).toBeVisible({ timeout: 20_000 });
  return card;
};

test.describe('Participant registration cancellation', () => {
  test.use({ storageState: userStateFile });

  test('Cancel a confirmed free registration and release its capacity', async ({
    browser,
    database,
    page,
    seeded,
    tenant,
    testClock,
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
    const registrationAcquisitionId = createId();
    const waitlistRegistrationId = createId();
    const eventTitle = 'Free registration cancellation guide';
    const eventWindow = futureServerEventWindow();
    const cancellationEmailKey = `registration-cancelled/${tenant.id}/${registrationId}`;
    const waitlistEmailKey = `waitlist-spot-available/${tenant.id}/${waitlistRegistrationId}/cancellation-${registrationId}`;
    let waitlistRecipientPage:
      Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;
    let followUpRegistrationId: string | undefined;
    let followUpConfirmationEmailKey: string | undefined;

    try {
      await database.insert(schema.eventInstances).values({
        creatorId: eventCreator.id,
        description:
          'A confirmed free registration used to explain cancellation and capacity handling.',
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
        isPaid: false,
        openRegistrationTime: eventWindow.openRegistrationTime,
        organizingRegistration: false,
        price: 0,
        registrationMode: 'fcfs',
        roleIds: [],
        spots: 2,
        title: 'Free participant',
        waitlistSpots: 1,
      });
      // Keep shared authenticated-user FK locks in separate autocommit
      // statements so parallel guides cannot form a cross-user lock cycle.
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
      const acquiredAt = earliestServerOrWallNow();
      await database.insert(schema.registrationAcquisitions).values({
        acquiredAt,
        eventId,
        id: registrationAcquisitionId,
        kind: 'initial',
        operationKey: `registration-initial:${registrationId}`,
        ordinal: 0,
        ownerUserId: participant.id,
        registrationId,
        spotCount: 2,
        tenantId: tenant.id,
      });
      await database.insert(schema.registrationAcquisitionComponents).values({
        acquiredAt,
        acquisitionId: registrationAcquisitionId,
        allocationKey: `registration-initial:${registrationId}`,
        applicationFeeAmount: 0,
        baseAmount: 0,
        currency: tenant.currency,
        eventId,
        grossAmount: 0,
        kind: 'registration',
        netAmount: 0,
        quantity: 2,
        registrationId,
        stripeFeeAmount: 0,
        taxAmount: 0,
        tenantId: tenant.id,
      });
      await database.insert(schema.eventRegistrations).values({
        eventId,
        id: waitlistRegistrationId,
        registrationOptionId: optionId,
        status: 'WAITLIST',
        tenantId: tenant.id,
        userId: waitlistedParticipant.id,
      });
      await testInfo.attach('markdown', {
        body: `
{% callout type="note" title="Before you start" %}
This guide is for a signed-in participant cancelling their own confirmed free registration. The account, event, and registration must all belong to the same organization. Ordinary self-service cancellation needs no organizer access, but it is available only before the event and before the participant cancellation deadline configured for the registration option or organization.

This example has one guest, so cancelling releases two occupied spots. The registration is free and creates no refund. The later Stripe add-on example shows that Evorto leaves the ticket, inventory, and refund unchanged when payment safety cannot be confirmed, together with the audited recovery path, without claiming live bank or card-network settlement.
{% /callout %}

### Cancel a confirmed registration

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
          'This cancels your confirmed registration and releases all selected spots.',
          { exact: false },
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

This free registration has no refund obligation. Paid tickets and paid add-ons use Stripe. If Evorto cannot safely confirm the payments, refunds, an active transfer, or Checkout state, it leaves the registration, refund status, and capacity unchanged and shows a recovery message instead. Evorto checks the confirmed and payment state again when cancellation is submitted; if either changed while this dialog was open, refresh the event and review the new consequences before confirming again.
`,
      });
      await takeScreenshot(
        testInfo,
        activeRegistration,
        page,
        'Review a confirmed free registration before cancelling',
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
        'If a refund applies, Evorto starts it automatically; it may take time to appear.',
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
        'Confirm the participant cancellation and capacity impact',
      );
      await cancellationDialog
        .getByRole('button', { name: 'Confirm cancellation' })
        .click();
      await expect(activeRegistration).toHaveCount(0, { timeout: 15_000 });
      await expect(
        page.getByRole('button', { exact: true, name: 'Register' }).first(),
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
      expect(refunds).toEqual([]);
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
### What completion means

The confirmed ticket disappears and the event offers registration again because the cancellation committed. The durable readback proves that Evorto:

- marks the registration **Cancelled**;
- releases both the participant and guest spots;
- creates no refund because the registration is free;
- queues a cancellation email for the former ticket owner; and
- tells the waitlisted participant that capacity may be available.

The waitlist message is not a reservation or automatic promotion. A waitlisted participant must open the event, leave the waitlist, and register while capacity is still available.
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

      const eventPath = waitlistEmail?.text.match(/\/events\/[\w-]+/u)?.[0];
      expect(eventPath).toBe(`/events/${eventId}`);
      if (!eventPath) {
        throw new Error(
          'Expected the waitlist availability email to contain the event path',
        );
      }

      await testInfo.attach('markdown', {
        body: `
### Follow the waitlist message as its recipient

The availability message sends the waitlisted participant back to this event. It does **not** reserve capacity and it does not silently promote the waitlist registration. Other eligible participants can still take the open spot first.

1. Sign in as the account that received the message.
2. Open the event link from that message. The link opens the signed-in event page; it does not grant access to a ticket.
3. Confirm that the page still shows **You are currently on the waitlist**.
4. Select **Leave waitlist**, review the warning, and confirm only if registration is still available.
5. Select **Register** immediately. If the option became full before this step, do not expect the email to override capacity; remain on or rejoin the waitlist instead.
`,
      });

      waitlistRecipientPage = await openAuthenticatedTestPage({
        baseUrl: new URL(page.url()).origin,
        browser,
        storageState: adminStateFile,
        tenantDomain: tenant.domain,
        testClock,
      });
      const recipientPage = waitlistRecipientPage.page;
      await recipientPage.goto(eventPath);
      await waitForRegistrationPage(recipientPage);
      await expect(
        recipientPage.getByText('You are currently on the waitlist'),
      ).toBeVisible();
      await takeScreenshot(
        testInfo,
        recipientPage.locator('app-event-active-registration'),
        recipientPage,
        'Waitlist recipient opens the availability message link',
      );

      await recipientPage
        .getByRole('button', { name: 'Leave waitlist' })
        .click();
      const leaveWaitlistDialog = recipientPage.getByRole('dialog');
      await expect(
        leaveWaitlistDialog.getByRole('heading', {
          name: 'Leave the waitlist?',
        }),
      ).toBeVisible();
      await expect(
        leaveWaitlistDialog.getByRole('button', {
          name: 'Keep registration',
        }),
      ).toBeFocused();
      await takeScreenshot(
        testInfo,
        leaveWaitlistDialog,
        recipientPage,
        'Waitlist recipient confirms giving up their old position',
      );
      await leaveWaitlistDialog
        .getByRole('button', { name: 'Leave waitlist' })
        .click();

      const recipientRegisterButton = recipientPage
        .getByRole('button', { exact: true, name: 'Register' })
        .first();
      await expect(recipientRegisterButton).toBeEnabled({ timeout: 20_000 });
      await takeScreenshot(
        testInfo,
        recipientPage
          .locator('section')
          .filter({
            has: recipientPage.getByRole('heading', {
              level: 2,
              name: 'Registration',
            }),
          })
          .first(),
        recipientPage,
        'Capacity remains available after leaving the waitlist',
      );
      await recipientRegisterButton.click();
      await expect(
        recipientPage
          .locator('app-event-active-registration')
          .getByText('Your registration is confirmed'),
      ).toBeVisible({ timeout: 20_000 });

      const followUpRegistration =
        await database.query.eventRegistrations.findFirst({
          where: {
            eventId,
            registrationOptionId: optionId,
            status: 'CONFIRMED',
            tenantId: tenant.id,
            userId: waitlistedParticipant.id,
          },
        });
      if (!followUpRegistration) {
        throw new Error(
          'Expected the waitlist recipient to persist a new confirmed registration',
        );
      }
      followUpRegistrationId = followUpRegistration.id;
      followUpConfirmationEmailKey = `registration-confirmed/${tenant.id}/${followUpRegistration.id}`;

      const cancelledWaitlistRegistration =
        await database.query.eventRegistrations.findFirst({
          where: {
            id: waitlistRegistrationId,
            tenantId: tenant.id,
          },
        });
      const optionAfterFollowUp =
        await database.query.eventRegistrationOptions.findFirst({
          columns: {
            confirmedSpots: true,
            waitlistSpots: true,
          },
          where: { id: optionId },
        });
      const followUpConfirmationEmail =
        await database.query.emailOutbox.findFirst({
          where: {
            idempotencyKey: followUpConfirmationEmailKey,
            kind: 'registrationConfirmed',
            tenantId: tenant.id,
          },
        });

      expect(cancelledWaitlistRegistration?.status).toBe('CANCELLED');
      expect(followUpRegistration).toMatchObject({
        guestCount: 0,
        status: 'CONFIRMED',
        userId: waitlistedParticipant.id,
      });
      expect(optionAfterFollowUp).toEqual({
        confirmedSpots: 1,
        waitlistSpots: 0,
      });
      expect(followUpConfirmationEmail).toMatchObject({
        idempotencyKey: followUpConfirmationEmailKey,
        kind: 'registrationConfirmed',
        tenantId: tenant.id,
        toEmail: waitlistedParticipantRecord.communicationEmail,
      });
      expect(followUpConfirmationEmail?.text).toContain(
        `Your registration for ${eventTitle} is confirmed.`,
      );
      expect(followUpConfirmationEmail?.text).toContain(eventPath);

      await testInfo.attach('markdown', {
        body: `
### What the recipient should see after registering

The old waitlist entry is now **Cancelled** and a separate **Confirmed** registration owns one spot. The option counters move from one waitlisted participant to one confirmed participant, and Evorto queues a confirmation email linking back to the authenticated ticket page.

This completes only the in-app follow-up. The earlier email still promised no reservation: success depends on capacity remaining when Evorto confirms **Register**.
`,
      });
      await takeScreenshot(
        testInfo,
        recipientPage.locator('app-event-active-registration'),
        recipientPage,
        'Waitlist recipient completes a confirmed registration',
      );
    } finally {
      await waitlistRecipientPage?.context.close();
      const persistedRegistrationIds = (
        await database.query.eventRegistrations.findMany({
          columns: { id: true },
          where: { eventId, tenantId: tenant.id },
        })
      ).map(({ id }) => id);
      const registrationIds = [
        ...new Set([
          registrationId,
          waitlistRegistrationId,
          ...persistedRegistrationIds,
          ...(followUpRegistrationId ? [followUpRegistrationId] : []),
        ]),
      ];
      const emailKeys = [
        cancellationEmailKey,
        waitlistEmailKey,
        ...registrationIds.map(
          (id) => `registration-confirmed/${tenant.id}/${id}`,
        ),
      ];
      if (followUpConfirmationEmailKey) {
        emailKeys.push(followUpConfirmationEmailKey);
      }
      await database
        .delete(schema.emailOutbox)
        .where(inArray(schema.emailOutbox.idempotencyKey, emailKeys));
      await database
        .delete(schema.transactions)
        .where(
          and(
            eq(schema.transactions.eventRegistrationId, registrationId),
            eq(schema.transactions.tenantId, tenant.id),
            eq(schema.transactions.type, 'refund'),
          ),
        );
      await deleteRegistrationAcquisitionLedger({
        database,
        registrationIds,
        tenantId: tenant.id,
      });
      await database
        .delete(schema.eventRegistrations)
        .where(inArray(schema.eventRegistrations.id, registrationIds));
      await database
        .delete(schema.eventRegistrationOptions)
        .where(eq(schema.eventRegistrationOptions.id, optionId));
      await database
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.id, eventId));
    }
  });

  test('Cancel a Stripe-backed registration with settled add-ons and recover its refund', async ({
    browser,
    database,
    page,
    registerDatabaseCleanup,
    request,
    seeded,
    tenant,
    testClock,
  }, testInfo) => {
    test.slow();
    const participant = requireUserFixture('user');
    const organizer = requireUserFixture('admin');
    const template = seeded.templates.find(
      (candidate) => candidate.seedKey === 'hike',
    );
    if (!template) {
      throw new Error(
        'Expected the hike template for Stripe cancellation docs',
      );
    }

    const scenario = await seedPostRegistrationAddonPurchaseScenario({
      database,
      paidIncludedQuantity: 1,
      templateId: template.id,
      tenant,
      testClock,
      title: 'Stripe add-on cancellation and refund recovery',
      userId: participant.id,
    });
    const cancellationEmailKey = `registration-cancelled/${tenant.id}/${scenario.registrationId}`;
    const generationZeroRefundId = `re_test_generation_zero_${createId()}`;
    const requiresActionWebhookEventId = `evt_test_${createId()}`;
    const failedWebhookEventId = `evt_test_${createId()}`;
    const recoveredRefundId = `re_test_recovered_${createId()}`;
    const recoveredWebhookEventId = `evt_test_${createId()}`;
    const resumeReason =
      'Verified the Stripe refund before resuming status checks';
    const newGenerationReason =
      'Verified the failed Stripe refund before scheduling recovery';
    let scannerPage:
      Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;
    let recoveryPage:
      Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

    registerDatabaseCleanup(() => scenario.cleanup());
    registerDatabaseCleanup(async (cleanupDatabase) => {
      await cleanupDatabase
        .delete(schema.platformAuditEntries)
        .where(
          and(
            eq(schema.platformAuditEntries.action, 'refundClaim.requeue'),
            inArray(schema.platformAuditEntries.reason, [
              resumeReason,
              newGenerationReason,
            ]),
            eq(schema.platformAuditEntries.targetTenantId, tenant.id),
          ),
        );
      await cleanupDatabase
        .delete(schema.stripeWebhookEvents)
        .where(
          inArray(schema.stripeWebhookEvents.stripeEventId, [
            requiresActionWebhookEventId,
            failedWebhookEventId,
            recoveredWebhookEventId,
          ]),
        );
      await cleanupDatabase
        .delete(schema.emailOutbox)
        .where(eq(schema.emailOutbox.idempotencyKey, cancellationEmailKey));
      await cleanupDatabase
        .delete(schema.registrationAcquisitionRefundAllocations)
        .where(
          and(
            eq(
              schema.registrationAcquisitionRefundAllocations.registrationId,
              scenario.registrationId,
            ),
            eq(
              schema.registrationAcquisitionRefundAllocations.tenantId,
              tenant.id,
            ),
          ),
        );
      await cleanupDatabase
        .delete(schema.eventRegistrationAddonFulfillmentEvents)
        .where(
          and(
            eq(
              schema.eventRegistrationAddonFulfillmentEvents.registrationId,
              scenario.registrationId,
            ),
            eq(
              schema.eventRegistrationAddonFulfillmentEvents.tenantId,
              tenant.id,
            ),
          ),
        );
      await cleanupDatabase
        .delete(schema.transactions)
        .where(
          and(
            eq(
              schema.transactions.eventRegistrationId,
              scenario.registrationId,
            ),
            eq(schema.transactions.tenantId, tenant.id),
            eq(schema.transactions.type, 'refund'),
          ),
        );
    });
    registerDatabaseCleanup(async () => {
      await recoveryPage?.context.close();
      await scannerPage?.context.close();
    });

    const settledCheckout = await scenario.beginPaidCheckout(2);
    expect(await scenario.completeCheckout()).toBe('finalized');
    const includedRedemption = await scenario.redeemPaidAddon(
      `cancellation-doc:${scenario.registrationId}:included`,
      organizer.id,
    );
    const purchasedRedemption = await scenario.redeemPaidAddon(
      `cancellation-doc:${scenario.registrationId}:purchased`,
      organizer.id,
    );
    const settledPurchase =
      await database.query.eventRegistrationAddonPurchases.findFirst({
        where: {
          addonId: scenario.addOns.paid.id,
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    const settledLot =
      await database.query.eventRegistrationAddonPurchaseLots.findFirst({
        where: {
          registrationId: scenario.registrationId,
          sourceTransactionId: settledCheckout.transactionId,
          tenantId: tenant.id,
        },
      });
    const stockBeforeCancellation = await database.query.eventAddons.findFirst({
      columns: { totalAvailableQuantity: true },
      where: { eventId: scenario.eventId, id: scenario.addOns.paid.id },
    });
    if (!settledPurchase || !settledLot) {
      throw new Error('Expected the settled add-on purchase and immutable lot');
    }
    expect(settledPurchase).toMatchObject({
      cancelledQuantity: 0,
      includedQuantity: 1,
      purchasedQuantity: 2,
      quantity: 3,
      redeemedQuantity: 2,
      refundAllocatedPurchasedQuantity: 0,
    });
    expect(settledLot).toMatchObject({
      applicationFeeAmount: 35,
      grossAmount: 1000,
      netAmount: 936,
      quantity: 2,
      redeemedQuantity: 1,
      sourceTransactionId: settledCheckout.transactionId,
      stripeFeeAmount: 29,
    });
    expect(stockBeforeCancellation).toEqual({ totalAvailableQuantity: 3 });
    const redemptionAllocations =
      await database.query.eventRegistrationAddonFulfillmentAllocations.findMany(
        {
          columns: {
            fulfillmentEventId: true,
            purchaseLotId: true,
            quantity: true,
            source: true,
          },
          where: {
            fulfillmentEventId: {
              in: [
                includedRedemption.fulfillmentEventId,
                purchasedRedemption.fulfillmentEventId,
              ],
            },
            tenantId: tenant.id,
          },
        },
      );
    const expectedRedemptionAllocations = [
      {
        fulfillmentEventId: includedRedemption.fulfillmentEventId,
        purchaseLotId: null,
        quantity: 1,
        source: 'included',
      },
      {
        fulfillmentEventId: purchasedRedemption.fulfillmentEventId,
        purchaseLotId: settledLot.id,
        quantity: 1,
        source: 'purchased',
      },
    ];
    expect(
      redemptionAllocations.toSorted((left, right) =>
        left.source.localeCompare(right.source),
      ),
    ).toEqual(expectedRedemptionAllocations);

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Before you start" %}
This guide follows a signed-in participant who owns a confirmed free registration with one included **Paid workshop kit** and two purchased kits settled through Stripe. An organizer has already recorded two handouts: the included unit first, then one purchased unit. The event, registration, add-on entitlement, payment, and connected Stripe account all belong to the same organization.

Only the one remaining purchased unit that has not been handed out is refundable. Handed-out units stay fulfilled, included units never create a monetary refund, and cancellation preserves every quantity and fulfillment result.

The journey begins in the participant account, then explicitly switches to an organizer account for the direct scanner result and to a platform administrator account for refund recovery. Each account needs the access described at that transition.
{% /callout %}

### Cancel a registration with a settled Stripe add-on

1. Open **Events** from the main navigation.
2. Select **${scenario.title}**.
3. Review the included, purchased, handed-out, and ready-to-hand-out quantities.
4. Select **Cancel registration**, read the confirmation, then choose **Confirm cancellation**.

If payment safety cannot be confirmed, an add-on Checkout is pending, or the registration changed, Evorto leaves the ticket, inventory, and refund status unchanged.
`,
    });

    await openEventFromNormalNavigation(page, scenario.title);
    const activeRegistration = page.locator('app-event-active-registration');
    const addOnRow = activeRegistration
      .locator('li')
      .filter({ hasText: scenario.addOns.paid.title });
    await expect(
      addOnRow.getByText('Included', { exact: true }).locator('..'),
    ).toContainText('1');
    await expect(
      addOnRow.getByText('Purchased', { exact: true }).locator('..'),
    ).toContainText('2');
    await expect(
      addOnRow.getByText('Redeemed', { exact: true }).locator('..'),
    ).toContainText('2');
    await expect(
      addOnRow.getByText('Available to use', { exact: true }).locator('..'),
    ).toContainText('1');
    await takeScreenshot(
      testInfo,
      addOnRow,
      page,
      'Review settled and redeemed add-on quantities before cancellation',
    );

    const cancelRegistration = activeRegistration.getByRole('button', {
      exact: true,
      name: 'Cancel registration',
    });
    await expect(cancelRegistration).not.toHaveAttribute('jsaction', /click/, {
      timeout: 20_000,
    });
    await cancelRegistration.click();
    const cancellationDialog = page.getByRole('dialog');
    await expect(
      cancellationDialog.getByRole('heading', {
        name: 'Cancel your registration?',
      }),
    ).toBeVisible();
    await expect(
      cancellationDialog.getByRole('button', { name: 'Keep registration' }),
    ).toBeFocused();
    await takeScreenshot(
      testInfo,
      cancellationDialog,
      page,
      'Confirm cancellation of the ticket and remaining paid add-on',
    );
    await cancellationDialog
      .getByRole('button', { name: 'Confirm cancellation' })
      .click();
    await expect(activeRegistration).toHaveCount(0, { timeout: 20_000 });
    await expect(
      page.getByRole('button', { exact: true, name: 'Register' }),
    ).toBeVisible();

    const cancelledRegistration =
      await database.query.eventRegistrations.findFirst({
        where: { id: scenario.registrationId, tenantId: tenant.id },
      });
    const cancelledPurchase =
      await database.query.eventRegistrationAddonPurchases.findFirst({
        where: { id: settledPurchase.id, tenantId: tenant.id },
      });
    const cancelledLot =
      await database.query.eventRegistrationAddonPurchaseLots.findFirst({
        where: { id: settledLot.id, tenantId: tenant.id },
      });
    const cancellationEvent =
      await database.query.eventRegistrationAddonFulfillmentEvents.findFirst({
        where: {
          purchaseId: settledPurchase.id,
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
          type: 'cancelled',
        },
      });
    if (!cancellationEvent) {
      throw new Error(
        'Expected a whole-registration add-on cancellation event',
      );
    }
    const cancellationAllocations =
      await database.query.eventRegistrationAddonFulfillmentAllocations.findMany(
        {
          columns: {
            purchaseLotId: true,
            quantity: true,
            source: true,
          },
          where: {
            fulfillmentEventId: cancellationEvent.id,
            purchaseId: settledPurchase.id,
            tenantId: tenant.id,
          },
        },
      );
    const currentAcquisition =
      await database.query.registrationAcquisitions.findFirst({
        orderBy: { ordinal: 'desc' },
        where: {
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    if (!currentAcquisition) {
      throw new Error('Expected the current registration acquisition');
    }
    const acquisitionPayments =
      await database.query.registrationAcquisitionPayments.findMany({
        orderBy: { id: 'asc' },
        where: {
          acquisitionId: currentAcquisition.id,
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    const acquisitionComponents =
      await database.query.registrationAcquisitionComponents.findMany({
        orderBy: { id: 'asc' },
        where: {
          acquisitionId: currentAcquisition.id,
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    const refundAllocations =
      await database.query.registrationAcquisitionRefundAllocations.findMany({
        columns: {
          acquisitionId: true,
          acquisitionPaymentId: true,
          applicationFeeAmount: true,
          applicationFeeRefunded: true,
          componentId: true,
          fulfillmentEventId: true,
          grossEntitlementAmount: true,
          netEntitlementAmount: true,
          operationKey: true,
          operationKind: true,
          purchaseId: true,
          quantity: true,
          refundAmount: true,
          refundTransactionId: true,
          stripeFeeAmount: true,
        },
        where: {
          acquisitionId: currentAcquisition.id,
          purchaseId: settledPurchase.id,
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    const sourceTransaction = await database.query.transactions.findFirst({
      where: {
        eventRegistrationId: scenario.registrationId,
        id: settledCheckout.transactionId,
        tenantId: tenant.id,
        type: 'addon',
      },
    });
    const readRefundClaims = () =>
      database.query.transactions.findMany({
        where: {
          eventRegistrationId: scenario.registrationId,
          sourceTransactionId: settledCheckout.transactionId,
          tenantId: tenant.id,
          type: 'refund',
        },
      });
    const refundClaims = await readRefundClaims();
    expect(refundClaims).toHaveLength(1);
    const refundClaim = refundClaims[0];
    const stockAfterCancellation = await database.query.eventAddons.findFirst({
      columns: { totalAvailableQuantity: true },
      where: { eventId: scenario.eventId, id: scenario.addOns.paid.id },
    });
    const optionAfterCancellation =
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true },
        where: { id: scenario.optionId },
      });
    if (!refundClaim) {
      throw new Error('Expected a durable Stripe add-on refund claim');
    }
    const acquisitionPayment = acquisitionPayments[0];
    const paidAcquisitionComponent = acquisitionComponents.find(
      ({ purchaseLotId }) => purchaseLotId === settledLot.id,
    );
    if (
      !acquisitionPayment ||
      !paidAcquisitionComponent ||
      !sourceTransaction?.stripeAccountId
    ) {
      throw new Error(
        'Expected exact current-acquisition ownership for the Stripe add-on source',
      );
    }
    const purchasedCancellationAllocation = cancellationAllocations[0];
    if (
      cancellationAllocations.length !== 1 ||
      !purchasedCancellationAllocation
    ) {
      throw new Error('Expected one purchased add-on cancellation allocation');
    }
    const expectedRefundAmounts = allocateAcquisitionComponentQuantity({
      alreadyAllocatedQuantity:
        settledLot.cancelledQuantity + settledLot.redeemedQuantity,
      component: paidAcquisitionComponent,
      quantity: purchasedCancellationAllocation.quantity,
    });
    if (!expectedRefundAmounts) {
      throw new Error(
        'Expected the settled add-on component to yield an exact refund allocation',
      );
    }

    expect(cancelledRegistration?.status).toBe('CANCELLED');
    expect(currentAcquisition).toMatchObject({
      eventId: scenario.eventId,
      kind: 'initial',
      ordinal: 0,
      ownerUserId: participant.id,
      previousAcquisitionId: null,
      registrationId: scenario.registrationId,
      spotCount: 1,
      tenantId: tenant.id,
      transferId: null,
    });
    expect(acquisitionPayments).toHaveLength(1);
    expect(acquisitionPayment).toMatchObject({
      acquisitionId: currentAcquisition.id,
      eventId: scenario.eventId,
      registrationId: scenario.registrationId,
      tenantId: tenant.id,
      transactionId: sourceTransaction.id,
    });
    expect(acquisitionComponents).toHaveLength(2);
    expect(
      acquisitionComponents.find(({ kind }) => kind === 'registration'),
    ).toMatchObject({
      acquisitionId: currentAcquisition.id,
      acquisitionPaymentId: null,
      applicationFeeAmount: 0,
      currency: tenant.currency,
      grossAmount: 0,
      kind: 'registration',
      netAmount: 0,
      quantity: 1,
      stripeFeeAmount: 0,
    });
    expect(paidAcquisitionComponent).toMatchObject({
      acquisitionId: currentAcquisition.id,
      acquisitionPaymentId: acquisitionPayment.id,
      allocationKey: `addon-order:${settledCheckout.orderId}`,
      applicationFeeAmount: 35,
      currency: tenant.currency,
      grossAmount: 1000,
      kind: 'addon_lot',
      netAmount: 936,
      purchaseId: settledPurchase.id,
      purchaseLotId: settledLot.id,
      quantity: 2,
      stripeFeeAmount: 29,
    });
    expect(sourceTransaction).toMatchObject({
      amount: 1000,
      appFee: 35,
      id: settledCheckout.transactionId,
      method: 'stripe',
      status: 'successful',
      stripeFee: 29,
      stripeNetAmount: 936,
      type: 'addon',
    });
    expect(cancelledPurchase).toMatchObject({
      cancelledQuantity: 1,
      includedQuantity: 1,
      purchasedQuantity: 2,
      quantity: 3,
      redeemedQuantity: 2,
    });
    expect(cancelledLot).toMatchObject({
      cancelledQuantity: 1,
      redeemedQuantity: 1,
    });
    expect(cancellationEvent).toMatchObject({
      quantity: 1,
      reason: 'Registration cancelled by participant',
      refundDisposition: 'claims_created',
      refundRequested: true,
    });
    expect(cancellationAllocations).toEqual([
      {
        purchaseLotId: settledLot.id,
        quantity: 1,
        source: 'purchased',
      },
    ]);
    expect(refundAllocations).toEqual([
      {
        acquisitionId: currentAcquisition.id,
        acquisitionPaymentId: acquisitionPayment.id,
        applicationFeeAmount: expectedRefundAmounts.applicationFeeAmount,
        applicationFeeRefunded: true,
        componentId: paidAcquisitionComponent.id,
        fulfillmentEventId: cancellationEvent.id,
        grossEntitlementAmount: expectedRefundAmounts.grossAmount,
        netEntitlementAmount: expectedRefundAmounts.netAmount,
        operationKey: `registration-cancellation:${scenario.registrationId}:${paidAcquisitionComponent.id}`,
        operationKind: 'addon_cancellation',
        purchaseId: settledPurchase.id,
        quantity: 1,
        refundAmount: expectedRefundAmounts.grossAmount,
        refundTransactionId: refundClaim.id,
        stripeFeeAmount: expectedRefundAmounts.stripeFeeAmount,
      },
    ]);
    expect(expectedRefundAmounts).toMatchObject({
      grossAmount: 500,
      netAmount: 468,
    });
    expect(
      expectedRefundAmounts.netAmount +
        expectedRefundAmounts.stripeFeeAmount +
        expectedRefundAmounts.applicationFeeAmount,
    ).toBe(expectedRefundAmounts.grossAmount);
    expect(refundClaim).toMatchObject({
      amount: -expectedRefundAmounts.grossAmount,
      manuallyCreated: false,
      method: 'stripe',
      refundOperationKey: `registration-cancellation:${scenario.registrationId}:${settledCheckout.transactionId}`,
      sourceTransactionId: settledCheckout.transactionId,
      status: 'pending',
      stripeRefundApplicationFee: true,
      targetUserId: participant.id,
      type: 'refund',
    });
    expect(refundClaim.stripeAccountId).toBe(sourceTransaction.stripeAccountId);
    expect(stockAfterCancellation).toEqual({ totalAvailableQuantity: 4 });
    expect(optionAfterCancellation).toEqual({ confirmedSpots: 0 });
    expect(
      await database.query.emailOutbox.findFirst({
        where: {
          idempotencyKey: cancellationEmailKey,
          kind: 'registrationCancelled',
          tenantId: tenant.id,
        },
      }),
    ).toBeTruthy();

    const refundAmountLabel = new Intl.NumberFormat('de-DE', {
      currency: tenant.currency,
      style: 'currency',
    }).format(expectedRefundAmounts.grossAmount / 100);
    await testInfo.attach('markdown', {
      body: `
### Read the cancellation and refund status

The ticket is now **Cancelled** and cannot be used again. Evorto preserved both redeemed units, cancelled and restocked only the one remaining purchased unit, and started a Stripe refund of exactly **${refundAmountLabel}**.

Open **Profile**, select **Events**, and find the cancelled event. Evorto started a Stripe refund. **Refund retrying** means it is still being processed; the money may not have arrived yet. Do not register or pay again to retry a refund.
`,
    });
    await page.getByRole('link', { exact: true, name: 'Profile' }).click();
    let profileCard = await openProfileEventCard(page, scenario.title);
    await expect(
      profileCard.getByText('Cancelled', { exact: true }),
    ).toBeVisible();
    await expect(profileCard).toContainText(
      /Add-on payment:\s*Refund retrying/,
    );
    await expect(profileCard).toContainText(refundAmountLabel);
    await expect(profileCard).toContainText(
      'Money has not necessarily been returned yet',
    );
    await takeScreenshot(
      testInfo,
      profileCard,
      page,
      'Cancelled participant ticket with its retrying add-on refund',
    );

    await testInfo.attach('markdown', {
      body: `
### Switch to the organizer scanner

Switch to an organizer account with access to check-in and add-on fulfillment for this event. Open the attendee's ticket link in the scanner result flow. The result keeps the cancelled ticket unusable while showing the preserved redemptions, cancelled quantity, and current refund state.
`,
    });

    scannerPage = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: adminStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
    await scannerPage.page.goto(
      `/scan/registration/${scenario.registrationId}`,
    );
    await expect(
      scannerPage.page.getByRole('heading', {
        level: 1,
        name: 'Registration scanned',
      }),
    ).toBeVisible();
    const cancelledScannerAlert = scannerPage.page
      .getByRole('alert')
      .filter({ hasText: 'Registration cancelled' });
    await expect(cancelledScannerAlert).toBeVisible();
    await expect(cancelledScannerAlert).toContainText(
      'Do not ask the attendee to pay or register again',
    );
    await waitForScannerAddonFulfillment(scannerPage.page);
    const scannerAddOn = scannerPage.page
      .locator('article')
      .filter({ hasText: scenario.addOns.paid.title });
    await expect(scannerAddOn).toContainText('1 included · 2 purchased');
    await expect(
      scannerAddOn
        .getByText('Ready to hand out', { exact: true })
        .locator('..'),
    ).toContainText('0');
    await expect(
      scannerAddOn.getByText('Handed out', { exact: true }).locator('..'),
    ).toContainText('2');
    await expect(
      scannerAddOn.getByText('Cancelled', { exact: true }).locator('..'),
    ).toContainText('1');
    await expect(
      scannerAddOn.getByText('Refund processing', { exact: true }),
    ).toBeVisible();

    const stripeAccountId = refundClaim.stripeAccountId;
    if (!stripeAccountId) {
      throw new Error('Expected the refund claim connected Stripe account');
    }
    await database
      .update(schema.transactions)
      .set({
        stripeRefundAttempts: refundClaim.stripeRefundMaxAttempts,
        stripeRefundNextAttemptAt: null,
      })
      .where(
        and(
          eq(schema.transactions.id, refundClaim.id),
          eq(schema.transactions.tenantId, tenant.id),
        ),
      );
    await deliverRegistrationRefundWebhook({
      amount: expectedRefundAmounts.grossAmount,
      chargeId: settledCheckout.chargeId,
      currency: tenant.currency,
      refundClaimId: refundClaim.id,
      refundGeneration: 0,
      refundId: generationZeroRefundId,
      registrationId: scenario.registrationId,
      request,
      sourceTransactionId: settledCheckout.transactionId,
      status: 'requires_action',
      stripeAccountId,
      stripeEventId: requiresActionWebhookEventId,
      tenantId: tenant.id,
    });
    const stoppedRefundClaim = await database.query.transactions.findFirst({
      where: { id: refundClaim.id, tenantId: tenant.id },
    });
    expect(stoppedRefundClaim).toMatchObject({
      id: refundClaim.id,
      status: 'pending',
      stripeRefundAttempts: refundClaim.stripeRefundMaxAttempts,
      stripeRefundGeneration: 0,
      stripeRefundId: generationZeroRefundId,
      stripeRefundMaxAttempts: refundClaim.stripeRefundMaxAttempts,
      stripeRefundStatus: 'requires_action',
    });
    expect(stoppedRefundClaim?.stripeRefundNextAttemptAt).toBeNull();
    expect(stoppedRefundClaim?.stripeRefundLastError).toBe(
      'Stripe refund remained requires_action after maximum processing attempts',
    );
    expect((await readRefundClaims()).map(({ id }) => id)).toEqual([
      refundClaim.id,
    ]);

    await scannerPage.page.reload();
    await waitForScannerAddonFulfillment(scannerPage.page);
    await expect(
      scannerAddOn.getByText('Refund needs review', { exact: true }),
    ).toBeVisible();
    await page.reload();
    profileCard = await openProfileEventCard(page, scenario.title);
    await expect(profileCard).toContainText(
      /Add-on payment:\s*Contact organizer for refund update/,
    );
    await expect(profileCard).toContainText(refundAmountLabel);
    await expect(profileCard).toContainText(
      'at least one refund needs organizer follow-up',
    );
    await expect(profileCard).toContainText(
      'Contact the organizer for an update',
    );
    await expect(profileCard).toContainText(
      'Do not pay or register again to retry it',
    );
    await testInfo.attach('markdown', {
      body: `
### Complete the required Stripe action and resume the same refund

A Stripe **requires action** update keeps the registration cancelled and links the update to the same Stripe refund. The profile asks the participant to **Contact organizer for refund update**, while the organizer scanner shows **Refund needs review**. The participant should not register, pay, or cancel again. The organizer can explain that the connected Stripe account needs action before a platform administrator resumes status checks for this exact refund.

When the safe automatic checks have stopped, open the organization's **Review finance** page. The **Transactions** tab shows **Action required in Stripe**. In **Refund recovery**, match the event and refund amount, then choose **Review recovery**. The review shows the safe next step without exposing internal payment identifiers or raw Stripe errors. **Resume refund checks** continues checking the same Stripe refund; it does not issue another refund.
`,
    });

    recoveryPage = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: gaStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
    await recoveryPage.page.goto(`/global-admin/tenants/${tenant.id}`);
    await recoveryPage.page
      .getByRole('link', { name: 'Review finance' })
      .click();
    await expect(
      recoveryPage.page.getByRole('heading', {
        level: 1,
        name: 'Organization finance',
      }),
    ).toBeVisible();
    const providerActionTransactionRow = recoveryPage.page
      .getByRole('row')
      .filter({ hasText: refundAmountLabel })
      .filter({ hasText: 'Action required in Stripe' });
    await expect(providerActionTransactionRow).toBeVisible({ timeout: 20_000 });
    await expect(providerActionTransactionRow).toContainText(
      'Complete the required action in the connected Stripe account, then open Refund recovery to resume checks.',
    );
    await recoveryPage.page
      .getByRole('tab', { name: 'Refund recovery' })
      .click();
    const stoppedRecoveryRow = recoveryPage.page
      .locator('div.border-b')
      .filter({
        hasText: 'Automatic refund checks stopped before completion.',
      });
    await expect(stoppedRecoveryRow).toBeVisible({ timeout: 20_000 });
    await expect(stoppedRecoveryRow).toContainText(scenario.title);
    await expect(stoppedRecoveryRow).toContainText(refundAmountLabel);
    await stoppedRecoveryRow
      .getByRole('button', { name: 'Review recovery' })
      .click();
    const resumeRecoveryForm = recoveryPage.page
      .getByRole('heading', {
        level: 2,
        name: 'Resume refund checks',
      })
      .locator('..');
    await expect(resumeRecoveryForm).toBeVisible();
    await expect(resumeRecoveryForm).toContainText(scenario.title);
    await expect(resumeRecoveryForm).toContainText(refundAmountLabel);
    await expect(resumeRecoveryForm).toContainText(
      'Resume checks for this refund',
    );
    await expect(resumeRecoveryForm).not.toContainText(refundClaim.id);
    await expect(resumeRecoveryForm).not.toContainText(scenario.registrationId);
    await expect(resumeRecoveryForm).not.toContainText(
      settledCheckout.transactionId,
    );
    await recoveryPage.page
      .getByLabel('Operational recovery reason')
      .fill(resumeReason);
    await takeScreenshot(
      testInfo,
      recoveryPage.page.locator('app-platform-finance'),
      recoveryPage.page,
      'Review and resume the exact stopped Stripe refund',
    );
    await recoveryPage.page
      .getByRole('button', { name: 'Resume refund checks' })
      .click();
    await expect(
      recoveryPage.page.getByText('Refund checks resumed', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(stoppedRecoveryRow).toHaveCount(0);

    const resumedRefund = await database.query.transactions.findFirst({
      where: { id: refundClaim.id, tenantId: tenant.id },
    });
    expect(resumedRefund).toMatchObject({
      id: refundClaim.id,
      status: 'pending',
      stripeRefundAttempts: 0,
      stripeRefundGeneration: 0,
      stripeRefundId: generationZeroRefundId,
      stripeRefundStatus: 'requires_action',
    });
    expect(resumedRefund?.stripeRefundNextAttemptAt).not.toBeNull();
    expect((await readRefundClaims()).map(({ id }) => id)).toEqual([
      refundClaim.id,
    ]);
    const resumeAuditEntry =
      await database.query.platformAuditEntries.findFirst({
        where: {
          action: 'refundClaim.requeue',
          reason: resumeReason,
          targetTenantId: tenant.id,
        },
      });
    expect(resumeAuditEntry).toMatchObject({
      action: 'refundClaim.requeue',
      after: {
        resourceId: refundClaim.id,
        resourceType: 'refundClaim',
        state: {
          attempts: 0,
          generation: 0,
          hasLastError: false,
          hasRefundId: true,
          mode: 'resumeGeneration',
          status: 'pending',
          stripeRefundStatus: 'requires_action',
        },
      },
      before: {
        resourceId: refundClaim.id,
        resourceType: 'refundClaim',
        state: {
          attempts: refundClaim.stripeRefundMaxAttempts,
          generation: 0,
          hasLastError: true,
          hasRefundId: true,
          mode: 'resumeGeneration',
          status: 'pending',
          stripeRefundStatus: 'requires_action',
        },
      },
      reason: resumeReason,
      targetTenantId: tenant.id,
    });

    await deliverRegistrationRefundWebhook({
      amount: expectedRefundAmounts.grossAmount,
      chargeId: settledCheckout.chargeId,
      currency: tenant.currency,
      refundClaimId: refundClaim.id,
      refundGeneration: 0,
      refundId: generationZeroRefundId,
      registrationId: scenario.registrationId,
      request,
      sourceTransactionId: settledCheckout.transactionId,
      status: 'failed',
      stripeAccountId,
      stripeEventId: failedWebhookEventId,
      tenantId: tenant.id,
    });
    const terminalRefundClaim = await database.query.transactions.findFirst({
      columns: {
        status: true,
        stripeRefundGeneration: true,
        stripeRefundId: true,
        stripeRefundStatus: true,
      },
      where: { id: refundClaim.id, tenantId: tenant.id },
    });
    expect(terminalRefundClaim).toMatchObject({
      status: 'pending',
      stripeRefundGeneration: 0,
      stripeRefundId: generationZeroRefundId,
      stripeRefundStatus: 'failed',
    });
    await scannerPage.page.reload();
    await waitForScannerAddonFulfillment(scannerPage.page);
    await expect(
      scannerAddOn.getByText('Refund needs attention', { exact: true }),
    ).toBeVisible();
    await page.reload();
    profileCard = await openProfileEventCard(page, scenario.title);
    await expect(profileCard).toContainText(
      /Add-on payment:\s*Contact organizer for refund update/,
    );
    await expect(profileCard).toContainText(refundAmountLabel);
    await expect(profileCard).toContainText(
      'at least one refund needs organizer follow-up',
    );
    await expect(profileCard).toContainText(
      'Contact the organizer for an update',
    );
    await testInfo.attach('markdown', {
      body: `
### Retry a failed refund

After status checks resume, a Stripe **failed** update for the same refund asks the participant to **Contact organizer for refund update** and changes the organizer result to **Refund needs attention**. It does not create a second refund.

Switch to a platform administrator account; an organization Admin role is not sufficient. Open the affected organization, select **Review finance**, open **Refund recovery**, and review the event, attendee, refund amount, failed state, and safe next step. Internal payment identifiers and raw Stripe errors remain hidden. Enter a specific **Operational recovery reason**, then choose **Retry failed refund**. Evorto keeps the failed Stripe refund in payment history, starts a new attempt for the same amount, and includes the reason in change history. It does not create a second refund.
`,
    });
    await takeScreenshot(
      testInfo,
      scannerAddOn,
      scannerPage.page,
      'Terminal Stripe refund failure on the cancelled add-on',
    );
    await recoveryPage.page.reload();
    await expect(
      recoveryPage.page.getByRole('heading', {
        level: 1,
        name: 'Organization finance',
      }),
    ).toBeVisible();
    await recoveryPage.page
      .getByRole('tab', { name: 'Refund recovery' })
      .click();
    const terminalRecoveryRow = recoveryPage.page
      .locator('div.border-b')
      .filter({ hasText: 'Stripe marked the previous refund as failed.' });
    await expect(terminalRecoveryRow).toBeVisible({ timeout: 20_000 });
    await expect(terminalRecoveryRow).toContainText(scenario.title);
    await expect(terminalRecoveryRow).toContainText(refundAmountLabel);
    await terminalRecoveryRow
      .getByRole('button', { name: 'Review recovery' })
      .click();
    const retryRecoveryForm = recoveryPage.page
      .getByRole('heading', {
        level: 2,
        name: 'Retry failed refund',
      })
      .locator('..');
    await expect(retryRecoveryForm).toBeVisible();
    await expect(retryRecoveryForm).toContainText(scenario.title);
    await expect(retryRecoveryForm).toContainText(refundAmountLabel);
    await expect(retryRecoveryForm).toContainText('Retry this failed refund');
    await expect(retryRecoveryForm).not.toContainText(refundClaim.id);
    await expect(retryRecoveryForm).not.toContainText(scenario.registrationId);
    await expect(retryRecoveryForm).not.toContainText(
      settledCheckout.transactionId,
    );
    await recoveryPage.page
      .getByLabel('Operational recovery reason')
      .fill(newGenerationReason);
    await takeScreenshot(
      testInfo,
      recoveryPage.page.locator('app-platform-finance'),
      recoveryPage.page,
      'Review and schedule the terminal add-on refund',
    );
    await recoveryPage.page
      .getByRole('button', { name: 'Retry failed refund' })
      .click();
    await expect(
      recoveryPage.page.getByText('Failed refund scheduled for retry', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(terminalRecoveryRow).toHaveCount(0);

    const requeuedRefund = await database.query.transactions.findFirst({
      where: { id: refundClaim.id, tenantId: tenant.id },
    });
    expect(requeuedRefund).toMatchObject({
      status: 'pending',
      stripeRefundGeneration: 1,
      stripeRefundHistory: [
        expect.objectContaining({
          generation: 0,
          refundId: generationZeroRefundId,
          status: 'failed',
        }),
      ],
      stripeRefundId: null,
      stripeRefundStatus: null,
    });
    expect(requeuedRefund?.stripeRefundNextAttemptAt).not.toBeNull();
    expect((await readRefundClaims()).map(({ id }) => id)).toEqual([
      refundClaim.id,
    ]);
    const newGenerationAuditEntry =
      await database.query.platformAuditEntries.findFirst({
        where: {
          action: 'refundClaim.requeue',
          reason: newGenerationReason,
          targetTenantId: tenant.id,
        },
      });
    expect(newGenerationAuditEntry).toMatchObject({
      action: 'refundClaim.requeue',
      after: {
        resourceId: refundClaim.id,
        resourceType: 'refundClaim',
        state: {
          attempts: 0,
          generation: 1,
          hasLastError: false,
          hasRefundId: false,
          mode: 'newGeneration',
          status: 'pending',
          stripeRefundStatus: null,
        },
      },
      before: {
        resourceId: refundClaim.id,
        resourceType: 'refundClaim',
        state: {
          generation: 0,
          hasLastError: true,
          hasRefundId: true,
          mode: 'newGeneration',
          status: 'pending',
          stripeRefundStatus: 'failed',
        },
      },
      reason: newGenerationReason,
      targetTenantId: tenant.id,
    });

    await scannerPage.page.reload();
    await waitForScannerAddonFulfillment(scannerPage.page);
    await expect(
      scannerAddOn.getByText('Refund processing', { exact: true }),
    ).toBeVisible();
    await page.reload();
    profileCard = await openProfileEventCard(page, scenario.title);
    await expect(profileCard).toContainText(
      /Add-on payment:\s*Refund retrying/,
    );
    await expect(profileCard).toContainText(refundAmountLabel);

    await deliverRegistrationRefundWebhook({
      amount: expectedRefundAmounts.grossAmount,
      chargeId: settledCheckout.chargeId,
      currency: tenant.currency,
      refundClaimId: refundClaim.id,
      refundGeneration: 1,
      refundId: recoveredRefundId,
      registrationId: scenario.registrationId,
      request,
      sourceTransactionId: settledCheckout.transactionId,
      status: 'succeeded',
      stripeAccountId,
      stripeEventId: recoveredWebhookEventId,
      tenantId: tenant.id,
    });
    await scannerPage.page.reload();
    await waitForScannerAddonFulfillment(scannerPage.page);
    await expect(
      scannerAddOn.getByText('Refunded', { exact: true }),
    ).toBeVisible();
    await page.reload();
    profileCard = await openProfileEventCard(page, scenario.title);
    await expect(profileCard).toContainText(
      /Add-on payment:\s*Refund completed/,
    );
    await expect(profileCard).toContainText(refundAmountLabel);
    await expect(profileCard).toContainText('every recorded refund completed');
    const completedRefund = await database.query.transactions.findFirst({
      where: { id: refundClaim.id, tenantId: tenant.id },
    });
    expect(completedRefund).toMatchObject({
      status: 'successful',
      stripeRefundGeneration: 1,
      stripeRefundHistory: [
        expect.objectContaining({
          generation: 0,
          reason: newGenerationReason,
          refundId: generationZeroRefundId,
          status: 'failed',
        }),
      ],
      stripeRefundId: recoveredRefundId,
      stripeRefundStatus: 'succeeded',
    });
    expect((await readRefundClaims()).map(({ id }) => id)).toEqual([
      refundClaim.id,
    ]);
    const preservedRedemptionAllocations =
      await database.query.eventRegistrationAddonFulfillmentAllocations.findMany(
        {
          columns: {
            fulfillmentEventId: true,
            purchaseLotId: true,
            quantity: true,
            source: true,
          },
          where: {
            fulfillmentEventId: {
              in: [
                includedRedemption.fulfillmentEventId,
                purchasedRedemption.fulfillmentEventId,
              ],
            },
            tenantId: tenant.id,
          },
        },
      );
    expect(
      preservedRedemptionAllocations.toSorted((left, right) =>
        left.source.localeCompare(right.source),
      ),
    ).toEqual(expectedRedemptionAllocations);
    expect(
      await database.query.eventRegistrations.findFirst({
        columns: { status: true },
        where: {
          id: scenario.registrationId,
          tenantId: tenant.id,
        },
      }),
    ).toEqual({ status: 'CANCELLED' });
    await testInfo.attach('markdown', {
      body: `
### Completion

After Stripe confirms the retry, the organizer view shows **Refunded** and the participant view shows **Refund completed**. The registration stays cancelled, and the earlier failed attempt remains in payment history.

This local walkthrough verifies Evorto's refund workflow but not settlement by the card network or bank. Treat a refund as complete only after Stripe reports it succeeded.
`,
    });
    await takeScreenshot(
      testInfo,
      profileCard,
      page,
      'Completed recovered refund on the cancelled participant ticket',
    );
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

    try {
      await database.insert(schema.eventInstances).values({
        creatorId: eventCreator.id,
        description:
          'A free registration whose participant cancellation deadline has passed.',
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
        isPaid: false,
        openRegistrationTime: eventWindow.openRegistrationTime,
        organizingRegistration: false,
        price: 0,
        registrationMode: 'fcfs',
        roleIds: [],
        spots: 5,
        title: 'Free deadline-controlled participant',
      });
      await database.insert(schema.eventRegistrations).values({
        basePriceAtRegistration: 0,
        eventId,
        id: registrationId,
        registrationOptionId: optionId,
        status: 'CONFIRMED',
        tenantId: tenant.id,
        userId: participant.id,
      });

      await testInfo.attach('markdown', {
        body: `
### When self-service cancellation is closed

The registration option can override the organization's default cancellation deadline. In this example, the option's deadline is deliberately set before the current time, so participant cancellation has already closed.

Open **Events**, select the event, and review the confirmed ticket. Evorto explains that the deadline has passed and does not offer a cancellation action. Evorto checks the deadline again if an outdated page tries to submit a cancellation.
`,
      });
      await openEventFromNormalNavigation(page, eventTitle);
      const activeRegistration = page.locator('app-event-active-registration');
      const deadlineExplanation = activeRegistration.getByText(
        'The cancellation deadline has passed. No cancellation, refund, or spot release has been made.',
        { exact: true },
      );
      await expect(deadlineExplanation).toBeVisible();
      await expect(
        activeRegistration.getByRole('button', {
          exact: true,
          name: 'Cancel registration',
        }),
      ).toHaveCount(0);
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
The deadline explanation and missing cancellation action mean the ticket remains confirmed, the occupied spot remains counted, no refund was started, and no cancellation email was scheduled. Refreshing does not override the policy, and Evorto checks the deadline again before accepting a cancellation.
{% /callout %}

Contact an event organizer if the registration still needs operational handling. An organizer who can organize this event and has **Cancel registrations and add-ons** access may cancel an unchecked registration before the event starts; participant deadline expiry alone does not grant the participant an override.

Other recoverable messages are equally literal: when payment fees are still reconciling, retry later; when pending Stripe Checkout cancellation cannot be confirmed, refresh before retrying; and when an add-on payment or transfer is active, finish or resolve that workflow first. Evorto keeps the registration and capacity intact until the prerequisite is proven.

Self-service cancellation applies only to the signed-in person's own registration in the current organization. A registration link does not grant access to another participant's ticket. For organizer cancellation, Evorto verifies the event, organization, organizer relationship, and cancellation access again.
`,
      });
      await takeScreenshot(
        testInfo,
        deadlineExplanation,
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
            eq(schema.transactions.tenantId, tenant.id),
            eq(schema.transactions.type, 'refund'),
          ),
        );
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
    const registrationAcquisitionId = createId();
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
      const acquiredAt = earliestServerOrWallNow();
      await database.insert(schema.registrationAcquisitions).values({
        acquiredAt,
        eventId,
        id: registrationAcquisitionId,
        kind: 'initial',
        operationKey: `registration-initial:${registrationId}`,
        ordinal: 0,
        ownerUserId: participant.id,
        registrationId,
        spotCount: 2,
        tenantId: tenant.id,
      });
      await database.insert(schema.registrationAcquisitionComponents).values({
        acquiredAt,
        acquisitionId: registrationAcquisitionId,
        allocationKey: `registration-initial:${registrationId}`,
        applicationFeeAmount: 0,
        baseAmount: 0,
        currency: tenant.currency,
        eventId,
        grossAmount: 0,
        kind: 'registration',
        netAmount: 0,
        quantity: 2,
        registrationId,
        stripeFeeAmount: 0,
        taxAmount: 0,
        tenantId: tenant.id,
      });

      await testInfo.attach('markdown', {
        body: `
{% callout type="note" title="Organizer prerequisites" %}
Use an account that can organize this exact event and has **Cancel registrations and add-ons** access. Opening the page is not enough: Evorto checks the current organization, event-organizer relationship, and cancellation access again before completing the action.

The target registration must belong to this event and organization, remain unchecked, and precede the event start. This example is free and includes one guest. A participant cancellation deadline has already passed, but that participant deadline does not prevent an authorized organizer from handling the registration.
{% /callout %}

### Cancel from the organizer overview

1. Open **Events** from the main navigation.
2. Select the event.
3. Select **Organize this event**.
4. Under **Participant registrations**, find the correct person and registration option.
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
The participant name and registration option are the first review context. Selecting the organizer action opens a second confirmation naming the participant and explaining that capacity is released and a payment may require refund follow-up. **Keep registration** is focused by default. Checked-in registrations show cancellation as disabled, and Evorto rejects the action as well.
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
        'If a refund applies, Evorto starts it automatically; it may take time to appear.',
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
### Organizer completion and recovery

The success message and disappearing participant row show that the cancellation completed. The registration is **Cancelled**, both participant and guest spots are released, and the participant receives an email that identifies the organizer cancellation. This free registration creates no refund.

Paid registrations and paid add-ons are Stripe-only. Evorto must first confirm the original payment and add-on amounts. If payment safety cannot be confirmed, nothing changes: the ticket and inventory remain intact. If an immediate refund attempt fails, the ticket remains cancelled and Evorto shows the refund status so an administrator can retry it safely.

This registration is free, so cancellation creates no refund. For a paid registration, check the refund status shown in Evorto before telling a participant that money has been returned.

An active transfer, pending add-on Checkout, checked-in attendee, started event, ticket from another organization, or missing cancellation access also blocks the operation. If the status or payment state changes while the confirmation is open, Evorto asks the organizer to refresh and review the updated participant state. Resolve the specific state shown by Evorto before retrying.
`,
      });
      await takeScreenshot(
        testInfo,
        page.locator('section').filter({
          has: page.getByRole('heading', {
            level: 2,
            name: 'Participant registrations',
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
        .delete(schema.registrationAcquisitionComponents)
        .where(
          eq(
            schema.registrationAcquisitionComponents.acquisitionId,
            registrationAcquisitionId,
          ),
        );
      await database
        .delete(schema.registrationAcquisitions)
        .where(
          eq(schema.registrationAcquisitions.id, registrationAcquisitionId),
        );
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
