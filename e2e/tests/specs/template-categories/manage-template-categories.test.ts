import { expect } from '@playwright/test';
import { defaultStateFile } from '../../../../helpers/user-data';
import { test } from '../../../fixtures/base-test';

test.setTimeout(120000);

test.use({ storageState: defaultStateFile });

test('creates template category', async ({ page }, testInfo) => {
  test.fixme(
    true,
    'Hangs during multi-tenant seeding in Playwright runs; revisit once fixture scope is reduced.',
  );
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Template categories' }).click();
  await expect(page).toHaveURL(/\/templates\/categories/);
  await page.getByRole('button', { name: 'Create a new category' }).first().click();
  await expect(page.getByRole('heading', { name: 'Create a new category' })).toBeVisible();
  const categoryTitle = `Mountain trips ${testInfo.testId}`;
  await page.getByLabel('Category title').fill(categoryTitle);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(categoryTitle)).toBeVisible();
});

test('edits existing template category', async ({ page }, testInfo) => {
  test.fixme(
    true,
    'Hangs during multi-tenant seeding in Playwright runs; revisit once fixture scope is reduced.',
  );
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Template categories' }).click();
  await expect(page).toHaveURL(/\/templates\/categories/);
  const categoryTitle = `Mountain trips ${testInfo.testId}`;
  const updatedTitle = `${categoryTitle} updated`;
  await page.getByRole('button', { name: 'Create a new category' }).first().click();
  await expect(page.getByRole('heading', { name: 'Create a new category' })).toBeVisible();
  await page.getByLabel('Category title').fill(categoryTitle);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(categoryTitle)).toBeVisible();
  await page.getByText(categoryTitle).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit category' })).toBeVisible();
  await expect(page.getByLabel('Category title')).toHaveValue(categoryTitle);
  await page.getByLabel('Category title').fill(updatedTitle);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(updatedTitle)).toBeVisible();
});
