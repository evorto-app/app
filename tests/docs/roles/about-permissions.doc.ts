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

test('About permissions', async ({}, testInfo) => {
  expect(PERMISSION_GROUPS.length).toBeGreaterThan(0);

  await testInfo.attach('markdown', {
    body: `
# About permissions

Permissions are tenant-scoped capabilities assigned through roles. A user has any permission that appears on at least one of their current-tenant roles.

Wildcard permissions such as \`events:*\` grant the permissions in that group. Some permissions also include dependent permissions so the user can reach the screens needed to use the parent capability.

${permissionLines().join('\n')}
`,
  });
});
