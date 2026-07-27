import type { Locator, Page } from '@playwright/test';

import { gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import {
  type EmailOutboxScenarioItem,
  seedEmailOutboxScenario,
} from '../../support/utils/email-outbox-scenario';

test.use({ storageState: gaStateFile });

// Parallel documentation runs can spend most of the default project timeout in
// tenant seeding before Playwright creates this page. Keep the release gate
// deterministic on slower local Docker runtimes.
test.setTimeout(120_000);

const outboxRow = (page: Page, item: EmailOutboxScenarioItem) =>
  page
    .getByRole('heading', { name: 'Delivery details' })
    .locator('..')
    .locator(':scope > div')
    .filter({ has: page.getByRole('heading', { name: item.subject }) });

const outboxAttempts = (row: Locator) =>
  row.getByText('Attempts', { exact: true }).locator('..').locator('dd');

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
You must be signed in as a platform administrator. Organization roles, including an organization's ordinary Admin role, do not grant access to this cross-organization page.
{% /callout %}

# Review Global Email Delivery Health

The **Email outbox** is an operational overview across every organization. Each queued email gets one provider request. An explicit provider rejection becomes **Failed**; a timeout, lost response, or abandoned sending claim becomes **Delivery unknown** and is never resent automatically. The page does not expose message bodies or a retry control.
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

    const unknownRow = outboxRow(page, scenario.unknown);
    const sendingRow = outboxRow(page, scenario.sending);
    const failedRow = outboxRow(page, scenario.failed);
    await expect(unknownRow).toContainText('Delivery unknown');
    await expect(outboxAttempts(unknownRow)).toHaveText('1');
    await expect(unknownRow).toContainText(
      'Provider accepted the request but its response was lost',
    );
    await expect(sendingRow).toContainText('Sending');
    await expect(sendingRow).toContainText(
      'Delivery attempt recorded. It will settle once or become unknown; it will not be resent.',
    );
    await expect(failedRow).toContainText('Failed');
    await expect(outboxAttempts(failedRow)).toHaveText('1');
    await expect(failedRow).toContainText('Recipient address was rejected');
    await expect(failedRow).toContainText(
      'Rejected before provider acceptance. Stored as terminal operational evidence.',
    );
    await expect(failedRow.getByText('Next attempt')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Email delivery status' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Failed emails were explicitly rejected before acceptance. They remain stored as terminal operational evidence.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: scenario.sent.subject }),
    ).toHaveCount(0);

    await takeScreenshot(
      testInfo,
      page.locator('app-email-outbox'),
      page,
      'Global email outbox delivery states',
    );

    await testInfo.attach('markdown', {
      body: `
## Read the overview before the delivery details

The six totals at the top count **Queued**, **Sending**, **Failed**, **Sent**, **Unknown**, and **Suppressed** emails globally. They are not limited to your current organization. The **Email delivery status** banner calls out explicit rejections, unknown outcomes, and abandoned **Sending** claims.

The **Delivery details** list is a bounded operational view, not an interactive search:

- It shows up to 100 **queued**, **sending**, **failed**, **delivery unknown**, and **suppressed** rows.
- It puts **failed**, **delivery unknown**, and abandoned **sending** incidents before routine traffic, so newer routine rows cannot displace older incidents. Each group shows its newest rows first.
- It omits successfully **sent** rows even though the Sent total still includes them.
- When there are no active rows, the list says **No unresolved email delivery records.**

Each row identifies the organization name and primary address, recipient, email kind, attempt count, last attempt, and last delivery error when one exists. Check the organization before contacting its team: this is a cross-organization surface.

## Interpret delivery states

- **Sending** means one delivery attempt was recorded but no terminal outcome is stored yet. Do not infer that the email is permanently stuck from a brief **Sending** state; refresh later to check whether it settled once or became unknown. It is never resent.
- **Failed** means the provider explicitly rejected the request before accepting it.
- **Delivery unknown** means Evorto cannot prove whether the provider accepted the email. It remains terminal and is not resent, preventing duplicate customer messages.

There is currently no organization/status search control and no manual retry button on this page. **Refresh** only reloads the overview; it does not send or requeue an email.
`,
    });

    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(outboxRow(page, scenario.unknown)).toContainText(
      'Provider accepted the request but its response was lost',
    );

    await testInfo.attach('markdown', {
      body: `
## Access denial and safe follow-up

A signed-in user without platform administrator authority is redirected to the forbidden page when opening **Email outbox** directly. Do not grant a broad organization role as a workaround; platform access is separate.

For a **Failed** or **Delivery unknown** row, capture the organization, recipient, attempt count, and last error while investigating. Do not expect a recovery action on this page. For an active **Sending** row, refresh later so its single provider request can settle or become unknown.
`,
    });
  } finally {
    await scenario.cleanup();
  }
});
