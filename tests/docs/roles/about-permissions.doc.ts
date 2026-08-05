import {
  PERMISSION_DEPENDENCIES,
  PERMISSION_GROUPS,
  permissionLabel,
} from '../../../src/shared/permissions/permissions';
import { expect, test } from '../../support/fixtures/parallel-test';

const permissionLines = () =>
  PERMISSION_GROUPS.flatMap((group) => [
    `## ${group.label}`,
    '',
    ...group.permissions.flatMap((permission) => {
      const dependencies = PERMISSION_DEPENDENCIES[permission.key] ?? [];
      return [
        `### ${permission.label}`,
        '',
        `- What it allows: ${permission.description}`,
        ...(dependencies.length > 0
          ? [
              `- You also receive: ${dependencies.map(permissionLabel).join(', ')}`,
            ]
          : []),
        '',
      ];
    }),
  ]);

test('About permissions', async ({}, testInfo) => {
  expect(PERMISSION_GROUPS.length).toBeGreaterThan(0);

  await testInfo.attach('markdown', {
    body: `

Permissions belong to an organization and are assigned through roles. A member receives every permission included in at least one of their roles in the current organization.

Some permissions automatically provide the other permissions needed to open and use the same area. Those additions appear below as **You also receive**, using the same names shown in the role editor.

Evorto administrator access is separate from organization roles and cannot be granted in the role editor.

${permissionLines().join('\n')}
`,
  });
});
