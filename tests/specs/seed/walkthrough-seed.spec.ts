import { addWalkthroughEvents } from '../../../helpers/add-walkthrough-events';
import { userStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: userStateFile });

test('walkthrough fixtures expose ready sign-ups and actionable tickets without fabricated paid transactions', async ({
  database,
  page,
  seedDate,
  tenant,
}) => {
  const scenarios = await addWalkthroughEvents(database, {
    tenantId: tenant.id,
    seedDate,
    includeRegistrations: true,
    currency: tenant.currency,
  });
  await expect(
    database.query.transactions.findMany({
      where: { tenantId: tenant.id, type: 'registration' },
    }),
  ).resolves.toHaveLength(0);
  const opening = scenarios['opensTomorrow'];
  const open = scenarios['open'];
  const ticket = scenarios['ticket'];
  if (!opening || !open || !ticket)
    throw new Error('Expected walkthrough handles');
  await page.goto(`/events/${opening.eventId}`);
  await expect(page.getByText(/Sign-up opens in/).first()).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Event list' })
      .getByRole('link', { name: /Meet your section/ }),
  ).toBeVisible();
  await page.goto(`/events/${open.eventId}`);
  await expect(page.getByLabel('Any dietary requirements?')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Welcome pack', exact: true }),
  ).toBeVisible();
  await page.goto(`/events/${ticket.eventId}`);
  const createTransfer = page.getByRole('button', {
    name: 'Create transfer link',
    exact: true,
  });
  await expect(createTransfer).toBeEnabled();
  await expect(createTransfer).not.toHaveAttribute('jsaction', /click/);
  await createTransfer.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Transfer code')).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Show transfer code', exact: true }),
  ).toBeVisible();
});
