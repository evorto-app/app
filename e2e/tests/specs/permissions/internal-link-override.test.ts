import { userStateFile } from '../../../../helpers/user-data';
import { expect, test } from '../../../fixtures/permissions-test';

test.use({ storageState: userStateFile });

test('reveals Internal link after granting view permission', async ({
  page,
  permissionOverride,
}) => {
  await permissionOverride({ roleName: 'Regular user', add: ['internal:viewInternalPages'] });
  await page.goto('.');
  await expect(page.getByRole('link', { name: 'Internal' })).toBeVisible();
});
