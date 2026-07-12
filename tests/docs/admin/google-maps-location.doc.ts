import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({
  screenshot: 'only-on-failure',
  storageState: adminStateFile,
  trace: 'retain-on-failure',
});
test.setTimeout(90_000);

test('Choose a tenant default location with Google Maps @needs-google-maps', async ({
  database,
  page,
  tenant,
}, testInfo) => {
  await page.goto('.');

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Account, permission, and provider prerequisite" %}
This guide uses a signed-in tenant administrator with **admin:changeSettings** in the tenant being changed. The Evorto deployment must have a working **PUBLIC_GOOGLE_MAPS_API_KEY**, billing enabled, and both the Maps JavaScript API and Places API (New) enabled for the key's project. Location search is required production functionality; a missing or rejected key is a release blocker, not a reason to skip this journey.
{% /callout %}

# Choose a tenant default location with Google Maps

The tenant default location biases later event and template searches toward the tenant's usual area. Selecting a result asks Google Places for both autocomplete results and the chosen place's current details. Evorto stores the returned place id, display name, address when available, and coordinates.

Start from the normal application navigation: select **Admin Tools**, then **General settings**.
`,
  });

  await page.getByRole('link', { name: 'Admin Tools' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Admin settings' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'General settings' }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/u);

  const settings = page.locator('app-general-settings');
  const locationField = settings.locator('app-location-selector-field');
  await expect(locationField).toContainText('No location selected');
  await locationField.getByRole('button', { name: 'Change location' }).click();

  const dialog = page.getByRole('dialog', { name: 'Select a location' });
  await expect(dialog).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
## Search and review the provider result

1. In **Location**, type a recognizable place name plus its city or country. More context reduces ambiguous results.
2. Wait for the Google Places suggestions. An empty-result message means the query found no candidates; broaden or correct the wording. A provider error offers **Retry location search**. A configuration error tells a site administrator to fix the API key.
3. Select the intended suggestion. Evorto then loads that place's details. If that second request fails, use **Retry location details** or choose another result. The dialog closes only after complete, finite coordinates and a place id have been returned.

This generated journey uses **Brandenburg Gate Berlin Germany** as a stable public example.
`,
  });

  const search = dialog.getByPlaceholder(
    'Start typing to search for a location',
  );
  await search.fill('Brandenburg Gate Berlin Germany');
  await expect(search).toHaveValue('Brandenburg Gate Berlin Germany');
  const firstSuggestion = page.getByRole('option').first();
  const configurationError = dialog.getByRole('alert').filter({
    hasText: 'Location search is not configured',
  });
  const providerError = dialog.getByRole('alert').filter({
    hasText: 'The location provider is unavailable',
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
    'Google Maps is not configured',
  ).toBeHidden();
  await expect(
    providerError,
    'Google Maps rejected the live search',
  ).toBeHidden();
  await expect(
    emptyResult,
    'Google Maps returned no live suggestions',
  ).toBeHidden();
  await expect(search).toHaveValue('Brandenburg Gate Berlin Germany');
  await takeScreenshot(
    testInfo,
    dialog,
    page,
    'Live Google Maps location suggestions',
  );
  await firstSuggestion.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(locationField).not.toContainText('No location selected');

  await testInfo.attach('markdown', {
    body: `
## Save and verify the location

The selected name appearing under **Default Location** is only the pending form value. Select **Save** and wait for **Tenant settings updated** before leaving the page. This journey then reads the tenant record and reloads the page; both checks must retain the same Google place.
`,
  });

  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Tenant settings updated')).toBeVisible();

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
    throw new Error('Expected the selected Google location to be persisted');
  }
  expect(Number.isFinite(location.coordinates.lat)).toBe(true);
  expect(Number.isFinite(location.coordinates.lng)).toBe(true);

  await page.reload();
  await expect(locationField).toContainText(location.name);
  await takeScreenshot(
    testInfo,
    locationField,
    page,
    'Persisted tenant default location',
  );

  await testInfo.attach('markdown', {
    body: `
## Completion, correction, and safety

The saved location is **${location.name}**. Event and template location searches may now use its coordinates as a search bias; it does not silently change existing event locations.

To correct the choice, select **Change location**, search again, select the intended result, and save. Select **Cancel** in the dialog to retain the current form value. If Google Maps cannot initialize, search, or load place details, do not type guessed coordinates into this flow or treat an unverified result as complete: correct the deployment key, API enablement, browser-key restrictions, billing, or network access, then rerun the required integration journey.
`,
  });
});
