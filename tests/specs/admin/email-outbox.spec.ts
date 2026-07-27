import type { Locator, Page } from '@playwright/test';

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

const outboxAttempts = (row: Locator) =>
  row.getByText('Attempts', { exact: true }).locator('..').locator('dd');

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

    const unknownRow = outboxRow(page, scenario.unknown);
    await expect(unknownRow).toContainText('Receipt reviewed');
    await expect(unknownRow).toContainText('Delivery unknown');
    await expect(outboxAttempts(unknownRow)).toHaveText('1');
    await expect(unknownRow).toContainText(
      'Provider accepted the request but its response was lost',
    );
    await expect(unknownRow.getByText('Next attempt')).toHaveCount(0);

    const sendingRow = outboxRow(page, scenario.sending);
    await expect(sendingRow).toContainText('Sending');
    await expect(outboxAttempts(sendingRow)).toHaveText('1');
    await expect(sendingRow.getByText('Last attempt')).toBeVisible();

    const failedRow = outboxRow(page, scenario.failed);
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

    // Sent rows contribute to the summary but the operational list is fixed to
    // queued, sending, failed, unknown, and suppressed deliveries.
    await expect(
      page.getByRole('heading', { name: scenario.sent.subject }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(outboxRow(page, scenario.unknown)).toContainText(
      'Provider accepted the request but its response was lost',
    );
  } finally {
    await scenario.cleanup();
  }
});
