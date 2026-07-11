import type { Page } from '@playwright/test';

import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/axe-test';

test.setTimeout(120_000);
test.use({ storageState: adminStateFile });

const failRpcOnce = async (page: Page, rpcName: string) => {
  let failureCount = 0;

  await page.route('**/rpc/**', async (route) => {
    const request = route.request();
    const requestBody = request.postData() ?? '';
    if (
      failureCount === 0 &&
      request.method() === 'POST' &&
      requestBody.includes(rpcName)
    ) {
      failureCount += 1;
      await route.abort('failed');
      return;
    }

    await route.fallback();
  });

  return () => failureCount;
};

const navigateClientSide = async (page: Page, path: string) => {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, '', nextPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await expect(page).toHaveURL(path);
};

test('tenant user list explains a first-load failure and recovers on retry @admin @resilience', async ({
  page,
}) => {
  await page.goto('/admin', { waitUntil: 'networkidle' });
  const failureCount = await failRpcOnce(page, 'users.findMany');

  await page.getByRole('link', { exact: true, name: 'Users' }).click();
  await expect.poll(failureCount).toBe(1);

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Users could not be loaded');
  await expect(alert).toContainText(
    'The user list is unavailable. Check your connection and try again.',
  );
  await alert.getByRole('button', { name: 'Try again' }).click();

  await expect(alert).toHaveCount(0);
  await expect(page.getByRole('table')).toBeVisible();
});

test('transaction history explains a first-load failure and recovers on retry @finance @resilience', async ({
  page,
}) => {
  await page.goto('/finance', { waitUntil: 'networkidle' });
  const failureCount = await failRpcOnce(page, 'finance.transactions.findMany');

  await page.getByRole('link', { exact: true, name: 'Transactions' }).click();
  await expect.poll(failureCount).toBe(1);

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Transactions could not be loaded');
  await expect(alert).toContainText(
    'The transaction history is unavailable. Check your connection and try again.',
  );
  await alert.getByRole('button', { name: 'Try again' }).click();

  await expect(alert).toHaveCount(0);
  await expect(page.getByRole('table')).toBeVisible();
});

test('template event creation explains a first-load failure and recovers on retry @templates @resilience', async ({
  page,
  templates,
}) => {
  const template = templates[0];
  if (!template) {
    throw new Error('Expected a seeded template for load-recovery coverage');
  }

  await page.goto('/templates', { waitUntil: 'networkidle' });
  const failureCount = await failRpcOnce(page, 'templates.findOne');

  const createEventPath = `/templates/${template.id}/create-event`;
  await navigateClientSide(page, createEventPath);
  await expect.poll(failureCount).toBe(1);

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Template could not be loaded');
  await expect(alert).toContainText(
    'The event form cannot be prepared until the selected template is available.',
  );
  await alert.getByRole('button', { name: 'Try again' }).click();

  await expect(alert).toHaveCount(0);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: `Create ${template.title} event`,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Event title')).toHaveValue(template.title);
});

test('organizer overview never presents failed participant data as zero and recovers on retry @events @resilience', async ({
  events,
  makeAxeBuilder,
  page,
  seeded,
}) => {
  const event = events.find(
    (candidate) => candidate.id === seeded.scenario.events.freeOpen.eventId,
  );
  if (!event) {
    throw new Error(
      'Expected the seeded free event for organizer load-recovery coverage',
    );
  }

  await page.goto('/events', { waitUntil: 'networkidle' });
  const failureCount = await failRpcOnce(page, 'events.getOrganizeOverview');

  await navigateClientSide(page, `/events/${event.id}/organize`);
  await expect.poll(failureCount).toBe(1);

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Participant data could not be loaded');
  await expect(alert).toContainText(
    'Do not treat the missing counts as zero or as current event data.',
  );
  await expect(page.getByText('Registered', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Cancel registration' }),
  ).toHaveCount(0);

  const backLink = page.getByRole('link', { name: 'Back to event' });
  await expect(backLink).toBeVisible();
  const failedStateAccessibilityScan = await makeAxeBuilder()
    .include('app-event-organize')
    .analyze();
  expect(failedStateAccessibilityScan.violations).toEqual([]);

  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(alert).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Registered', { exact: true })).toBeVisible();

  await backLink.focus();
  await expect(backLink).toBeFocused();
  await backLink.press('Enter');
  await expect(page).toHaveURL(`/events/${event.id}`);
});
