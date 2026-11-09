import { adminStateFile, organizerStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/permissions-test';

test.setTimeout(120_000);

test.use({ storageState: adminStateFile });

test('template pages present a deliberate read-only experience without write capabilities @permissions', async ({
  isMobile,
  page,
  permissionOverride,
  templates,
}) => {
  const template = templates[0];
  if (!template) {
    throw new Error('Expected a seeded template for permission coverage');
  }

  await permissionOverride({
    add: ['templates:view'],
    remove: [
      'events:create',
      'templates:create',
      'templates:editAll',
      'templates:manageCategories',
    ],
    roleName: ['Admin', 'Section member'],
  });

  await page.goto('/templates');
  await expect(
    page.getByRole('heading', { name: 'Event templates' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create template' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('link', { name: 'Manage categories' }),
  ).toHaveCount(0);

  if (isMobile) {
    await page.getByRole('button', { name: /menu/i }).click();
    await page.getByRole('menuitem', { name: 'View categories' }).click();
  } else {
    await page.getByRole('link', { name: 'View categories' }).click();
  }

  await expect(page).toHaveURL(/\/templates\/categories/);
  await expect(
    page.getByRole('status').filter({
      hasText:
        'You can view template categories. Ask an administrator if you need to create or edit them.',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create category' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Actions' })).toHaveCount(
    0,
  );

  await page.goto(`/templates/${template.id}`);
  const details = page.locator('app-template-details');
  await expect(
    details.getByRole('heading', { name: template.title }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    details.getByRole('button', { name: 'Edit template' }),
  ).toHaveCount(0);
  await expect(details.getByRole('button', { name: /menu/i })).toHaveCount(0);
  await expect(details.getByRole('link', { name: 'Create event' })).toHaveCount(
    0,
  );
});

test.describe('section member defaults', () => {
  test.use({ storageState: organizerStateFile });

  test('can create events from templates but cannot create or edit templates by default @permissions', async ({
    page,
    templates,
  }) => {
    const template = templates[0];
    if (!template) throw new Error('Expected a seeded template');
    await page.goto('/templates');
    await expect(
      page.getByRole('link', { name: 'Create template', exact: true }),
    ).toHaveCount(0);
    await page.goto(`/templates/${template.id}`);
    const details = page.locator('app-template-details');
    await expect(
      details.getByRole('heading', {
        name: template.title,
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await expect(
      details.getByRole('button', { name: 'Edit template', exact: true }),
    ).toHaveCount(0);
    await expect(
      details.getByRole('link', { name: 'Edit template', exact: true }),
    ).toHaveCount(0);
    const createEvent = details.getByRole('link', {
      name: 'Create event',
      exact: true,
    });
    await expect(createEvent).toBeVisible();
    await expect(createEvent).not.toHaveAttribute('jsaction', /click/);
    await createEvent.click();
    await expect(
      page.getByRole('heading', {
        name: `Create ${template.title} event`,
        exact: true,
      }),
    ).toBeVisible();
    await page.goto('/templates/create');
    await expect(page).toHaveURL(/\/403/);
    await page.goto(`/templates/${template.id}/edit`);
    await expect(page).toHaveURL(/\/403/);
  });
});
