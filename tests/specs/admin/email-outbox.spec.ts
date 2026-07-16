import type { Page } from '@playwright/test';

import { gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  type EmailOutboxScenarioItem,
  seedEmailOutboxScenario,
} from '../../support/utils/email-outbox-scenario';

test.use({ storageState: gaStateFile });

const outboxRow = (page: Page, item: EmailOutboxScenarioItem) =>
  page
    .getByRole('heading', { name: 'Delivery details' })
    .locator('..')
    .locator(':scope > div')
    .filter({ has: page.getByRole('heading', { name: item.subject }) });

test('global admin reviews active Email Outbox delivery states and read-only history @admin @globalAdmin', async ({
  database,
  page,
  tenant,
}) => {
  const scenario = await seedEmailOutboxScenario({ database, tenant });

  try {
    await page.goto('/global-admin');
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
    await expect(queuedRow).toContainText('Manual approval');
    await expect(queuedRow).toContainText(scenario.queued.recipient);
    await expect(queuedRow).toContainText(`${tenant.name} (${tenant.domain})`);
    await expect(queuedRow).toContainText('0/8');
    await expect(queuedRow).toContainText('Not attempted');

    const retryRow = outboxRow(page, scenario.retry);
    await expect(retryRow).toContainText('Receipt reviewed');
    await expect(retryRow).toContainText('Queued');
    await expect(retryRow).toContainText('2/8');
    await expect(retryRow).toContainText('Temporary provider timeout');
    await expect(retryRow.getByText('Next attempt')).toBeVisible();

    const sendingRow = outboxRow(page, scenario.sending);
    await expect(sendingRow).toContainText('Sending');
    await expect(sendingRow).toContainText('1/8');
    await expect(sendingRow.getByText('Last attempt')).toBeVisible();

    const exhaustedRow = outboxRow(page, scenario.exhausted);
    await expect(exhaustedRow).toContainText('Failed');
    await expect(exhaustedRow).toContainText('8/8');
    await expect(exhaustedRow).toContainText('Recipient address was rejected');
    await expect(
      exhaustedRow.getByText('Retries ended', { exact: true }),
    ).toBeVisible();
    await expect(exhaustedRow).toContainText(
      'Automatic retries ended. Stored as read-only history.',
    );
    await expect(exhaustedRow.getByText('Next attempt')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Email delivery status' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Exhausted emails remain stored as read-only history. Automatic retries have ended; no recovery action is required.',
        { exact: true },
      ),
    ).toBeVisible();

    // Sent rows contribute to the summary but the operational list is fixed to
    // queued, sending, and failed deliveries.
    await expect(
      page.getByRole('heading', { name: scenario.sent.subject }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(outboxRow(page, scenario.retry)).toContainText(
      'Temporary provider timeout',
    );
  } finally {
    await scenario.cleanup();
  }
});
