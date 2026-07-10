import { createId } from '@db/create-id';
import * as schema from '@db/schema';
import { eq, like } from 'drizzle-orm';

import {
  adminStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import { seedPaidRegistrationTransferScenario } from '../../support/utils/paid-registration-transfer-scenario';

test.use({ storageState: userStateFile, trace: 'on-first-retry' });

test('Transfer a registration with a private link', async ({
  browser,
  database,
  page,
  seeded,
  tenant,
  testClock,
}, testInfo) => {
  const source = usersToAuthenticate.find((user) => user.roles === 'user');
  const recipient = usersToAuthenticate.find((user) => user.roles === 'admin');
  const template = seeded.templates[0];
  if (!source || !recipient || !template) {
    throw new Error('Expected documented transfer users and template');
  }

  const eventId = createId();
  const optionId = createId();
  const sourceRegistrationId = createId();
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  let recipientRegistrationId: string | undefined;
  let recipientPage:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

  await database.insert(schema.eventInstances).values({
    creatorId: source.id,
    description: 'A documented registration transfer.',
    end: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
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
    closeRegistrationTime: new Date(startsAt.getTime() - 60 * 60 * 1000),
    confirmedSpots: 1,
    eventId,
    id: optionId,
    isPaid: false,
    openRegistrationTime: new Date(Date.now() - 60 * 60 * 1000),
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
    id: sourceRegistrationId,
    registrationOptionId: optionId,
    status: 'CONFIRMED',
    tenantId: tenant.id,
    userId: source.id,
  });

  try {
    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Before you start" %}
Only a confirmed registration that has not been checked in can be transferred. The tenant or event option may close transfers a configured number of hours before the event starts.

The transfer link and manual code are bearer credentials. Share one of them privately with exactly one intended recipient.
{% /callout %}

# Transfer a registration

The recipient does not inherit the previous owner's answers, discount, guests, or add-ons. Evorto checks the recipient's current role eligibility, asks the current questions, and calculates the current price when they claim.

## Create a private offer

Open the event while signed in as the current registration owner. Under the confirmed ticket, select **Create transfer link**.
`,
    });

    await page.goto(`/events/${eventId}`);
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'detached' });
    const createButton = page.getByRole('button', {
      name: 'Create transfer link',
    });
    await expect(createButton).toBeVisible();
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
    const claimUrl = await dialog.getByLabel('Claim link').inputValue();

    await testInfo.attach('markdown', {
      body: `
The source registration stays confirmed while the offer is open. If the recipient starts a paid claim, it also stays confirmed while Stripe Checkout is pending. The source owner can cancel the offer before the recipient is confirmed.

## Review as the recipient

Open the private link while signed in to the same tenant. Review the event, registration option, expiry, current price, questions, available add-ons, and guest choice. Select **Claim registration** only when the current details are correct.
`,
    });

    recipientPage = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: adminStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
    await recipientPage.page.goto(new URL(claimUrl).pathname);
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
    await recipientPage.page
      .getByRole('button', { name: 'Claim registration' })
      .click();
    await expect(
      recipientPage.page.getByRole('heading', { name: 'Transfer complete' }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      recipientPage.page.locator('main'),
      recipientPage.page,
      'Confirmed recipient after the source registration is cancelled',
    );

    const recipientRegistration =
      await database.query.eventRegistrations.findFirst({
        where: {
          eventId,
          status: 'CONFIRMED',
          tenantId: tenant.id,
          userId: recipient.id,
        },
      });
    if (!recipientRegistration) {
      throw new Error('Expected documented recipient registration');
    }
    recipientRegistrationId = recipientRegistration.id;

    await testInfo.attach('markdown', {
      body: `
## What paid transfers add

For a paid transfer, **Claim registration** opens Stripe Checkout on the tenant's connected account and includes the platform application fee. The recipient is confirmed first; only then is the source registration cancelled and its persisted refund queued.

- **Transfer complete — refund processing** means the recipient owns the ticket and the source refund is still running asynchronously.
- **Transfer complete — refund needs attention** still means the recipient owns the ticket. A finance or platform administrator must use the recovery action to requeue the existing refund; the participant must not pay or claim again.
- If the original ticket is cancelled, checked in, or otherwise changes after the recipient pays but before the transfer commits, Evorto cancels the recipient reservation and queues a full recipient refund including the platform fee. **Transfer stopped — refund processing** and **Transfer stopped — refund needs attention** mean the recipient does not own the ticket and must not pay or claim again.
- If Checkout expires or the offer is cancelled before payment, the recipient reservation is released and the source keeps the confirmed ticket.
`,
    });
  } finally {
    await recipientPage?.context.close();
    if (recipientRegistrationId) {
      await database
        .delete(schema.emailOutbox)
        .where(
          like(
            schema.emailOutbox.idempotencyKey,
            `%/${recipientRegistrationId}/%`,
          ),
        );
    }
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

test('Complete a paid transfer and recover its source refund', async ({
  browser,
  database,
  page,
  seeded,
  tenant,
  testClock,
}, testInfo) => {
  const source = usersToAuthenticate.find((user) => user.roles === 'user');
  const recipient = usersToAuthenticate.find((user) => user.roles === 'admin');
  const template = seeded.templates[0];
  if (!source || !recipient || !template) {
    throw new Error('Expected documented paid-transfer users and template');
  }

  const scenario = await seedPaidRegistrationTransferScenario({
    database,
    recipient,
    source,
    templateId: template.id,
    tenant,
    title: 'Paid transfer refund guide',
  });
  let recipientPage:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

  try {
    await testInfo.attach('markdown', {
      body: `
# Complete a paid registration transfer

After a recipient claims a paid registration, Evorto keeps one Stripe Checkout attached to that private offer. The recipient reservation is not a ticket yet, and the previous owner keeps their confirmed ticket until payment succeeds.

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
      'The recipient is confirmed while the source refund is processing',
    );

    const recipientRegistration =
      await database.query.eventRegistrations.findFirst({
        columns: { status: true },
        where: {
          id: scenario.recipientRegistrationId,
          tenantId: tenant.id,
        },
      });
    const sourceRegistration =
      await database.query.eventRegistrations.findFirst({
        columns: { status: true },
        where: {
          id: scenario.sourceRegistrationId,
          tenantId: tenant.id,
        },
      });
    const transferAfterPayment =
      await database.query.registrationTransfers.findFirst({
        columns: { refundTransactionId: true, status: true },
        where: { id: scenario.transferId, tenantId: tenant.id },
      });
    expect(recipientRegistration).toEqual({ status: 'CONFIRMED' });
    expect(sourceRegistration).toEqual({ status: 'CANCELLED' });
    expect(transferAfterPayment?.status).toBe('refund_pending');
    expect(transferAfterPayment?.refundTransactionId).toBeTruthy();

    await testInfo.attach('markdown', {
      body: `
## Read the result before taking action

**Transfer complete — refund processing** means payment and ticket ownership are final: the recipient is confirmed, the previous owner is cancelled, and the previous owner's persisted refund is running asynchronously. The recipient must not pay again.

If Stripe reports a terminal refund failure, the recipient still owns the ticket. The private page changes to **Transfer complete — refund needs attention** so nobody mistakes a source-refund problem for an incomplete purchase.
`,
    });

    const refundTransactionId = await scenario.failSourceRefund();
    expect(refundTransactionId).toBe(transferAfterPayment?.refundTransactionId);
    await recipientPage.page.reload();
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Transfer complete — refund needs attention',
      }),
    ).toBeVisible();
    await expect(
      recipientPage.page.getByText(/do not need to pay or claim again/i),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      recipientPage.page.locator('main'),
      recipientPage.page,
      'A completed transfer whose source refund needs operator attention',
    );

    expect(await scenario.requeueSourceRefund()).toEqual({
      recoveryMode: 'newGeneration',
      transferStatus: 'requeued',
    });
    await recipientPage.page.reload();
    await expect(
      recipientPage.page.getByRole('heading', {
        name: 'Transfer complete — refund processing',
      }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      recipientPage.page.locator('main'),
      recipientPage.page,
      'The existing source refund safely requeued for another attempt',
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

    await testInfo.attach('markdown', {
      body: `
## Operator recovery

A finance or platform administrator requeues the existing refund claim with a reason. Evorto preserves the failed Stripe refund in the claim history, starts a new idempotency generation, and returns the participant page to **Transfer complete — refund processing**. Recovery never creates a second transfer, registration, payment, or refund obligation.
`,
    });
  } finally {
    await recipientPage?.context.close();
    await scenario.cleanup();
  }
});
