import { organizerStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: organizerStateFile });

test('search narrows templates by title and keeps category grouping', async ({
  page,
  templateCategories,
  templates,
}) => {
  // Seeded templates: 'city-trip' lives in "City Trips", 'sports' in "Sports".
  const templateA = templates.find(
    (template) => template.seedKey === 'city-trip',
  );
  const templateB = templates.find((template) => template.seedKey === 'sports');
  const categoryA = templateCategories.find(
    (category) => category.title === 'City Trips',
  );
  const categoryB = templateCategories.find(
    (category) => category.title === 'Sports',
  );
  if (!templateA || !templateB || !categoryA || !categoryB) {
    throw new Error('Expected seeded city trip and sports templates');
  }
  const searchText = `  ${templateA.title.toUpperCase()}  `;
  expect(templateB.title.toLowerCase()).not.toContain(
    templateA.title.toLowerCase(),
  );

  await page.goto('/templates');
  const list = page.getByRole('region', { name: 'Template list' });
  const linkA = list.getByRole('link', { name: templateA.title });
  const linkB = list.getByRole('link', { name: templateB.title });
  const headingA = list.getByRole('heading', {
    exact: true,
    name: categoryA.title,
  });
  const headingB = list.getByRole('heading', {
    exact: true,
    name: categoryB.title,
  });
  const searchField = page.getByRole('searchbox', { name: 'Search templates' });
  const clearButton = page.getByRole('button', { name: 'Clear search' });

  await expect(linkA).toBeVisible();
  await expect(linkB).toBeVisible();
  await expect(clearButton).toBeHidden();

  // The server-rendered field accepts typing before Angular attaches its input
  // listener. The hydration markers can disappear before event replay has
  // finished, so also wait for the field's `jsaction` marker to go.
  await expect(page.locator('[ngh]')).toHaveCount(0, { timeout: 20_000 });
  await expect(searchField).not.toHaveAttribute('jsaction', /input/, {
    timeout: 20_000,
  });
  await searchField.fill(searchText);
  await expect(searchField).toHaveValue(searchText);
  await expect(linkA).toBeVisible();
  await expect(headingA).toBeVisible();
  await expect(linkB).toBeHidden();
  await expect(headingB).toBeHidden();

  await searchField.fill(`zzz-no-template-${templateA.id}`);
  const emptyState = page
    .getByRole('status')
    .filter({ hasText: 'No matching templates' });
  await expect(emptyState).toBeVisible();
  await expect(emptyState).toContainText(`zzz-no-template-${templateA.id}`);
  await expect(linkA).toBeHidden();

  await clearButton.click();
  await expect(searchField).toHaveValue('');
  await expect(searchField).toBeFocused();
  await expect(clearButton).toBeHidden();
  await expect(linkA).toBeVisible();
  await expect(linkB).toBeVisible();
  await expect(headingA).toBeVisible();
  await expect(headingB).toBeVisible();
});
