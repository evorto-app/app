import {
  PERMISSION_DEPENDENCIES,
  PERMISSION_GROUPS,
  permissionLabel,
} from '../../../src/shared/permissions/permissions';
import type { Locator, Page } from '@playwright/test';

import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

const permissionGroupReferenceSurface = (page: Page): Locator =>
  page
    .locator('app-role-form div')
    .filter({
      has: page.getByRole('checkbox', { exact: true, name: 'Events' }),
    })
    .filter({ hasText: 'Includes: View templates' })
    .first();

const permissionLines = () =>
  PERMISSION_GROUPS.flatMap((group) => [
    `## ${group.label}`,
    '',
    ...group.permissions.flatMap((permission) => {
      const dependencies = PERMISSION_DEPENDENCIES[permission.key] ?? [];
      return [
        `### ${permission.label}`,
        '',
        `- Key: \`${permission.key}\``,
        `- What it allows: ${permission.description}`,
        ...(dependencies.length > 0
          ? [
              `- Also includes: ${dependencies.map((key) => `${permissionLabel(key)} (\`${key}\`)`).join(', ')}`,
            ]
          : []),
        '',
      ];
    }),
  ]);

test('About permissions', async ({ page }, testInfo) => {
  expect(PERMISSION_GROUPS.length).toBeGreaterThan(0);

  await testInfo.attach('markdown', {
    body: `
# About permissions

Permissions are tenant-scoped capabilities assigned through roles. A user has any permission that appears on at least one of their current-tenant roles.

Wildcard permissions such as \`events:*\` grant the permissions in that group. Some permissions also include dependent permissions so the user can reach the screens needed to use the parent capability.

${permissionLines().join('\n')}
`,
  });

  await page.goto('/admin/roles/create');
  await expect(
    page.getByRole('heading', { name: 'Create role' }),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { exact: true, name: 'Events' }),
  ).toBeVisible();
  await page.getByRole('checkbox', { exact: true, name: 'Events' }).click();
  await expect(page.getByText('Includes: View templates')).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'View templates' }),
  ).toBeChecked();

  const permissionGroupReference = permissionGroupReferenceSurface(page);
  await expect(permissionGroupReference).toBeVisible();
  await takeScreenshot(
    testInfo,
    permissionGroupReference,
    page,
    'Permission group reference with dependent permissions visible',
  );
});
