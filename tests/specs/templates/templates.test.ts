import { organizerStateFile } from '../../../helpers/user-data';
import { getId } from '../../../helpers/get-id';
import { expect, test } from '../../support/fixtures/parallel-test';
import { fillTemplateBasics } from '../../support/utils/template-form';
import * as schema from '../../../src/db/schema';

test.setTimeout(120000);

test.use({ storageState: organizerStateFile });

test('create template in empty category', async ({
  database,
  page,
  permissionOverride,
  tenant,
}) => {
  await permissionOverride({
    add: ['templates:create'],
    roleName: 'Section member',
  });
  const icon = await database.query.icons.findFirst({
    where: { tenantId: tenant.id },
  });
  if (!icon) {
    throw new Error('Expected seeded icons for template category creation');
  }

  const categoryTitle = `Empty ${getId().slice(0, 6)}`;
  const [category] = await database
    .insert(schema.eventTemplateCategories)
    .values({
      icon: { iconColor: icon.sourceColor ?? 0, iconName: icon.commonName },
      tenantId: tenant.id,
      title: categoryTitle,
    })
    .returning();
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  const categoryCard = page
    .getByRole('heading', { name: category.title })
    .locator('..')
    .locator('..');
  await categoryCard
    .getByRole('link', { name: 'Add template to this category' })
    .click();
  await expect(page).toHaveURL(`/templates/create/${category.id}`);
  await expect(page.getByLabel('Template Category')).toHaveText(category.title);
});

test('create a new template', async ({
  page,
  permissionOverride,
  templateCategories,
}) => {
  await permissionOverride({
    add: ['templates:create'],
    roleName: 'Section member',
  });
  const category = templateCategories[0];
  const templateTitle = `Historical tour ${getId().slice(0, 6)}`;
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: 'Create template' }).click();
  await expect(page).toHaveURL(`/templates/create`);
  await fillTemplateBasics(page, {
    categoryTitle: category.title,
    title: templateTitle,
  });
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await expect(page.getByRole('link', { name: templateTitle })).toBeVisible();
});

test('view a template', async ({ page, templates }) => {
  const template = templates[0];
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: template.title }).click();
  await expect(page).toHaveURL(`/templates/${template.id}`);
});

test('template create form hides selected roles in autocomplete', async ({
  page,
  permissionOverride,
}) => {
  await permissionOverride({
    add: ['templates:create'],
    roleName: 'Section member',
  });
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: 'Create template' }).click();
  await expect(page).toHaveURL('/templates/create');

  const selectedRoleName = 'Section member';
  await expect(
    page.locator('mat-chip-row').filter({ hasText: selectedRoleName }),
  ).toBeVisible();

  const organizerRoleInput = page.getByPlaceholder('Add Role...').first();
  await organizerRoleInput.fill('Section');

  await expect(
    page.getByRole('option', {
      exact: true,
      name: selectedRoleName,
    }),
  ).toHaveCount(0);
});
