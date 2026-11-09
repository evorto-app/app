import { gaStateFile, userStateFile } from '../../../helpers/user-data';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  seedCheckoutRecoveryScenario,
  waitForRegistrationStatus,
} from '../../support/utils/manual-approval-scenario';

test.use({ storageState: gaStateFile });

test('platform administration links to ordinary organization pages and retains only payment support @admin @globalAdmin', async ({
  page,
  tenant,
}) => {
  await page.goto(`/global-admin/tenants/${tenant.id}`);
  await expect(
    page.getByRole('link', { name: 'Open organization', exact: true }),
  ).toHaveAttribute('href', '/');
  await page
    .getByRole('link', { name: 'Payment support', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Payment support', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('tab')).toHaveText([
    'Refunds needing attention',
    'Payments needing attention',
  ]);
  await expect(
    page.getByText('No refunds currently need attention.'),
  ).toBeVisible();
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
  await page
    .getByRole('link', { name: 'Payment support', exact: true })
    .click();
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
      name: 'Apply',
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
