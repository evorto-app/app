import { userStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/permissions-test';

test.use({ storageState: userStateFile });

test('adds internal:viewInternalPages to Regular user shows Internal link', async ({ isMobile, page, permissionOverride }) => {
  test.fixme(
    isMobile,
    'Internal link is not available in the mobile nav without admin permissions.',
  );
  await permissionOverride({ roleName: 'Regular user', add: ['internal:viewInternalPages'] });
  await page.goto('.');
  if (isMobile) {
    await page.getByRole('button', { name: 'More' }).click();
  }
  await expect(page.getByRole('link', { name: 'Internal' })).toBeVisible();
});
