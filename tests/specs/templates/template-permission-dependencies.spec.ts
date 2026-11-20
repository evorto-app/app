import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/permissions-test';

test.use({ storageState: adminStateFile });

const templateGrants = [
  'events:*',
  'events:create',
  'templates:*',
  'templates:create',
  'templates:delete',
  'templates:editAll',
  'templates:manageCategories',
  'templates:view',
] as const;

for (const permission of ['templates:create', 'templates:editAll'] as const) {
  test(`${permission} alone opens its template form with categories through implied viewing`, async ({
    page,
    permissionOverride,
    templateCategories,
    templates,
  }) => {
    const template = templates.find((entry) => entry.seedKey === 'city-tour');
    const category = templateCategories[0];
    if (!template || !category)
      throw new Error('Expected seeded template data.');
    await permissionOverride({
      add: [permission],
      remove: templateGrants.filter((grant) => grant !== permission),
      roleName: ['Admin', 'Section member'],
    });

    const path =
      permission === 'templates:create'
        ? `/templates/create/${category.id}`
        : `/templates/${template.id}/edit`;
    await page.goto(path);
    const editor = page.locator(
      permission === 'templates:create'
        ? 'app-template-create'
        : 'app-template-edit',
    );
    await expect(editor).not.toHaveAttribute('ngh', /.*/, { timeout: 20_000 });
    await expect(
      editor.getByRole('textbox', { name: 'Template title' }),
    ).toBeVisible();
    if (permission === 'templates:editAll') {
      await expect(
        editor.getByRole('textbox', { name: 'Template title' }),
      ).toHaveValue(template.title);
    }
    const categories = editor.getByRole('combobox', {
      name: 'Template Category',
    });
    if (permission === 'templates:create') {
      await expect(categories).toHaveText(category.title);
    }
    await expect(categories).not.toHaveAttribute('jsaction', /click/);
    await categories.click();
    await expect(
      page.getByRole('option', { name: category.title, exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto('/templates/categories');
    await expect(
      page
        .locator('app-category-list')
        .getByText(category.title, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create category', exact: true }),
    ).toHaveCount(0);
  });
}

test('category management alone loads its category table without granting template creation or editing', async ({
  page,
  permissionOverride,
  templateCategories,
  templates,
}) => {
  const template = templates.find((entry) => entry.seedKey === 'city-tour');
  const category = templateCategories[0];
  if (!template || !category) throw new Error('Expected seeded template data.');
  await permissionOverride({
    add: ['templates:manageCategories'],
    remove: templateGrants.filter(
      (grant) => grant !== 'templates:manageCategories',
    ),
    roleName: ['Admin', 'Section member'],
  });

  await page.goto('/templates/categories');
  await expect(
    page
      .locator('app-category-list')
      .getByText(category.title, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create category', exact: true }),
  ).toBeEnabled();

  await page.goto('/templates/create');
  await expect(page).toHaveURL(/\/403/);
  await page.goto(`/templates/${template.id}/edit`);
  await expect(page).toHaveURL(/\/403/);
});
