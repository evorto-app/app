import { defaultStateFile } from '../../helpers/user-data';
import { getId } from '../../helpers/get-id';
import { expect, test } from '../fixtures/parallel-test';
import { fillTemplateBasics } from '../utils/template-form';
import * as schema from '../../src/db/schema';

test.setTimeout(120000);

test.use({ storageState: defaultStateFile });

test('create template in empty category @track(playwright-specs-track-linking_20260126) @req(TEMPLATES-TEST-01)', async ({
  database,
  page,
  tenant,
}) => {
  const icon = await database.query.icons.findFirst({
    where: { tenantId: tenant.id },
  });
  if (!icon) test.skip(true, 'No icons found');
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

test('create a new template @track(playwright-specs-track-linking_20260126) @req(TEMPLATES-TEST-02)', async ({ page, templateCategories }) => {
  test.fixme(
    true,
    'TinyMCE editor iframe does not load in e2e; template creation blocked.',
  );
  const category = templateCategories[0];
  const templateTitle = 'Historical tour';
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: 'Create template' }).click();
  await expect(page).toHaveURL(`/templates/create`);
  // FIXME: TinyMCE editor never loads in e2e, so description cannot be set and creation fails.
  await fillTemplateBasics(page, {
    categoryTitle: category.title,
    title: templateTitle,
  });
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await expect(page.getByRole('link', { name: templateTitle })).toBeVisible();
});

test('view a template @track(playwright-specs-track-linking_20260126) @req(TEMPLATES-TEST-03)', async ({ page, templates }) => {
  const template = templates[0];
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: template.title }).click();
  await expect(page).toHaveURL(`/templates/${template.id}`);
});
