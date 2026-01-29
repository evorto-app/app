import { expect, test } from '../../fixtures/parallel-test';
import { adminStateFile } from '../../../helpers/user-data';

test.use({ storageState: adminStateFile });

test('scan confirmed registration shows allow check-in', async ({ page, registrations, tenant }) => {
  const confirmedRegistration = registrations.find(
    (registration) =>
      registration.status === 'CONFIRMED' &&
      registration.tenantId === tenant.id,
  );
  if (!confirmedRegistration) {
    test.skip(true, 'No confirmed registration available');
    return;
  }
  await page.goto(`/scan/registration/${confirmedRegistration.id}`);
  await expect(page.getByRole('heading', { name: 'Registration scanned' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm Check In' })).toBeEnabled();
});
