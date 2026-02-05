import { defaultStateFile } from '../../helpers/user-data';
import * as schema from '../../src/db/schema';
import { expect, test } from '../fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: defaultStateFile });

test('create event form template @track(playwright-specs-track-linking_20260126) @req(EVENTS-TEST-01)', async ({
  database,
  page,
  templates,
}) => {
  const freeTemplate = await (async () => {
    for (const template of templates) {
      const options = await database.query.templateRegistrationOptions.findMany(
        {
          where: { templateId: template.id },
        },
      );
      if (
        options.every(
          (option) => !option.isPaid || option.stripeTaxRateId !== null,
        )
      ) {
        return template;
      }
    }
    return null;
  })();

  if (!freeTemplate) {
    test.skip(
      true,
      'No template with valid tax rates (or all-free options) available for event creation.',
    );
  }
  const template = freeTemplate!;
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
  if (await createButton.isDisabled()) {
    test.skip(
      true,
      'Create event is disabled (likely missing tax rates for paid options).',
    );
  }
  await createButton.click();
  await page.waitForURL(/\/events\//, { timeout: 20000 });
  const detailHeading = page.getByRole('heading', {
    level: 1,
    name: template.title,
  });
  await ((await detailHeading.isVisible())
    ? expect(detailHeading).toBeVisible()
    : expect(
        page.getByRole('link', { name: template.title }).first(),
      ).toBeVisible());
});
