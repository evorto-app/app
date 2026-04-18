import { userStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/permissions-test';

test.use({ storageState: userStateFile });

test('adds internal:viewInternalPages to Regular user shows Internal link @track(playwright-specs-track-linking_20260126) @req(OVERRIDE-TEST-01)', async ({
  isMobile,
  page,
  permissionOverride,
}) => {
  test.skip(
    isMobile,
    'Internal link is not available in the mobile nav without admin permissions.',
  );
  await permissionOverride({
    roleName: 'Regular user',
    add: ['internal:viewInternalPages'],
  });
  await page.goto('.');
  if (isMobile) {
    await page.getByRole('button', { name: 'More' }).click();
  }
  await expect(page.getByRole('link', { name: 'Internal' })).toBeVisible();
});
