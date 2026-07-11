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

test.describe('Register for events', () => {
  test.describe.configure({ mode: 'serial' });

  test('Register for a free event', async ({
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
  This guide is for a signed-in participant whose account belongs to the same tenant as the event. Use the account that should own the ticket. The account must match any participant-role restrictions shown on the registration option; no organizer or administrator permission is required for an ordinary participant registration.

  A paid registration also requires the tenant's Stripe payments to be available and a payment method accepted by Stripe.
  {% /callout %}

  Open **Events** from the main navigation and browse the events available to you. Select an event to read its details and registration options.`,
    });
    await takeScreenshot(testInfo, freeEventLink, page);
    await freeEventLink.click();
    await expect(page).toHaveURL(/\/events\/[a-z0-9]+$/i);
    await expect(
      page.getByRole('heading', { level: 1, name: freeEvent.title }),
    ).toBeVisible({ timeout: 15_000 });
    await waitForRegistrationStatus(page);
    await testInfo.attach('markdown', {
      body: `
  After you have selected your event, you can see the event description and your options for registration.
  If you arrived while signed out, select **Log in**, sign in with the participant account that should own the ticket, and return to the event.

  ### Free events
  Here we will make a distinction for free events and paid events (covered further down).
  Participant options are labeled separately from organizer/helper options, which use **Sign up as organizer/helper** copy when you are helping run the event.
  When a participant option is full, registration changes to a distinct **Join waitlist** action instead of pretending a normal spot is still available. Waitlisted participants can return to the event page and use **Leave waitlist** before the event starts.
  If you open a direct event link but your account does not match the roles required by any available option, the event remains visible and the registration area explains that registration is unavailable for your account.`,
    });
    await takeScreenshot(
      testInfo,
      page.getByRole('heading', { level: 2, name: 'Registration' }),
      page,
    );
    await testInfo.attach('markdown', {
      body: `
  Free registration cards can also offer registration-time add-ons and required questions. Choose the quantity you want, answer any required questions, and then register. After registration, selected add-ons are shown with the active registration so participants can review what they picked. Question answers are stored with the registration for organizers.`,
    });
    const participantRegistrationCard = page
      .locator('app-event-registration-option')
      .filter({ hasText: 'Participant registration' })
      .first();
    await expect(participantRegistrationCard).toBeVisible({ timeout: 20_000 });
    await expect(
      participantRegistrationCard.getByText('Snack voucher'),
    ).toBeVisible();
    await expect(
      participantRegistrationCard.getByLabel(registrationQuestion.title),
    ).toBeVisible();
    await expect(
      participantRegistrationCard.getByRole('button', { name: 'Register' }),
    ).toBeDisabled();
    await participantRegistrationCard.getByLabel('Quantity').fill('2');
    await participantRegistrationCard
      .getByLabel(registrationQuestion.title)
      .fill('Vegetarian snack, please.');
    await participantRegistrationCard
      .getByRole('button', { name: 'Register' })
      .click();
    await waitForActiveRegistration(page);
    const activeRegistration = page.locator('app-event-active-registration');
    await expect(
      activeRegistration.getByText('You are registered', { exact: true }),
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
    expect(registration.questionAnswers).toEqual([
      expect.objectContaining({
        answer: 'Vegetarian snack, please.',
        questionId: registrationQuestion.questionId,
      }),
    ]);
    const registrationEmail = await database.query.emailOutbox.findFirst({
      where: {
        idempotencyKey: `registration-confirmed/${tenant.id}/${registration.id}`,
        kind: 'registrationConfirmed',
        tenantId: tenant.id,
      },
    });
    expect(registrationEmail).toBeTruthy();
    expect(registrationEmail?.html).toContain(`/events/${freeEventId}`);
    expect(registrationEmail?.text).toContain('not a bearer credential');

    await testInfo.attach('markdown', {
      body: `
  ### Successful registration
  You should now have a successful registration.
  You can see this by additional information being available and also your ticket QR code.
  Participant registrations can include guests, registration-time add-ons, and registration-question answers. Guest spots are attached to the logged-in buyer's registration and count against the same option capacity. Add-ons are shown with the confirmed registration and can be reviewed by organizers.
  Show this ticket QR code when attending the event. Evorto also queues a confirmation email with a link back to this authenticated ticket page. The link is not a bearer credential: the participant must still sign in as the ticket owner.
  You can cancel a pending or confirmed registration from this event page before the event starts. Confirmed cancellation releases your selected spots, including guests when attached. If the registration was paid, Evorto submits a Stripe refund when the original payment reference is available; otherwise it creates a pending manual refund record for organizers.`,
    });

    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Registration' }),
      page,
      'Event details after registration',
    );
  });

  test('Buy add-ons after registration', async ({
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
      title: 'Participant add-ons after registration',
      userId: regularUser.id,
    });
    registerDatabaseCleanup(() => scenario.cleanup());

    await page.goto('/events');
    const eventLink = page.getByRole('link', { name: scenario.title }).first();
    await expect(eventLink).toBeVisible();
    await testInfo.attach('markdown', {
      body: `
  A confirmed participant can return to a listed event and buy optional add-ons from the existing ticket. The organizer controls whether each add-on is sold before the event, during the event, or in both windows.`,
    });
    await takeScreenshot(
      testInfo,
      eventLink,
      page,
      'Registered event with participant add-ons',
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
  Free add-ons are added immediately. The ticket shows the settled **Purchased** and **Available to use** quantities, while a before-event restriction remains visible instead of showing an unusable purchase action.`,
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
  For a paid add-on, choose the quantity and select **Continue to Stripe**. Evorto creates one pending order, reserves that stock, and opens Stripe Checkout. Leaving Checkout does not add the items to the ticket: return to this event and continue the same payment link instead of starting another purchase.`,
    });
    const continueToStripeButton = paidAddOnRow.getByRole('button', {
      exact: true,
      name: 'Continue to Stripe',
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
      'Start a paid add-on purchase from the participant ticket',
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
        name: 'Continue Stripe checkout',
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
  A paid add-on first reserves stock and shows **Payment is pending**. Pending payment is not an entitlement: reloading keeps the same **Continue Stripe checkout** link, and the purchased quantity changes only after Stripe confirms payment. While checkout is pending, cancellation and transfer stay disabled so the ticket cannot change ownership underneath the reservation.`,
    });
    await takeScreenshot(
      testInfo,
      page.locator('app-event-active-registration'),
      page,
      'Paid add-on checkout pending after reload',
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
  After settlement, the pending state disappears and the paid quantity becomes available to use. The order, successful transaction, aggregate purchase, and immutable purchase lot provide the matching server-side record. During-event restrictions continue to be explained explicitly.`,
    });
    await takeScreenshot(
      testInfo,
      page.locator('app-event-active-registration'),
      page,
      'Paid add-on settled on the participant ticket',
    );
  });

  test('Review unavailable registration states', async ({
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
  Event pages stay readable when registration is not currently possible. The registration card explains the current state instead of showing an action that cannot succeed.
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
    await expect(page.getByText('Registration is closed')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Register$/ })).toHaveCount(
      0,
    );
    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Registration' }),
      page,
      'Closed registration window',
    );

    await testInfo.attach('markdown', {
      body: `
  When the registration window is closed, participants can still read the event details, but the registration action is removed.
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
    await expect(page.getByText('This option is full.')).toBeVisible();
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
    await expect(page.getByRole('button', { name: /^Register$/ })).toHaveCount(
      0,
    );
    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Registration' }),
      page,
      'Full registration option with waitlist',
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
    await expect(page.getByText('This option is full.')).toBeVisible();
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
  Full participant options expose a distinct **Join waitlist** action. If that option asks required registration questions, participants must answer them before joining the waitlist. Waitlist registration is separate from a confirmed registration, and a normal **Register** button is not shown while the option is full. Participants can leave the waitlist before the event starts, which cancels the waitlist registration and releases the waitlist position.
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

  test.describe('without eligible roles', () => {
    test.use({ storageState: userStateFile });

    test('Review role-ineligible registration state', async ({
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
          page.getByRole('heading', { name: 'Registration unavailable' }),
        ).toBeVisible();
        await expect(
          page.getByText(
            'This event is visible from the direct link, but your account is not eligible for the available registration options.',
          ),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: /^Register$/ }),
        ).toHaveCount(0);
        await takeScreenshot(
          testInfo,
          page.locator('section').filter({ hasText: 'Registration' }),
          page,
          'Role-ineligible registration state',
        );

        await testInfo.attach('markdown', {
          body: `
  Direct event links remain readable for signed-in users without eligible tenant roles. The registration area states that the current account is not eligible instead of hiding the event or rendering an empty registration section.
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

  test('Register for a paid event', async ({
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
  To register for a paid event, you have to pay the registration fee.`,
    });
    await page.goto(`/events/${paidEvent.id}`);
    await expect(page).toHaveURL(new RegExp(`/events/${paidEvent.id}`));
    await waitForRegistrationStatus(page);
    await takeScreenshot(
      testInfo,
      page.getByRole('heading', { level: 2, name: 'Registration' }),
      page,
    );
    const payButton = page.getByRole('button', { name: /Pay/i }).first();
    await testInfo.attach('markdown', {
      body: `
  By clicking the **Pay and register** button, you are starting the payment process.
  Paid guest spots are included in the Stripe Checkout quantity and reserve the matching capacity while payment is pending.
  Afterwards, you can either finish the registration by paying or cancel your payment and registration in case you changed your mind. Cancelling a pending payment registration releases every selected buyer and guest spot and expires the pending checkout when possible.`,
    });
    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Registration' }),
      page,
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

    await testInfo.attach('markdown', {
      body: `
  Stripe Checkout opens on Stripe's website. Review the event and amount there, enter a payment method, and submit the payment. Closing Checkout leaves this registration pending, so return here and use the same **Pay now** link instead of starting another registration.

  This guide verifies the exact Stripe destination and the signed completion event Evorto accepts for this registration. It shows Evorto immediately before and after payment instead of reproducing Stripe's changing card form.`,
    });
    await deliverCompletedRegistrationCheckoutWebhook({
      amount: pendingTransaction.amount,
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
    const registeredMessage = page.getByText('You are registered');
    await expect(registeredMessage).toBeVisible({ timeout: 20_000 });
    await testInfo.attach('markdown', {
      body: `
  ### Successful paid registration
  After Stripe accepts the payment, return to the event page to see your registration confirmation.
  Your ticket details and QR code are now available.`,
    });
    await takeScreenshot(
      testInfo,
      page.getByRole('heading', { level: 2, name: 'Registration' }),
      page,
      'Event details after successful paid registration',
    );
  });
});
