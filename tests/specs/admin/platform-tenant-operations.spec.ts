import { and, eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import {
  gaStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  seedCheckoutRecoveryScenario,
  waitForRegistrationStatus,
} from '../../support/utils/manual-approval-scenario';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import {
  cleanupScannerRegistrationAcquisition,
  seedScannerRegistrationAcquisition,
} from '../../support/utils/seed-scanner-fulfillment';

const platformScannerStatusGuidance = [
  {
    body: 'This ticket is not confirmed yet and cannot be checked in. Ask the attendee to open the event or Profile to see whether organizer approval or their existing payment is still needed. Do not start another sign-up or payment here.',
    label: 'Pending',
    status: 'PENDING',
    title: 'Sign-up pending',
  },
  {
    body: 'This attendee does not have a confirmed place yet and cannot be checked in. Review the waitlist and available places. Do not take payment or start another sign-up here.',
    label: 'On waitlist',
    status: 'WAITLIST',
    title: 'On waitlist',
  },
  {
    body: 'This sign-up has ended and cannot be checked in. Do not ask the attendee to pay or sign up again. If the cancellation or refund looks wrong, review the existing sign-up instead of creating a replacement.',
    label: 'Cancelled',
    status: 'CANCELLED',
    title: 'Sign-up ended',
  },
] as const;

test.use({ storageState: gaStateFile });

test('platform administrator opens target operations, refund recovery, and a deterministic scanner result @admin @globalAdmin', async ({
  database,
  page,
  registerDatabaseCleanup,
  registrations,
  tenant,
}) => {
  const registration =
    registrations.find((candidate) => candidate.status === 'CONFIRMED') ??
    registrations[0];
  if (!registration) {
    throw new Error('Expected a seeded registration for platform inspection');
  }
  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .update(schema.eventRegistrations)
      .set({ status: registration.status })
      .where(
        and(
          eq(schema.eventRegistrations.id, registration.id),
          eq(schema.eventRegistrations.tenantId, tenant.id),
        ),
      );
  });

  await page.goto(`/global-admin/tenants/${tenant.id}`);
  await expect(
    page.getByRole('navigation', { name: 'Organization management' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Manage events' }),
  ).toHaveAttribute('href', `/global-admin/tenants/${tenant.id}/events`);
  await expect(
    page.getByRole('link', { name: 'Manage templates' }),
  ).toHaveAttribute('href', `/global-admin/tenants/${tenant.id}/templates`);
  await expect(
    page.getByRole('link', { name: 'Ticket support' }),
  ).toHaveAttribute('href', `/global-admin/tenants/${tenant.id}/scanner`);
  await expect(
    page.getByRole('link', { name: 'Review finance' }),
  ).toHaveAttribute('href', `/global-admin/tenants/${tenant.id}/finance`);

  await page.getByRole('link', { name: 'Review finance' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/global-admin/tenants/${tenant.id}/finance$`),
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'Organization finance' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Refunds needing attention' }).click();
  await expect(
    page.getByText(
      'Refunds appear here when they did not finish and there is a clear next action. Refunds that are waiting, in progress, or completed do not appear here.',
      { exact: false },
    ),
  ).toBeVisible();

  await page.goto(`/global-admin/tenants/${tenant.id}/scanner`);
  await expect(page).toHaveURL(
    new RegExp(`/global-admin/tenants/${tenant.id}/scanner$`),
  );
  const lookupInput = page.getByLabel('Ticket link or ticket number');
  await expect(lookupInput).toBeEnabled();
  await lookupInput.fill(
    `http://localhost:4200/scan/registration/${registration.id}`,
  );
  await page.getByRole('button', { name: 'Open ticket' }).click();

  await expect(page).toHaveURL(
    new RegExp(
      `/global-admin/tenants/${tenant.id}/scanner/${registration.id}$`,
    ),
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ticket support' }),
  ).toBeVisible();

  const scanner = page.locator('app-platform-scanner');
  const registrationDetail = scanner.locator('section').filter({
    has: page.getByRole('heading', {
      name: 'Help with this ticket',
    }),
  });
  for (const guidance of platformScannerStatusGuidance) {
    await database
      .update(schema.eventRegistrations)
      .set({ status: guidance.status })
      .where(
        and(
          eq(schema.eventRegistrations.id, registration.id),
          eq(schema.eventRegistrations.tenantId, tenant.id),
        ),
      );
    await page.reload();

    await expect(
      registrationDetail.getByRole('status', {
        exact: true,
        name: 'Ticket status',
      }),
    ).toHaveText(guidance.label);
    const statusAlert = registrationDetail.getByRole('alert');
    await expect(statusAlert).toContainText(guidance.title);
    await expect(statusAlert).toContainText(guidance.body);
  }
});

test('platform cancellation preserves its confirmed outcome when detail readback fails @admin @globalAdmin', async ({
  database,
  page,
  registerDatabaseCleanup,
  seeded,
  tenant,
}) => {
  const { eventId, optionId } = seeded.scenario.events.freeOpen;
  const participant = usersToAuthenticate.find((user) => user.roles === 'user');
  const event = await database.query.eventInstances.findFirst({
    where: { id: eventId, tenantId: tenant.id },
    with: { registrationOptions: { where: { id: optionId } } },
  });
  const option = event?.registrationOptions[0];
  if (
    !participant ||
    !option ||
    option.isPaid ||
    option.price !== 0 ||
    option.stripeTaxRateId
  ) {
    throw new Error(
      'Expected an explicitly free option and the canonical participant',
    );
  }
  if (option.confirmedSpots + option.reservedSpots >= option.spots) {
    throw new Error('Expected a free place for the cancellation fixture');
  }
  const candidate = { id: getId() };
  const acquisitionId = getId();
  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .update(schema.eventRegistrationOptions)
      .set({ confirmedSpots: option.confirmedSpots })
      .where(
        and(
          eq(schema.eventRegistrationOptions.id, optionId),
          eq(schema.eventRegistrationOptions.eventId, eventId),
        ),
      );
  });
  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.id, candidate.id),
          eq(schema.eventRegistrations.tenantId, tenant.id),
        ),
      );
  });
  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupScannerRegistrationAcquisition({
      acquisitionId,
      database: cleanupDatabase,
    });
  });
  await database.transaction(async (transaction) => {
    const updated = await transaction
      .update(schema.eventRegistrationOptions)
      .set({ confirmedSpots: option.confirmedSpots + 1 })
      .where(
        and(
          eq(schema.eventRegistrationOptions.id, optionId),
          eq(schema.eventRegistrationOptions.eventId, eventId),
          eq(
            schema.eventRegistrationOptions.confirmedSpots,
            option.confirmedSpots,
          ),
          eq(
            schema.eventRegistrationOptions.reservedSpots,
            option.reservedSpots,
          ),
        ),
      )
      .returning({ id: schema.eventRegistrationOptions.id });
    if (updated.length !== 1)
      throw new Error('Cancellation fixture capacity changed');
    await transaction.insert(schema.eventRegistrations).values({
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      basePriceAtRegistration: 0,
      checkedInGuestCount: 0,
      discountAmount: 0,
      eventId,
      guestCount: 0,
      id: candidate.id,
      registrationOptionId: optionId,
      status: 'CONFIRMED',
      tenantId: tenant.id,
      userId: participant.id,
    });
  });
  await seedScannerRegistrationAcquisition({
    acquisitionId,
    database,
    eventId,
    registrationId: candidate.id,
    tenant,
  });
  await page.goto(`/global-admin/tenants/${tenant.id}/scanner/${candidate.id}`);
  const scanner = page.locator('app-platform-scanner');
  await expect(
    scanner.getByRole('heading', { name: 'Help with this ticket' }),
  ).toBeVisible();
  const reason = scanner.getByLabel('Reason for this action');
  await expect(reason).not.toHaveAttribute('jsaction', /input/, {
    timeout: 20_000,
  });
  await reason.fill('Cancel the duplicate free ticket');
  const cancel = scanner.getByRole('button', {
    name: 'Cancel ticket',
    exact: true,
  });
  await expect(cancel).not.toHaveAttribute('jsaction', /click/, {
    timeout: 20_000,
  });
  await cancel.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  let cancellationRequests = 0;
  await page.route('**/rpc/**', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('platform.registrations.cancel')) {
      cancellationRequests += 1;
    } else if (
      cancellationRequests > 0 &&
      body.includes('platform.registrations.findOne')
    ) {
      await route.abort('failed');
      return;
    }
    await route.fallback();
  });
  await dialog
    .getByRole('button', { name: 'Cancel ticket', exact: true })
    .click();
  await expect(
    page.getByText(
      'Cancellation confirmed. Current sign-up details could not be loaded. Reload the page before making another change.',
      { exact: true },
    ),
  ).toBeVisible({ timeout: 20_000 });
  expect(cancellationRequests).toBe(1);
  await expect
    .poll(
      async () =>
        (
          await database.query.eventRegistrations.findFirst({
            where: { id: candidate.id, tenantId: tenant.id },
          })
        )?.status,
    )
    .toBe('CANCELLED');
  const refunds = await database.query.transactions.findMany({
    where: {
      eventRegistrationId: candidate.id,
      tenantId: tenant.id,
      type: 'refund',
    },
  });
  expect(refunds).toEqual([]);
});

test('platform restores an original test Checkout and records its reason @admin @globalAdmin', async ({
  browser,
  database,
  page,
  registerDatabaseCleanup,
  seeded,
  testClock,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/global-admin');
  const scenario = await seedCheckoutRecoveryScenario({
    baseUrl: new URL(page.url()).origin,
    database,
    registerCleanup: registerDatabaseCleanup,
    seeded,
  });
  await page.getByRole('link', { name: 'Organizations', exact: true }).click();
  await page.getByLabel('Search organizations').fill(scenario.tenant.domain);
  await page
    .locator('app-tenant-list > div')
    .filter({ hasText: scenario.tenant.domain })
    .getByRole('link', { name: 'Review organization', exact: true })
    .click();
  await page.getByRole('link', { name: 'Review finance', exact: true }).click();
  await page
    .getByRole('tab', { name: 'Payments needing attention', exact: true })
    .click();
  const queue = page.getByRole('region', {
    name: 'Payments needing attention',
    exact: true,
  });
  await expect(
    queue.getByText(scenario.eventTitle, { exact: true }),
  ).toBeVisible();
  await queue
    .getByRole('button', { name: 'Review payment setup', exact: true })
    .click();
  const restore = queue.getByRole('button', {
    name: 'Restore existing payment',
    exact: true,
  });
  await expect(restore).toBeDisabled();
  await queue
    .getByLabel('Reason for restoring payment setup')
    .fill(scenario.reason);
  await expect(restore).toBeEnabled();
  for (const width of [1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await expect(restore).toBeVisible();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await restore.click();
  await expect(
    page.getByText(
      'Payment link restored. The attendee can return to the event to continue paying.',
      { exact: true },
    ),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    queue.getByRole('button', { name: 'Review payment setup', exact: true }),
  ).toHaveCount(0);
  const claims = await database.query.transactions.findMany({
    where: {
      eventRegistrationId: scenario.registrationId,
      tenantId: scenario.tenant.id,
    },
  });
  expect(claims).toEqual([
    expect.objectContaining({
      id: scenario.transactionId,
      status: 'pending',
      stripeCheckoutSessionId: scenario.sessionId,
      stripeCheckoutUrl: scenario.checkoutUrl,
      stripeCheckoutIncidentSessionId: null,
    }),
  ]);
  expect(
    await database.query.eventRegistrationOptions.findFirst({
      where: { id: scenario.optionId },
    }),
  ).toMatchObject({ reservedSpots: 1, confirmedSpots: 0 });
  expect(
    await database.query.emailOutbox.findMany({
      where: {
        idempotencyKey: `manual-approval/${scenario.tenant.id}/${scenario.registrationId}/${scenario.transactionId}`,
      },
    }),
  ).toHaveLength(1);
  const audits = await database.query.platformAuditEntries.findMany({
    where: { targetTenantId: scenario.tenant.id, reason: scenario.reason },
  });
  expect(audits).toEqual([
    expect.objectContaining({
      action: 'registration.recoverCheckout',
      before: expect.objectContaining({
        state: expect.objectContaining({
          incidentSessionId: scenario.sessionId,
        }),
      }),
    }),
  ]);
  const attendee = await openAuthenticatedTestPage({
    baseUrl: new URL(page.url()).origin,
    browser,
    storageState: userStateFile,
    tenantDomain: scenario.tenant.domain,
    testClock,
  });
  registerDatabaseCleanup(attendee.close);
  await attendee.page.goto('/');
  await attendee.page
    .locator(`a[href="/events/${scenario.eventId}"]`)
    .first()
    .click();
  await waitForRegistrationStatus(attendee.page);
  await expect(
    attendee.page.getByRole('link', { name: 'Pay now', exact: true }),
  ).toHaveAttribute('href', scenario.checkoutUrl);
  await expect(
    attendee.page.getByRole('button', {
      name: 'Apply for approval',
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto('/global-admin');
  await page.getByRole('link', { name: 'Evorto change history' }).click();
  const audit = page
    .getByRole('article')
    .filter({ has: page.getByText(scenario.reason, { exact: true }) });
  await expect(
    audit.getByRole('heading', { name: 'Payment setup restored', exact: true }),
  ).toBeVisible();
  await expect(audit).toContainText('Existing payment linked');
  await expect(audit).not.toContainText(scenario.sessionId);
  await expect(audit).not.toContainText(
    scenario.tenant.stripeAccountId ?? 'unexpected missing account',
  );
});
