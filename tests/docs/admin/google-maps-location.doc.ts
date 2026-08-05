import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({
  screenshot: 'only-on-failure',
  storageState: adminStateFile,
  trace: 'retain-on-failure',
});
test.setTimeout(90_000);

test('Choose an organization default location @needs-google-maps', async ({
  database,
  page,
  tenant,
}, testInfo) => {
  await page.goto('.');

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Before you begin" %}
Sign in as an organization administrator with access to change organization settings. Location search must be available.
{% /callout %}


The default location helps later event and template searches start near the organization's usual area. Choose a location suggestion to save its name and address.

From the main navigation, select **Admin Tools**, then **Organization settings**.
`,
  });

  await page.getByRole('link', { name: 'Admin Tools' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Admin settings' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Organization settings' }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/u);

  const settings = page.locator('app-organization-settings');
  await expect(settings).not.toHaveAttribute('ngh', /.*/);
  const locationField = settings.locator('app-location-selector-field');
  await expect(locationField).toContainText('No location selected');
  await locationField.getByRole('button', { name: 'Change location' }).click();

  const dialog = page.getByRole('dialog', { name: 'Select a location' });
  await expect(dialog).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
## Search and review the location

1. In **Location**, type a recognizable place name plus its city or country. More context reduces ambiguous results.
2. Wait for the location suggestions. If there are no results, broaden or correct the search. If the search cannot be completed, use **Try location search again** once. If the same message remains, contact Evorto support.
3. Select the intended suggestion. If Evorto cannot open it, use **Try this location again** or choose another result. The dialog closes only after the location is ready to use.

For example, search for **Brandenburg Gate Berlin Germany**.
`,
  });

  const search = dialog.getByPlaceholder(
    'Start typing to search for a location',
  );
  await search.fill('Brandenburg Gate Berlin Germany');
  await expect(search).toHaveValue('Brandenburg Gate Berlin Germany');
  const firstSuggestion = page.getByRole('option').first();
  const configurationError = dialog.getByRole('alert').filter({
    hasText: 'Location search is unavailable',
  });
  const providerError = dialog.getByRole('alert').filter({
    hasText: "We couldn't search for locations",
  });
  const emptyResult = dialog.getByText('No locations found');
  await expect(
    firstSuggestion
      .or(configurationError)
      .or(providerError)
      .or(emptyResult)
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    configurationError,
    'Location search is unavailable',
  ).toBeHidden();
  await expect(
    providerError,
    'Location search could not be completed',
  ).toBeHidden();
  await expect(emptyResult, 'No location suggestions were found').toBeHidden();
  await expect(search).toHaveValue('Brandenburg Gate Berlin Germany');
  await takeScreenshot(testInfo, dialog, page, 'Location suggestions');
  await firstSuggestion.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(locationField).not.toContainText('No location selected');

  await testInfo.attach('markdown', {
    body: `
## Save and verify the location

The location is not saved yet when its name first appears under **Default Location**. Select **Save organization settings** and wait for **Organization settings updated** before leaving the page. If you leave and return, the same location remains selected.
`,
  });

  await settings
    .getByRole('button', { name: 'Save organization settings' })
    .click();
  await expect(page.getByText('Organization settings updated')).toBeVisible();

  await expect
    .poll(async () => {
      const persistedTenant = await database.query.tenants.findFirst({
        where: { id: tenant.id },
      });
      return persistedTenant?.defaultLocation ?? null;
    })
    .toMatchObject({
      coordinates: {
        lat: expect.any(Number),
        lng: expect.any(Number),
      },
      name: expect.stringMatching(/\S/u),
      placeId: expect.stringMatching(/\S/u),
      type: 'google',
    });

  const persistedTenant = await database.query.tenants.findFirst({
    where: { id: tenant.id },
  });
  const location = persistedTenant?.defaultLocation;
  if (!location) {
    throw new Error('Expected the selected location to be persisted');
  }
  expect(Number.isFinite(location.coordinates.lat)).toBe(true);
  expect(Number.isFinite(location.coordinates.lng)).toBe(true);

  await page.reload();
  await expect(locationField).toContainText(location.name);
  await takeScreenshot(
    testInfo,
    locationField,
    page,
    'Saved organization default location',
  );

  await testInfo.attach('markdown', {
    body: `
## Completion, correction, and safety

The saved location is **${location.name}**. Event and template searches may now start near this area; existing event locations do not change.

To correct the choice, select **Change location**, search again, select the intended result, and save. Select **Cancel** in the dialog to keep the current selection. If location search cannot start or open a result, do not treat an unchecked result as complete. Try once more, then contact Evorto support if the problem continues.
`,
  });
});
