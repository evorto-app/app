import { defaultStateFile } from '../../helpers/user-data';
import { expect, test } from '../../e2e/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: defaultStateFile });

test.fixme('create event form template @track(playwright-specs-track-linking_20260126) @req(EVENTS-TEST-01)', async ({ page, templates }) => {
  const template = templates[0];
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: template.title }).click();
  await page.getByRole('link', { name: 'Create event' }).click();
  await expect(page).toHaveURL(`/templates/${template.id}/create-event`);
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/\/events/);
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
