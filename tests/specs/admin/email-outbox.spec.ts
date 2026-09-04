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
  registerDatabaseCleanup,
  tenant,
}) => {
  const scenario = await seedEmailOutboxScenario({ database, tenant });
  registerDatabaseCleanup(scenario.cleanup);

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
    page.getByText('Delivery not confirmed', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText('Not sent', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByText('Sent', { exact: true })
      .first()
      .locator('..')
      .locator('.headline-small'),
  ).toHaveText(/^[1-9]\d*$/);

  const unknownRow = outboxRow(page, scenario.unknown);
  await expect(unknownRow).toContainText('Receipt reviewed');
  await expect(unknownRow).toContainText(scenario.unknown.recipient);
  await expect(unknownRow).toContainText(`${tenant.name} (${tenant.domain})`);
  await expect(unknownRow).toContainText('Delivery not confirmed');
  await expect(unknownRow.getByText('Send attempts')).toHaveCount(0);
  await expect(unknownRow).toContainText(
    'Evorto could not confirm whether this email was delivered, so it will not send it again.',
  );
  await expect(unknownRow).not.toContainText(
    'Provider accepted the request but its response was lost',
  );
  await expect(unknownRow.getByText('tem', { exact: true })).toHaveCount(0);
  await expect(unknownRow.getByText('Next attempt')).toHaveCount(0);

  const sendingRow = outboxRow(page, scenario.sending);
  await expect(sendingRow).toContainText('Sending');
  await expect(sendingRow.getByText('Send attempts')).toHaveCount(0);
  await expect(sendingRow).toContainText(
    'Evorto is sending this message. If delivery cannot be confirmed, it will not be sent again.',
  );
  await expect(sendingRow.getByText('Last tried')).toBeVisible();

  const failedRow = outboxRow(page, scenario.failed);
  await expect(failedRow).toContainText('Could not send');
  await expect(failedRow.getByText('Send attempts')).toHaveCount(0);
  await expect(failedRow).toContainText('This email could not be sent.');
  await expect(failedRow).not.toContainText('Recipient address was rejected');
  await expect(failedRow.getByText('Next attempt')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Some emails need attention' }),
  ).toBeVisible();

  const sentRow = outboxRow(page, scenario.sent);
  await expect(sentRow).toBeVisible();
  await expect(sentRow.getByText('Sent', { exact: true })).toBeVisible();
  await expect(sentRow).toContainText('Evorto sent this message.');

  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(outboxRow(page, scenario.unknown)).toContainText(
    'Delivery not confirmed',
  );
});
