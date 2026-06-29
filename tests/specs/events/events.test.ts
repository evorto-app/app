import { organizerStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: organizerStateFile });

test.skip('create event form template', async ({
  database,
  page,
  templates,
}) => {
  const template = templates.find((candidate) => candidate.seedKey === 'hike');
  if (!template) {
    throw new Error('Expected seeded hike template for event creation');
  }

  const options = await database.query.templateRegistrationOptions.findMany({
    where: { templateId: template.id },
  });
  if (options.length === 0) {
    throw new Error(
      `Expected seeded template "${template.title}" to have registration options`,
    );
  }
  if (
    options.some((option) => option.isPaid && option.stripeTaxRateId === null)
  ) {
    throw new Error(
      `Expected seeded template "${template.title}" paid options to have tax rates`,
    );
  }

  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: template.title }).click();
  await page.getByRole('link', { name: 'Create event' }).click();
  await expect(page).toHaveURL(`/templates/${template.id}/create-event`);
  await expect(page.getByLabel('Event title')).toHaveValue(template.title);

  const taxRateSelects = page.getByLabel('Tax rate');
  const taxRateCount = await taxRateSelects.count();
  for (let index = 0; index < taxRateCount; index += 1) {
    await taxRateSelects.nth(index).click();
    const option = page.getByRole('option').filter({ hasText: /%/ }).first();
    await expect(option).toBeVisible();
    await option.click();
  }
  const createButton = page.getByRole('button', { name: 'Create event' });
  await expect(createButton).toBeVisible();
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await page.waitForURL(/\/events\//, { timeout: 20000 });
  await expect(page).toHaveURL(/\/events\/[a-z0-9]+/);
});
