import { eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  collectBrowserLogFailures,
  expectedStablePageLayout,
  readPageLayout,
} from '../../support/utils/page-layout';

test.setTimeout(120_000);

test.use({ storageState: adminStateFile });

const viewportSizes = [
  { height: 740, label: 'narrow mobile', width: 320 },
  { height: 844, label: 'mobile', width: 390 },
  { height: 900, label: 'desktop', width: 1440 },
] as const;

test('tenant admin role pages have stable layouts across viewports @admin @permissions', async ({
  database,
  page,
  seedDate,
  tenant,
}) => {
  const browserLogFailures = collectBrowserLogFailures(page);
  const roleName = `Viewport role ${seedDate.getTime()}`;
  const [role] = await database
    .insert(schema.roles)
    .values({
      description:
        'Role seeded for admin role viewport coverage with dependent permissions.',
      displayInHub: true,
      name: roleName,
      permissions: ['events:create', 'templates:view'],
      tenantId: tenant.id,
    })
    .returning({ id: schema.roles.id });

  if (!role) {
    throw new Error('Expected role viewport seed to create a role');
  }

  const routes = [
    {
      expectedHeading: 'All users',
      extraText: 'Search users',
      path: '/admin/users',
    },
    {
      expectedHeading: 'User roles',
      extraText: roleName,
      path: '/admin/roles',
    },
    {
      expectedHeading: 'Create Role',
      extraText: 'Every new user should get this role',
      path: '/admin/roles/create',
    },
    {
      expectedHeading: roleName,
      extraText: 'Create events',
      path: `/admin/roles/${role.id}`,
    },
    {
      expectedHeading: 'Edit Role',
      extraText: 'Show this role in the hub',
      path: `/admin/roles/${role.id}/edit`,
    },
  ] as const;

  try {
    for (const viewport of viewportSizes) {
      await test.step(`${viewport.label} viewport`, async () => {
        await page.setViewportSize(viewport);

        for (const route of routes) {
          await test.step(route.path, async () => {
            browserLogFailures.length = 0;
            await page.goto(route.path);

            await expect(
              page.getByRole('heading', {
                level: 1,
                name: route.expectedHeading,
              }),
            ).toBeVisible();
            await expect(
              page.getByText(route.extraText, { exact: false }).first(),
            ).toBeVisible();
            await expect(readPageLayout(page)).resolves.toEqual(
              expectedStablePageLayout,
            );
            expect(
              browserLogFailures,
              `${viewport.label} ${route.path} should not emit browser warning/error logs`,
            ).toEqual([]);
          });
        }
      });
    }
  } finally {
    await database.delete(schema.roles).where(eq(schema.roles.id, role.id));
  }
});
