import { createId } from '@db/create-id';
import * as schema from '@db/schema';
import { TENANT_FORMATTING_LOCALE } from '@types/custom/tenant';
import { and, eq, inArray, like } from 'drizzle-orm';

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
import { futureServerEventWindow } from '../../support/utils/server-test-clock';
import { seedPaidRegistrationTransferScenario } from '../../support/utils/paid-registration-transfer-scenario';

test.use({ storageState: userStateFile, trace: 'on-first-retry' });

// These guides reuse the same authenticated user fixtures while exercising
// user row locks. Keep each guide independent, but avoid cross-guide deadlocks.
test.describe.configure({ mode: 'default' });

test('Transfer a registration with a private offer', async ({
  browser,
  database,
  page,
  seeded,
  tenant,
  testClock,
}, testInfo) => {
  // This documentation journey uses two browser contexts, captures several
  // screenshots, and proves both invalid-code recovery and a completed claim.
  test.slow();

  const source = usersToAuthenticate.find((user) => user.roles === 'user');
  const recipient = usersToAuthenticate.find((user) => user.roles === 'admin');
  const template = seeded.templates[0];
  if (!source || !recipient || !template) {
    throw new Error('Expected documented transfer users and template');
  }

  const eventId = createId();
  const optionId = createId();
  const questionId = createId();
  const sourceRegistrationId = createId();
  const sourceAcquisitionId = createId();
  const recipientAnswer = 'I will attend the complete event.';
  const eventWindow = futureServerEventWindow();
  const startsAt = eventWindow.start;
  let recipientPage:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

  await database.insert(schema.eventInstances).values({
    creatorId: source.id,
    description: 'A documented registration transfer.',
    end: eventWindow.end,
    icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
    id: eventId,
    start: startsAt,
    status: 'APPROVED',
    templateId: template.id,
    tenantId: tenant.id,
    title: 'Registration transfer guide',
    unlisted: true,
  });
  await database.insert(schema.eventRegistrationOptions).values({
    closeRegistrationTime: eventWindow.closeRegistrationTime,
    confirmedSpots: 1,
    eventId,
    id: optionId,
    isPaid: false,
    openRegistrationTime: eventWindow.openRegistrationTime,
    organizingRegistration: false,
    price: 0,
    registeredDescription: 'Your transferred registration is confirmed.',
    registrationMode: 'fcfs',
    roleIds: [],
    spots: 10,
    title: 'Participant',
    transferDeadlineHoursBeforeStart: 0,
  });
  await database.insert(schema.eventRegistrationQuestions).values({
    eventId,
    id: questionId,
    registrationOptionId: optionId,
    required: true,
    sortOrder: 0,
    title: 'What should the organizer know?',
  });
  await database.insert(schema.eventRegistrations).values({
    basePriceAtRegistration: 0,
    eventId,
    id: sourceRegistrationId,
    registrationOptionId: optionId,
    status: 'CONFIRMED',
    tenantId: tenant.id,
    userId: source.id,
  });
  await database.insert(schema.eventRegistrationQuestionAnswers).values({
    answer: 'The previous owner entered this answer.',
    id: createId(),
    questionId,
    registrationId: sourceRegistrationId,
  });
  await database.insert(schema.registrationAcquisitions).values({
    acquiredAt: new Date(),
    eventId,
    id: sourceAcquisitionId,
    kind: 'initial',
    operationKey: `registration-initial:${sourceRegistrationId}`,
    ordinal: 0,
    ownerUserId: source.id,
    registrationId: sourceRegistrationId,
    spotCount: 1,
    tenantId: tenant.id,
  });
  await database.insert(schema.registrationAcquisitionComponents).values({
    acquiredAt: new Date(),
    acquisitionId: sourceAcquisitionId,
    allocationKey: `registration-initial:${sourceRegistrationId}`,
    applicationFeeAmount: 0,
    baseAmount: 0,
    currency: tenant.currency,
    eventId,
    grossAmount: 0,
    kind: 'registration',
    netAmount: 0,
    quantity: 1,
    registrationId: sourceRegistrationId,
    stripeFeeAmount: 0,
    taxAmount: 0,
    tenantId: tenant.id,
  });

  try {
    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Before you start" %}
This guide uses two signed-in participant accounts that belong to the same organization:

- the current ticket owner, who has a confirmed registration; and
- a different intended recipient, whose current organization roles are eligible for the registration option.

Neither account needs organizer or administrator access for this participant transfer. A paid transfer requires the organization's connected Stripe account because paid event registrations and add-ons are Stripe-only. The registration and every included, free, and purchased add-on form one inseparable bundle; Evorto refunds the exact remaining refundable amount from each original Stripe payment after accounting for prior successful refunds. Platform-administrator access is needed only if one of those refunds later requires recovery.

Only a confirmed registration within the configured transfer deadline can be offered. Existing attendee/guest check-in and add-on fulfillment history remain part of the fixed bundle and move unchanged.

The private link and manual code grant access to the transfer offer. Share one of them privately with exactly one intended recipient.
{% /callout %}

# Transfer a registration

The previous owner's answers and discounts do not transfer. Evorto checks the recipient's current role eligibility, asks the current questions, prices the fixed bundle from current base prices, and applies only the recipient's current eligible discounts. Guest quantity, every included/free/purchased add-on quantity, check-in state, and fulfillment history transfer unchanged; the recipient cannot omit or re-quantity them.

## Create a private offer

Open the event while signed in as the current registration owner. Under the confirmed ticket, select **Create transfer link**.
`,
    });

    await page.goto(`/events/${eventId}`);
    await waitForRegistrationPage(page);
    const createButton = page.getByRole('button', {
      name: 'Create transfer link',
    });
    await expect(createButton).toBeVisible();
    // SSR exposes the action before Angular attaches its click listener.
    // Event replay removes `jsaction` once this mutation is interactive.
    await expect(createButton).not.toHaveAttribute('jsaction', /click/);
    await takeScreenshot(
      testInfo,
      page.locator('app-event-active-registration'),
      page,
      'Create a private transfer offer from the confirmed ticket',
    );
    await createButton.click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Private transfer link created' }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      dialog,
      page,
      'Copy the private link or manual claim code',
    );
    await dialog.getByRole('button', { name: 'Done' }).click();
    const firstOffer = await database.query.registrationTransfers.findFirst({
      where: {
        sourceRegistrationId,
        status: 'open',
        tenantId: tenant.id,
      },
    });
    if (!firstOffer) {
      throw new Error('Expected the first documented transfer offer');
    }

    await testInfo.attach('markdown', {
      body: `
## Cancel an offer before it is claimed

While an offer is open, the current owner's ticket remains confirmed and the event page shows **Cancel transfer offer**. Select it if the private link or code was sent to the wrong person or should no longer be usable. Cancelling the offer invalidates its private link and manual code; it does not cancel or transfer the registration.
`,
    });
    await page.getByRole('button', { name: 'Cancel transfer offer' }).click();
    await expect(createButton).toBeVisible();
    await expect
      .poll(async () => {
        const cancelledOffer =
          await database.query.registrationTransfers.findFirst({
            columns: { status: true },
            where: { id: firstOffer.id, tenantId: tenant.id },
          });
        return cancelledOffer?.status;
      })
      .toBe('cancelled');
    expect(
      await database.query.eventRegistrations.findFirst({
        columns: { status: true, userId: true },
        where: { id: sourceRegistrationId, tenantId: tenant.id },
      }),
    ).toEqual({ status: 'CONFIRMED', userId: source.id });
    await takeScreenshot(
      testInfo,
      page.locator('app-event-active-registration'),
      page,
      'Confirmed ticket after cancelling the private offer',
    );

    await createButton.click();
    await expect(
      dialog.getByRole('heading', { name: 'Private transfer link created' }),
    ).toBeVisible();
    const claimCode = await dialog.getByLabel('Manual claim code').inputValue();

    await testInfo.attach('markdown', {
      body: `
The registration stays confirmed under the current owner's ownership while the offer is open. If the recipient starts a paid claim, ownership still does not change while Stripe Checkout is pending. The current owner can cancel the offer before the handoff completes.

## Review as the recipient

Sign in to the intended recipient's account in the same organization, open **Profile**, and select **Claim transfer**. Paste the complete manual code, including its hyphens, and select **Review transfer**. You can use the private link instead when the sender shared it. If Evorto says the transfer could not be opened, select **Enter another code**, check that the complete current code was copied, and ask the sender for a new code if they cancelled or replaced the offer.

Review the event, registration option, expiry, current price, current questions, fixed guest quantity, every add-on quantity, and existing check-in/fulfillment history. These bundle contents are read-only. Previous answers do not transfer: answer every currently required question for the recipient, then select **Claim registration** only when the current details are correct.
`,
    });

    recipientPage = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: adminStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
    await recipientPage.page.goto('/events');
    await recipientPage.page
      .getByRole('link', { exact: true, name: 'Profile' })
      .click();
    await recipientPage.page
      .getByRole('link', { exact: true, name: 'Claim transfer' })
      .click();
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Enter a private claim code',
      }),
    ).toBeVisible();
    const claimCodeInput = recipientPage.page.getByLabel('Claim code');
    const reviewTransfer = recipientPage.page.getByRole('button', {
      name: 'Review transfer',
    });
    const transferCodeForm = recipientPage.page.locator('form').filter({
      has: reviewTransfer,
    });
    await expect(transferCodeForm).not.toHaveAttribute('jsaction', /submit/, {
      timeout: 20_000,
    });
    await claimCodeInput.fill('NOT-A-VALID-TRANSFER-CODE');
    await expect(reviewTransfer).toBeEnabled();
    await reviewTransfer.click();
    const invalidCodeAlert = recipientPage.page.getByRole('alert');
    await expect(
      invalidCodeAlert.getByRole('heading', {
        name: 'Transfer could not be opened',
      }),
    ).toBeVisible();
    await expect(invalidCodeAlert).toContainText(
      'Check the complete code and try again',
    );
    await invalidCodeAlert
      .getByRole('link', { name: 'Enter another code' })
      .click();
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Enter a private claim code',
      }),
    ).toBeVisible();
    await expect(transferCodeForm).not.toHaveAttribute('jsaction', /submit/, {
      timeout: 20_000,
    });
    await recipientPage.page.getByLabel('Claim code').fill(claimCode);
    await expect(reviewTransfer).toBeEnabled();
    await reviewTransfer.click();
    const claimHeading = recipientPage.page.getByRole('heading', {
      name: 'Review before you claim',
    });
    await expect(claimHeading).toBeVisible();
    await takeScreenshot(
      testInfo,
      recipientPage.page.locator('main'),
      recipientPage.page,
      'Review current transfer terms before claiming',
    );
    const claimRegistration = recipientPage.page.getByRole('button', {
      name: 'Claim registration',
    });
    const claimRegistrationForm = recipientPage.page.locator('form').filter({
      has: claimRegistration,
    });
    await expect(claimRegistrationForm).not.toHaveAttribute(
      'jsaction',
      /submit/,
      { timeout: 20_000 },
    );
    await expect(claimRegistration).toBeDisabled();
    await recipientPage.page
      .getByLabel('What should the organizer know?')
      .fill(recipientAnswer);
    await expect(claimRegistration).toBeEnabled();
    await claimRegistration.click();
    await expect(
      recipientPage.page.getByRole('heading', { name: 'Transfer complete' }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      recipientPage.page.locator('main'),
      recipientPage.page,
      'Confirmed registration after ownership moves to the recipient',
    );

    const transferredRegistration =
      await database.query.eventRegistrations.findFirst({
        where: { id: sourceRegistrationId, tenantId: tenant.id },
      });
    if (!transferredRegistration) {
      throw new Error('Expected documented transferred registration');
    }
    expect(transferredRegistration).toMatchObject({
      basePriceAtRegistration: 0,
      guestCount: 0,
      id: sourceRegistrationId,
      registrationOptionId: optionId,
      status: 'CONFIRMED',
      userId: recipient.id,
    });
    expect(
      await database.query.eventRegistrations.findMany({
        columns: { id: true, status: true, userId: true },
        where: { eventId, tenantId: tenant.id },
      }),
    ).toEqual([
      {
        id: sourceRegistrationId,
        status: 'CONFIRMED',
        userId: recipient.id,
      },
    ]);
    expect(
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: optionId },
      }),
    ).toEqual({ confirmedSpots: 1, reservedSpots: 0 });
    expect(
      await database.query.registrationTransfers.findFirst({
        where: {
          sourceRegistrationId,
          status: 'completed',
          tenantId: tenant.id,
        },
      }),
    ).toMatchObject({
      recipientRegistrationId: sourceRegistrationId,
      recipientUserId: recipient.id,
      status: 'completed',
    });
    expect(
      await database
        .select({
          answer: schema.eventRegistrationQuestionAnswers.answer,
          questionId: schema.eventRegistrationQuestionAnswers.questionId,
          registrationId:
            schema.eventRegistrationQuestionAnswers.registrationId,
        })
        .from(schema.eventRegistrationQuestionAnswers)
        .where(
          and(
            eq(
              schema.eventRegistrationQuestionAnswers.registrationId,
              sourceRegistrationId,
            ),
            eq(schema.eventRegistrationQuestionAnswers.questionId, questionId),
          ),
        ),
    ).toEqual([
      {
        answer: recipientAnswer,
        questionId,
        registrationId: sourceRegistrationId,
      },
    ]);
    expect(
      await database
        .select({ id: schema.emailOutbox.id })
        .from(schema.emailOutbox)
        .where(
          and(
            eq(schema.emailOutbox.kind, 'registrationTransferred'),
            eq(schema.emailOutbox.tenantId, tenant.id),
            like(
              schema.emailOutbox.idempotencyKey,
              `%/${sourceRegistrationId}/%`,
            ),
          ),
        ),
    ).toHaveLength(2);

    await testInfo.attach('markdown', {
      body: `
The transfer keeps the same confirmed ticket and occupied capacity, moves ownership to the recipient, and notifies both people.

## What paid transfers add

For a paid transfer, **Claim registration** opens Stripe Checkout on the organization's connected account and includes the platform application fee. The recipient's payment is recalculated independently from the previous owner's refunds. After payment succeeds, the complete bundle moves to the recipient and Evorto refunds the exact remaining refundable amount from each original Stripe payment after accounting for prior successful refunds. When the bundle is free and no refund is needed, the transfer completes immediately without Stripe.

- **Transfer complete — refund processing** means the recipient owns the ticket and one or more refunds to the previous owner are still being processed.
- **Transfer complete — refund needs attention** still means the recipient owns the ticket. A platform administrator must retry the failed refund; the participant must not pay or claim again.
- If the previous owner's ticket becomes ineligible or the fixed bundle otherwise changes after the recipient pays but before the transfer completes, Evorto leaves ownership unchanged and starts a full recipient refund including the platform fee. Check-in and fulfillment activity remain part of the bundle history. **Transfer stopped — refund processing** and **Transfer stopped — refund needs attention** mean the recipient does not own the ticket and must not pay or claim again.
- If Checkout expires or the offer is cancelled before payment, the pending payment is released and the current owner keeps the confirmed ticket.

Continue with [Complete a paid transfer and retry a failed refund](/docs/complete-a-paid-transfer-and-retry-a-failed-refund) for the paid Checkout and refund-recovery states.
`,
    });
  } finally {
    await recipientPage?.context.close();
    await database
      .delete(schema.emailOutbox)
      .where(
        like(schema.emailOutbox.idempotencyKey, `%/${sourceRegistrationId}/%`),
      );
    await database
      .delete(schema.registrationTransferRefundPlanAcquisitionLinks)
      .where(
        eq(
          schema.registrationTransferRefundPlanAcquisitionLinks
            .sourceAcquisitionId,
          sourceAcquisitionId,
        ),
      );
    await database
      .delete(schema.registrationTransferRefundPlanItems)
      .where(
        eq(
          schema.registrationTransferRefundPlanItems.sourceRegistrationId,
          sourceRegistrationId,
        ),
      );
    await database
      .delete(schema.registrationAcquisitionComponents)
      .where(
        eq(
          schema.registrationAcquisitionComponents.registrationId,
          sourceRegistrationId,
        ),
      );
    await database
      .delete(schema.registrationAcquisitionPayments)
      .where(
        eq(
          schema.registrationAcquisitionPayments.registrationId,
          sourceRegistrationId,
        ),
      );
    await database
      .delete(schema.registrationAcquisitions)
      .where(
        eq(
          schema.registrationAcquisitions.registrationId,
          sourceRegistrationId,
        ),
      );
    await database
      .delete(schema.registrationTransfers)
      .where(
        eq(
          schema.registrationTransfers.sourceRegistrationId,
          sourceRegistrationId,
        ),
      );
    await database
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.eventId, eventId));
    await database
      .delete(schema.eventRegistrationOptions)
      .where(eq(schema.eventRegistrationOptions.eventId, eventId));
    await database
      .delete(schema.eventInstances)
      .where(eq(schema.eventInstances.id, eventId));
  }
});

test('Complete a paid transfer and retry a failed refund', async ({
  browser,
  database,
  page,
  seeded,
  tenant,
  testClock,
}, testInfo) => {
  test.slow();

  const source = usersToAuthenticate.find((user) => user.roles === 'user');
  const recipient = usersToAuthenticate.find((user) => user.roles === 'admin');
  const template = seeded.templates[0];
  if (!source || !recipient || !template) {
    throw new Error('Expected documented paid-transfer users and template');
  }
  const operatorRecoveryReason =
    'Retry one failed previous-owner refund after operator review.';

  const scenario = await seedPaidRegistrationTransferScenario({
    database,
    recipient,
    source,
    templateId: template.id,
    tenant,
    title: 'Paid transfer refund guide',
  });
  const registrationBefore = await database.query.eventRegistrations.findFirst({
    columns: {
      appliedDiscountedPrice: true,
      appliedDiscountType: true,
      basePriceAtRegistration: true,
      checkedInGuestCount: true,
      checkInTime: true,
      discountAmount: true,
      guestCount: true,
      id: true,
      registrationOptionId: true,
      status: true,
      userId: true,
    },
    where: { id: scenario.sourceRegistrationId, tenantId: tenant.id },
  });
  const purchasesBefore =
    await database.query.eventRegistrationAddonPurchases.findMany({
      columns: {
        addonId: true,
        cancelledQuantity: true,
        id: true,
        includedQuantity: true,
        purchasedQuantity: true,
        quantity: true,
        redeemedQuantity: true,
        refundAllocatedPurchasedQuantity: true,
        registrationId: true,
        unitPrice: true,
      },
      orderBy: { id: 'asc' },
      where: {
        registrationId: scenario.sourceRegistrationId,
        tenantId: tenant.id,
      },
    });
  const lotsBefore =
    await database.query.eventRegistrationAddonPurchaseLots.findMany({
      columns: {
        cancelledQuantity: true,
        id: true,
        purchaseId: true,
        quantity: true,
        redeemedQuantity: true,
        refundAllocatedGrossAmount: true,
        refundAllocatedQuantity: true,
        registrationId: true,
        sourceTransactionId: true,
      },
      orderBy: { id: 'asc' },
      where: {
        registrationId: scenario.sourceRegistrationId,
        tenantId: tenant.id,
      },
    });
  const fulfillmentEventsBefore =
    await database.query.eventRegistrationAddonFulfillmentEvents.findMany({
      columns: {
        id: true,
        purchaseId: true,
        quantity: true,
        refundDisposition: true,
        refundRequested: true,
        registrationId: true,
        reversesEventId: true,
        type: true,
      },
      orderBy: { id: 'asc' },
      where: {
        registrationId: scenario.sourceRegistrationId,
        tenantId: tenant.id,
      },
    });
  const refundAllocationsBefore =
    await database.query.eventRegistrationAddonRefundAllocations.findMany({
      columns: {
        fulfillmentEventId: true,
        id: true,
        purchaseId: true,
        purchaseLotId: true,
        quantity: true,
        refundAmount: true,
        refundTransactionId: true,
        registrationId: true,
      },
      orderBy: { id: 'asc' },
      where: {
        registrationId: scenario.sourceRegistrationId,
        tenantId: tenant.id,
      },
    });
  const sourceAcquisitionBefore =
    await database.query.registrationAcquisitions.findFirst({
      where: {
        id: scenario.sourceAcquisitionId,
        tenantId: tenant.id,
      },
    });
  const sourceAcquisitionPaymentsBefore = await database
    .select()
    .from(schema.registrationAcquisitionPayments)
    .where(
      and(
        eq(
          schema.registrationAcquisitionPayments.acquisitionId,
          scenario.sourceAcquisitionId,
        ),
        eq(schema.registrationAcquisitionPayments.tenantId, tenant.id),
      ),
    )
    .orderBy(schema.registrationAcquisitionPayments.id);
  const sourceAcquisitionComponentsBefore = await database
    .select()
    .from(schema.registrationAcquisitionComponents)
    .where(
      and(
        eq(
          schema.registrationAcquisitionComponents.acquisitionId,
          scenario.sourceAcquisitionId,
        ),
        eq(schema.registrationAcquisitionComponents.tenantId, tenant.id),
      ),
    )
    .orderBy(schema.registrationAcquisitionComponents.id);
  const sourceAcquisitionRefundAllocationsBefore = await database
    .select()
    .from(schema.registrationAcquisitionRefundAllocations)
    .where(
      and(
        eq(
          schema.registrationAcquisitionRefundAllocations.acquisitionId,
          scenario.sourceAcquisitionId,
        ),
        eq(schema.registrationAcquisitionRefundAllocations.tenantId, tenant.id),
      ),
    )
    .orderBy(schema.registrationAcquisitionRefundAllocations.id);
  const addonStockBefore = await database.query.eventAddons.findMany({
    columns: { id: true, totalAvailableQuantity: true },
    orderBy: { id: 'asc' },
    where: { eventId: scenario.eventId },
  });
  const optionCapacityBefore =
    await database.query.eventRegistrationOptions.findFirst({
      columns: { confirmedSpots: true, reservedSpots: true },
      where: { id: scenario.optionId },
    });
  if (
    !registrationBefore ||
    !optionCapacityBefore ||
    !sourceAcquisitionBefore
  ) {
    throw new Error('Expected the sealed paid transfer bundle');
  }
  expect(registrationBefore).toMatchObject({
    appliedDiscountedPrice: 1500,
    appliedDiscountType: 'esnCard',
    basePriceAtRegistration: 1800,
    checkedInGuestCount: 1,
    discountAmount: 300,
    guestCount: 1,
    status: 'CONFIRMED',
    userId: source.id,
  });
  expect(registrationBefore.checkInTime).not.toBeNull();
  expect(purchasesBefore).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        cancelledQuantity: 1,
        includedQuantity: 1,
        purchasedQuantity: 2,
        quantity: 3,
        redeemedQuantity: 1,
        refundAllocatedPurchasedQuantity: 1,
        unitPrice: 500,
      }),
      expect.objectContaining({
        cancelledQuantity: 1,
        includedQuantity: 0,
        purchasedQuantity: 2,
        quantity: 2,
        redeemedQuantity: 1,
        unitPrice: 0,
      }),
    ]),
  );
  expect(lotsBefore).toHaveLength(2);
  expect(fulfillmentEventsBefore.map(({ type }) => type).sort()).toEqual([
    'cancelled',
    'cancelled',
    'redeemed',
    'redeemed',
  ]);
  expect(refundAllocationsBefore).toEqual([
    expect.objectContaining({ quantity: 1, refundAmount: 500 }),
  ]);
  expect(sourceAcquisitionBefore).toMatchObject({
    eventId: scenario.eventId,
    kind: 'initial',
    ordinal: 0,
    ownerUserId: source.id,
    previousAcquisitionId: null,
    registrationId: scenario.sourceRegistrationId,
    spotCount: 2,
    tenantId: tenant.id,
    transferId: null,
  });
  expect(sourceAcquisitionPaymentsBefore).toHaveLength(2);
  expect(
    new Set(
      sourceAcquisitionPaymentsBefore.map(({ transactionId }) => transactionId),
    ),
  ).toEqual(new Set(scenario.sourceTransactionIds));
  expect(sourceAcquisitionComponentsBefore).toHaveLength(3);
  expect(
    sourceAcquisitionComponentsBefore.find(
      ({ kind }) => kind === 'registration',
    ),
  ).toMatchObject({
    applicationFeeAmount: 116,
    baseAmount: 3300,
    grossAmount: 3300,
    kind: 'registration',
    netAmount: 3100,
    quantity: 2,
    stripeFeeAmount: 84,
  });
  expect(
    sourceAcquisitionComponentsBefore.find(
      ({ purchaseLotId }) => purchaseLotId === scenario.paidPurchaseLotId,
    ),
  ).toMatchObject({
    applicationFeeAmount: 40,
    baseAmount: 1000,
    grossAmount: 1000,
    kind: 'addon_lot',
    netAmount: 930,
    purchaseId: scenario.paidPurchaseId,
    quantity: 2,
    stripeFeeAmount: 30,
  });
  expect(
    sourceAcquisitionComponentsBefore.find(
      ({ purchaseLotId }) => purchaseLotId === scenario.freePurchaseLotId,
    ),
  ).toMatchObject({
    acquisitionPaymentId: null,
    baseAmount: 0,
    grossAmount: 0,
    kind: 'addon_lot',
    quantity: 2,
  });
  expect(sourceAcquisitionRefundAllocationsBefore).toEqual([
    expect.objectContaining({
      acquisitionId: scenario.sourceAcquisitionId,
      applicationFeeAmount: 20,
      applicationFeeRefunded: true,
      grossEntitlementAmount: 500,
      netEntitlementAmount: 465,
      operationKind: 'addon_cancellation',
      purchaseId: scenario.paidPurchaseId,
      quantity: 1,
      refundAmount: 500,
      stripeFeeAmount: 15,
    }),
  ]);
  expect(addonStockBefore).toHaveLength(2);
  expect(optionCapacityBefore).toEqual({
    confirmedSpots: 2,
    reservedSpots: 0,
  });
  let recipientPage:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;
  let operatorPage:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

  try {
    await testInfo.attach('markdown', {
      body: `
# Complete a paid transfer and retry a failed refund

{% callout type="note" title="Before you start" %}
This guide continues after a current ticket owner has created a Stripe-paid private transfer and the intended recipient, signed in to the same organization with an eligible account, has started the claim. The organization's connected Stripe account must be available. This example starts with a historical discount for the previous owner, one original registration payment, and one purchased-add-on payment that was already partially refunded. The recipient has no current eligible discount, so the previous owner's discount does not carry over: the recipient payment uses the current base prices. Evorto refunds the remaining amount from each original payment to the previous owner without changing the independently recalculated recipient payment. If you still need to create the private offer, start with [Transfer a registration with a private offer](/docs/transfer-a-registration-with-a-private-offer).
{% /callout %}

After a recipient claims a paid registration, Evorto keeps one Stripe Checkout attached to that private offer. The pending paid claim does not transfer ticket ownership yet; the previous owner keeps the same confirmed registration until payment succeeds.

## Continue the existing Checkout

Open the same private claim link. **Payment still required** means the reservation is waiting for payment. Select **Continue payment** to return to the already-created Stripe Checkout; do not start another claim.
`,
    });

    await page.goto(`/events/${scenario.eventId}`);
    recipientPage = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: adminStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
    await recipientPage.page.goto(scenario.claimPath);
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Payment still required',
      }),
    ).toBeVisible();
    await expect(
      recipientPage.page.getByRole('button', { name: 'Continue payment' }),
    ).toBeVisible();
    const bundleContents = recipientPage.page
      .getByRole('heading', { name: 'Fixed bundle contents' })
      .locator('..')
      .locator('..');
    const registrationCheckInRow = bundleContents
      .getByText('Registration check-in', { exact: true })
      .locator('..');
    await expect(registrationCheckInRow).toContainText('Checked in');
    await expect(
      bundleContents.getByText('Guests checked in', { exact: true }),
    ).toBeVisible();
    await expect(
      bundleContents.getByText('1 of 1', { exact: true }),
    ).toBeVisible();
    const paidAddonRow = bundleContents
      .getByText('Transfer workshop kit', { exact: true })
      .locator('..')
      .locator('..');
    await expect(paidAddonRow).toContainText('3 total');
    const includedPaidUnits = paidAddonRow
      .getByText('Included in registration price', { exact: true })
      .locator('..');
    await expect(includedPaidUnits.locator('dd')).toHaveText('1');
    const purchasedPaidUnits = paidAddonRow
      .getByText('Purchased at current unit price', { exact: true })
      .locator('..');
    await expect(purchasedPaidUnits.locator('dd')).toContainText(
      /2\s*×\s*(?:€\s*)?6[,.]50/,
    );
    await expect(paidAddonRow).toContainText(/Available to use\s*1/);
    await expect(paidAddonRow).toContainText(/Redeemed\s*1/);
    await expect(paidAddonRow).toContainText(/Cancelled\s*1/);
    const freeAddonRow = bundleContents
      .getByText('Transfer checklist item', { exact: true })
      .locator('..')
      .locator('..');
    await expect(freeAddonRow).toContainText('2 total');
    const purchasedFreeUnits = freeAddonRow
      .getByText('Purchased at current unit price', { exact: true })
      .locator('..');
    await expect(purchasedFreeUnits.locator('dd')).toContainText(
      /2\s*×\s*(?:€\s*)?0[,.]00/,
    );
    await expect(freeAddonRow).toContainText(/Available to use\s*0/);
    await expect(freeAddonRow).toContainText(/Redeemed\s*1/);
    await expect(freeAddonRow).toContainText(/Cancelled\s*1/);
    await takeScreenshot(
      testInfo,
      recipientPage.page.locator('main'),
      recipientPage.page,
      'A paid claim waiting for its existing Stripe Checkout',
    );

    expect(await scenario.completeCheckout()).toBe('finalized');
    await recipientPage.page.reload();
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Transfer complete — refund processing',
      }),
    ).toBeVisible();
    await expect(
      recipientPage.page.getByRole('button', { name: 'Continue payment' }),
    ).toHaveCount(0);
    await takeScreenshot(
      testInfo,
      recipientPage.page.locator('main'),
      recipientPage.page,
      'The recipient is confirmed while previous-owner refunds are processing',
    );

    const transferredRegistration =
      await database.query.eventRegistrations.findFirst({
        columns: {
          appliedDiscountedPrice: true,
          appliedDiscountType: true,
          basePriceAtRegistration: true,
          checkedInGuestCount: true,
          checkInTime: true,
          discountAmount: true,
          guestCount: true,
          id: true,
          registrationOptionId: true,
          status: true,
          userId: true,
        },
        where: {
          id: scenario.sourceRegistrationId,
          tenantId: tenant.id,
        },
      });
    expect(transferredRegistration).toEqual({
      ...registrationBefore,
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      basePriceAtRegistration: 2100,
      discountAmount: 0,
      userId: recipient.id,
    });
    expect(
      await database.query.eventRegistrations.findMany({
        columns: { id: true, status: true, userId: true },
        where: { eventId: scenario.eventId, tenantId: tenant.id },
      }),
    ).toEqual([
      {
        id: scenario.sourceRegistrationId,
        status: 'CONFIRMED',
        userId: recipient.id,
      },
    ]);
    const acquisitionsAfter = await database
      .select()
      .from(schema.registrationAcquisitions)
      .where(
        and(
          eq(
            schema.registrationAcquisitions.registrationId,
            scenario.sourceRegistrationId,
          ),
          eq(schema.registrationAcquisitions.tenantId, tenant.id),
        ),
      )
      .orderBy(schema.registrationAcquisitions.ordinal);
    expect(acquisitionsAfter).toHaveLength(2);
    expect(acquisitionsAfter[0]).toEqual(sourceAcquisitionBefore);
    expect(acquisitionsAfter[1]).toMatchObject({
      eventId: scenario.eventId,
      kind: 'claim_transfer',
      operationKey: `registration-transfer:${scenario.transferId}`,
      ordinal: 1,
      ownerUserId: recipient.id,
      previousAcquisitionId: scenario.sourceAcquisitionId,
      registrationId: scenario.sourceRegistrationId,
      spotCount: 2,
      tenantId: tenant.id,
      transferId: scenario.transferId,
    });
    const recipientAcquisition = acquisitionsAfter[1];
    if (!recipientAcquisition) {
      throw new Error('Expected the recipient claim-transfer acquisition');
    }
    const recipientAcquisitionPayments = await database
      .select()
      .from(schema.registrationAcquisitionPayments)
      .where(
        and(
          eq(
            schema.registrationAcquisitionPayments.acquisitionId,
            recipientAcquisition.id,
          ),
          eq(schema.registrationAcquisitionPayments.tenantId, tenant.id),
        ),
      );
    expect(recipientAcquisitionPayments).toHaveLength(1);
    expect(recipientAcquisitionPayments[0]).toMatchObject({
      acquisitionId: recipientAcquisition.id,
      eventId: scenario.eventId,
      registrationId: scenario.sourceRegistrationId,
      tenantId: tenant.id,
      transactionId: scenario.recipientTransactionId,
    });
    const recipientAcquisitionPayment = recipientAcquisitionPayments[0];
    if (!recipientAcquisitionPayment) {
      throw new Error('Expected the recipient acquisition payment');
    }
    const recipientAcquisitionComponents = await database
      .select()
      .from(schema.registrationAcquisitionComponents)
      .where(
        and(
          eq(
            schema.registrationAcquisitionComponents.acquisitionId,
            recipientAcquisition.id,
          ),
          eq(schema.registrationAcquisitionComponents.tenantId, tenant.id),
        ),
      );
    expect(recipientAcquisitionComponents).toHaveLength(3);
    expect(
      recipientAcquisitionComponents.find(
        ({ kind }) => kind === 'registration',
      ),
    ).toMatchObject({
      acquisitionPaymentId: recipientAcquisitionPayment.id,
      allocationKey: 'registration',
      applicationFeeAmount: 147,
      baseAmount: 4200,
      currency: 'EUR',
      grossAmount: 4200,
      kind: 'registration',
      netAmount: 3977,
      purchaseId: null,
      purchaseLotId: null,
      quantity: 2,
      stripeFeeAmount: 76,
      taxAmount: 0,
    });
    expect(
      recipientAcquisitionComponents.find(
        ({ purchaseLotId }) => purchaseLotId === scenario.paidPurchaseLotId,
      ),
    ).toMatchObject({
      acquisitionPaymentId: recipientAcquisitionPayment.id,
      allocationKey: `addon-lot:${scenario.paidPurchaseLotId}`,
      applicationFeeAmount: 46,
      baseAmount: 1300,
      currency: 'EUR',
      grossAmount: 1300,
      kind: 'addon_lot',
      netAmount: 1230,
      purchaseId: scenario.paidPurchaseId,
      purchaseLotId: scenario.paidPurchaseLotId,
      quantity: 2,
      stripeFeeAmount: 24,
      taxAmount: 0,
    });
    expect(
      recipientAcquisitionComponents.find(
        ({ purchaseLotId }) => purchaseLotId === scenario.freePurchaseLotId,
      ),
    ).toMatchObject({
      acquisitionPaymentId: null,
      allocationKey: `addon-lot:${scenario.freePurchaseLotId}`,
      applicationFeeAmount: 0,
      baseAmount: 0,
      currency: 'EUR',
      grossAmount: 0,
      kind: 'addon_lot',
      netAmount: 0,
      purchaseLotId: scenario.freePurchaseLotId,
      quantity: 2,
      stripeFeeAmount: 0,
      taxAmount: 0,
    });
    expect(
      await database
        .select()
        .from(schema.registrationAcquisitionPayments)
        .where(
          and(
            eq(
              schema.registrationAcquisitionPayments.acquisitionId,
              scenario.sourceAcquisitionId,
            ),
            eq(schema.registrationAcquisitionPayments.tenantId, tenant.id),
          ),
        )
        .orderBy(schema.registrationAcquisitionPayments.id),
    ).toEqual(sourceAcquisitionPaymentsBefore);
    expect(
      await database
        .select()
        .from(schema.registrationAcquisitionComponents)
        .where(
          and(
            eq(
              schema.registrationAcquisitionComponents.acquisitionId,
              scenario.sourceAcquisitionId,
            ),
            eq(schema.registrationAcquisitionComponents.tenantId, tenant.id),
          ),
        )
        .orderBy(schema.registrationAcquisitionComponents.id),
    ).toEqual(sourceAcquisitionComponentsBefore);
    expect(
      await database
        .select()
        .from(schema.registrationAcquisitionRefundAllocations)
        .where(
          and(
            eq(
              schema.registrationAcquisitionRefundAllocations.acquisitionId,
              scenario.sourceAcquisitionId,
            ),
            eq(
              schema.registrationAcquisitionRefundAllocations.tenantId,
              tenant.id,
            ),
          ),
        )
        .orderBy(schema.registrationAcquisitionRefundAllocations.id),
    ).toEqual(sourceAcquisitionRefundAllocationsBefore);
    expect(
      await database.query.eventRegistrationAddonPurchases.findMany({
        columns: {
          addonId: true,
          cancelledQuantity: true,
          id: true,
          includedQuantity: true,
          purchasedQuantity: true,
          quantity: true,
          redeemedQuantity: true,
          refundAllocatedPurchasedQuantity: true,
          registrationId: true,
          unitPrice: true,
        },
        orderBy: { id: 'asc' },
        where: {
          registrationId: scenario.sourceRegistrationId,
          tenantId: tenant.id,
        },
      }),
    ).toEqual(purchasesBefore);
    expect(
      await database.query.eventRegistrationAddonPurchaseLots.findMany({
        columns: {
          cancelledQuantity: true,
          id: true,
          purchaseId: true,
          quantity: true,
          redeemedQuantity: true,
          refundAllocatedGrossAmount: true,
          refundAllocatedQuantity: true,
          registrationId: true,
          sourceTransactionId: true,
        },
        orderBy: { id: 'asc' },
        where: {
          registrationId: scenario.sourceRegistrationId,
          tenantId: tenant.id,
        },
      }),
    ).toEqual(lotsBefore);
    expect(
      await database.query.eventRegistrationAddonFulfillmentEvents.findMany({
        columns: {
          id: true,
          purchaseId: true,
          quantity: true,
          refundDisposition: true,
          refundRequested: true,
          registrationId: true,
          reversesEventId: true,
          type: true,
        },
        orderBy: { id: 'asc' },
        where: {
          registrationId: scenario.sourceRegistrationId,
          tenantId: tenant.id,
        },
      }),
    ).toEqual(fulfillmentEventsBefore);
    expect(
      await database.query.eventRegistrationAddonRefundAllocations.findMany({
        columns: {
          fulfillmentEventId: true,
          id: true,
          purchaseId: true,
          purchaseLotId: true,
          quantity: true,
          refundAmount: true,
          refundTransactionId: true,
          registrationId: true,
        },
        orderBy: { id: 'asc' },
        where: {
          registrationId: scenario.sourceRegistrationId,
          tenantId: tenant.id,
        },
      }),
    ).toEqual(refundAllocationsBefore);
    expect(
      await database.query.eventAddons.findMany({
        columns: { id: true, totalAvailableQuantity: true },
        orderBy: { id: 'asc' },
        where: { eventId: scenario.eventId },
      }),
    ).toEqual(addonStockBefore);
    expect(
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: scenario.optionId },
      }),
    ).toEqual(optionCapacityBefore);

    expect(
      await database.query.transactions.findFirst({
        columns: {
          amount: true,
          appFee: true,
          eventRegistrationId: true,
          method: true,
          status: true,
          targetUserId: true,
          type: true,
        },
        where: { id: scenario.recipientTransactionId, tenantId: tenant.id },
      }),
    ).toEqual({
      amount: 5500,
      appFee: 193,
      eventRegistrationId: scenario.sourceRegistrationId,
      method: 'stripe',
      status: 'successful',
      targetUserId: recipient.id,
      type: 'registration',
    });

    const transferAfterPayment =
      await database.query.registrationTransfers.findFirst({
        columns: {
          compensationRefundTransactionId: true,
          ownershipTransferredAt: true,
          recipientBasePrice: true,
          recipientDiscountAmount: true,
          recipientRegistrationId: true,
          recipientSpotCount: true,
          reservedAdditionalSpots: true,
          sourceRegistrationId: true,
          sourceSpotCount: true,
          status: true,
        },
        where: { id: scenario.transferId, tenantId: tenant.id },
      });
    expect(transferAfterPayment).toMatchObject({
      compensationRefundTransactionId: null,
      recipientBasePrice: 2100,
      recipientDiscountAmount: 0,
      recipientRegistrationId: scenario.sourceRegistrationId,
      recipientSpotCount: 2,
      reservedAdditionalSpots: 0,
      sourceRegistrationId: scenario.sourceRegistrationId,
      sourceSpotCount: 2,
      status: 'refund_pending',
    });
    expect(transferAfterPayment?.ownershipTransferredAt).not.toBeNull();

    const refundPlans =
      await database.query.registrationTransferRefundPlanItems.findMany({
        columns: {
          applicationFeeRefunded: true,
          currency: true,
          id: true,
          originalAmount: true,
          priorRefundedAmount: true,
          refundAmountDue: true,
          refundTransactionId: true,
          sourceTransactionId: true,
          sourceTransactionType: true,
          stripeAccountId: true,
        },
        orderBy: { sourceTransactionId: 'asc' },
        where: { tenantId: tenant.id, transferId: scenario.transferId },
      });
    expect(refundPlans).toHaveLength(2);
    expect(
      new Set(refundPlans.map((plan) => plan.sourceTransactionId)),
    ).toEqual(new Set(scenario.sourceTransactionIds));
    for (const plan of refundPlans) {
      expect(plan.originalAmount).toBe(
        plan.priorRefundedAmount + plan.refundAmountDue,
      );
      expect(plan).toMatchObject({
        applicationFeeRefunded: true,
        currency: 'EUR',
        stripeAccountId: scenario.sourceStripeAccountId,
      });
      expect(plan.refundTransactionId).toBeTruthy();
    }
    const registrationRefundPlan = refundPlans.find(
      (plan) => plan.sourceTransactionId === scenario.sourceTransactionId,
    );
    const addonRefundPlan = refundPlans.find(
      (plan) => plan.sourceTransactionType === 'addon',
    );
    expect(registrationRefundPlan).toMatchObject({
      originalAmount: 3300,
      priorRefundedAmount: 0,
      refundAmountDue: 3300,
      sourceTransactionType: 'registration',
    });
    expect(addonRefundPlan).toMatchObject({
      originalAmount: 1000,
      priorRefundedAmount: 500,
      refundAmountDue: 500,
      sourceTransactionType: 'addon',
    });
    const acquisitionPlanLinks = await database
      .select()
      .from(schema.registrationTransferRefundPlanAcquisitionLinks)
      .where(
        and(
          eq(
            schema.registrationTransferRefundPlanAcquisitionLinks
              .sourceAcquisitionId,
            scenario.sourceAcquisitionId,
          ),
          eq(
            schema.registrationTransferRefundPlanAcquisitionLinks.tenantId,
            tenant.id,
          ),
        ),
      );
    expect(acquisitionPlanLinks).toHaveLength(refundPlans.length);
    for (const plan of refundPlans) {
      const sourcePayment = sourceAcquisitionPaymentsBefore.find(
        ({ transactionId }) => transactionId === plan.sourceTransactionId,
      );
      if (!sourcePayment) {
        throw new Error('Expected the exact source acquisition payment');
      }
      expect(
        acquisitionPlanLinks.find(({ planItemId }) => planItemId === plan.id),
      ).toMatchObject({
        planItemId: plan.id,
        sourceAcquisitionId: scenario.sourceAcquisitionId,
        sourceAcquisitionPaymentId: sourcePayment.id,
        sourceTransactionId: plan.sourceTransactionId,
        tenantId: tenant.id,
      });
    }
    if (!registrationRefundPlan?.refundTransactionId) {
      throw new Error('Expected the registration source refund claim');
    }
    const refundTransactionIds = refundPlans.flatMap((plan) =>
      plan.refundTransactionId ? [plan.refundTransactionId] : [],
    );
    expect(new Set(refundTransactionIds).size).toBe(2);
    const refundTransactions = await database
      .select({
        amount: schema.transactions.amount,
        id: schema.transactions.id,
        method: schema.transactions.method,
        sourceTransactionId: schema.transactions.sourceTransactionId,
        status: schema.transactions.status,
        stripeAccountId: schema.transactions.stripeAccountId,
        stripeRefundApplicationFee:
          schema.transactions.stripeRefundApplicationFee,
        targetUserId: schema.transactions.targetUserId,
        type: schema.transactions.type,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.tenantId, tenant.id),
          inArray(schema.transactions.id, refundTransactionIds),
        ),
      );
    expect(refundTransactions).toHaveLength(2);
    for (const plan of refundPlans) {
      expect(
        refundTransactions.find(
          (transaction) => transaction.id === plan.refundTransactionId,
        ),
      ).toEqual({
        amount: -plan.refundAmountDue,
        id: plan.refundTransactionId,
        method: 'stripe',
        sourceTransactionId: plan.sourceTransactionId,
        status: 'pending',
        stripeAccountId: scenario.sourceStripeAccountId,
        stripeRefundApplicationFee: true,
        targetUserId: source.id,
        type: 'refund',
      });
    }
    const transferEventTypes = (
      await database.query.registrationTransferEvents.findMany({
        columns: { eventType: true },
        where: { tenantId: tenant.id, transferId: scenario.transferId },
      })
    ).map(({ eventType }) => eventType);
    expect(transferEventTypes).toContain('ownership_transferred');

    await testInfo.attach('markdown', {
      body: `
## Read the result before taking action

**Transfer complete — refund processing** means payment and ticket ownership are final: the same confirmed registration and its full bundle now belong to the recipient, the previous owner no longer owns it, and one or more refunds to the previous owner are still being processed. The recipient must not pay again. The recipient's new Stripe payment remains independent from those exact refunds.

If any refund fails and needs attention, the recipient still owns the ticket and the other refunds continue independently. The private page changes to **Transfer complete — refund needs attention** so nobody mistakes a refund problem for an incomplete purchase.

The previous owner can reopen the event at any time. **Transferred registrations** shows the exact total refund amount and whether it is processing, needs attention, or completed. This history does not restore ticket ownership or ticket actions.
`,
    });

    const sourceRefundAmount = refundPlans.reduce(
      (total, plan) => total + plan.refundAmountDue,
      0,
    );
    const formattedSourceRefundAmount = new Intl.NumberFormat(
      TENANT_FORMATTING_LOCALE,
      {
        currency: tenant.currency,
        style: 'currency',
      },
    ).format(sourceRefundAmount / 100);
    await page.reload();
    await waitForRegistrationPage(page);
    const sourceTransferSummary = page.getByTestId(
      'outgoing-registration-transfer',
    );
    await expect(
      sourceTransferSummary.getByRole('heading', {
        name: 'Transfer refund is processing',
      }),
    ).toBeVisible();
    await expect(sourceTransferSummary).toContainText(
      formattedSourceRefundAmount,
    );
    await expect(sourceTransferSummary.getByRole('button')).toHaveCount(0);
    await expect(page.locator('app-event-active-registration')).toHaveCount(0);
    await takeScreenshot(
      testInfo,
      sourceTransferSummary,
      page,
      'Previous-owner refund processing after ticket ownership moves',
    );

    const refundTransactionId = await scenario.failSourceRefund();
    expect(refundTransactionId).toBe(
      registrationRefundPlan.refundTransactionId,
    );
    const rawProviderError = 'Deterministic terminal Stripe refund failure';
    const failedRefundEvidence = await database.query.transactions.findFirst({
      columns: {
        stripeRefundId: true,
        stripeRefundLastError: true,
      },
      where: { id: refundTransactionId, tenantId: tenant.id },
    });
    expect(failedRefundEvidence).toMatchObject({
      stripeRefundId: expect.stringMatching(/^re_/),
      stripeRefundLastError: rawProviderError,
    });
    if (!failedRefundEvidence?.stripeRefundId) {
      throw new Error('Expected the failed provider refund identifier');
    }
    await recipientPage.page.reload();
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Transfer complete — refund needs attention',
      }),
    ).toBeVisible();
    await expect(
      recipientPage.page.getByText(/do not need to pay or claim again/i),
    ).toBeVisible();
    await page.reload();
    await waitForRegistrationPage(page);
    await expect(
      sourceTransferSummary.getByRole('heading', {
        name: 'Transfer refund needs attention',
      }),
    ).toBeVisible();
    await expect(sourceTransferSummary).toContainText(
      formattedSourceRefundAmount,
    );
    await expect(sourceTransferSummary).toContainText(
      'Contact an organizer for an update.',
    );
    await expect(sourceTransferSummary.getByRole('button')).toHaveCount(0);
    await takeScreenshot(
      testInfo,
      recipientPage.page.locator('main'),
      recipientPage.page,
      'A completed transfer with a failed previous-owner refund',
    );

    await testInfo.attach('markdown', {
      body: `
## Operator recovery

A platform administrator opens the affected organization, selects **Review finance**, and then opens **Refund recovery**. Find the failed refund by its event, amount, failed state, and related registration-transfer activity. Select **Review recovery**, enter the required operational reason, and choose **Retry failed refund**.

Evorto keeps the failed Stripe refund in payment history, starts a new refund attempt for the same amount, and returns the participant page to **Transfer complete — refund processing**. Recovery never creates a second transfer, registration, payment, or refund obligation.
`,
    });
    operatorPage = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: gaStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
    await operatorPage.page.goto(`/global-admin/tenants/${tenant.id}/finance`);
    await expect(
      operatorPage.page.getByRole('heading', {
        level: 1,
        name: 'Organization finance',
      }),
    ).toBeVisible();
    await operatorPage.page
      .getByRole('tab', { name: 'Refund recovery' })
      .click();
    const formattedFailedRefundAmount = new Intl.NumberFormat(
      TENANT_FORMATTING_LOCALE,
      {
        currency: registrationRefundPlan.currency,
        style: 'currency',
      },
    ).format(registrationRefundPlan.refundAmountDue / 100);
    const platformFinance = operatorPage.page.locator('app-platform-finance');
    const recoveryRow = platformFinance
      .locator('div.border-b')
      .filter({ hasText: 'Paid transfer refund guide' })
      .filter({ hasText: formattedFailedRefundAmount })
      .filter({ hasText: 'Related to a registration transfer' })
      .filter({ hasText: 'Stripe marked the previous refund as failed.' });
    await expect(recoveryRow).toBeVisible({ timeout: 20_000 });
    await expect(recoveryRow).toHaveCount(1);
    await expect(recoveryRow).toContainText('Paid transfer refund guide');
    await expect(recoveryRow).toContainText(formattedFailedRefundAmount);
    await expect(recoveryRow).toContainText(
      'Related to a registration transfer',
    );
    await expect(recoveryRow).toContainText(
      'Stripe marked the previous refund as failed.',
    );
    for (const hiddenIdentifier of [
      scenario.transferId,
      registrationRefundPlan.id,
      refundTransactionId,
      failedRefundEvidence.stripeRefundId,
    ]) {
      await expect(platformFinance).not.toContainText(hiddenIdentifier);
    }
    await expect(platformFinance).not.toContainText(rawProviderError);
    await recoveryRow.getByRole('button', { name: 'Review recovery' }).click();
    const refundRecoveryHeading = operatorPage.page.getByRole('heading', {
      level: 2,
      name: 'Retry failed refund',
    });
    await expect(refundRecoveryHeading).toBeVisible();
    const refundRecoveryForm = refundRecoveryHeading.locator('..');
    await expect(refundRecoveryForm).not.toHaveAttribute('jsaction', /submit/, {
      timeout: 20_000,
    });
    await expect(
      refundRecoveryForm.getByText('Event', { exact: true }).locator('..'),
    ).toContainText('Paid transfer refund guide');
    await expect(
      refundRecoveryForm.getByText('Amount', { exact: true }).locator('..'),
    ).toContainText(formattedFailedRefundAmount);
    await expect(
      refundRecoveryForm
        .getByText('Safe next step', { exact: true })
        .locator('..'),
    ).toContainText('Retry this failed refund');
    await expect(
      refundRecoveryForm
        .getByText('Related activity', { exact: true })
        .locator('..'),
    ).toContainText('Registration transfer');
    for (const hiddenIdentifier of [
      scenario.transferId,
      registrationRefundPlan.id,
      refundTransactionId,
      failedRefundEvidence.stripeRefundId,
    ]) {
      await expect(refundRecoveryForm).not.toContainText(hiddenIdentifier);
    }
    await expect(refundRecoveryForm).not.toContainText(rawProviderError);
    const refundRecoveryReason = refundRecoveryForm.getByLabel(
      'Operational recovery reason',
    );
    await refundRecoveryReason.fill(operatorRecoveryReason);
    await expect(refundRecoveryReason).toHaveValue(operatorRecoveryReason);
    await takeScreenshot(
      testInfo,
      operatorPage.page.locator('app-platform-finance'),
      operatorPage.page,
      'Review and retry one failed refund',
    );
    const scheduleNewRefundGeneration = refundRecoveryForm.getByRole('button', {
      name: 'Retry failed refund',
    });
    await expect(scheduleNewRefundGeneration).toBeEnabled();
    await scheduleNewRefundGeneration.click();
    await expect(
      operatorPage.page.getByText('Failed refund scheduled for retry', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      operatorPage.page.getByRole('heading', {
        level: 2,
        name: 'Retry failed refund',
      }),
    ).toHaveCount(0);
    await recipientPage.page.reload();
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Transfer complete — refund processing',
      }),
    ).toBeVisible();
    await page.reload();
    await waitForRegistrationPage(page);
    await expect(
      sourceTransferSummary.getByRole('heading', {
        name: 'Transfer refund is processing',
      }),
    ).toBeVisible();
    await expect(sourceTransferSummary).toContainText(
      formattedSourceRefundAmount,
    );
    await takeScreenshot(
      testInfo,
      recipientPage.page.locator('main'),
      recipientPage.page,
      'Failed refund scheduled for another attempt',
    );

    const recoveredRefund = await database.query.transactions.findFirst({
      columns: {
        stripeRefundGeneration: true,
        stripeRefundHistory: true,
        stripeRefundId: true,
        stripeRefundNextAttemptAt: true,
        stripeRefundStatus: true,
      },
      where: { id: refundTransactionId, tenantId: tenant.id },
    });
    expect(recoveredRefund).toMatchObject({
      stripeRefundGeneration: 1,
      stripeRefundHistory: [expect.objectContaining({ status: 'failed' })],
      stripeRefundId: null,
      stripeRefundStatus: null,
    });
    expect(recoveredRefund?.stripeRefundNextAttemptAt).not.toBeNull();
    expect(
      await database.query.platformAuditEntries.findFirst({
        where: {
          action: 'refundClaim.requeue',
          reason: operatorRecoveryReason,
          targetTenantId: tenant.id,
        },
      }),
    ).toMatchObject({
      action: 'refundClaim.requeue',
      reason: operatorRecoveryReason,
      targetTenantId: tenant.id,
    });

    await testInfo.attach('markdown', {
      body: `
## Confirm the previous-owner refund completed

When every original Stripe refund succeeds, the previous owner's event page changes to **Transfer refund completed** and keeps the exact total visible. The ticket still belongs to the recipient, so no transferred-ticket actions return.
`,
    });
    await scenario.completeSourceRefunds();
    await page.reload();
    await waitForRegistrationPage(page);
    await expect(
      sourceTransferSummary.getByRole('heading', {
        name: 'Transfer refund completed',
      }),
    ).toBeVisible();
    await expect(sourceTransferSummary).toContainText(
      formattedSourceRefundAmount,
    );
    await expect(sourceTransferSummary).toContainText('No action is needed.');
    await expect(sourceTransferSummary.getByRole('button')).toHaveCount(0);
    await expect(page.locator('app-event-active-registration')).toHaveCount(0);
    await expect
      .poll(async () => {
        const transfer = await database.query.registrationTransfers.findFirst({
          columns: { status: true },
          where: { id: scenario.transferId, tenantId: tenant.id },
        });
        return transfer?.status;
      })
      .toBe('completed');
    await takeScreenshot(
      testInfo,
      sourceTransferSummary,
      page,
      'Previous-owner refund completed without restoring ticket actions',
    );
  } finally {
    await operatorPage?.context.close();
    await recipientPage?.context.close();
    await database
      .delete(schema.platformAuditEntries)
      .where(
        and(
          eq(schema.platformAuditEntries.action, 'refundClaim.requeue'),
          eq(schema.platformAuditEntries.reason, operatorRecoveryReason),
          eq(schema.platformAuditEntries.targetTenantId, tenant.id),
        ),
      );
    await scenario.cleanup();
  }
});
