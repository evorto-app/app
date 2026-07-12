import type { Page } from '@playwright/test';

import { gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import {
  type EmailOutboxScenarioItem,
  seedEmailOutboxScenario,
} from '../../support/utils/email-outbox-scenario';

test.use({ storageState: gaStateFile });

const outboxRow = (page: Page, item: EmailOutboxScenarioItem) =>
  page
    .getByRole('heading', { name: 'Rows needing delivery' })
    .locator('..')
    .locator(':scope > div')
    .filter({ has: page.getByRole('heading', { name: item.subject }) });

test('Review global email delivery health @admin @globalAdmin', async ({
  database,
  page,
  tenant,
}, testInfo) => {
  const scenario = await seedEmailOutboxScenario({ database, tenant });

  try {
    await page.goto('/global-admin');

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Platform authority" %}
This guide uses a signed-in platform administrator whose authority comes from verified Auth0 app metadata. Tenant roles, including a tenant's ordinary Admin role, do not grant access to this cross-tenant page.
{% /callout %}

# Review Global Email Delivery Health

The **Email outbox** is an operational overview across every tenant. Use it to understand whether Evorto has queued an email, is currently delivering it, will retry it, or has exhausted delivery attempts. The page does not expose message bodies or a manual retry control.
`,
    });

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Platform administration',
      }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Email outbox' }).click();
    await expect(page).toHaveURL(/\/global-admin\/email-outbox$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Email outbox' }),
    ).toBeVisible();

    await expect(
      page.getByText('Queued', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('Sending', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('Failed', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible();
    await expect(
      page
        .getByText('Sent', { exact: true })
        .first()
        .locator('..')
        .locator('.headline-small'),
    ).toHaveText(/^[1-9]\d*$/);

    const queuedRow = outboxRow(page, scenario.queued);
    const retryRow = outboxRow(page, scenario.retry);
    const sendingRow = outboxRow(page, scenario.sending);
    const exhaustedRow = outboxRow(page, scenario.exhausted);
    await expect(queuedRow).toContainText('Queued');
    await expect(queuedRow).toContainText('0/8');
    await expect(queuedRow).toContainText('Not attempted');
    await expect(retryRow).toContainText('Queued');
    await expect(retryRow).toContainText('2/8');
    await expect(retryRow).toContainText('Temporary provider timeout');
    await expect(sendingRow).toContainText('Sending');
    await expect(sendingRow).toContainText('1/8');
    await expect(exhaustedRow).toContainText('Failed');
    await expect(exhaustedRow).toContainText('8/8');
    await expect(exhaustedRow).toContainText('Recipient address was rejected');
    await expect(
      exhaustedRow.getByText('Exhausted', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Email delivery needs attention' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: scenario.sent.subject }),
    ).toHaveCount(0);

    await takeScreenshot(
      testInfo,
      page.locator('app-email-outbox'),
      page,
      'Global email outbox recovery states',
    );

    await testInfo.attach('markdown', {
      body: `
## Read the overview before the rows

The four totals at the top count **Queued**, **Sending**, **Failed**, and **Sent** emails globally. They are not limited to your current tenant. The attention banner summarizes exhausted failures and delivery claims that have been stuck in sending.

The **Rows needing delivery** list is a fixed operational filter, not an interactive search:

- It shows the 100 most recently updated **queued**, **sending**, and **failed** rows.
- It omits successfully **sent** rows even though the Sent total still includes them. The generated journey proves this by seeding a sent row, observing the Sent summary, and asserting that the sent subject is absent from the list.
- When there are no active rows, the list says **No queued, sending, or failed email rows.**

Each active row identifies the tenant name and primary domain, recipient, email kind, attempt count, next attempt, last attempt, and last provider error when one exists. Use those tenant fields before contacting a section: this is a cross-tenant surface.

## Interpret recovery states

- **Queued, 0/8, Not attempted** means Evorto has stored the message durably and has not tried the provider yet.
- **Queued** with a prior attempt and a **Last error** means an automatic retry is scheduled for **Next attempt**. Wait until that time, then use **Refresh** to read the latest state.
- **Sending** means a worker owns a time-limited delivery claim. If a process stops, Evorto can reclaim the row after that claim lease expires; do not infer that the email is permanently stuck from a brief Sending state.
- **Failed**, attempts equal to the maximum, and an **Exhausted** timestamp means automatic retries have stopped. Record the tenant, recipient, and last error for incident investigation. The row intentionally remains stored and read-only; the current product does not requeue or edit exhausted email.

There is currently no tenant/status search control and no manual retry button on this page. **Refresh** only reloads the overview; it does not send or requeue an email.
`,
    });

    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(outboxRow(page, scenario.retry)).toContainText(
      'Temporary provider timeout',
    );

    await testInfo.attach('markdown', {
      body: `
## Access denial and safe follow-up

A signed-in user without platform administrator authority is redirected to the forbidden page when opening \`/global-admin/email-outbox\` directly. Do not grant a broad tenant role as a workaround; platform access is separate.

For an exhausted row, capture the tenant, recipient, attempt count, and last error as durable evidence while investigating the underlying provider or data problem. Do not expect a recovery action on this page. For a queued retry or an active Sending row, prefer a later Refresh so the automatic processor can settle it before manual intervention.
`,
    });
  } finally {
    await scenario.cleanup();
  }
});
