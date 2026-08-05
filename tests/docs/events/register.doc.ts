import { and, eq } from 'drizzle-orm';
import type { Locator, Page } from '@playwright/test';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { deliverCompletedRegistrationCheckoutWebhook } from '../../support/utils/registration-checkout-webhook';
import { seedPostRegistrationAddonPurchaseScenario } from '../../support/utils/post-registration-addon-purchase-scenario';
import {
  seedFreeRegistrationAddon,
  seedRequiredRegistrationQuestion,
} from '../../support/utils/seed-registration-addons';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';
import { waitForRegistrationPage as waitForRegistrationStatus } from '../../support/utils/event-registration-page';

test.use({ storageState: userStateFile, trace: 'retain-on-failure' });

const waitForActiveRegistration = async (page: Page) => {
  await waitForRegistrationStatus(page);
  await page.locator('app-event-active-registration').waitFor({
    state: 'visible',
    timeout: 15_000,
  });
};

const registrationAddOnRow = (page: Page, title: string): Locator =>
  page
    .locator('app-event-active-registration')
    .getByRole('listitem')
    .filter({
      has: page.getByRole('heading', { exact: true, level: 5, name: title }),
    });

const registrationAddOnCount = (addOnRow: Locator, label: string): Locator =>
  addOnRow.getByText(label, { exact: true }).locator('..').locator('dd');

const fillHydratedInputForAction = async (
  input: Locator,
  value: string,
  action: Locator,
): Promise<void> => {
  await expect(async () => {
    await expect(action).toBeVisible();
    // SSR controls accept DOM input before Angular attaches its live handlers.
    // Event replay removes `jsaction` once the action is safely interactive.
    await expect(action).not.toHaveAttribute('jsaction', /click/);
    await input.fill(value);
    await expect(input).toHaveValue(value);
    await expect(action).toBeEnabled();
  }).toPass({ timeout: 15_000 });
};

const requireUserFixture = (
  predicate: (user: (typeof usersToAuthenticate)[number]) => boolean,
  description: string,
) => {
  const user = usersToAuthenticate.find(predicate);
  if (!user) {
    throw new Error(`Expected ${description} user fixture`);
  }

  return user;
};

test.describe('Sign up for events', () => {
  test.describe.configure({ mode: 'serial' });

  test('Sign up for a free event', async ({
    database,
    events,
    page,
    seeded,
    tenant,
  }, testInfo) => {
    test.slow();
    const freeEventId = seeded.scenario.events.freeOpen.eventId;
    const freeOptionId = seeded.scenario.events.freeOpen.optionId;
    const freeEvent = events.find((event) => event.id === freeEventId);
    if (!freeEvent) {
      throw new Error(
        `Seeded freeOpen scenario event "${freeEventId}" was not found`,
      );
    }
    const regularUser = requireUserFixture(
      (user) => user.roles === 'user',
      'regular',
    );
    const addOnId = `addon-${getId().slice(0, 14)}`;
    const serverEventWindow = futureServerEventWindow();

    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, freeEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
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
      .where(eq(schema.eventRegistrationOptions.id, freeOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: serverEventWindow.end,
        start: serverEventWindow.start,
      })
      .where(eq(schema.eventInstances.id, freeEventId));
    await seedFreeRegistrationAddon({
      addonId: addOnId,
      database,
      eventId: freeEventId,
      registrationOptionId: freeOptionId,
      title: 'Snack voucher',
    });
    const registrationQuestion = await seedRequiredRegistrationQuestion({
      database,
      eventId: freeEventId,
      registrationOptionId: freeOptionId,
      title: 'Anything organizers should know?',
    });

    const freeEventHref = `/events/${freeEvent.id}`;
    const freeEventLink = page.locator(`a[href="${freeEventHref}"]`).first();

    await page.goto('.');
    await testInfo.attach('markdown', {
      body: `
  {% callout type="note" title="Before you start" %}
  This guide is for a signed-in attendee whose account belongs to the same organization as the event. Use the account that should own the ticket. The account must have one of the roles allowed to use the attendee choice; no organizer or administrator access is required for an ordinary sign-up.

  For a paid sign-up, the organization's online payments must be available and you need an accepted payment method.
  {% /callout %}

  Open **Events** from the main navigation and browse the events available to you. Select an event to read its details and sign-up choices.`,
    });
    await takeScreenshot(
      testInfo,
      freeEventLink,
      page,
      'Choose a published event from the event list',
    );
    await freeEventLink.click();
    await expect(page).toHaveURL(/\/events\/[a-z0-9]+$/i);
    await expect(
      page.getByRole('heading', { level: 1, name: freeEvent.title }),
    ).toBeVisible({ timeout: 15_000 });
    await waitForRegistrationStatus(page);
    await testInfo.attach('markdown', {
      body: `
  After you have selected your event, you can see the event description and your sign-up choices.
  If you arrived while signed out, select **Sign in**, use the account that should own the ticket, and return to the event.

  ### Free sign-ups
  This section covers free sign-ups. Paid sign-ups are covered later in this guide.
  Attendee choices are labeled separately from organizer/helper choices, which use **Sign up as organizer/helper** when you are helping run the event.
  When an attendee choice is full, **Join waitlist** replaces **Sign up**. People on the waitlist can return to the event page and use **Leave waitlist** before the event starts.
  If you open a direct event link but your account does not match the roles required by any available choice, the event remains visible and the sign-up area explains that sign-up is unavailable for your account.`,
    });
    await takeScreenshot(
      testInfo,
      page.getByRole('heading', { level: 2, name: 'Your sign-up' }),
      page,
      'Choose guests, add-ons, and answers before a free sign-up',
    );
    await testInfo.attach('markdown', {
      body: `
  A free sign-up choice can also offer guests, add-ons, and required questions. In **Guests**, enter only the people attending with you; guests do not need separate accounts, but each guest uses one available event place and stays attached to your ticket. The total beside the field includes you. Then choose any add-on quantity, answer every required question, and sign up. Afterwards, the ticket shows the guest count and selected add-ons, while organizers can review the answers.`,
    });
    const participantRegistrationCard = page
      .locator('app-event-registration-option')
      .filter({ hasText: 'Attendee sign-up' })
      .first();
    await expect(participantRegistrationCard).toBeVisible({ timeout: 20_000 });
    await expect(
      participantRegistrationCard.getByText('Snack voucher'),
    ).toBeVisible();
    await expect(
      participantRegistrationCard.getByLabel(registrationQuestion.title),
    ).toBeVisible();
    const guestCountInput = participantRegistrationCard.getByLabel('Guests');
    await expect(guestCountInput).toBeEnabled({ timeout: 15_000 });
    await expect(
      participantRegistrationCard.getByText(
        'Guests do not need separate accounts. Each guest uses one available place and shares your ticket.',
      ),
    ).toBeVisible();
    await guestCountInput.fill('1');
    await expect(guestCountInput).toHaveValue('1');
    await expect(
      participantRegistrationCard.getByText('+ you = 2 places'),
    ).toBeVisible();
    await expect(
      participantRegistrationCard.getByRole('button', { name: 'Sign up' }),
    ).toBeDisabled();
    await participantRegistrationCard.getByLabel('Quantity').fill('2');
    await participantRegistrationCard
      .getByLabel(registrationQuestion.title)
      .fill('Vegetarian snack, please.');
    await participantRegistrationCard
      .getByRole('button', { name: 'Sign up' })
      .click();
    await waitForActiveRegistration(page);
    const activeRegistration = page.locator('app-event-active-registration');
    await expect(
      activeRegistration.getByText('Your ticket is confirmed', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      activeRegistration.getByText('Includes 1 guest plus you.'),
    ).toBeVisible();
    const snackVoucherRow = registrationAddOnRow(page, 'Snack voucher');
    await expect(
      activeRegistration.getByRole('heading', {
        exact: true,
        level: 4,
        name: 'Add-ons',
      }),
    ).toBeVisible();
    await expect(snackVoucherRow).toBeVisible();
    await expect(
      registrationAddOnCount(snackVoucherRow, 'Purchased'),
    ).toHaveText('2');
    await expect(
      registrationAddOnCount(snackVoucherRow, 'Available to use'),
    ).toHaveText('2');

    const registration = await database.query.eventRegistrations.findFirst({
      where: {
        eventId: freeEventId,
        registrationOptionId: freeOptionId,
        status: 'CONFIRMED',
        tenantId: tenant.id,
        userId: regularUser.id,
      },
      with: {
        questionAnswers: true,
      },
    });
    if (!registration) {
      throw new Error(
        'Expected registration docs flow to persist the confirmed registration',
      );
    }
    expect(registration.guestCount).toBe(1);
    expect(registration.questionAnswers).toEqual([
      expect.objectContaining({
        answer: 'Vegetarian snack, please.',
        questionId: registrationQuestion.questionId,
      }),
    ]);
    const freeOptionAfterRegistration =
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: freeOptionId },
      });
    expect(freeOptionAfterRegistration).toEqual({
      confirmedSpots: 2,
      reservedSpots: 0,
    });
    const registrationEmail = await database.query.emailOutbox.findFirst({
      where: {
        idempotencyKey: `registration-confirmed/${tenant.id}/${registration.id}`,
        kind: 'registrationConfirmed',
        tenantId: tenant.id,
      },
    });
    expect(registrationEmail).toBeTruthy();
    expect(registrationEmail?.html).toContain(`/events/${freeEventId}`);
    expect(registrationEmail?.text).toContain(
      'Sign in with the account that holds this ticket to open it.',
    );

    await testInfo.attach('markdown', {
      body: `
  ### Confirmed free ticket
  The event page now shows **Your ticket is confirmed**, the ticket details, and its QR code.
  **Includes 1 guest plus you.** means the guest remains attached to the signed-in attendee's ticket and the two people use two confirmed places. Selected add-ons appear on the same ticket and organizers can review the answers.
  Show the QR code when attending the event. Evorto also tries to send a confirmation email with a link back to the ticket. The ticket shown on the event page is the confirmation: if the email does not arrive, sign in with the account used for the sign-up and open the event to find it.
  You can cancel while payment or approval is still pending. You can also cancel a confirmed ticket before its displayed cancellation deadline and before the event starts. Cancelling a confirmed ticket releases your selected places, including guests, and starts any refund shown in the confirmation.`,
    });

    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Your sign-up' }),
      page,
      'Confirmed free ticket with QR code, guest count, and add-ons',
    );
  });

  test('Buy add-ons for a confirmed ticket', async ({
    database,
    page,
    registerDatabaseCleanup,
    templates,
    tenant,
    testClock,
  }, testInfo) => {
    test.slow();
    const regularUser = requireUserFixture(
      (user) => user.roles === 'user',
      'regular',
    );
    const template = templates.find(
      (candidate) => candidate.seedKey === 'hike',
    );
    if (!template) {
      throw new Error(
        'Expected seeded hike template for participant add-on documentation',
      );
    }
    const scenario = await seedPostRegistrationAddonPurchaseScenario({
      database,
      templateId: template.id,
      tenant,
      testClock,
      title: 'Attendee add-ons after sign-up',
      userId: regularUser.id,
    });
    registerDatabaseCleanup(() => scenario.cleanup());

    await page.goto('/events');
    const eventLink = page.getByRole('link', { name: scenario.title }).first();
    await expect(eventLink).toBeVisible({ timeout: 20_000 });
    await testInfo.attach('markdown', {
      body: `
  A confirmed attendee can return to an event shown in **Events** and buy optional add-ons from the existing ticket. The organizer controls whether each add-on is sold before the event, during the event, or at both times.`,
    });
    await takeScreenshot(
      testInfo,
      eventLink,
      page,
      'Open a confirmed ticket to buy add-ons',
    );
    await eventLink.click();
    await expect(
      page.getByRole('heading', { level: 1, name: scenario.title }),
    ).toBeVisible({ timeout: 15_000 });
    await waitForActiveRegistration(page);

    const freeAddOnRow = registrationAddOnRow(page, scenario.addOns.free.title);
    const duringOnlyAddOnRow = registrationAddOnRow(
      page,
      scenario.addOns.duringOnly.title,
    );
    await expect(
      duringOnlyAddOnRow.getByText(
        'This add-on is not sold before the event.',
        { exact: true },
      ),
    ).toBeVisible();
    const addFreeAddOnButton = freeAddOnRow.getByRole('button', {
      exact: true,
      name: 'Add to ticket',
    });
    await fillHydratedInputForAction(
      freeAddOnRow.getByLabel(`Quantity for ${scenario.addOns.free.title}`, {
        exact: true,
      }),
      '2',
      addFreeAddOnButton,
    );
    await addFreeAddOnButton.click();
    await expect(freeAddOnRow.getByRole('status')).toContainText(
      `2 × ${scenario.addOns.free.title} added to your ticket.`,
      { timeout: 15_000 },
    );
    await expect(registrationAddOnCount(freeAddOnRow, 'Purchased')).toHaveText(
      '2',
    );
    const freePurchase =
      await database.query.eventRegistrationAddonPurchases.findFirst({
        where: {
          addonId: scenario.addOns.free.id,
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    expect(freePurchase).toEqual(
      expect.objectContaining({
        includedQuantity: 0,
        purchasedQuantity: 2,
        quantity: 2,
        unitPrice: 0,
      }),
    );
    await testInfo.attach('markdown', {
      body: `
  Free add-ons are added immediately. The ticket shows the **Purchased** and **Available to use** quantities. If an add-on cannot be used until later, the ticket explains when it becomes available.`,
    });
    await takeScreenshot(
      testInfo,
      page.locator('app-event-active-registration'),
      page,
      'Free add-on added to a confirmed ticket',
    );

    await scenario.setWindow('during');
    await page.reload();
    await waitForActiveRegistration(page);
    const beforeOnlyAddOnRow = registrationAddOnRow(
      page,
      scenario.addOns.beforeOnly.title,
    );
    await expect(
      beforeOnlyAddOnRow.getByText(
        'This add-on is not sold during the event.',
        { exact: true },
      ),
    ).toBeVisible();

    const paidAddOnRow = registrationAddOnRow(page, scenario.addOns.paid.title);
    await testInfo.attach('markdown', {
      body: `
  For a paid add-on, choose the quantity and select **Continue to payment**. Evorto holds those items while payment is pending. Leaving the payment page does not add them to the ticket: return to this event and continue the same payment instead of starting another purchase.`,
    });
    const continueToStripeButton = paidAddOnRow.getByRole('button', {
      exact: true,
      name: 'Continue to payment',
    });
    await fillHydratedInputForAction(
      paidAddOnRow.getByLabel(`Quantity for ${scenario.addOns.paid.title}`, {
        exact: true,
      }),
      '2',
      continueToStripeButton,
    );
    await takeScreenshot(
      testInfo,
      paidAddOnRow,
      page,
      'Start a paid add-on purchase from the attendee ticket',
    );
    await Promise.all([
      page.waitForURL(/checkout\.stripe\.com/, { timeout: 90_000 }),
      continueToStripeButton.click(),
    ]);
    await expect
      .poll(
        async () => {
          try {
            return (await scenario.readPendingCheckout()).checkoutUrl;
          } catch {
            return null;
          }
        },
        {
          message:
            'Timed out waiting for the participant UI to create the paid add-on checkout',
          timeout: 20_000,
        },
      )
      .not.toBeNull();
    const pendingCheckout = await scenario.readPendingCheckout();
    await expect(page).toHaveURL(pendingCheckout.checkoutUrl);
    await page.goto(`/events/${scenario.eventId}`);
    await waitForActiveRegistration(page);
    await expect(
      paidAddOnRow.getByText('Payment is pending', { exact: true }),
    ).toBeVisible();
    await expect(
      paidAddOnRow.getByRole('link', {
        exact: true,
        name: 'Continue to payment',
      }),
    ).toHaveAttribute('href', pendingCheckout.checkoutUrl);
    await expect(
      registrationAddOnCount(paidAddOnRow, 'Payment pending'),
    ).toHaveText('2');
    const pendingOrder =
      await database.query.eventRegistrationAddonPurchaseOrders.findFirst({
        where: { id: pendingCheckout.orderId, tenantId: tenant.id },
      });
    const pendingTransaction = await database.query.transactions.findFirst({
      where: { id: pendingCheckout.transactionId, tenantId: tenant.id },
    });
    const prematurePaidPurchase =
      await database.query.eventRegistrationAddonPurchases.findFirst({
        where: {
          addonId: scenario.addOns.paid.id,
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    const prematurePaidLot =
      await database.query.eventRegistrationAddonPurchaseLots.findFirst({
        where: {
          sourceTransactionId: pendingCheckout.transactionId,
          tenantId: tenant.id,
        },
      });
    expect(pendingOrder).toEqual(
      expect.objectContaining({
        applicationFeeAmount: 35,
        expectedGrossAmount: 1_000,
        expiresAt: pendingCheckout.expiresAt,
        status: 'pending_payment',
        transactionId: pendingCheckout.transactionId,
      }),
    );
    expect(pendingTransaction).toEqual(
      expect.objectContaining({
        appFee: 35,
        status: 'pending',
        stripeChargeId: null,
        stripeCheckoutSessionId: pendingCheckout.sessionId,
        stripeCheckoutUrl: pendingCheckout.checkoutUrl,
        stripeFee: null,
        stripeNetAmount: null,
        stripePaymentIntentId: null,
      }),
    );
    expect(prematurePaidPurchase).toBeUndefined();
    expect(prematurePaidLot).toBeUndefined();
    await testInfo.attach('markdown', {
      body: `
  A paid add-on first holds the selected quantity and shows **Payment is pending**. It becomes available only after payment succeeds. The same **Continue to payment** action remains available while payment is pending; use it to return to the existing payment. Cancellation and transfer stay unavailable so the ticket cannot change at the same time.`,
    });
    await takeScreenshot(
      testInfo,
      page.locator('app-event-active-registration'),
      page,
      'Paid add-on held while payment is pending',
    );

    await expect(scenario.completeCheckout()).resolves.toBe('finalized');
    await page.reload();
    await waitForActiveRegistration(page);
    await expect(
      paidAddOnRow.getByText('Payment is pending', { exact: true }),
    ).toHaveCount(0);
    await expect(registrationAddOnCount(paidAddOnRow, 'Purchased')).toHaveText(
      '2',
    );
    await expect(
      registrationAddOnCount(paidAddOnRow, 'Available to use'),
    ).toHaveText('2');
    await expect(
      beforeOnlyAddOnRow.getByText(
        'This add-on is not sold during the event.',
        { exact: true },
      ),
    ).toBeVisible();

    const settledOrder =
      await database.query.eventRegistrationAddonPurchaseOrders.findFirst({
        where: { id: pendingCheckout.orderId, tenantId: tenant.id },
      });
    const settledTransaction = await database.query.transactions.findFirst({
      where: { id: pendingCheckout.transactionId, tenantId: tenant.id },
    });
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
          sourceTransactionId: pendingCheckout.transactionId,
          tenantId: tenant.id,
        },
      });
    expect(settledOrder?.status).toBe('completed');
    expect(settledTransaction).toEqual(
      expect.objectContaining({
        appFee: 35,
        status: 'successful',
        stripeChargeId: pendingCheckout.chargeId,
        stripeFee: 29,
        stripeNetAmount: 936,
        stripePaymentIntentId: pendingCheckout.paymentIntentId,
      }),
    );
    expect(settledPurchase).toEqual(
      expect.objectContaining({
        includedQuantity: 0,
        purchasedQuantity: 2,
        quantity: 2,
      }),
    );
    expect(settledLot).toEqual(
      expect.objectContaining({
        applicationFeeAmount: 35,
        grossAmount: 1_000,
        netAmount: 936,
        paymentAllocationFinalizedAt: expect.any(Date),
        quantity: 2,
        sourceTransactionId: pendingCheckout.transactionId,
        stripeFeeAmount: 29,
      }),
    );
    await testInfo.attach('markdown', {
      body: `
  After payment succeeds, the purchased quantity becomes available to use. Any timing restrictions remain visible with the add-on.`,
    });
    await takeScreenshot(
      testInfo,
      page.locator('app-event-active-registration'),
      page,
      'Paid add-on available on the attendee ticket',
    );
  });

  test('See when sign-up is unavailable', async ({
    database,
    page,
    seeded,
    tenant,
  }, testInfo) => {
    const regularUser = requireUserFixture(
      (user) => user.roles === 'user',
      'regular',
    );
    const closedEventId = seeded.scenario.events.closedReg.eventId;
    const fullEventId = seeded.scenario.events.freeOpen.eventId;
    const fullOptionId = seeded.scenario.events.freeOpen.optionId;
    const serverEventWindow = futureServerEventWindow();
    const fullOption = await database.query.eventRegistrationOptions.findFirst({
      where: { eventId: fullEventId, id: fullOptionId },
    });
    if (!regularUser || !fullOption) {
      throw new Error(
        'Expected regular user and seeded free registration option',
      );
    }
    const fullEvent = await database.query.eventInstances.findFirst({
      where: { id: fullEventId, tenantId: tenant.id },
    });
    if (!fullEvent) {
      throw new Error('Expected seeded free registration event');
    }
    await testInfo.attach('markdown', {
      body: `
  Event pages stay readable when sign-up is not currently possible. The sign-up card explains why and what you can do instead of showing an action that cannot succeed.
`,
    });

    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, closedEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      );
    await page.goto(`/events/${closedEventId}`);
    await waitForRegistrationStatus(page);
    await expect(page.getByText('Sign-up closed')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Sign up$/ })).toHaveCount(
      0,
    );
    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Your sign-up' }),
      page,
      'Event details show that sign-up has closed',
    );

    await testInfo.attach('markdown', {
      body: `
  When the sign-up window is closed, attendees can still read the event details, but the sign-up action is removed.
`,
    });

    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, fullEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      );
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        closeRegistrationTime: serverEventWindow.closeRegistrationTime,
        confirmedSpots: fullOption.spots,
        openRegistrationTime: serverEventWindow.openRegistrationTime,
        reservedSpots: 0,
        waitlistSpots: 0,
      })
      .where(eq(schema.eventRegistrationOptions.id, fullOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: serverEventWindow.end,
        start: serverEventWindow.start,
      })
      .where(eq(schema.eventInstances.id, fullEventId));
    const waitlistQuestion = await seedRequiredRegistrationQuestion({
      database,
      eventId: fullEventId,
      registrationOptionId: fullOptionId,
      title: 'Anything organizers should know?',
    });
    await page.goto(`/events/${fullEventId}`);
    await waitForRegistrationStatus(page);
    await expect(page.getByText('This sign-up choice is full.')).toBeVisible();
    const waitlistButton = page.getByRole('button', { name: 'Join waitlist' });
    await expect(waitlistButton).toBeVisible();
    const waitlistQuestionInput = page.getByLabel(waitlistQuestion.title);
    await expect(waitlistQuestionInput).toBeVisible();
    await expect(waitlistButton).toBeDisabled();
    await fillHydratedInputForAction(
      waitlistQuestionInput,
      'Please tell me if a spot opens.',
      waitlistButton,
    );
    await expect(page.getByRole('button', { name: /^Sign up$/ })).toHaveCount(
      0,
    );
    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Your sign-up' }),
      page,
      'Full sign-up choice with waitlist',
    );
    await waitlistButton.click();
    await expect(
      page.getByText('You are currently on the waitlist'),
    ).toBeVisible();
    const waitlistRegistration =
      await database.query.eventRegistrations.findFirst({
        where: {
          eventId: fullEventId,
          registrationOptionId: fullOptionId,
          status: 'WAITLIST',
          tenantId: tenant.id,
          userId: regularUser.id,
        },
        with: {
          questionAnswers: true,
        },
      });
    if (!waitlistRegistration) {
      throw new Error(
        'Expected registration docs waitlist flow to persist the waitlist registration',
      );
    }
    expect(waitlistRegistration.questionAnswers).toEqual([
      expect.objectContaining({
        answer: 'Please tell me if a spot opens.',
        questionId: waitlistQuestion.questionId,
      }),
    ]);
    await page.getByRole('button', { name: 'Leave waitlist' }).click();
    const leaveWaitlistDialog = page.getByRole('dialog');
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
      page,
      'Review before leaving the waitlist',
    );
    await leaveWaitlistDialog
      .getByRole('button', { name: 'Leave waitlist' })
      .click();
    await expect(page.getByText('This sign-up choice is full.')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Join waitlist' }),
    ).toBeVisible();

    const cancelledWaitlistRegistration =
      await database.query.eventRegistrations.findFirst({
        where: {
          id: waitlistRegistration.id,
          status: 'CANCELLED',
          tenantId: tenant.id,
        },
      });
    if (!cancelledWaitlistRegistration) {
      throw new Error(
        'Expected registration docs waitlist leave action to cancel the waitlist registration',
      );
    }
    const fullOptionAfterLeaving =
      await database.query.eventRegistrationOptions.findFirst({
        where: { eventId: fullEventId, id: fullOptionId },
      });
    if (!fullOptionAfterLeaving) {
      throw new Error(
        'Expected seeded full option after registration docs waitlist leave action',
      );
    }
    expect(fullOptionAfterLeaving.waitlistSpots).toBe(0);

    await testInfo.attach('markdown', {
      body: `
When all places in an attendee choice are taken, **Join waitlist** replaces **Sign up**. If that choice asks required sign-up questions, attendees must answer them before joining. A waitlist place is not a confirmed ticket.

To give up the position before the event starts, select **Leave waitlist**. When the **Leave the waitlist?** confirmation opens, pressing Enter chooses **Stay on waitlist**, so your place stays unchanged. Select **Leave waitlist** only when you intend to give up that place.
`,
    });
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        closeRegistrationTime: fullOption.closeRegistrationTime,
        confirmedSpots: fullOption.confirmedSpots,
        reservedSpots: fullOption.reservedSpots,
        waitlistSpots: fullOption.waitlistSpots,
      })
      .where(eq(schema.eventRegistrationOptions.id, fullOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: fullEvent.end,
        start: fullEvent.start,
      })
      .where(eq(schema.eventInstances.id, fullEventId));
  });

  test.describe('When you cannot sign up', () => {
    test.use({ storageState: userStateFile });

    test('Understand why sign-up is unavailable', async ({
      database,
      page,
      roles,
      seeded,
      tenant,
    }, testInfo) => {
      const regularUser = requireUserFixture(
        (user) => user.roles === 'user',
        'regular',
      );
      const organizerRoleIds = roles
        .filter((role) => role.defaultOrganizerRole)
        .map((role) => role.id);
      if (organizerRoleIds.length === 0) {
        throw new Error('Expected seeded organizer-only role');
      }

      const eventId = seeded.scenario.events.freeOpen.eventId;
      const optionId = seeded.scenario.events.freeOpen.optionId;
      const option = await database.query.eventRegistrationOptions.findFirst({
        where: { eventId, id: optionId },
      });
      if (!option) {
        throw new Error(
          'Expected seeded free registration option for role-ineligible docs state',
        );
      }

      try {
        await database
          .delete(schema.eventRegistrations)
          .where(
            and(
              eq(schema.eventRegistrations.eventId, eventId),
              eq(schema.eventRegistrations.tenantId, tenant.id),
              eq(schema.eventRegistrations.userId, regularUser.id),
            ),
          );
        await database
          .update(schema.eventRegistrationOptions)
          .set({ roleIds: organizerRoleIds })
          .where(eq(schema.eventRegistrationOptions.id, optionId));

        await page.goto(`/events/${eventId}`);
        await waitForRegistrationStatus(page);

        await expect(
          page.getByRole('heading', { name: 'Sign-up unavailable' }),
        ).toBeVisible();
        await expect(
          page.getByText(
            'You can view this event, but none of its sign-up choices are available to you.',
          ),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: /^Sign up$/ }),
        ).toHaveCount(0);
        await takeScreenshot(
          testInfo,
          page.locator('section').filter({ hasText: 'Your sign-up' }),
          page,
          'Why this account cannot sign up',
        );

        await testInfo.attach('markdown', {
          body: `
  Shared event links remain readable for signed-in members who cannot use any sign-up choice. **Sign-up unavailable** means none of the event's sign-up choices are available to the current account. Check that you opened the correct organization and signed in with the intended account. If you expected access, ask an organizer which organization role the choice requires. A shared link does not make a sign-up choice available to you.
`,
        });
      } finally {
        await database
          .update(schema.eventRegistrationOptions)
          .set({ roleIds: option.roleIds })
          .where(eq(schema.eventRegistrationOptions.id, optionId));
      }
    });
  });

  test('Sign up for a paid event', async ({
    database,
    events,
    page,
    request,
    seeded,
    tenant,
  }, testInfo) => {
    test.slow();
    const paidEventId = seeded.scenario.events.paidOpen.eventId;
    const paidOptionId = seeded.scenario.events.paidOpen.optionId;
    const paidEvent = events.find((event) => event.id === paidEventId);
    if (!paidEvent) {
      throw new Error(
        `Seeded paidOpen scenario event "${paidEventId}" was not found`,
      );
    }
    const regularUserId = requireUserFixture(
      (user) => user.roles === 'user',
      'regular',
    ).id;
    const serverEventWindow = futureServerEventWindow();
    const paidOption = await database.query.eventRegistrationOptions.findFirst({
      where: {
        eventId: paidEventId,
        id: paidOptionId,
      },
    });
    if (!paidOption?.isPaid) {
      throw new Error(
        'Expected seeded paidOpen registration option to exist and be paid',
      );
    }

    await database
      .delete(schema.transactions)
      .where(
        and(
          eq(schema.transactions.eventId, paidEvent.id),
          eq(schema.transactions.method, 'stripe'),
          eq(schema.transactions.targetUserId, regularUserId),
          eq(schema.transactions.tenantId, tenant.id),
          eq(schema.transactions.type, 'registration'),
        ),
      );
    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, paidEvent.id),
          eq(schema.eventRegistrations.registrationOptionId, paidOptionId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUserId),
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
      .where(eq(schema.eventRegistrationOptions.id, paidOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: serverEventWindow.end,
        start: serverEventWindow.start,
      })
      .where(eq(schema.eventInstances.id, paidEventId));

    await page.goto('.');
    await testInfo.attach('markdown', {
      body: `
  A paid sign-up is confirmed only after its payment succeeds.`,
    });
    await page.goto(`/events/${paidEvent.id}`);
    await expect(page).toHaveURL(new RegExp(`/events/${paidEvent.id}`));
    await waitForRegistrationStatus(page);
    await takeScreenshot(
      testInfo,
      page.getByRole('heading', { level: 2, name: 'Your sign-up' }),
      page,
      'Paid sign-up choice before selecting guests',
    );
    const paidRegistrationCard = page
      .locator('app-event-registration-option')
      .filter({ hasText: paidOption.title });
    await expect(paidRegistrationCard).toHaveCount(1);
    await expect(paidRegistrationCard).toBeVisible({ timeout: 20_000 });
    const paidGuestCountInput = paidRegistrationCard.getByLabel('Guests');
    await expect(paidGuestCountInput).toBeEnabled({ timeout: 15_000 });
    await testInfo.attach('markdown', {
      body: `
  In **Guests**, enter the number of people attending with you before starting payment. This guide selects one guest, so the field shows **+ you = 2 places**. The total on the payment button includes the signed-in attendee and the guest; each person reserves one event place while payment is pending.

  Check the guest count and total carefully, then select the payment button to continue.
  Afterwards, you can pay to confirm the ticket or cancel the unfinished sign-up if you change your mind. Cancelling releases the places only after Evorto confirms that payment was stopped. If Evorto cannot confirm that, the unfinished sign-up and held places remain unchanged; open the ticket again and follow the displayed message before trying again.`,
    });
    await expect(
      paidRegistrationCard.getByText(
        'Guests do not need separate accounts. Each guest uses one available place and shares your ticket.',
      ),
    ).toBeVisible();
    await paidGuestCountInput.fill('1');
    await expect(paidGuestCountInput).toHaveValue('1');
    await expect(
      paidRegistrationCard.getByText('+ you = 2 places'),
    ).toBeVisible();
    const payButton = paidRegistrationCard.getByRole('button');
    await expect(payButton).toHaveCount(1);
    await expect(payButton).toContainText('and sign up');
    await takeScreenshot(
      testInfo,
      paidRegistrationCard,
      page,
      'Paid sign-up with one guest and two places',
    );
    const payNowLink = page.getByRole('link', { name: 'Pay now' }).first();
    let checkoutUrl: null | string = null;
    if ((await payNowLink.count()) > 0) {
      checkoutUrl = await payNowLink.getAttribute('href');
    }
    if (!checkoutUrl) {
      await expect(payButton).toBeVisible({ timeout: 20_000 });
      await expect(payButton).not.toHaveAttribute('jsaction', /click/);
      await expect(payButton).toBeEnabled();
      await payButton.click();
      await expect
        .poll(
          async () => {
            const pendingTransaction =
              await database.query.transactions.findFirst({
                orderBy: { createdAt: 'desc' },
                where: {
                  eventId: paidEvent.id,
                  method: 'stripe',
                  status: 'pending',
                  targetUserId: regularUserId,
                  tenantId: tenant.id,
                  type: 'registration',
                },
              });
            return pendingTransaction?.stripeCheckoutUrl ?? null;
          },
          {
            intervals: [1_000, 2_000, 4_000],
            message:
              'Timed out waiting for a pending Stripe checkout transaction URL',
            timeout: 90_000,
          },
        )
        .not.toBeNull();
      const pendingTransaction = await database.query.transactions.findFirst({
        orderBy: { createdAt: 'desc' },
        where: {
          eventId: paidEvent.id,
          method: 'stripe',
          status: 'pending',
          targetUserId: regularUserId,
          tenantId: tenant.id,
          type: 'registration',
        },
      });
      checkoutUrl = pendingTransaction?.stripeCheckoutUrl ?? null;
    }
    const pendingTransaction = await database.query.transactions.findFirst({
      orderBy: { createdAt: 'desc' },
      where: {
        eventId: paidEvent.id,
        method: 'stripe',
        status: 'pending',
        targetUserId: regularUserId,
        tenantId: tenant.id,
        type: 'registration',
      },
    });
    if (
      !checkoutUrl ||
      !pendingTransaction?.eventRegistrationId ||
      !pendingTransaction.stripeAccountId ||
      !pendingTransaction.stripeCheckoutSessionId ||
      !pendingTransaction.stripeCheckoutUrl
    ) {
      throw new Error('Expected exact pending paid registration ownership');
    }
    expect(pendingTransaction.stripeCheckoutUrl).toBe(checkoutUrl);
    expect(new URL(checkoutUrl).hostname).toBe('checkout.stripe.com');
    expect(pendingTransaction.amount).toBe(paidOption.price * 2);
    const pendingRegistration =
      await database.query.eventRegistrations.findFirst({
        where: {
          id: pendingTransaction.eventRegistrationId,
          tenantId: tenant.id,
        },
      });
    expect(pendingRegistration?.guestCount).toBe(1);
    expect(pendingRegistration?.status).toBe('PENDING');
    const paidOptionDuringCheckout =
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: paidOptionId },
      });
    expect(paidOptionDuringCheckout).toEqual({
      confirmedSpots: 0,
      reservedSpots: 2,
    });

    await testInfo.attach('markdown', {
      body: `
  **Pay now** opens the secure payment page. Review the event and amount, enter a payment method, and submit the payment. Closing the payment page leaves this sign-up waiting for payment, so return here and use the same **Pay now** link instead of starting a second sign-up.

  Return to Evorto after paying and check that the ticket is confirmed before relying on it.`,
    });
    await deliverCompletedRegistrationCheckoutWebhook({
      amount: pendingTransaction.amount,
      applicationFeeAmount: pendingTransaction.appFee,
      currency: pendingTransaction.currency,
      paymentIntentId: pendingTransaction.stripePaymentIntentId,
      registrationId: pendingTransaction.eventRegistrationId,
      request,
      sessionId: pendingTransaction.stripeCheckoutSessionId,
      stripeAccountId: pendingTransaction.stripeAccountId,
      tenantId: tenant.id,
      transactionId: pendingTransaction.id,
    });

    const getStripeRegistrationState = async () => {
      const transaction = await database.query.transactions.findFirst({
        orderBy: { createdAt: 'desc' },
        where: {
          eventId: paidEvent.id,
          method: 'stripe',
          targetUserId: regularUserId,
          tenantId: tenant.id,
          type: 'registration',
        },
      });
      if (!transaction) {
        return 'missing-transaction';
      }

      const registration = transaction.eventRegistrationId
        ? await database.query.eventRegistrations.findFirst({
            where: {
              id: transaction.eventRegistrationId,
              tenantId: tenant.id,
            },
          })
        : await database.query.eventRegistrations.findFirst({
            orderBy: { createdAt: 'desc' },
            where: {
              eventId: paidEvent.id,
              tenantId: tenant.id,
              userId: regularUserId,
            },
          });

      return `${transaction.status}:${registration?.status ?? 'missing-registration'}`;
    };

    await expect
      .poll(getStripeRegistrationState, {
        intervals: [1_000, 2_000, 4_000],
        message:
          'Timed out waiting for Stripe checkout side-effects to be mirrored in the application database',
        timeout: 90_000,
      })
      .toBe('successful:CONFIRMED');

    await page.goto(`/events/${paidEvent.id}`);
    await expect(page).toHaveURL(new RegExp(`/events/${paidEvent.id}`));
    await waitForRegistrationStatus(page);
    const registeredMessage = page.getByText('Your ticket is confirmed');
    await expect(registeredMessage).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Includes 1 guest plus you.')).toBeVisible();
    const paidOptionAfterCheckout =
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: paidOptionId },
      });
    expect(paidOptionAfterCheckout).toEqual({
      confirmedSpots: 2,
      reservedSpots: 0,
    });
    await testInfo.attach('markdown', {
      body: `
  ### Confirmed paid ticket
  After payment succeeds, return to the event page and check for **Your ticket is confirmed**. The ticket details and QR code are now available. **Includes 1 guest plus you** confirms that both paid places belong to this ticket.
  Evorto tries to send a confirmation email with a link back to the ticket. You can always check the confirmed ticket on the event page, even if that email does not arrive.`,
    });
    await takeScreenshot(
      testInfo,
      page.getByRole('heading', { level: 2, name: 'Your sign-up' }),
      page,
      'Confirmed paid ticket with QR code and guest count',
    );
  });
});
