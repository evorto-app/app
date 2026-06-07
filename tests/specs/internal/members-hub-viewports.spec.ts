import { and, eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import {
  adminStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
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

test('members hub has stable layouts across viewports @internal', async ({
  database,
  page,
  tenant,
}) => {
  const browserLogFailures = collectBrowserLogFailures(page);
  const hubUser = usersToAuthenticate.find((user) => user.roles === 'user');
  if (!hubUser) {
    throw new Error('Expected regular user fixture for members hub coverage');
  }

  const tenantUser = await database.query.usersToTenants.findFirst({
    columns: {
      id: true,
    },
    where: {
      tenantId: tenant.id,
      userId: hubUser.id,
    },
  });
  if (!tenantUser) {
    throw new Error('Expected regular user tenant assignment for hub coverage');
  }

  const user = await database.query.users.findFirst({
    columns: {
      firstName: true,
      lastName: true,
    },
    where: {
      id: hubUser.id,
    },
  });
  if (!user) {
    throw new Error('Expected regular user row for hub coverage');
  }

  const roleName = `Viewport Community Coordination Role ${getId().slice(0, 8)}`;
  const [role] = await database
    .insert(schema.roles)
    .values({
      collapseMembersInHup: false,
      description:
        'Visible members hub role seeded to prove long descriptions and member names stay inside narrow mobile layouts.',
      displayInHub: true,
      name: roleName,
      permissions: [],
      tenantId: tenant.id,
    })
    .returning({ id: schema.roles.id });

  if (!role) {
    throw new Error('Expected members hub viewport seed to create a role');
  }

  try {
    await database.insert(schema.rolesToTenantUsers).values({
      roleId: role.id,
      userTenantId: tenantUser.id,
    });

    for (const viewport of viewportSizes) {
      await test.step(`${viewport.label} viewport`, async () => {
        browserLogFailures.length = 0;
        await page.setViewportSize(viewport);
        await page.goto('/internal/members-hub');

        await expect(
          page.getByRole('heading', { level: 1, name: 'Members Hub' }),
        ).toBeVisible();
        await expect(
          page.getByRole('heading', { level: 2, name: "Who's who" }),
        ).toBeVisible();
        await expect(page.getByText(roleName)).toBeVisible();
        await expect(
          page.getByText(`${user.firstName} ${user.lastName}`),
        ).toBeVisible();
        await expect(readPageLayout(page)).resolves.toEqual(
          expectedStablePageLayout,
        );
        expect(
          browserLogFailures,
          `${viewport.label} /internal/members-hub should not emit browser warning/error logs`,
        ).toEqual([]);
      });
    }
  } finally {
    await database
      .delete(schema.rolesToTenantUsers)
      .where(
        and(
          eq(schema.rolesToTenantUsers.roleId, role.id),
          eq(schema.rolesToTenantUsers.userTenantId, tenantUser.id),
        ),
      );
    await database.delete(schema.roles).where(eq(schema.roles.id, role.id));
  }
});
