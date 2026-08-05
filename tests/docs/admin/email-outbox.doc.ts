import type { Page } from '@playwright/test';

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

test('Review email delivery across organizations @admin @globalAdmin', async ({
  database,
  page,
  tenant,
}, testInfo) => {
  const scenario = await seedEmailOutboxScenario({ database, tenant });

  try {
    await page.goto('/global-admin');

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Who can use this page" %}
Only people who manage Evorto as a whole can use this page. The Admin role for one organization does not open it.
{% /callout %}


**Email delivery** shows recent messages for every organization. It tells you whether each message is waiting, being sent, could not be sent, was sent, could not be confirmed, or was not sent because the address cannot receive organization emails. The page does not show message contents or offer a resend action.
`,
    });

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Evorto administration',
      }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Email delivery' }).click();
    await expect(page).toHaveURL(/\/global-admin\/email-delivery$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Email delivery' }),
    ).toBeVisible();

    await expect(
      page.getByText('Waiting to send', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('Sending', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('Could not send', { exact: true }).first(),
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
    await expect(unknownRow).toContainText('Delivery not confirmed');
    await expect(unknownRow).toContainText(
      'Evorto could not confirm whether this email was delivered, so it will not send it again.',
    );
    await expect(sendingRow).toContainText('Sending');
    await expect(sendingRow).toContainText(
      'Evorto is sending this message. If delivery cannot be confirmed, it will not be sent again.',
    );
    await expect(failedRow).toContainText('Could not send');
    await expect(failedRow).toContainText('This email could not be sent.');
    await expect(
      page.getByRole('heading', { name: 'Some emails need attention' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: scenario.sent.subject }),
    ).toHaveCount(0);

    await takeScreenshot(
      testInfo,
      page.locator('app-email-outbox'),
      page,
      'Email totals for all organizations and messages needing attention',
    );

    await testInfo.attach('markdown', {
      body: `
## Read the overview before the delivery details

The six totals at the top count messages that are **Waiting to send**, **Sending**, **Could not send**, **Sent**, **Delivery not confirmed**, or **Not sent**. They cover every organization, not only the one you currently have open. The notice highlights messages that need attention.

The **Delivery details** list shows up to 100 recent messages:

- Messages marked **Could not send** or **Delivery not confirmed** appear before messages still waiting or being sent. Each group shows the newest messages first.
- Successfully **Sent** messages are included in the total but omitted from this list.
- When there is nothing to review, the list says **No email delivery details to show.**

Each row identifies the organization, recipient, purpose, and relevant times. Check the organization before following up because this page covers all organizations.

## Understand delivery status

- **Waiting to send** means Evorto has not tried the message yet and will try automatically.
- **Sending** means Evorto is sending the message.
- **Could not send** means sending failed and Evorto will not try again automatically.
- **Sent** means Evorto sent the message.
- **Delivery not confirmed** means Evorto could not confirm delivery and will not send the message again, avoiding a duplicate.
- **Not sent** means the address cannot receive organization emails.

There is currently no search or resend action on this page. **Check again** shows the latest information but does not send anything.
`,
    });

    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(outboxRow(page, scenario.unknown)).toContainText(
      'Delivery not confirmed',
    );

    await testInfo.attach('markdown', {
      body: `
## If you cannot open Email delivery

A signed-in member who does not manage Evorto as a whole sees **Access not allowed** when opening **Email delivery** directly. Being an Admin for one organization does not open this page for all organizations.

For **Could not send**, verify the address with the organization and contact the recipient another way; Evorto will not try again automatically. For **Delivery not confirmed**, do not immediately send a duplicate because the first message may have arrived. For either status, include the organization, recipient, purpose, and time when asking Evorto support for help. For **Sending**, wait briefly and select **Check again** once. If it still has not changed, contact Evorto support with the same details.
`,
    });
  } finally {
    await scenario.cleanup();
  }
});
