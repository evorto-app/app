import type { Page } from '@playwright/test';

import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);
test.use({ storageState: adminStateFile });

const failRpcOnce = async (page: Page, rpcName: string) => {
  let failureCount = 0;

  await page.route('**/rpc', async (route) => {
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
  await page.goto('/admin');
  const failureCount = await failRpcOnce(page, 'users.findMany');

  await page.getByRole('link', { exact: true, name: 'Users' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Users could not be loaded');
  await expect(alert).toContainText(
    'The user list is unavailable. Check your connection and try again.',
  );
  expect(failureCount()).toBe(1);

  await alert.getByRole('button', { name: 'Try again' }).click();

  await expect(alert).toHaveCount(0);
  await expect(page.getByRole('table')).toBeVisible();
});

test('transaction history explains a first-load failure and recovers on retry @finance @resilience', async ({
  page,
}) => {
  await page.goto('/finance');
  const failureCount = await failRpcOnce(page, 'finance.transactions.findMany');

  await page.getByRole('link', { exact: true, name: 'Transactions' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Transactions could not be loaded');
  await expect(alert).toContainText(
    'The transaction history is unavailable. Check your connection and try again.',
  );
  expect(failureCount()).toBe(1);

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

  await page.goto('/templates');
  const failureCount = await failRpcOnce(page, 'templates.findOne');

  const createEventPath = `/templates/${template.id}/create-event`;
  await navigateClientSide(page, createEventPath);

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Template could not be loaded');
  await expect(alert).toContainText(
    'The event form cannot be prepared until the selected template is available.',
  );
  expect(failureCount()).toBe(1);

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
