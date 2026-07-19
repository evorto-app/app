import { createId } from '@db/create-id';
import * as schema from '@db/schema';
import { and, eq, inArray, like } from 'drizzle-orm';

import {
  adminStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import { waitForRegistrationPage } from '../../support/utils/event-registration-page';
import { seedPaidRegistrationTransferScenario } from '../../support/utils/paid-registration-transfer-scenario';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';

test.use({ storageState: userStateFile, trace: 'on-first-retry' });

// These flows reuse the same two authenticated user fixtures and intentionally
// exercise user row locks. Keep the tests independent, but run this file in
// order so fullyParallel does not create a fixture-only cross-transfer deadlock.
test.describe.configure({ mode: 'default' });

test('transfers a free registration through a private claim URL', async ({
  browser,
  database,
  page,
  seeded,
  tenant,
  testClock,
}) => {
  const source = usersToAuthenticate.find((user) => user.roles === 'user');
  const recipient = usersToAuthenticate.find((user) => user.roles === 'admin');
  const template = seeded.templates[0];
  if (!source || !recipient || !template) {
    throw new Error('Expected seeded source, recipient, and event template');
  }

  const eventId = createId();
  const optionId = createId();
  const sourceRegistrationId = createId();
  const sourceAcquisitionId = createId();
  const eventWindow = futureServerEventWindow();
  const startsAt = eventWindow.start;
  let recipientPage:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

  await database.insert(schema.eventInstances).values({
    creatorId: source.id,
    description: 'Transfer state-machine Playwright scenario',
    end: eventWindow.end,
    icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
    id: eventId,
    start: startsAt,
    status: 'APPROVED',
    templateId: template.id,
    tenantId: tenant.id,
    title: 'Private transfer scenario',
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
  await database.insert(schema.eventRegistrations).values({
    basePriceAtRegistration: 0,
    eventId,
    guestCount: 0,
    id: sourceRegistrationId,
    registrationOptionId: optionId,
    status: 'CONFIRMED',
    tenantId: tenant.id,
    userId: source.id,
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
    await page.goto(`/events/${eventId}`);
    await waitForRegistrationPage(page);
    const createTransferLink = page.getByRole('button', {
      name: 'Create transfer link',
    });
    await expect(createTransferLink).toBeVisible();
    // SSR exposes the action before Angular attaches its click listener.
    // Event replay removes `jsaction` once the mutation is interactive.
    await expect(createTransferLink).not.toHaveAttribute('jsaction', /click/);
    await createTransferLink.click();
    await expect(
      page.getByRole('heading', { name: 'Private transfer link created' }),
    ).toBeVisible();
    const claimUrl = await page.getByLabel('Claim link').inputValue();
    const claimCode = await page.getByLabel('Manual claim code').inputValue();
    const claimToken = new URL(claimUrl).pathname.split('/').at(-1);
    if (!claimToken) throw new Error('Expected an opaque claim token in URL');
    expect(claimCode).toMatch(/^[A-F0-9]+(?:-[A-F0-9]+)+$/);

    const persistedOffer = await database.query.registrationTransfers.findFirst(
      {
        where: {
          sourceRegistrationId,
          tenantId: tenant.id,
        },
      },
    );
    expect(persistedOffer).toMatchObject({ status: 'open' });
    expect(persistedOffer?.claimTokenHash).toHaveLength(64);
    expect(persistedOffer?.claimTokenHash).not.toBe(claimToken);
    expect(persistedOffer?.claimCodeHash).toHaveLength(64);
    expect(persistedOffer?.claimCodeHash).not.toBe(claimCode);

    recipientPage = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: adminStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
    await recipientPage.page.goto(new URL(claimUrl).pathname);
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Review before you claim',
      }),
    ).toBeVisible();
    await expect(
      recipientPage.page.getByText('Private transfer scenario'),
    ).toBeVisible();
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
    await claimRegistration.click();
    await expect(
      recipientPage.page.getByRole('heading', { name: 'Transfer complete' }),
    ).toBeVisible();

    const eventRegistrations = await database
      .select()
      .from(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, eventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
        ),
      );
    expect(eventRegistrations).toHaveLength(1);
    expect(eventRegistrations[0]).toMatchObject({
      basePriceAtRegistration: 0,
      guestCount: 0,
      id: sourceRegistrationId,
      registrationOptionId: optionId,
      status: 'CONFIRMED',
      userId: recipient.id,
    });
    expect(
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: optionId },
      }),
    ).toEqual({ confirmedSpots: 1, reservedSpots: 0 });
    expect(
      await database.query.registrationTransfers.findFirst({
        where: { sourceRegistrationId, tenantId: tenant.id },
      }),
    ).toMatchObject({
      recipientRegistrationId: sourceRegistrationId,
      recipientUserId: recipient.id,
      status: 'completed',
    });
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

test('offers a paid registration privately while rejecting a source self-claim', async ({
  browser,
  database,
  page,
  seeded,
  tenant,
  testClock,
}) => {
  const source = usersToAuthenticate.find((user) => user.roles === 'user');
  const recipient = usersToAuthenticate.find((user) => user.roles === 'admin');
  const template = seeded.templates[0];
  if (!source || !recipient || !template) {
    throw new Error('Expected seeded paid-transfer users and template');
  }

  const eventId = createId();
  const optionId = createId();
  const sourceRegistrationId = createId();
  const sourceTransactionId = createId();
  const sourceAcquisitionId = createId();
  const sourceAcquisitionPaymentId = createId();
  const stripeAccountId = `acct_transfer_offer_${sourceTransactionId}`;
  const eventWindow = futureServerEventWindow();
  const startsAt = eventWindow.start;
  let recipientPage:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

  const originalTenant = await database.query.tenants.findFirst({
    columns: { stripeAccountId: true },
    where: { id: tenant.id },
  });
  if (!originalTenant) {
    throw new Error('Expected paid-transfer tenant');
  }

  await database
    .update(schema.tenants)
    .set({ stripeAccountId })
    .where(eq(schema.tenants.id, tenant.id));

  await database.insert(schema.eventInstances).values({
    creatorId: source.id,
    description: 'Paid transfer offer Playwright scenario',
    end: eventWindow.end,
    icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
    id: eventId,
    start: startsAt,
    status: 'APPROVED',
    templateId: template.id,
    tenantId: tenant.id,
    title: 'Paid private transfer scenario',
    unlisted: true,
  });
  await database.insert(schema.eventRegistrationOptions).values({
    closeRegistrationTime: eventWindow.closeRegistrationTime,
    confirmedSpots: 1,
    eventId,
    id: optionId,
    isPaid: true,
    openRegistrationTime: eventWindow.openRegistrationTime,
    organizingRegistration: false,
    price: 1800,
    refundFeesOnCancellation: true,
    registrationMode: 'fcfs',
    roleIds: [],
    spots: 10,
    title: 'Paid participant',
    transferDeadlineHoursBeforeStart: 0,
  });
  await database.insert(schema.eventRegistrations).values({
    basePriceAtRegistration: 1800,
    eventId,
    id: sourceRegistrationId,
    registrationOptionId: optionId,
    status: 'CONFIRMED',
    tenantId: tenant.id,
    userId: source.id,
  });
  await database.insert(schema.transactions).values({
    amount: 1800,
    appFee: 100,
    currency: 'EUR',
    eventId,
    eventRegistrationId: sourceRegistrationId,
    id: sourceTransactionId,
    method: 'stripe',
    status: 'successful',
    stripeAccountId,
    stripeChargeId: `ch_transfer_offer_${sourceTransactionId}`,
    stripeFee: 200,
    stripeNetAmount: 1500,
    targetUserId: source.id,
    tenantId: tenant.id,
    type: 'registration',
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
  await database.insert(schema.registrationAcquisitionPayments).values({
    acquisitionId: sourceAcquisitionId,
    attachedAt: new Date(),
    eventId,
    id: sourceAcquisitionPaymentId,
    registrationId: sourceRegistrationId,
    tenantId: tenant.id,
    transactionId: sourceTransactionId,
  });
  await database.insert(schema.registrationAcquisitionComponents).values({
    acquiredAt: new Date(),
    acquisitionId: sourceAcquisitionId,
    acquisitionPaymentId: sourceAcquisitionPaymentId,
    allocationKey: `registration-initial:${sourceRegistrationId}`,
    applicationFeeAmount: 100,
    baseAmount: 1800,
    currency: 'EUR',
    eventId,
    grossAmount: 1800,
    kind: 'registration',
    netAmount: 1500,
    quantity: 1,
    registrationId: sourceRegistrationId,
    stripeFeeAmount: 200,
    taxAmount: 0,
    tenantId: tenant.id,
  });

  try {
    await page.goto(`/events/${eventId}`);
    await waitForRegistrationPage(page);
    const createTransferLink = page.getByRole('button', {
      name: 'Create transfer link',
    });
    await expect(createTransferLink).toBeVisible();
    // Waiting at the action boundary prevents an SSR-only click from consuming
    // the test timeout before its cleanup can use the database fixture.
    await expect(createTransferLink).not.toHaveAttribute('jsaction', /click/);
    await createTransferLink.click();
    const claimUrl = await page.getByLabel('Claim link').inputValue();
    const claimPath = new URL(claimUrl).pathname;

    const transfer = await database.query.registrationTransfers.findFirst({
      where: { sourceRegistrationId, tenantId: tenant.id },
    });
    expect(transfer).toMatchObject({
      recipientRegistrationId: null,
      status: 'open',
    });
    if (!transfer) {
      throw new Error('Expected persisted paid transfer offer');
    }
    expect(
      await database
        .select({
          applicationFeeRefunded:
            schema.registrationTransferRefundPlanItems.applicationFeeRefunded,
          originalAmount:
            schema.registrationTransferRefundPlanItems.originalAmount,
          priorRefundedAmount:
            schema.registrationTransferRefundPlanItems.priorRefundedAmount,
          refundAmountDue:
            schema.registrationTransferRefundPlanItems.refundAmountDue,
          refundTransactionId:
            schema.registrationTransferRefundPlanItems.refundTransactionId,
          sourceRegistrationId:
            schema.registrationTransferRefundPlanItems.sourceRegistrationId,
          sourceTransactionId:
            schema.registrationTransferRefundPlanItems.sourceTransactionId,
          sourceTransactionType:
            schema.registrationTransferRefundPlanItems.sourceTransactionType,
          stripeAccountId:
            schema.registrationTransferRefundPlanItems.stripeAccountId,
          transferId: schema.registrationTransferRefundPlanItems.transferId,
        })
        .from(schema.registrationTransferRefundPlanItems)
        .where(
          and(
            eq(
              schema.registrationTransferRefundPlanItems.transferId,
              transfer.id,
            ),
            eq(schema.registrationTransferRefundPlanItems.tenantId, tenant.id),
          ),
        ),
    ).toEqual([
      {
        applicationFeeRefunded: true,
        originalAmount: 1800,
        priorRefundedAmount: 0,
        refundAmountDue: 1800,
        refundTransactionId: null,
        sourceRegistrationId,
        sourceTransactionId,
        sourceTransactionType: 'registration',
        stripeAccountId,
        transferId: transfer.id,
      },
    ]);

    await page.goto(claimPath);
    await expect(
      page.getByRole('heading', { name: 'Review before you claim' }),
    ).toBeVisible();
    const claimRegistration = page.getByRole('button', {
      name: 'Claim registration',
    });
    const claimRegistrationForm = page.locator('form').filter({
      has: claimRegistration,
    });
    await expect(claimRegistrationForm).not.toHaveAttribute(
      'jsaction',
      /submit/,
      { timeout: 20_000 },
    );
    await claimRegistration.click();
    await expect(
      page.getByRole('heading', { name: 'Claim did not complete' }),
    ).toBeVisible();
    await expect(
      page.getByText('We could not complete the transfer. Nothing changed.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        database.query.registrationTransfers.findFirst({
          columns: { recipientRegistrationId: true, status: true },
          where: { id: transfer.id, tenantId: tenant.id },
        }),
      )
      .toEqual({ recipientRegistrationId: null, status: 'open' });

    recipientPage = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: adminStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
    await recipientPage.page.goto(claimPath);
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Review before you claim',
      }),
    ).toBeVisible();
    await expect(
      recipientPage.page.getByText('Paid private transfer scenario'),
    ).toBeVisible();
    const currentRegistrationPrice = recipientPage.page
      .locator('dt', { hasText: 'Your current registration price' })
      .locator('..');
    await expect(currentRegistrationPrice.locator('dd')).toContainText(
      /18[,.]00/,
    );
    await expect(
      recipientPage.page.getByRole('button', { name: 'Claim registration' }),
    ).toBeVisible();
  } finally {
    await recipientPage?.context.close();
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
      .delete(schema.transactions)
      .where(eq(schema.transactions.id, sourceTransactionId));
    await database
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.id, sourceRegistrationId));
    await database
      .delete(schema.eventRegistrationOptions)
      .where(eq(schema.eventRegistrationOptions.id, optionId));
    await database
      .delete(schema.eventInstances)
      .where(eq(schema.eventInstances.id, eventId));
    await database
      .update(schema.tenants)
      .set({ stripeAccountId: originalTenant.stripeAccountId })
      .where(eq(schema.tenants.id, tenant.id));
  }
});

test('completes a paid transfer and preserves its failed refund for operator requeue', async ({
  browser,
  database,
  page,
  seeded,
  tenant,
  testClock,
}) => {
  test.slow();

  const source = usersToAuthenticate.find((user) => user.roles === 'user');
  const recipient = usersToAuthenticate.find((user) => user.roles === 'admin');
  const template = seeded.templates[0];
  if (!source || !recipient || !template) {
    throw new Error('Expected seeded paid-transfer users and template');
  }

  const scenario = await seedPaidRegistrationTransferScenario({
    database,
    recipient,
    source,
    templateId: template.id,
    tenant,
    title: 'Paid transfer recovery scenario',
  });
  let recipientPage:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

  try {
    expect(scenario.recipientRegistrationId).toBe(
      scenario.sourceRegistrationId,
    );
    const registrationBefore =
      await database.query.eventRegistrations.findFirst({
        columns: {
          appliedDiscountedPrice: true,
          appliedDiscountType: true,
          basePriceAtRegistration: true,
          checkedInGuestCount: true,
          checkInTime: true,
          discountAmount: true,
          eventId: true,
          guestCount: true,
          id: true,
          registrationOptionId: true,
          status: true,
          tenantId: true,
          userId: true,
        },
        where: {
          id: scenario.sourceRegistrationId,
          tenantId: tenant.id,
        },
      });
    expect(registrationBefore).toMatchObject({
      checkedInGuestCount: 1,
      guestCount: 1,
      id: scenario.sourceRegistrationId,
      status: 'CONFIRMED',
      userId: source.id,
    });
    expect(registrationBefore?.checkInTime).not.toBeNull();
    const addonPurchasesBefore = await database
      .select()
      .from(schema.eventRegistrationAddonPurchases)
      .where(
        and(
          eq(
            schema.eventRegistrationAddonPurchases.registrationId,
            scenario.sourceRegistrationId,
          ),
          eq(schema.eventRegistrationAddonPurchases.tenantId, tenant.id),
        ),
      )
      .orderBy(schema.eventRegistrationAddonPurchases.id);
    const purchaseLotsBefore = await database
      .select()
      .from(schema.eventRegistrationAddonPurchaseLots)
      .where(
        and(
          eq(
            schema.eventRegistrationAddonPurchaseLots.registrationId,
            scenario.sourceRegistrationId,
          ),
          eq(schema.eventRegistrationAddonPurchaseLots.tenantId, tenant.id),
        ),
      )
      .orderBy(schema.eventRegistrationAddonPurchaseLots.id);
    const fulfillmentEventsBefore = await database
      .select()
      .from(schema.eventRegistrationAddonFulfillmentEvents)
      .where(
        and(
          eq(
            schema.eventRegistrationAddonFulfillmentEvents.registrationId,
            scenario.sourceRegistrationId,
          ),
          eq(
            schema.eventRegistrationAddonFulfillmentEvents.tenantId,
            tenant.id,
          ),
        ),
      )
      .orderBy(schema.eventRegistrationAddonFulfillmentEvents.id);
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
          eq(
            schema.registrationAcquisitionRefundAllocations.tenantId,
            tenant.id,
          ),
        ),
      )
      .orderBy(schema.registrationAcquisitionRefundAllocations.id);
    expect(addonPurchasesBefore).toHaveLength(2);
    expect(purchaseLotsBefore).toHaveLength(2);
    expect(fulfillmentEventsBefore).toHaveLength(4);
    const freePurchaseLotBefore = purchaseLotsBefore.find(
      ({ id }) => id === scenario.freePurchaseLotId,
    );
    if (!freePurchaseLotBefore) {
      throw new Error('Expected source free add-on purchase lot');
    }
    expect(sourceAcquisitionBefore).toMatchObject({
      kind: 'initial',
      ordinal: 0,
      ownerUserId: source.id,
    });
    expect(sourceAcquisitionPaymentsBefore).toHaveLength(2);
    expect(sourceAcquisitionComponentsBefore).toHaveLength(3);
    expect(sourceAcquisitionRefundAllocationsBefore).toHaveLength(1);

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
    expect(
      await database.query.transactions.findFirst({
        columns: {
          amount: true,
          stripeAccountId: true,
          targetUserId: true,
        },
        where: { id: scenario.recipientTransactionId, tenantId: tenant.id },
      }),
    ).toEqual({
      amount: 5500,
      stripeAccountId: scenario.stripeAccountId,
      targetUserId: recipient.id,
    });

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

    const registrationsAfter = await database
      .select({
        appliedDiscountedPrice:
          schema.eventRegistrations.appliedDiscountedPrice,
        appliedDiscountType: schema.eventRegistrations.appliedDiscountType,
        basePriceAtRegistration:
          schema.eventRegistrations.basePriceAtRegistration,
        checkedInGuestCount: schema.eventRegistrations.checkedInGuestCount,
        checkInTime: schema.eventRegistrations.checkInTime,
        discountAmount: schema.eventRegistrations.discountAmount,
        eventId: schema.eventRegistrations.eventId,
        guestCount: schema.eventRegistrations.guestCount,
        id: schema.eventRegistrations.id,
        registrationOptionId: schema.eventRegistrations.registrationOptionId,
        status: schema.eventRegistrations.status,
        tenantId: schema.eventRegistrations.tenantId,
        userId: schema.eventRegistrations.userId,
      })
      .from(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, scenario.eventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
        ),
      );
    expect(registrationsAfter).toHaveLength(1);
    expect(registrationsAfter[0]).toEqual({
      ...registrationBefore,
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      basePriceAtRegistration: 2100,
      discountAmount: 0,
      userId: recipient.id,
    });
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
      throw new Error('Expected the exact recipient acquisition payment');
    }
    expect(
      await database.query.transactions.findFirst({
        columns: {
          amount: true,
          appFee: true,
          status: true,
          stripeAccountId: true,
          stripeChargeId: true,
          stripeFee: true,
          stripeNetAmount: true,
          stripePaymentIntentId: true,
          targetUserId: true,
        },
        where: {
          id: scenario.recipientTransactionId,
          tenantId: tenant.id,
        },
      }),
    ).toEqual({
      amount: 5500,
      appFee: 193,
      status: 'successful',
      stripeAccountId: scenario.stripeAccountId,
      stripeChargeId: scenario.recipientChargeId,
      stripeFee: 100,
      stripeNetAmount: 5207,
      stripePaymentIntentId: scenario.recipientPaymentIntentId,
      targetUserId: recipient.id,
    });
    const recipientComponents = await database
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
    expect(recipientComponents).toHaveLength(3);
    expect(
      recipientComponents.find(({ kind }) => kind === 'registration'),
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
      recipientComponents.find(
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
      recipientComponents.find(
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
      purchaseId: freePurchaseLotBefore.purchaseId,
      purchaseLotId: scenario.freePurchaseLotId,
      quantity: 2,
      stripeFeeAmount: 0,
      taxAmount: 0,
    });
    expect(
      await database.query.eventRegistrationOptions.findFirst({
        columns: { confirmedSpots: true, reservedSpots: true },
        where: { id: scenario.optionId },
      }),
    ).toEqual({ confirmedSpots: 2, reservedSpots: 0 });
    expect(
      await database
        .select()
        .from(schema.eventRegistrationAddonPurchases)
        .where(
          and(
            eq(
              schema.eventRegistrationAddonPurchases.registrationId,
              scenario.sourceRegistrationId,
            ),
            eq(schema.eventRegistrationAddonPurchases.tenantId, tenant.id),
          ),
        )
        .orderBy(schema.eventRegistrationAddonPurchases.id),
    ).toEqual(addonPurchasesBefore);
    expect(
      await database
        .select()
        .from(schema.eventRegistrationAddonPurchaseLots)
        .where(
          and(
            eq(
              schema.eventRegistrationAddonPurchaseLots.registrationId,
              scenario.sourceRegistrationId,
            ),
            eq(schema.eventRegistrationAddonPurchaseLots.tenantId, tenant.id),
          ),
        )
        .orderBy(schema.eventRegistrationAddonPurchaseLots.id),
    ).toEqual(purchaseLotsBefore);
    expect(
      await database
        .select()
        .from(schema.eventRegistrationAddonFulfillmentEvents)
        .where(
          and(
            eq(
              schema.eventRegistrationAddonFulfillmentEvents.registrationId,
              scenario.sourceRegistrationId,
            ),
            eq(
              schema.eventRegistrationAddonFulfillmentEvents.tenantId,
              tenant.id,
            ),
          ),
        )
        .orderBy(schema.eventRegistrationAddonFulfillmentEvents.id),
    ).toEqual(fulfillmentEventsBefore);
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

    const refundPlans = await database
      .select()
      .from(schema.registrationTransferRefundPlanItems)
      .where(
        and(
          eq(
            schema.registrationTransferRefundPlanItems.transferId,
            scenario.transferId,
          ),
          eq(schema.registrationTransferRefundPlanItems.tenantId, tenant.id),
        ),
      )
      .orderBy(schema.registrationTransferRefundPlanItems.sourceTransactionId);
    expect(refundPlans).toHaveLength(scenario.sourceTransactionIds.length);
    expect(
      refundPlans.map(({ sourceTransactionId }) => sourceTransactionId).sort(),
    ).toEqual([...scenario.sourceTransactionIds].sort());
    expect(
      refundPlans.find(
        ({ sourceTransactionId }) =>
          sourceTransactionId === scenario.sourceTransactionId,
      ),
    ).toMatchObject({
      applicationFeeRefunded: true,
      originalAmount: 3300,
      priorRefundedAmount: 0,
      refundAmountDue: 3300,
      sourceRegistrationId: scenario.sourceRegistrationId,
      sourceTransactionType: 'registration',
    });
    expect(
      refundPlans.find(
        ({ sourceTransactionId }) =>
          sourceTransactionId !== scenario.sourceTransactionId,
      ),
    ).toMatchObject({
      applicationFeeRefunded: true,
      originalAmount: 1000,
      priorRefundedAmount: 500,
      refundAmountDue: 500,
      sourceRegistrationId: scenario.sourceRegistrationId,
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
        throw new Error('Expected exact source acquisition payment');
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
    const refundTransactionIds = refundPlans.flatMap(
      ({ refundTransactionId }) =>
        refundTransactionId ? [refundTransactionId] : [],
    );
    expect(refundTransactionIds).toHaveLength(refundPlans.length);
    const refundClaims = await database
      .select()
      .from(schema.transactions)
      .where(
        and(
          inArray(schema.transactions.id, refundTransactionIds),
          eq(schema.transactions.tenantId, tenant.id),
          eq(schema.transactions.type, 'refund'),
        ),
      );
    expect(refundClaims).toHaveLength(refundPlans.length);
    for (const plan of refundPlans) {
      const refundClaim = refundClaims.find(
        ({ id }) => id === plan.refundTransactionId,
      );
      expect(refundClaim).toMatchObject({
        amount: -plan.refundAmountDue,
        eventRegistrationId: scenario.sourceRegistrationId,
        method: 'stripe',
        sourceTransactionId: plan.sourceTransactionId,
        status: 'pending',
        stripeAccountId: scenario.sourceStripeAccountId,
        stripeRefundApplicationFee: true,
        targetUserId: source.id,
      });
      expect(refundClaim?.stripeRefundNextAttemptAt).not.toBeNull();
    }
    expect(
      await database.query.registrationTransfers.findFirst({
        where: { id: scenario.transferId, tenantId: tenant.id },
      }),
    ).toMatchObject({
      recipientRegistrationId: scenario.sourceRegistrationId,
      recipientUserId: recipient.id,
      status: 'refund_pending',
    });

    const refundTransactionId = await scenario.failSourceRefund();
    expect(refundTransactionId).toBe(
      refundPlans.find(
        ({ sourceTransactionId }) =>
          sourceTransactionId === scenario.sourceTransactionId,
      )?.refundTransactionId,
    );
    await recipientPage.page.reload();
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Transfer complete — refund needs attention',
      }),
    ).toBeVisible();
    await expect(
      recipientPage.page.getByText(/do not need to pay or claim again/i),
    ).toBeVisible();
    expect(
      await database.query.registrationTransfers.findFirst({
        columns: { status: true },
        where: { id: scenario.transferId, tenantId: tenant.id },
      }),
    ).toEqual({ status: 'refund_failed' });

    expect(await scenario.requeueSourceRefund()).toEqual({
      refundAfter: {
        attempts: 0,
        generation: 1,
        refundId: null,
        status: 'pending',
        stripeRefundStatus: null,
      },
      recoveryMode: 'newGeneration',
      transferStatus: 'requeued',
    });
    await recipientPage.page.reload();
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Transfer complete — refund processing',
      }),
    ).toBeVisible();
    expect(
      await database.query.transactions.findFirst({
        columns: {
          status: true,
          stripeRefundGeneration: true,
          stripeRefundHistory: true,
          stripeRefundId: true,
          stripeRefundNextAttemptAt: true,
          stripeRefundStatus: true,
        },
        where: { id: refundTransactionId, tenantId: tenant.id },
      }),
    ).toMatchObject({
      status: 'pending',
      stripeRefundGeneration: 1,
      stripeRefundHistory: [
        expect.objectContaining({
          refundId: `re_transfer_${scenario.sourceTransactionId}`,
          status: 'failed',
        }),
      ],
      stripeRefundId: null,
      stripeRefundStatus: null,
    });
    expect(
      (
        await database.query.transactions.findFirst({
          columns: { stripeRefundNextAttemptAt: true },
          where: { id: refundTransactionId, tenantId: tenant.id },
        })
      )?.stripeRefundNextAttemptAt,
    ).not.toBeNull();
  } finally {
    await recipientPage?.context.close();
    await scenario.cleanup();
  }
});

test('refunds an inherited add-on from the recipient Checkout after account rotation', async ({
  database,
  seeded,
  tenant,
}) => {
  const source = usersToAuthenticate.find((user) => user.roles === 'user');
  const recipient = usersToAuthenticate.find((user) => user.roles === 'admin');
  const template = seeded.templates[0];
  if (!source || !recipient || !template) {
    throw new Error('Expected seeded paid-transfer users and template');
  }

  const scenario = await seedPaidRegistrationTransferScenario({
    database,
    recipient,
    source,
    templateId: template.id,
    tenant,
    title: 'Inherited add-on refund scenario',
  });
  try {
    expect(scenario.sourceStripeAccountId).not.toBe(scenario.stripeAccountId);
    const sourceAcquisitionBefore =
      await database.query.registrationAcquisitions.findFirst({
        where: {
          id: scenario.sourceAcquisitionId,
          tenantId: tenant.id,
        },
      });
    const sourceComponentsBefore = await database
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
    const sourceAllocationsBefore = await database
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
      .orderBy(schema.registrationAcquisitionRefundAllocations.id);
    const paidLotBefore =
      await database.query.eventRegistrationAddonPurchaseLots.findFirst({
        where: {
          id: scenario.paidPurchaseLotId,
          tenantId: tenant.id,
        },
      });
    if (!sourceAcquisitionBefore || !paidLotBefore) {
      throw new Error('Expected source acquisition and paid lot history');
    }

    expect(await scenario.completeCheckout()).toBe('finalized');
    const recipientAcquisition =
      await database.query.registrationAcquisitions.findFirst({
        where: {
          registrationId: scenario.sourceRegistrationId,
          tenantId: tenant.id,
          transferId: scenario.transferId,
        },
      });
    expect(recipientAcquisition).toMatchObject({
      kind: 'claim_transfer',
      ordinal: 1,
      ownerUserId: recipient.id,
      previousAcquisitionId: scenario.sourceAcquisitionId,
    });
    if (!recipientAcquisition) {
      throw new Error('Expected recipient claim-transfer acquisition');
    }
    const recipientPayment =
      await database.query.registrationAcquisitionPayments.findFirst({
        where: {
          acquisitionId: recipientAcquisition.id,
          tenantId: tenant.id,
          transactionId: scenario.recipientTransactionId,
        },
      });
    expect(recipientPayment).toMatchObject({
      acquisitionId: recipientAcquisition.id,
      registrationId: scenario.sourceRegistrationId,
      transactionId: scenario.recipientTransactionId,
    });
    if (!recipientPayment) {
      throw new Error('Expected recipient acquisition payment');
    }
    const recipientPaidComponent =
      await database.query.registrationAcquisitionComponents.findFirst({
        where: {
          acquisitionId: recipientAcquisition.id,
          purchaseLotId: scenario.paidPurchaseLotId,
          tenantId: tenant.id,
        },
      });
    expect(recipientPaidComponent).toMatchObject({
      acquisitionPaymentId: recipientPayment.id,
      applicationFeeAmount: 46,
      baseAmount: 1300,
      grossAmount: 1300,
      kind: 'addon_lot',
      netAmount: 1230,
      purchaseId: scenario.paidPurchaseId,
      quantity: 2,
      stripeFeeAmount: 24,
    });
    if (!recipientPaidComponent) {
      throw new Error('Expected recipient paid add-on component');
    }

    const cancellation = await scenario.cancelInheritedAddon();
    expect(cancellation).toMatchObject({ refundStatus: 'pending' });

    const allocations = await database
      .select()
      .from(schema.registrationAcquisitionRefundAllocations)
      .where(
        and(
          eq(
            schema.registrationAcquisitionRefundAllocations.componentId,
            recipientPaidComponent.id,
          ),
          eq(
            schema.registrationAcquisitionRefundAllocations.operationKind,
            'addon_cancellation',
          ),
          eq(
            schema.registrationAcquisitionRefundAllocations.tenantId,
            tenant.id,
          ),
        ),
      );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      acquisitionId: recipientAcquisition.id,
      acquisitionPaymentId: recipientPayment.id,
      applicationFeeAmount: 23,
      applicationFeeRefunded: true,
      componentId: recipientPaidComponent.id,
      eventId: scenario.eventId,
      fulfillmentEventId: cancellation.fulfillmentEventId,
      grossEntitlementAmount: 650,
      netEntitlementAmount: 615,
      operationKey: `addon-cancel:${cancellation.fulfillmentEventId}:${recipientPaidComponent.id}`,
      operationKind: 'addon_cancellation',
      purchaseId: scenario.paidPurchaseId,
      quantity: 1,
      refundAmount: 650,
      registrationId: scenario.sourceRegistrationId,
      stripeFeeAmount: 12,
      tenantId: tenant.id,
    });
    const refundTransactionId = allocations[0]?.refundTransactionId;
    expect(refundTransactionId).toBeTruthy();
    expect(
      await database.query.transactions.findFirst({
        columns: {
          amount: true,
          sourceTransactionId: true,
          stripeAccountId: true,
          targetUserId: true,
        },
        where: { id: refundTransactionId, tenantId: tenant.id },
      }),
    ).toEqual({
      amount: -650,
      sourceTransactionId: scenario.recipientTransactionId,
      stripeAccountId: scenario.stripeAccountId,
      targetUserId: recipient.id,
    });
    expect(
      await database.query.registrationAcquisitions.findFirst({
        where: {
          id: scenario.sourceAcquisitionId,
          tenantId: tenant.id,
        },
      }),
    ).toEqual(sourceAcquisitionBefore);
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
    ).toEqual(sourceComponentsBefore);
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
    ).toEqual(sourceAllocationsBefore);
    expect(
      await database.query.registrationAcquisitionComponents.findFirst({
        where: {
          id: recipientPaidComponent.id,
          tenantId: tenant.id,
        },
      }),
    ).toEqual(recipientPaidComponent);
    const paidLotAfter =
      await database.query.eventRegistrationAddonPurchaseLots.findFirst({
        where: {
          id: scenario.paidPurchaseLotId,
          tenantId: tenant.id,
        },
      });
    expect(paidLotAfter).toEqual({
      ...paidLotBefore,
      cancelledQuantity: paidLotBefore.cancelledQuantity + 1,
      updatedAt: expect.any(Date),
    });
    expect(paidLotAfter?.updatedAt.getTime()).toBeGreaterThan(
      paidLotBefore.updatedAt.getTime(),
    );
  } finally {
    await scenario.cleanup();
  }
});
