import type { Locator, Page } from '@playwright/test';

import { organizerStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: organizerStateFile });

const pickTemplates = (
  templateCategories: readonly { title: string }[],
  templates: readonly { id: string; seedKey?: string; title: string }[],
) => {
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
  expect(templateB.title.toLowerCase()).not.toContain(
    templateA.title.toLowerCase(),
  );
  return { categoryA, categoryB, templateA, templateB };
};

const locators = (page: Page, picked: ReturnType<typeof pickTemplates>) => {
  const list = page.getByRole('region', { name: 'Template list' });
  return {
    clearButton: page.getByRole('button', { name: 'Clear search' }),
    closeButton: page.getByRole('button', { name: 'Close search' }),
    headingA: list.getByRole('heading', {
      exact: true,
      name: picked.categoryA.title,
    }),
    headingB: list.getByRole('heading', {
      exact: true,
      name: picked.categoryB.title,
    }),
    linkA: list.getByRole('link', { name: picked.templateA.title }),
    linkB: list.getByRole('link', { name: picked.templateB.title }),
    list,
    liveRegion: page.locator('app-template-list [role="status"]'),
    pageTitle: page.getByRole('heading', { name: 'Event templates' }),
    searchButton: page.getByRole('button', { name: 'Search templates' }),
    searchField: page.getByRole('searchbox', { name: 'Search templates' }),
  };
};

// The search button's click handler is attached once its `jsaction` marker is
// gone, after hydration and event replay.
const waitForHydration = async (page: Page, searchButton: Locator) => {
  await expect(page.locator('[ngh]')).toHaveCount(0, { timeout: 20_000 });
  await expect(searchButton).not.toHaveAttribute('jsaction', /click/, {
    timeout: 20_000,
  });
};

test('search narrows templates by title and keeps category grouping', async ({
  page,
  templateCategories,
  templates,
}) => {
  const picked = pickTemplates(templateCategories, templates);
  const { templateA } = picked;
  const searchText = `  ${templateA.title.toUpperCase()}  `;
  const {
    clearButton,
    headingA,
    headingB,
    linkA,
    linkB,
    list,
    liveRegion,
    pageTitle,
    searchButton,
    searchField,
  } = locators(page, picked);

  await page.goto('/templates');
  await expect(linkA).toBeVisible();
  await expect(linkB).toBeVisible();
  await expect(searchField).toBeHidden();
  await waitForHydration(page, searchButton);

  await searchButton.click();
  await expect(searchField).toBeFocused();
  await expect(pageTitle).toBeHidden();

  await searchField.fill(searchText);
  await expect(searchField).toHaveValue(searchText);
  await expect(linkA).toBeVisible();
  await expect(headingA).toBeVisible();
  await expect(linkB).toBeHidden();
  await expect(headingB).toBeHidden();
  await expect(liveRegion).toHaveText('1 matching template');

  await searchField.fill(`zzz-no-template-${templateA.id}`);
  await expect(list.getByText(`zzz-no-template-${templateA.id}`)).toBeVisible();
  await expect(list).toContainText('No matching templates');
  await expect(liveRegion).toHaveText('No matching templates');
  await expect(linkA).toBeHidden();

  await clearButton.click();
  await expect(searchField).toHaveValue('');
  await expect(searchField).toBeFocused();
  await expect(clearButton).toBeHidden();
  await expect(linkA).toBeVisible();
  await expect(linkB).toBeVisible();

  await searchField.fill(searchText);
  await expect(linkB).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(searchField).toBeHidden();
  await expect(pageTitle).toBeVisible();
  await expect(linkA).toBeVisible();
  await expect(linkB).toBeVisible();
  await expect(headingA).toBeVisible();
  await expect(headingB).toBeVisible();
  await expect(liveRegion).toHaveText('');
  await expect(searchButton).toBeFocused();
});

test('restores the list scroll position when search closes', async ({
  page,
  templateCategories,
  templates,
}) => {
  const picked = pickTemplates(templateCategories, templates);
  const { closeButton, list, searchButton, searchField } = locators(
    page,
    picked,
  );

  // Short viewport so the desktop list region scrolls.
  await page.setViewportSize({ height: 600, width: 1280 });
  await page.goto('/templates');
  await expect(list).toBeVisible();
  await waitForHydration(page, searchButton);

  await list.evaluate((element) => {
    element.scrollTop = 150;
  });
  const scrolled = await list.evaluate((element) => element.scrollTop);
  expect(scrolled).toBeGreaterThan(0);

  await searchButton.click();
  await expect(searchField).toBeFocused();
  await searchField.fill('trip');
  await closeButton.click();

  await expect(searchField).toBeHidden();
  await expect
    .poll(() => list.evaluate((element) => element.scrollTop))
    .toBe(scrolled);
});

test('restores the page scroll position on mobile when search closes', async ({
  page,
  templateCategories,
  templates,
}) => {
  const picked = pickTemplates(templateCategories, templates);
  const { closeButton, linkA, searchButton, searchField } = locators(
    page,
    picked,
  );

  await page.setViewportSize({ height: 600, width: 375 });
  await page.goto('/templates');
  await expect(linkA).toBeVisible();
  await waitForHydration(page, searchButton);

  await page.evaluate(() => {
    window.scrollTo(0, 300);
  });
  const saved = await page.evaluate(() => window.scrollY);
  expect(saved).toBeGreaterThan(0);

  // The mobile header scrolls with the page; a Playwright click would first
  // scroll the button into view and change the position under test.
  await searchButton.dispatchEvent('click');
  await expect(searchField).toBeFocused();
  await searchField.fill('trip');
  await closeButton.click();

  await expect(searchField).toBeHidden();
  await expect(searchButton).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(saved);
});

test('opens search from a click made before the page finishes loading', async ({
  page,
  templateCategories,
  templates,
}) => {
  const picked = pickTemplates(templateCategories, templates);
  const searchText = `  ${picked.templateA.title.toUpperCase()}  `;
  const { linkA, linkB, liveRegion, searchButton, searchField } = locators(
    page,
    picked,
  );

  // Hold the app bundle so the click lands on the server-rendered button.
  let releaseApp = () => {
    // Replaced once the route handler is waiting.
  };
  const appHeld = new Promise<void>((resolve) => {
    releaseApp = resolve;
  });
  await page.route(/\/main-[\w-]+\.js(?:\?.*)?$/, async (route) => {
    await appHeld;
    await route.fallback();
  });

  // `load` and `domcontentloaded` wait for the held module script.
  await page.goto('/templates', { waitUntil: 'commit' });
  await expect(searchButton).toBeVisible();
  await searchButton.click();
  // The field cannot exist until the app runs, which proves the hold worked.
  await expect(searchField).toHaveCount(0);
  releaseApp();

  // Event replay runs the click once the app has started.
  await expect(searchField).toBeVisible({ timeout: 20_000 });
  await expect(searchField).toBeFocused();

  await searchField.fill(searchText);
  await expect(liveRegion).toHaveText('1 matching template');
  await expect(linkA).toBeVisible();
  await expect(linkB).toBeHidden();
});
