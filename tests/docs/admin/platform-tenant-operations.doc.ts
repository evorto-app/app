import { gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { seedCheckoutRecoveryScenario } from '../../support/utils/manual-approval-scenario';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: gaStateFile });
test('Open an organization and recover a held payment', async ({
  database,
  page,
  registerDatabaseCleanup,
  seeded,
  tenant,
}, testInfo) => {
  await page.goto(`/global-admin/tenants/${tenant.id}`);
  await expect(
    page.getByRole('link', { name: 'Open organization', exact: true }),
  ).toHaveAttribute('href', '/');
  await testInfo.attach('markdown', {
    body: `
## Open the organization's own pages

From **Evorto administration** → **Organizations**, choose **Review organization** and then **Open organization**. Manage its events, templates, members, roles, tax rates, and routine finance on that website. Evorto administrators retain full access there without joining the organization or assigning themselves a role.

**Edit organization** remains available for platform configuration. **Payment support** contains only payment setup and refund recovery; every recovery action requires a reason and is recorded in change history.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-tenant-detail'),
    page,
    'Open the organization or review payment support',
  );
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
  await queue
    .getByRole('button', { name: 'Review payment setup', exact: true })
    .click();
  await queue
    .getByLabel('Reason for restoring payment setup')
    .fill(scenario.reason);
  await testInfo.attach('markdown', {
    body: `
## Find the held sign-up

An Evorto administrator can open **Organizations**, find the organization by its website address, and choose **Review organization** → **Payment support** → **Payments needing attention**. These sign-ups still hold their places because Evorto could not confirm payment setup. Choose **Review payment setup**, check the attendee, event and amount, and enter a precise reason.

This action checks the original payment page. It never creates a second page or charges the attendee. It supports ordinary and organizer-approved sign-ups; separate add-on purchases and ticket transfers require investigation. If no unique matching page can be verified, the reservation stays held. If the payment could not be checked, the sign-up has changed, or the search could not finish, this does not prove that no payment exists.
`,
  });
  await takeScreenshot(
    testInfo,
    queue,
    page,
    'Review the held sign-up and explain why its payment should be restored',
  );
  await queue
    .getByRole('button', { name: 'Restore existing payment', exact: true })
    .click();
  await expect(
    page.getByText(
      'Payment link restored. The attendee can return to the event to continue paying.',
      { exact: true },
    ),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    queue.getByRole('button', { name: 'Review payment setup', exact: true }),
  ).toHaveCount(0);
  expect(
    await database.query.transactions.findFirst({
      where: { id: scenario.transactionId, tenantId: scenario.tenant.id },
    }),
  ).toMatchObject({
    stripeCheckoutSessionId: scenario.sessionId,
    stripeCheckoutUrl: scenario.checkoutUrl,
    status: 'pending',
  });
  await testInfo.attach('markdown', {
    body: `
## Confirm what was restored

For an open page, Evorto confirms that the payment link was restored. The attendee can return to the event and continue paying; the place remains reserved until payment finishes. If the original page has already completed or expired, Evorto instead checks whether the sign-up should be confirmed or ended.

For an organizer-approved sign-up, a missing approval notification is recorded with the restored link. An existing notification is not sent again. If the action succeeded but the latest finance information cannot be loaded, keep the recorded result and reload. If the response was lost, check the latest information before another action.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-finance'),
    page,
    'Confirm the original payment was restored',
  );
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
  await testInfo.attach('markdown', {
    body: `
## Verify the reason in change history

Return to **Evorto administration** → **Evorto change history**. Find the recorded reason, check the organization, and confirm **Payment setup restored**. The visible history summarizes the change without showing private payment identifiers.
`,
  });
  await takeScreenshot(
    testInfo,
    audit,
    page,
    'Verify the organization and reason for restoring payment setup',
  );
});
