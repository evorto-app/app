import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({
  screenshot: 'only-on-failure',
  storageState: adminStateFile,
  trace: 'retain-on-failure',
});
test.setTimeout(90_000);

test('selects and persists a live Google Maps place @needs-google-maps', async ({
  database,
  page,
  tenant,
}) => {
  await page.goto('/admin/settings');

  const settings = page.locator('app-general-settings');
  await expect(
    settings.getByRole('heading', { name: 'General settings' }),
  ).toBeVisible();
  await expect(settings).not.toHaveAttribute('ngh', /.*/);

  const locationField = settings.locator('app-location-selector-field');
  await locationField.getByRole('button', { name: 'Change location' }).click();

  const dialog = page.getByRole('dialog', { name: 'Select a location' });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole('combobox', { name: 'Location' });
  await expect(search).toBeEditable();
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
  await firstSuggestion.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(locationField).not.toContainText('No location selected');

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
});
