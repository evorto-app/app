import { eq } from 'drizzle-orm';
import { getId } from '../../../helpers/get-id';
import { organizerStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: organizerStateFile });
test.setTimeout(60_000);
test('members view resources; an explicit manager can maintain ordered links without overwriting another editor', async ({
  page,
  database,
  tenant,
  permissionOverride,
  registerDatabaseCleanup,
}) => {
  const decoyId = getId();
  const decoyResources = [
    {
      label: 'Other section private resources',
      href: 'https://example.org/other',
      icon: { iconName: 'link', iconColor: 0 },
    },
  ];
  await database.insert(schema.tenants).values({
    id: decoyId,
    domain: `hub-decoy-${decoyId}.example.org`,
    name: 'Other section',
    hubResources: decoyResources,
  });
  registerDatabaseCleanup(async (cleanup) => {
    await cleanup.delete(schema.tenants).where(eq(schema.tenants.id, decoyId));
  });
  const original = [
    {
      label: 'Shared documents',
      href: 'https://drive.google.com/',
      icon: { iconName: 'folder', iconColor: 0 },
    },
  ];
  await database
    .update(schema.tenants)
    .set({ hubResources: original })
    .where(eq(schema.tenants.id, tenant.id));
  await page.goto('/internal/members-hub');
  await expect(
    page.getByRole('link', { name: 'Shared documents', exact: true }),
  ).toHaveAttribute('href', 'https://drive.google.com/');
  await expect(
    page.getByRole('link', {
      name: 'Other section private resources',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Manage resources', exact: true }),
  ).toHaveCount(0);
  await permissionOverride({
    roleName: 'Section member',
    add: ['internal:manageResources'],
  });
  await page.reload();
  const manage = page.getByRole('button', {
    name: 'Manage resources',
    exact: true,
  });
  await expect(manage).not.toHaveAttribute('jsaction', /click/);
  await manage.click();
  await page.getByRole('button', { name: 'Add resource', exact: true }).click();
  const first = page.getByRole('group', { name: 'Resource 1', exact: true });
  const second = page.getByRole('group', { name: 'Resource 2', exact: true });
  await second.getByLabel('Name', { exact: true }).fill('Section calendar');
  await second
    .getByLabel('Web or email address', { exact: true })
    .fill('javascript:alert(1)');
  await second.getByLabel('Name', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Save resources', exact: true }),
  ).toBeDisabled();
  await second
    .getByLabel('Web or email address', { exact: true })
    .fill('https://calendar.google.com/');
  await second
    .getByRole('button', { name: 'Change Icon', exact: true })
    .click();
  const picker = page.getByRole('dialog', {
    name: 'Choose an icon',
    exact: true,
  });
  await picker
    .getByRole('textbox', { name: 'Search', exact: true })
    .fill('mountain');
  await picker
    .getByRole('button', { name: 'Select Mountain icon', exact: true })
    .click();
  await second
    .getByRole('button', { name: 'Move resource 2 up', exact: true })
    .click();
  await expect(first.getByLabel('Name', { exact: true })).toHaveValue(
    'Section calendar',
  );
  await page
    .getByRole('button', { name: 'Save resources', exact: true })
    .click();
  await expect(manage).toBeVisible();
  await page.reload();
  const resources = page.getByRole('region', {
    name: 'Resources',
    exact: true,
  });
  await expect(
    resources
      .getByRole('link', { name: 'Section calendar', exact: true })
      .locator('img'),
  ).toHaveAttribute('src', /mountain\.png/);
  await expect(resources.getByRole('link')).toHaveText([
    'Section calendar',
    'Shared documents',
  ]);
  await expect(manage).not.toHaveAttribute('jsaction', /click/);
  await manage.click();
  await expect(first).toBeVisible();
  await first.getByLabel('Name', { exact: true }).fill('My draft');
  const concurrent = [
    {
      label: 'Updated by someone else',
      href: 'https://example.org/',
      icon: { iconName: 'document', iconColor: 0 },
    },
  ];
  await database
    .update(schema.tenants)
    .set({ hubResources: concurrent })
    .where(eq(schema.tenants.id, tenant.id));
  await page
    .getByRole('button', { name: 'Save resources', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Someone else changed the resources',
  );
  await expect(first.getByLabel('Name', { exact: true })).toHaveValue(
    'My draft',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    resources.getByRole('link', {
      name: 'Updated by someone else',
      exact: true,
    }),
  ).toBeVisible();
  await manage.click();
  await page
    .getByRole('button', { name: 'Remove resource 1', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Save resources', exact: true })
    .click();
  await expect(manage).toBeVisible();
  await expect(resources.getByRole('link')).toHaveCount(0);
  const saved = await database.query.tenants.findFirst({
    where: { id: tenant.id },
  });
  expect(saved?.hubResources).toEqual([]);
  const decoy = await database.query.tenants.findFirst({
    where: { id: decoyId },
  });
  expect(decoy?.hubResources).toEqual(decoyResources);
});
