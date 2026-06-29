import { userStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/permissions-test';

test.use({ storageState: userStateFile });

test('adds internal:viewInternalPages to Regular user shows Internal link', async ({
  page,
  permissionOverride,
}) => {
  await permissionOverride({
    roleName: 'Regular user',
    add: ['internal:viewInternalPages'],
  });
  await page.goto('.');
  await expect(page.getByRole('link', { name: 'Internal' })).toBeVisible();
});
