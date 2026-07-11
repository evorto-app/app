import { createId } from '@db/create-id';
import * as schema from '@db/schema';
import { and, eq, like } from 'drizzle-orm';

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
  const eventWindow = futureServerEventWindow();
  const startsAt = eventWindow.start;
  let recipientRegistrationId: string | undefined;
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
This guide uses two signed-in participant accounts that belong to the same tenant:

- the current ticket owner, who has a confirmed registration; and
- a different intended recipient, whose current tenant roles are eligible for the registration option.

Neither account needs organizer or administrator permission for this participant transfer. A paid transfer additionally requires the tenant's connected Stripe account to be available. Platform-administrator permission is only needed if a refund later requires operator recovery.

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
    await waitForRegistrationPage(page);
    // SSR exposes the registration actions before Angular has attached their
    // client handlers. Hydration removes these markers once the actions are
    // interactive, so wait before issuing the single transfer mutation.
    await expect(page.locator('[ngh]')).toHaveCount(0, { timeout: 20_000 });
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

    const sourceRegistration =
      await database.query.eventRegistrations.findFirst({
        where: { id: sourceRegistrationId, tenantId: tenant.id },
      });
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
    expect(sourceRegistration?.status).toBe('CANCELLED');
    expect(recipientRegistration).toMatchObject({
      basePriceAtRegistration: 0,
      guestCount: 0,
      registrationOptionId: optionId,
      status: 'CONFIRMED',
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
      recipientRegistrationId,
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
              `%/${recipientRegistrationId}/%`,
            ),
          ),
        ),
    ).toHaveLength(2);

    await testInfo.attach('markdown', {
      body: `
The completed transfer cancels the previous owner's registration, confirms the recipient without changing the option's occupied capacity, records the completed ownership handoff, and queues separate transfer notifications for both people.

## What paid transfers add

For a paid transfer, **Claim registration** opens Stripe Checkout on the tenant's connected account and includes the platform application fee. The recipient is confirmed first; only then is the source registration cancelled and its persisted refund queued.

- **Transfer complete — refund processing** means the recipient owns the ticket and the source refund is still running asynchronously.
- **Transfer complete — refund needs attention** still means the recipient owns the ticket. A platform administrator must use the recovery action to requeue the existing refund; the participant must not pay or claim again.
- If the original ticket is cancelled, checked in, or otherwise changes after the recipient pays but before the transfer commits, Evorto cancels the recipient reservation and queues a full recipient refund including the platform fee. **Transfer stopped — refund processing** and **Transfer stopped — refund needs attention** mean the recipient does not own the ticket and must not pay or claim again.
- If Checkout expires or the offer is cancelled before payment, the recipient reservation is released and the source keeps the confirmed ticket.

Continue with [Complete a paid registration transfer](/docs/complete-a-paid-transfer-and-recover-its-source-refund) for the paid Checkout and refund-recovery states.
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
  const operatorRecoveryReason =
    'Retry the failed source refund after operator review.';

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
  let operatorPage:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

  try {
    await testInfo.attach('markdown', {
      body: `
# Complete a paid registration transfer

{% callout type="note" title="Before you start" %}
This guide continues after a current ticket owner has created a private transfer and the intended recipient, signed in to the same tenant with an eligible account, has started the paid claim. The tenant's connected Stripe account must be available. If you still need to create the private offer, start with [Transfer a registration with a private link](/docs/transfer-a-registration-with-a-private-link).
{% /callout %}

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

    await testInfo.attach('markdown', {
      body: `
## Operator recovery

A platform administrator opens the affected tenant, selects **Review finance**, and then opens **Refund recovery**. Find the terminal refund by its transfer and error details, select **Review recovery**, enter the required operational reason, and choose **Schedule new refund generation**.

Evorto preserves the failed Stripe refund in immutable history, starts a new idempotency generation, and returns the participant page to **Transfer complete — refund processing**. Recovery never creates a second transfer, registration, payment, or refund obligation.
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
        name: 'Tenant finance',
      }),
    ).toBeVisible();
    await operatorPage.page
      .getByRole('tab', { name: 'Refund recovery' })
      .click();
    const recoveryRow = operatorPage.page
      .locator('div.border-b')
      .filter({ hasText: `Transfer ${scenario.transferId}` });
    await expect(recoveryRow).toBeVisible({ timeout: 20_000 });
    await expect(recoveryRow).toContainText(
      'Deterministic terminal Stripe refund failure',
    );
    await recoveryRow.getByRole('button', { name: 'Review recovery' }).click();
    await expect(
      operatorPage.page.getByRole('heading', {
        level: 2,
        name: 'Retry terminal refund',
      }),
    ).toBeVisible();
    await operatorPage.page
      .getByLabel('Operational recovery reason')
      .fill(operatorRecoveryReason);
    await takeScreenshot(
      testInfo,
      operatorPage.page.locator('app-platform-finance'),
      operatorPage.page,
      'Review and schedule the failed source refund',
    );
    await operatorPage.page
      .getByRole('button', { name: 'Schedule new refund generation' })
      .click();
    await expect(
      operatorPage.page.getByText(
        'Terminal refund scheduled as a new safe generation',
        { exact: true },
      ),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      operatorPage.page.getByRole('heading', {
        level: 2,
        name: 'Retry terminal refund',
      }),
    ).toHaveCount(0);
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
