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
          ? [`- Also includes: ${dependencies.map(permissionLabel).join(', ')}`]
          : []),
        '',
      ];
    }),
  ]);

test('About permissions', async ({}, testInfo) => {
  expect(PERMISSION_GROUPS.length).toBeGreaterThan(0);

  await testInfo.attach('markdown', {
    body: `
# About permissions

Permissions belong to an organization and are assigned through roles. A user has any permission that appears on at least one of their roles in the current organization.

Some permissions include related access so the user can reach the screens needed to use them. The reference below names those included permissions with the same labels shown in the role editor.

Platform administrator access is separate from organization roles and cannot be granted in the role editor.

${permissionLines().join('\n')}
`,
  });
});
