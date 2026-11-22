import { gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: gaStateFile });
test('Open an organization from Evorto administration', async ({
  page,
  tenant,
}, testInfo) => {
  await page.goto(`/global-admin/tenants/${tenant.id}`);
  await expect(
    page.getByRole('link', { name: 'Open organization', exact: true }),
  ).toHaveAttribute('href', '/');
  await testInfo.attach('markdown', {
    body: `
## Open the organization's own pages

From **Evorto administration** → **Organizations**, choose **Review organization** and then **Open organization**. Manage its events, templates, members, roles, tax rates, and routine finance on that website. Evorto administrators retain full access there without joining the organization or assigning themselves a role.

**Edit organization** remains available for platform configuration.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-tenant-detail'),
    page,
    'Open the organization or edit its platform configuration',
  );
});
