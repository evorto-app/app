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
  const eventsSection = page
    .getByRole('navigation', { name: 'Profile sections' })
    .getByRole('link', {
      exact: true,
      name: 'Events',
    });
  await expect(eventsSection).toBeVisible();
  await expect(page.locator('[ngh]')).toHaveCount(0, { timeout: 20_000 });
  await eventsSection.click();
  await expect(
    page.getByRole('heading', { name: 'Your events' }),
  ).toBeVisible();
  const card = page.locator('article').filter({ hasText: eventTitle });
  await expect(card).toBeVisible({ timeout: 20_000 });
  return card;
};

test.describe('Cancel a ticket', () => {
  test.use({ storageState: userStateFile });

  test('Cancel a confirmed free ticket and release its places', async ({
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
    const eventTitle = 'Riverside breakfast picnic';
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
          'A confirmed free ticket used to explain cancellation and available places.',
        end: eventWindow.end,
        icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
        id: eventId,
        reviewedAt: testClock.toJSDate(),
        reviewedBy: waitlistedParticipant.id,
        start: eventWindow.start,
        status: 'APPROVED',
        templateId: template.id,
        tenantId: tenant.id,
        title: eventTitle,
      });
      const [registrationOption] = await database
        .insert(schema.eventRegistrationOptions)
        .values({
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
          title: 'Free attendee',
          waitlistSpots: 1,
        })
        .returning({
          id: schema.eventRegistrationOptions.id,
          price: schema.eventRegistrationOptions.price,
        });
      if (!registrationOption) {
        throw new Error('Expected the free cancellation registration option');
      }
      // Keep shared authenticated-user FK locks in separate autocommit
      // statements so parallel guides cannot form a cross-user lock cycle.
      await database.insert(schema.eventRegistrations).values({
        appliedDiscountedPrice: null,
        appliedDiscountType: null,
        basePriceAtRegistration: registrationOption.price,
        discountAmount: 0,
        eventId,
        guestCount: 1,
        id: registrationId,
        registrationOptionId: registrationOption.id,
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
This guide is for a signed-in attendee cancelling their own confirmed free ticket. Cancelling your own ticket needs no organizer access, but it is available only before the event and before its cancellation deadline.

This example has one guest, so cancelling releases two places. The ticket is free and creates no refund. A later example covers a paid add-on and explains what happens when a refund needs attention.
{% /callout %}

### Cancel a confirmed ticket

1. Sign in as the attendee who owns the ticket.
2. Open **Events** from the main navigation.
3. Select the event, then find the confirmed ticket on its details page.
4. Read the cancellation explanation before selecting **Cancel ticket**.
`,
      });

      await openEventFromNormalNavigation(page, eventTitle);
      const activeRegistration = page.locator('app-event-active-registration');
      await expect(activeRegistration).toBeVisible();
      await expect(
        activeRegistration.getByText('Your ticket is confirmed'),
      ).toBeVisible();
      await expect(
        activeRegistration.getByText(
          'This cancels your ticket and releases all selected places.',
          { exact: false },
        ),
      ).toBeVisible();
      const cancelRegistration = activeRegistration.getByRole('button', {
        exact: true,
        name: 'Cancel ticket',
      });
      await expect(cancelRegistration).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await testInfo.attach('markdown', {
        body: `
{% callout type="warning" title="Review the confirmation carefully" %}
Selecting **Cancel ticket** opens a confirmation that explains which places are released and whether a refund starts. When the confirmation opens, pressing Enter chooses **Go back**, so the ticket stays unchanged. Continue only when you intend to give up the attendee and guest places and start the applicable refund process.
{% /callout %}

This free ticket does not need a refund. For a paid ticket or add-on, Evorto leaves the ticket and available places unchanged if it cannot confirm that cancellation is safe. Follow the displayed message instead. If the ticket or payment changes while this dialog is open, select **Go back**, open **Cancel ticket** again, and review the updated consequences before confirming.
`,
      });
      await takeScreenshot(
        testInfo,
        activeRegistration,
        page,
        'Review a confirmed free ticket before cancelling',
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
          name: 'Cancel your ticket?',
        }),
      ).toBeVisible();
      await expect(cancellationDialog).toContainText(
        'If a refund applies, it will be requested and may take time to appear.',
      );
      const keepRegistration = cancellationDialog.getByRole('button', {
        name: 'Go back',
      });
      await expect(keepRegistration).toBeFocused();
      await expect(activeRegistration).toBeVisible();
      await takeScreenshot(
        testInfo,
        cancellationDialog,
        page,
        'Confirmation shows the two places that will be released',
      );
      await cancellationDialog
        .getByRole('button', { name: 'Cancel ticket' })
        .click();
      await expect(activeRegistration).toHaveCount(0, { timeout: 15_000 });
      await expect(
        page.getByRole('button', { exact: true, name: 'Sign up' }).first(),
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
        `You cancelled your ticket for ${eventTitle}.`,
      );
      expect(cancellationEmail?.text).toContain(`/events/${eventId}`);
      expect(waitlistEmail).toMatchObject({
        idempotencyKey: waitlistEmailKey,
        kind: 'waitlistSpotAvailable',
        tenantId: tenant.id,
        toEmail: waitlistedParticipantRecord.communicationEmail,
      });
      expect(waitlistEmail?.text).toContain(
        `A place may now be available for ${eventTitle}.`,
      );
      expect(waitlistEmail?.text).toContain(
        'We have not held a place for you. Open the event, leave the waitlist, and sign up while a place is still available.',
      );

      await testInfo.attach('markdown', {
        body: `
### What completion means

The confirmed ticket disappears and the event offers sign-up again. Evorto:

- marks the ticket **Cancelled**;
- releases both the attendee and guest places;
- creates no refund because the ticket is free;
- tries to send a cancellation email to the former ticket owner; and
- tries to email the waitlisted attendee that a place may be available.

The waitlist email does not hold a place or move the attendee off the waitlist. Its event link returns the attendee to the event, where they must leave the waitlist and sign up while a place is still available.
`,
      });
      await takeScreenshot(
        testInfo,
        page
          .locator('section')
          .filter({
            has: page.getByRole('heading', {
              level: 2,
              name: 'Your sign-up',
            }),
          })
          .first(),
        page,
        'Sign-up choices after confirmed cancellation',
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

If the availability email arrives, its event link returns the waitlisted attendee to this event. It does **not** reserve a place or turn the waitlist place into a ticket. Someone else who can use the sign-up choice can still take the open place first.

1. Sign in as the account that received the message.
2. Open the event link from that message. The link opens the signed-in event page; it does not grant access to a ticket.
3. Confirm that the page still shows **You are currently on the waitlist**.
4. Select **Leave waitlist**, review the warning, and confirm only if sign-up is still available.
5. Select **Sign up** immediately. If the choice became full before this step, the email has not reserved a place; join the waitlist again instead.
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
        'Availability message returns the attendee to their waitlist place',
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
          name: 'Stay on waitlist',
        }),
      ).toBeFocused();
      await takeScreenshot(
        testInfo,
        leaveWaitlistDialog,
        recipientPage,
        'Review before leaving the waitlist',
      );
      await leaveWaitlistDialog
        .getByRole('button', { name: 'Leave waitlist' })
        .click();

      const recipientRegisterButton = recipientPage
        .getByRole('button', { exact: true, name: 'Sign up' })
        .first();
      await expect(recipientRegisterButton).toBeEnabled({ timeout: 20_000 });
      await takeScreenshot(
        testInfo,
        recipientPage
          .locator('section')
          .filter({
            has: recipientPage.getByRole('heading', {
              level: 2,
              name: 'Your sign-up',
            }),
          })
          .first(),
        recipientPage,
        'A place remains available after leaving the waitlist',
      );
      await recipientRegisterButton.click();
      await expect(
        recipientPage
          .locator('app-event-active-registration')
          .getByText('Your ticket is confirmed'),
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
        `Your ticket for ${eventTitle} is confirmed.`,
      );
      expect(followUpConfirmationEmail?.text).toContain(eventPath);

      await testInfo.attach('markdown', {
        body: `
### What the recipient should see after signing up

After the sign-up succeeds, the page shows a confirmed ticket and the attendee is no longer on the waitlist. Evorto tries to email them a link to their ticket. If the email does not arrive, the confirmed ticket remains available from the event page.

The earlier email does not reserve a place; sign-up succeeds only if a place is still available when the attendee selects **Sign up**.
`,
      });
      await takeScreenshot(
        testInfo,
        recipientPage.locator('app-event-active-registration'),
        recipientPage,
        'Waitlist recipient receives a confirmed ticket',
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

  test('Cancel a paid ticket with add-ons and resolve a refund problem', async ({
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
      title: 'Weekend creative workshop',
      userId: participant.id,
    });
    const cancellationEmailKey = `registration-cancelled/${tenant.id}/${scenario.registrationId}`;
    const generationZeroRefundId = `re_test_generation_zero_${createId()}`;
    const requiresActionWebhookEventId = `evt_test_${createId()}`;
    const failedWebhookEventId = `evt_test_${createId()}`;
    const recoveredRefundId = `re_test_recovered_${createId()}`;
    const recoveredWebhookEventId = `evt_test_${createId()}`;
    const resumeReason = 'Reviewed the existing refund before continuing it';
    const newGenerationReason =
      'Verified the failed refund before trying again';
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
This guide follows a signed-in attendee who has one included **Paid workshop kit** and two purchased kits. An organizer has already handed out the included kit and one purchased kit.

Only the one remaining purchased item that has not been handed out is refundable. Handed-out items stay handed out, included items do not create a refund, and the cancelled ticket still shows every item and whether it was handed out.

The guide begins with the attendee, then switches to an organizer to review the cancelled ticket and to an Evorto administrator if the refund needs attention. Each person needs the access described at that step.
{% /callout %}

### Cancel a ticket with a paid add-on

1. Open **Events** from the main navigation.
2. Select **${scenario.title}**.
3. Review the included, purchased, handed-out, and ready-to-hand-out quantities.
4. Select **Cancel ticket**, read the confirmation, then choose **Cancel ticket**.

If Evorto cannot confirm that cancellation is safe, payment is still pending, or the ticket changed, it leaves the ticket, add-ons, and refund unchanged and explains what to do next.
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
      addOnRow.getByText('Handed out', { exact: true }).locator('..'),
    ).toContainText('2');
    await expect(
      addOnRow.getByText('Available to use', { exact: true }).locator('..'),
    ).toContainText('1');
    await takeScreenshot(
      testInfo,
      addOnRow,
      page,
      'Ticket shows handed-out and refundable add-ons before cancellation',
    );

    const cancelRegistration = activeRegistration.getByRole('button', {
      exact: true,
      name: 'Cancel ticket',
    });
    await expect(cancelRegistration).not.toHaveAttribute('jsaction', /click/, {
      timeout: 20_000,
    });
    await cancelRegistration.click();
    const cancellationDialog = page.getByRole('dialog');
    await expect(
      cancellationDialog.getByRole('heading', {
        name: 'Cancel your ticket?',
      }),
    ).toBeVisible();
    await expect(
      cancellationDialog.getByRole('button', { name: 'Go back' }),
    ).toBeFocused();
    await takeScreenshot(
      testInfo,
      cancellationDialog,
      page,
      'Confirm ticket cancellation and the remaining paid add-on',
    );
    await cancellationDialog
      .getByRole('button', { name: 'Cancel ticket' })
      .click();
    await expect(activeRegistration).toHaveCount(0, { timeout: 20_000 });
    await expect(
      page.getByRole('button', { exact: true, name: 'Sign up' }),
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
      reason: 'Sign-up ended by attendee',
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

The ticket is now **Cancelled** and cannot be used again. Both handed-out kits remain in its history. The one remaining purchased kit is returned to availability, and Evorto starts a refund of **${refundAmountLabel}**.

Open **Profile**, select **Events**, and find the cancelled event. **Refund delayed** means the refund is still on the way and the money may not have arrived yet. Do not sign up or pay again.
`,
    });
    await page.getByRole('link', { exact: true, name: 'Profile' }).click();
    let profileCard = await openProfileEventCard(page, scenario.title);
    await expect(
      profileCard.getByText('Cancelled', { exact: true }),
    ).toBeVisible();
    await expect(profileCard).toContainText(/Add-on payment:\s*Refund delayed/);
    await expect(profileCard).toContainText(refundAmountLabel);
    await expect(profileCard).toContainText(
      'The money may not have reached your account yet',
    );
    await takeScreenshot(
      testInfo,
      profileCard,
      page,
      'Cancelled attendee ticket while its refund is on the way',
    );

    await testInfo.attach('markdown', {
      body: `
### Switch to the organizer scanner

Switch to an organizer account that can check in attendees and hand out add-ons for this event. Open the attendee's ticket in the scanner. The cancelled ticket remains unusable while showing items already handed out, cancelled items, and the latest refund information.
`,
    });

    const scannerPage = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: adminStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
    registerDatabaseCleanup(async () => scannerPage.context.close());
    await scannerPage.page.goto(
      `/scan/registration/${scenario.registrationId}`,
    );
    await expect(
      scannerPage.page.getByRole('heading', {
        level: 1,
        name: 'Ticket scanned',
      }),
    ).toBeVisible();
    const cancelledScannerAlert = scannerPage.page
      .getByRole('alert')
      .filter({ hasText: 'Sign-up ended' });
    await expect(cancelledScannerAlert).toBeVisible();
    await expect(cancelledScannerAlert).toContainText(
      'Do not ask the attendee to pay or sign up again',
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
      scannerAddOn.getByText('Refund in progress', { exact: true }),
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
      /Add-on payment:\s*Contact the organizer/,
    );
    await expect(profileCard).toContainText(refundAmountLabel);
    await expect(profileCard).toContainText(
      'at least one refund needs help from the organizer',
    );
    await expect(profileCard).toContainText(
      'Contact the organizer for an update',
    );
    await expect(profileCard).toContainText(
      'Do not pay or sign up again while you wait',
    );
    await testInfo.attach('markdown', {
      body: `
### Continue a refund that needs attention

The ticket stays cancelled when the refund needs attention. The attendee sees **Contact the organizer**, while the organizer sees **Refund needs review**. An Evorto administrator must resolve the refund. Do not pay, sign up, or cancel again.

Evorto keeps showing that the refund needs attention until the administrator resolves it.
`,
    });

    const recoveryPage = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: gaStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
    registerDatabaseCleanup(async () => recoveryPage.context.close());
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
      .filter({ hasText: 'Payment action needed' });
    await expect(providerActionTransactionRow).toBeVisible({ timeout: 20_000 });
    await expect(providerActionTransactionRow).toContainText(
      "Complete the required step in the organization's payment account, then open Refunds needing attention to continue.",
    );
    await recoveryPage.page
      .getByRole('tab', { name: 'Refunds needing attention' })
      .click();
    const stoppedRecoveryRow = recoveryPage.page
      .locator('div.border-b')
      .filter({
        hasText: 'This refund did not finish and needs review.',
      });
    await expect(stoppedRecoveryRow).toBeVisible({ timeout: 20_000 });
    await expect(stoppedRecoveryRow).toContainText(scenario.title);
    await expect(stoppedRecoveryRow).toContainText(refundAmountLabel);
    await stoppedRecoveryRow
      .getByRole('button', { name: 'Review refund' })
      .click();
    const resumeRecoveryForm = recoveryPage.page
      .getByRole('heading', {
        level: 2,
        name: 'Continue refund',
      })
      .locator('..');
    await expect(resumeRecoveryForm).toBeVisible();
    await expect(resumeRecoveryForm).toContainText(scenario.title);
    await expect(resumeRecoveryForm).toContainText(refundAmountLabel);
    await expect(resumeRecoveryForm).toContainText('Continue this refund');
    await expect(resumeRecoveryForm).not.toContainText(refundClaim.id);
    await expect(resumeRecoveryForm).not.toContainText(scenario.registrationId);
    await expect(resumeRecoveryForm).not.toContainText(
      settledCheckout.transactionId,
    );
    await recoveryPage.page
      .getByLabel('Reason for this action')
      .fill(resumeReason);
    await takeScreenshot(
      testInfo,
      recoveryPage.page.locator('app-platform-finance'),
      recoveryPage.page,
      'Review and continue a refund that needs attention',
    );
    await recoveryPage.page
      .getByRole('button', { name: 'Continue refund' })
      .click();
    await expect(
      recoveryPage.page.getByText('Refund continued', {
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
      /Add-on payment:\s*Contact the organizer/,
    );
    await expect(profileCard).toContainText(refundAmountLabel);
    await expect(profileCard).toContainText(
      'at least one refund needs help from the organizer',
    );
    await expect(profileCard).toContainText(
      'Contact the organizer for an update',
    );
    await testInfo.attach('markdown', {
      body: `
### Try a failed refund again

If the refund fails, the attendee sees **Contact the organizer** and the organizer sees **Refund needs attention**. It does not start another refund.

Switch to an Evorto administrator account; an organization Admin role is not sufficient. Open the affected organization, select **Review finance**, open **Refunds needing attention**, and review the event, attendee, refund amount, and next step. Enter a clear reason for the action, then choose **Try failed refund again**. Evorto tries the same amount again and adds the reason to change history. The failed refund remains in the payment history, and Evorto will not create two completed refunds.
`,
    });
    await takeScreenshot(
      testInfo,
      scannerAddOn,
      scannerPage.page,
      'Cancelled add-on shows that its refund needs attention',
    );
    await recoveryPage.page.reload();
    await expect(
      recoveryPage.page.getByRole('heading', {
        level: 1,
        name: 'Organization finance',
      }),
    ).toBeVisible();
    await recoveryPage.page
      .getByRole('tab', { name: 'Refunds needing attention' })
      .click();
    const terminalRecoveryRow = recoveryPage.page
      .locator('div.border-b')
      .filter({ hasText: 'The previous refund failed.' });
    await expect(terminalRecoveryRow).toBeVisible({ timeout: 20_000 });
    await expect(terminalRecoveryRow).toContainText(scenario.title);
    await expect(terminalRecoveryRow).toContainText(refundAmountLabel);
    await terminalRecoveryRow
      .getByRole('button', { name: 'Review refund' })
      .click();
    const retryRecoveryForm = recoveryPage.page
      .getByRole('heading', {
        level: 2,
        name: 'Try failed refund again',
      })
      .locator('..');
    await expect(retryRecoveryForm).toBeVisible();
    await expect(retryRecoveryForm).toContainText(scenario.title);
    await expect(retryRecoveryForm).toContainText(refundAmountLabel);
    await expect(retryRecoveryForm).toContainText('Try this refund again');
    await expect(retryRecoveryForm).not.toContainText(refundClaim.id);
    await expect(retryRecoveryForm).not.toContainText(scenario.registrationId);
    await expect(retryRecoveryForm).not.toContainText(
      settledCheckout.transactionId,
    );
    await recoveryPage.page
      .getByLabel('Reason for this action')
      .fill(newGenerationReason);
    await takeScreenshot(
      testInfo,
      recoveryPage.page.locator('app-platform-finance'),
      recoveryPage.page,
      'Review and try the add-on refund again',
    );
    await recoveryPage.page
      .getByRole('button', { name: 'Try failed refund again' })
      .click();
    await expect(
      recoveryPage.page.getByText('The refund will be tried again', {
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
      scannerAddOn.getByText('Refund in progress', { exact: true }),
    ).toBeVisible();
    await page.reload();
    profileCard = await openProfileEventCard(page, scenario.title);
    await expect(profileCard).toContainText(/Add-on payment:\s*Refund delayed/);
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
      /Add-on payment:\s*Refund complete/,
    );
    await expect(profileCard).toContainText(refundAmountLabel);
    await expect(profileCard).toContainText(
      'Your sign-up is cancelled and all refunds are complete',
    );
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

After the refund succeeds, the organizer view shows **Refunded** and the attendee view shows **Refund complete**. The ticket stays cancelled.

Treat a refund as complete only when Evorto shows **Refund complete**.
`,
    });
    await takeScreenshot(
      testInfo,
      profileCard,
      page,
      'Completed refund on the cancelled attendee ticket',
    );
  });

  test('Understand when you can no longer cancel your ticket', async ({
    database,
    page,
    seeded,
    tenant,
    testClock,
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
    const eventTitle = 'Evening museum visit';
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
        description: 'A free ticket whose cancellation deadline has passed.',
        end: eventWindow.end,
        icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
        id: eventId,
        reviewedAt: testClock.toJSDate(),
        reviewedBy: eventCreator.id,
        start: eventWindow.start,
        status: 'APPROVED',
        templateId: template.id,
        tenantId: tenant.id,
        title: eventTitle,
      });
      const [registrationOption] = await database
        .insert(schema.eventRegistrationOptions)
        .values({
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
          title: 'Free attendee with a cancellation deadline',
        })
        .returning({
          id: schema.eventRegistrationOptions.id,
          price: schema.eventRegistrationOptions.price,
        });
      if (!registrationOption) {
        throw new Error('Expected the deadline-controlled registration option');
      }
      await database.insert(schema.eventRegistrations).values({
        appliedDiscountedPrice: null,
        appliedDiscountType: null,
        basePriceAtRegistration: registrationOption.price,
        discountAmount: 0,
        eventId,
        id: registrationId,
        registrationOptionId: registrationOption.id,
        status: 'CONFIRMED',
        tenantId: tenant.id,
        userId: participant.id,
      });

      await testInfo.attach('markdown', {
        body: `
The sign-up choice can override the organization's default cancellation deadline. If the cancellation deadline shown for the choice has passed, the attendee can no longer cancel the ticket.

Open **Events**, select the event, and review the confirmed ticket. Evorto explains that the deadline has passed and does not offer a cancellation action. If the page was opened before the deadline, trying to cancel later still shows that the deadline has passed.
`,
      });
      await openEventFromNormalNavigation(page, eventTitle);
      const activeRegistration = page.locator('app-event-active-registration');
      const deadlineExplanation = activeRegistration.getByText(
        'The cancellation deadline has passed. Your ticket is still active, no place has been released, and no refund has started.',
        { exact: true },
      );
      await expect(deadlineExplanation).toBeVisible();
      await expect(
        activeRegistration.getByRole('button', {
          exact: true,
          name: 'Cancel ticket',
        }),
      ).toHaveCount(0);
      await expect(activeRegistration).toBeVisible();
      await expect(
        activeRegistration.getByText('Your ticket is confirmed'),
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
The deadline explanation and missing cancellation action mean the ticket remains confirmed, the occupied spot remains counted, no refund was started, and Evorto does not try to send a cancellation email. The deadline remains in effect, so there is no cancellation action to use.
{% /callout %}

Contact an event organizer if the ticket still needs to be cancelled. An organizer who manages this event and is allowed to cancel attendee tickets and add-ons may cancel a ticket before check-in and before the event starts. The attendee cannot cancel it themselves after their deadline.

Other messages explain what blocks cancellation. If Evorto cannot find or verify the payment, keep the ticket and contact the event organizer; do not pay or cancel again. The organizer can ask Evorto support to review it. If Evorto cannot confirm that a pending payment was cancelled, return to the event and select **Cancel pending sign-up** once more. If it is still blocked, keep the ticket and contact the organizer. Finish or cancel an active add-on payment or transfer before reviewing cancellation again. Evorto keeps the ticket and place intact until cancellation is safe.

You can cancel only your own ticket in the organization you are signed in to. A shared link does not open another attendee's ticket. An organizer can cancel only if they manage this event and are allowed to cancel attendee tickets and add-ons.
`,
      });
      await takeScreenshot(
        testInfo,
        deadlineExplanation,
        page,
        'Confirmed ticket remains active after the cancellation deadline',
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

test.describe('Cancel an attendee as an organizer', () => {
  test.use({ storageState: adminStateFile });

  test('Cancel an attendee ticket from the organizer overview', async ({
    database,
    page,
    seeded,
    tenant,
    testClock,
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
    const eventTitle = 'Volunteer welcome evening';
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
          "An event used to explain an organizer cancelling an attendee's ticket.",
        end: eventWindow.end,
        icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
        id: eventId,
        reviewedAt: testClock.toJSDate(),
        reviewedBy: organizer.id,
        start: eventWindow.start,
        status: 'APPROVED',
        templateId: template.id,
        tenantId: tenant.id,
        title: eventTitle,
      });
      const [registrationOption] = await database
        .insert(schema.eventRegistrationOptions)
        .values({
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
          title: 'Attendee',
        })
        .returning({
          id: schema.eventRegistrationOptions.id,
          price: schema.eventRegistrationOptions.price,
        });
      if (!registrationOption) {
        throw new Error(
          'Expected the organizer cancellation registration option',
        );
      }
      await database.insert(schema.eventRegistrations).values({
        appliedDiscountedPrice: null,
        appliedDiscountType: null,
        basePriceAtRegistration: registrationOption.price,
        discountAmount: 0,
        eventId,
        guestCount: 1,
        id: registrationId,
        registrationOptionId: registrationOption.id,
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
{% callout type="note" title="Before you start as an organizer" %}
Use an account that can organize this exact event and is allowed to cancel attendee tickets and add-ons. Opening the page is not enough; only an organizer for this event with cancellation access can complete the action.

The ticket you are cancelling must belong to this event and organization, must not have been checked in, and the event must not have started. This example is free and includes one guest. The attendee's cancellation deadline has already passed, but an organizer who manages this event's tickets can still cancel it.
{% /callout %}

## Cancel from the organizer overview

1. Open **Events** from the main navigation.
2. Select the event.
3. Select **Organize this event**.
4. Under **Attendee sign-ups**, find the correct person and sign-up choice.
5. Verify that the attendee has not checked in, then select **Cancel ticket**.
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
        name: 'Cancel ticket',
      });
      await expect(cancelRegistration).toBeEnabled();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await testInfo.attach('markdown', {
        body: `
The attendee name and sign-up choice are the first details to review. Selecting the organizer action opens a second confirmation naming the attendee and explaining that places are released and a payment may require refund follow-up. When the confirmation opens, pressing Enter chooses **Go back**, so the ticket stays unchanged. Checked-in tickets do not offer cancellation, and Evorto blocks the action as well.
`,
      });
      await takeScreenshot(
        testInfo,
        participantRow,
        page,
        'Organizer reviews the named attendee and ticket',
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
          name: `Cancel ${participantName}'s ticket?`,
        }),
      ).toBeVisible();
      await expect(cancellationDialog).toContainText(
        'If a refund applies, it will be requested and may take time to appear.',
      );
      await expect(
        cancellationDialog.getByRole('button', {
          name: 'Go back',
        }),
      ).toBeFocused();
      await takeScreenshot(
        testInfo,
        cancellationDialog,
        page,
        'Organizer confirmation names the attendee and released places',
      );
      await cancellationDialog
        .getByRole('button', { name: 'Cancel ticket' })
        .click();

      await expect(
        page.getByText('Ticket cancelled', { exact: true }),
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
        `An organizer cancelled your ticket for ${eventTitle}.`,
      );

      await testInfo.attach('markdown', {
        body: `
## After the organizer cancels

The success message and disappearing attendee row show that the cancellation completed. The ticket is **Cancelled**, both attendee and guest places are released, and Evorto tries to email the attendee about the organizer cancellation. The ticket remains cancelled in Evorto even if the email does not arrive. This free ticket creates no refund.

For a paid ticket or add-on, Evorto first checks the amount that may need to be refunded. If it cannot confirm that cancellation is safe, nothing changes. If the refund later fails, the ticket remains cancelled and Evorto explains that an administrator needs to try the refund again.

This ticket is free, so cancellation creates no refund. For a paid ticket, check the refund status shown in Evorto before telling an attendee that money has been returned.

An active transfer, pending add-on payment, checked-in attendee, started event, ticket from another organization, or missing cancellation access also prevents cancellation. If anything changes while the confirmation is open, Evorto does not cancel the ticket or release places. Reopen the ticket and review its current details before cancelling again.
`,
      });
      await takeScreenshot(
        testInfo,
        page.locator('section').filter({
          has: page.getByRole('heading', {
            level: 2,
            name: 'Attendee sign-ups',
          }),
        }),
        page,
        'Attendee no longer appears after organizer cancellation',
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
