import { and, eq, inArray } from 'drizzle-orm';
import type { Locator, Page } from '@playwright/test';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/axe-test';
import { seedPostRegistrationAddonPurchaseScenario } from '../../support/utils/post-registration-addon-purchase-scenario';
import { seedFreeRegistrationAddon } from '../../support/utils/seed-registration-addons';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';
import { waitForRegistrationPage } from '../../support/utils/event-registration-page';

const regularUser = usersToAuthenticate.find((user) => user.roles === 'user');

test.use({ storageState: userStateFile });
test.setTimeout(120_000);

const waitForRegistrationStatus = async (page: Page) => {
  await waitForRegistrationPage(page);
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

test('registers with a free add-on and required registration question', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
  if (!regularUser) {
    throw new Error('Expected regular user fixture');
  }

  const targetEventId = seeded.scenario.events.freeOpen.eventId;
  const targetOptionId = seeded.scenario.events.freeOpen.optionId;
  const addOnId = `addon-${getId().slice(0, 14)}`;
  const questionId = `q-${getId().slice(0, 18)}`;
  const questionTitle = 'Anything organizers should know?';
  const serverEventWindow = futureServerEventWindow();
  const [targetEvent] = await database
    .select()
    .from(schema.eventInstances)
    .where(eq(schema.eventInstances.id, targetEventId))
    .limit(1);
  if (!targetEvent) {
    throw new Error(
      'Expected seeded freeOpen event for add-on registration flow',
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
      'Expected seeded freeOpen event registration option for add-on registration flow',
    );
  }
  const originalRegistrations = await database
    .select()
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.eventId, targetEventId),
        eq(schema.eventRegistrations.tenantId, tenant.id),
        eq(schema.eventRegistrations.userId, regularUser.id),
      ),
    );
  const originalRegistrationIds = originalRegistrations.map(
    (registration) => registration.id,
  );
  const originalAddonPurchases = originalRegistrationIds.length
    ? await database
        .select()
        .from(schema.eventRegistrationAddonPurchases)
        .where(
          inArray(
            schema.eventRegistrationAddonPurchases.registrationId,
            originalRegistrationIds,
          ),
        )
    : [];
  const originalQuestionAnswers = originalRegistrationIds.length
    ? await database
        .select()
        .from(schema.eventRegistrationQuestionAnswers)
        .where(
          inArray(
            schema.eventRegistrationQuestionAnswers.registrationId,
            originalRegistrationIds,
          ),
        )
    : [];

  try {
    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, targetEventId),
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
      .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: serverEventWindow.end,
        start: serverEventWindow.start,
      })
      .where(eq(schema.eventInstances.id, targetEventId));
    await seedFreeRegistrationAddon({
      addonId: addOnId,
      database,
      eventId: targetEventId,
      registrationOptionId: targetOptionId,
      title: 'Snack voucher',
    });
    await database.insert(schema.eventRegistrationQuestions).values({
      description:
        'Tell organizers anything they need to know before the event.',
      eventId: targetEventId,
      id: questionId,
      registrationOptionId: targetOptionId,
      required: true,
      sortOrder: 0,
      title: questionTitle,
    });

    await page.goto(`/events/${targetEventId}`);
    await waitForRegistrationPage(page);

    const participantRegistrationCard = page
      .locator('app-event-registration-option')
      .filter({ hasText: 'Participant registration' })
      .first();
    await expect(
      participantRegistrationCard.getByText('Add-ons'),
    ).toBeVisible();
    await expect(
      participantRegistrationCard.getByText('Snack voucher'),
    ).toBeVisible();
    await expect(
      participantRegistrationCard.getByLabel(questionTitle),
    ).toBeVisible();
    await expect(
      participantRegistrationCard.getByRole('button', { name: 'Register' }),
    ).toBeDisabled();
    const quantityInput = participantRegistrationCard.getByLabel('Quantity');
    const questionInput = participantRegistrationCard.getByLabel(questionTitle);
    const registerButton = participantRegistrationCard.getByRole('button', {
      name: 'Register',
    });
    await expect(participantRegistrationCard).toHaveAttribute(
      'aria-busy',
      'false',
      { timeout: 20_000 },
    );
    await expect(questionInput).toBeEditable();
    await quantityInput.fill('2');
    await expect(quantityInput).toHaveValue('2');
    await questionInput.fill('Vegetarian snack, please.');
    await expect(questionInput).toHaveValue('Vegetarian snack, please.');
    await expect(registerButton).toBeEnabled({ timeout: 20_000 });
    await registerButton.click();

    await waitForRegistrationStatus(page);
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

    const [registration] = await database
      .select()
      .from(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, targetEventId),
          eq(schema.eventRegistrations.registrationOptionId, targetOptionId),
          eq(schema.eventRegistrations.status, 'CONFIRMED'),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      )
      .limit(1);
    if (!registration) {
      throw new Error(
        'Expected add-on registration flow to persist a confirmed registration',
      );
    }
    const addonPurchases = await database
      .select()
      .from(schema.eventRegistrationAddonPurchases)
      .where(
        eq(
          schema.eventRegistrationAddonPurchases.registrationId,
          registration.id,
        ),
      );
    const questionAnswers = await database
      .select()
      .from(schema.eventRegistrationQuestionAnswers)
      .where(
        eq(
          schema.eventRegistrationQuestionAnswers.registrationId,
          registration.id,
        ),
      );
    expect(addonPurchases).toEqual([
      expect.objectContaining({
        addonId: addOnId,
        quantity: 2,
        unitPrice: 0,
      }),
    ]);
    expect(questionAnswers).toEqual([
      expect.objectContaining({
        answer: 'Vegetarian snack, please.',
        questionId,
      }),
    ]);

    const [addOn] = await database
      .select()
      .from(schema.eventAddons)
      .where(eq(schema.eventAddons.id, addOnId))
      .limit(1);
    if (!addOn) {
      throw new Error('Expected seeded registration add-on to remain readable');
    }
    expect(addOn.totalAvailableQuantity).toBe(3);
  } finally {
    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, targetEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      );
    if (originalRegistrations.length) {
      await database
        .insert(schema.eventRegistrations)
        .values(originalRegistrations);
    }
    if (originalAddonPurchases.length) {
      await database
        .insert(schema.eventRegistrationAddonPurchases)
        .values(originalAddonPurchases);
    }
    if (originalQuestionAnswers.length) {
      await database
        .insert(schema.eventRegistrationQuestionAnswers)
        .values(originalQuestionAnswers);
    }
    await database
      .delete(schema.eventRegistrationQuestions)
      .where(eq(schema.eventRegistrationQuestions.id, questionId));
    await database
      .delete(schema.addonToEventRegistrationOptions)
      .where(eq(schema.addonToEventRegistrationOptions.addonId, addOnId));
    await database
      .delete(schema.eventAddons)
      .where(eq(schema.eventAddons.id, addOnId));
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

test('buys a free add-on after registration on mobile and explains the before-event block', async ({
  database,
  makeAxeBuilder,
  page,
  templates,
  tenant,
  testClock,
}) => {
  if (!regularUser) {
    throw new Error('Expected regular user fixture');
  }
  const template = templates.find((candidate) => candidate.seedKey === 'hike');
  if (!template) {
    throw new Error('Expected seeded hike template for add-on purchase flow');
  }
  const scenario = await seedPostRegistrationAddonPurchaseScenario({
    database,
    templateId: template.id,
    tenant,
    testClock,
    title: 'Participant add-ons on mobile',
    userId: regularUser.id,
  });

  try {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(`/events/${scenario.eventId}`);
    await waitForRegistrationStatus(page);
    await expect(
      page.getByRole('heading', { level: 1, name: scenario.title }),
    ).toBeVisible();

    const freeAddOnRow = registrationAddOnRow(page, scenario.addOns.free.title);
    const duringOnlyAddOnRow = registrationAddOnRow(
      page,
      scenario.addOns.duringOnly.title,
    );
    await expect(
      freeAddOnRow.getByRole('heading', {
        exact: true,
        level: 5,
        name: scenario.addOns.free.title,
      }),
    ).toBeVisible();
    await expect(
      duringOnlyAddOnRow.getByText(
        'This add-on is not sold before the event.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      duringOnlyAddOnRow.getByLabel(
        `Quantity for ${scenario.addOns.duringOnly.title}`,
        { exact: true },
      ),
    ).toHaveCount(0);
    await expect(duringOnlyAddOnRow.getByRole('button')).toHaveCount(0);

    const freeAddOnQuantity = freeAddOnRow.getByLabel(
      `Quantity for ${scenario.addOns.free.title}`,
      { exact: true },
    );
    const addToTicketButton = freeAddOnRow.getByRole('button', {
      exact: true,
      name: 'Add to ticket',
    });
    // Wait for Angular's live click listener before changing its controlled
    // input; otherwise hydration restores the server-rendered quantity of 1.
    await expect(addToTicketButton).not.toHaveAttribute('jsaction', /click/);
    await freeAddOnQuantity.fill('2');
    await expect(freeAddOnQuantity).toHaveValue('2');
    await expect(addToTicketButton).toBeEnabled();
    await addToTicketButton.press('Enter');

    await expect(freeAddOnRow.getByRole('status')).toContainText(
      `2 × ${scenario.addOns.free.title} added to your ticket.`,
      { timeout: 15_000 },
    );
    await expect(registrationAddOnCount(freeAddOnRow, 'Purchased')).toHaveText(
      '2',
    );
    await expect(
      registrationAddOnCount(freeAddOnRow, 'Available to use'),
    ).toHaveText('2');

    const order =
      await database.query.eventRegistrationAddonPurchaseOrders.findFirst({
        where: {
          addonId: scenario.addOns.free.id,
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    const purchase =
      await database.query.eventRegistrationAddonPurchases.findFirst({
        where: {
          addonId: scenario.addOns.free.id,
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    const lots =
      await database.query.eventRegistrationAddonPurchaseLots.findMany({
        where: {
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    const transaction = await database.query.transactions.findFirst({
      where: {
        eventRegistrationId: scenario.registrationId,
        tenantId: tenant.id,
        type: 'addon',
      },
    });
    const addOn = await database.query.eventAddons.findFirst({
      where: { eventId: scenario.eventId, id: scenario.addOns.free.id },
    });
    expect(order).toEqual(
      expect.objectContaining({
        quantity: 2,
        status: 'completed',
        transactionId: null,
        unitPrice: 0,
      }),
    );
    expect(purchase).toEqual(
      expect.objectContaining({
        includedQuantity: 0,
        purchasedQuantity: 2,
        quantity: 2,
        unitPrice: 0,
      }),
    );
    expect(lots).toEqual([
      expect.objectContaining({
        applicationFeeAmount: 0,
        baseAmount: 0,
        grossAmount: 0,
        netAmount: 0,
        paymentAllocationFinalizedAt: expect.any(Date),
        quantity: 2,
        sourceTransactionId: null,
        stripeFeeAmount: 0,
      }),
    ]);
    expect(transaction).toBeUndefined();
    expect(addOn?.totalAvailableQuantity).toBe(4);

    const hasHorizontalOverflow = await page
      .locator('app-event-active-registration')
      .evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(hasHorizontalOverflow).toBe(false);
    const accessibilityScan = await makeAxeBuilder()
      .include('app-event-active-registration')
      .analyze();
    expect(accessibilityScan.violations).toEqual([]);
  } finally {
    await scenario.cleanup();
  }
});

test('keeps a paid add-on pending across reload and settles through the production finalizer', async ({
  database,
  makeAxeBuilder,
  page,
  templates,
  tenant,
  testClock,
}) => {
  if (!regularUser) {
    throw new Error('Expected regular user fixture');
  }
  const template = templates.find((candidate) => candidate.seedKey === 'hike');
  if (!template) {
    throw new Error('Expected seeded hike template for add-on purchase flow');
  }
  const scenario = await seedPostRegistrationAddonPurchaseScenario({
    database,
    templateId: template.id,
    tenant,
    testClock,
    title: 'Participant paid add-on lifecycle',
    userId: regularUser.id,
  });

  try {
    await scenario.setWindow('during');
    await page.goto(`/events/${scenario.eventId}`);
    await waitForRegistrationStatus(page);

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
    await expect(
      beforeOnlyAddOnRow.getByLabel(
        `Quantity for ${scenario.addOns.beforeOnly.title}`,
        { exact: true },
      ),
    ).toHaveCount(0);

    const pendingCheckout = await scenario.beginPaidCheckout(2);
    await page.reload();
    await waitForRegistrationStatus(page);

    const paidAddOnRow = registrationAddOnRow(page, scenario.addOns.paid.title);
    await expect(
      paidAddOnRow.getByText('Payment is pending', { exact: true }),
    ).toBeVisible();
    await expect(paidAddOnRow.getByRole('status')).toContainText(
      `Payment is pending for 2 × ${scenario.addOns.paid.title}.`,
    );
    await expect(
      paidAddOnRow.getByRole('link', {
        exact: true,
        name: 'Continue Stripe checkout',
      }),
    ).toHaveAttribute('href', pendingCheckout.checkoutUrl);
    await expect(
      registrationAddOnCount(paidAddOnRow, 'Payment pending'),
    ).toHaveText('2');
    await expect(
      registrationAddOnCount(paidAddOnRow, 'Available to use'),
    ).toHaveText('0');

    const pendingOrder =
      await database.query.eventRegistrationAddonPurchaseOrders.findFirst({
        where: { id: pendingCheckout.orderId, tenantId: tenant.id },
      });
    const pendingTransaction = await database.query.transactions.findFirst({
      where: { id: pendingCheckout.transactionId, tenantId: tenant.id },
    });
    const pendingPurchase =
      await database.query.eventRegistrationAddonPurchases.findFirst({
        where: {
          addonId: scenario.addOns.paid.id,
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    const pendingLots =
      await database.query.eventRegistrationAddonPurchaseLots.findMany({
        where: {
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    const reservedAddOn = await database.query.eventAddons.findFirst({
      where: { eventId: scenario.eventId, id: scenario.addOns.paid.id },
    });
    expect(pendingOrder).toEqual(
      expect.objectContaining({
        applicationFeeAmount: 35,
        expectedGrossAmount: 1_000,
        expiresAt: pendingCheckout.expiresAt,
        quantity: 2,
        status: 'pending_payment',
        transactionId: pendingCheckout.transactionId,
        unitPrice: 500,
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
        type: 'addon',
      }),
    );
    expect(pendingPurchase).toBeUndefined();
    expect(pendingLots).toEqual([]);
    expect(reservedAddOn?.totalAvailableQuantity).toBe(4);

    const activeRegistration = page.locator('app-event-active-registration');
    await expect(
      activeRegistration.getByText(
        'The event has started, so this registration can no longer be cancelled.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      activeRegistration.getByRole('button', {
        exact: true,
        name: 'Cancel registration',
      }),
    ).toHaveCount(0);
    await expect(
      activeRegistration.getByText(
        'Finish or let the pending add-on checkout expire before transferring this ticket.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      activeRegistration.getByRole('button', {
        exact: true,
        name: 'Transfer unavailable',
      }),
    ).toBeDisabled();
    const pendingAccessibilityScan = await makeAxeBuilder()
      .include('app-event-active-registration')
      .analyze();
    expect(pendingAccessibilityScan.violations).toEqual([]);

    await expect(scenario.completeCheckout()).resolves.toBe('finalized');
    await page.reload();
    await waitForRegistrationStatus(page);

    await expect(
      paidAddOnRow.getByText('Payment is pending', { exact: true }),
    ).toHaveCount(0);
    await expect(
      paidAddOnRow.getByRole('link', {
        exact: true,
        name: 'Continue Stripe checkout',
      }),
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

    const completedOrder =
      await database.query.eventRegistrationAddonPurchaseOrders.findFirst({
        where: { id: pendingCheckout.orderId, tenantId: tenant.id },
      });
    const completedTransaction = await database.query.transactions.findFirst({
      where: { id: pendingCheckout.transactionId, tenantId: tenant.id },
    });
    const completedPurchase =
      await database.query.eventRegistrationAddonPurchases.findFirst({
        where: {
          addonId: scenario.addOns.paid.id,
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    const completedLots =
      await database.query.eventRegistrationAddonPurchaseLots.findMany({
        where: {
          registrationId: scenario.registrationId,
          tenantId: tenant.id,
        },
      });
    const completedAddOn = await database.query.eventAddons.findFirst({
      where: { eventId: scenario.eventId, id: scenario.addOns.paid.id },
    });
    expect(completedOrder).toEqual(
      expect.objectContaining({
        completedAt: expect.any(Date),
        quantity: 2,
        status: 'completed',
      }),
    );
    expect(completedTransaction).toEqual(
      expect.objectContaining({
        amount: 1_000,
        appFee: 35,
        status: 'successful',
        stripeChargeId: pendingCheckout.chargeId,
        stripeFee: 29,
        stripeNetAmount: 936,
        stripePaymentIntentId: pendingCheckout.paymentIntentId,
        type: 'addon',
      }),
    );
    expect(completedPurchase).toEqual(
      expect.objectContaining({
        includedQuantity: 0,
        purchasedQuantity: 2,
        quantity: 2,
        unitPrice: 500,
      }),
    );
    expect(completedLots).toEqual([
      expect.objectContaining({
        applicationFeeAmount: 35,
        baseAmount: 1_000,
        grossAmount: 1_000,
        netAmount: 936,
        paymentAllocationFinalizedAt: expect.any(Date),
        quantity: 2,
        sourceTransactionId: pendingCheckout.transactionId,
        stripeFeeAmount: 29,
        unitPrice: 500,
      }),
    ]);
    expect(completedAddOn?.totalAvailableQuantity).toBe(4);
  } finally {
    await scenario.cleanup();
  }
});
