import { expect, test } from '../../support/fixtures/permissions-test';
import { permissionMatrix } from '../../support/permissions/matrix';
import { openAdminTools } from '../../support/utils/admin-tools';

for (const [index, matrixCase] of permissionMatrix.entries()) {
  const reqIdBase = `PERMISSION-MATRIX-SPEC-${String(index + 1).padStart(2, '0')}`;

  test.describe(matrixCase.capability, () => {
    test.use({ storageState: matrixCase.storageState });

    test(`allows capability when required permissions are present @permissions @track(playwright-specs-track-linking_20260126) @req(${reqIdBase}-ALLOW)`, async ({
      isMobile,
      page,
      permissionOverride,
    }) => {
      await permissionOverride(matrixCase.allowedDiff);

      if (matrixCase.capability === 'admin tax rates access') {
        await page.goto('.');
        await openAdminTools(page, isMobile);
        await expect(page.getByRole('link', { name: 'Tax Rates' })).toBeVisible();
        return;
      }

      if (matrixCase.capability === 'template creation access') {
        await page.goto('/templates');
        await expect(
          page.getByRole('link', { name: 'Create template' }).first(),
        ).toBeVisible();
        return;
      }

      await page.goto(matrixCase.allowedRoute);
      await expect(page).toHaveURL(new RegExp(matrixCase.allowedRoute));
      await expect(page).not.toHaveURL(/\/403/);
    });

    test(`denies capability when required permissions are removed @permissions @track(playwright-specs-track-linking_20260126) @req(${reqIdBase}-DENY)`, async ({
      isMobile,
      page,
      permissionOverride,
    }) => {
      await permissionOverride(matrixCase.deniedDiff);

      if (matrixCase.capability === 'admin tax rates access') {
        await page.goto('/admin');
        await expect(page).toHaveURL(/\/admin/);
      }

      if (matrixCase.capability === 'template creation access') {
        await page.goto('/templates');
        await expect(
          page.getByRole('link', { name: 'Create template' }).first(),
        ).toHaveCount(0);
        return;
      }

      await page.goto(matrixCase.deniedRoute);
      await expect(page).toHaveURL(/\/403/);
    });
  });
}
