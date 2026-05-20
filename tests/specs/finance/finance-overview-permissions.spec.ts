import { adminStateFile } from '../../../helpers/user-data';
import type { Permission } from '../../../src/shared/permissions/permissions';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: adminStateFile });

const financePermissions = [
  'finance:viewTransactions',
  'finance:approveReceipts',
  'finance:refundReceipts',
] as const satisfies Permission[];

const financeLinks = [
  {
    name: 'Transactions',
    permission: 'finance:viewTransactions',
  },
  {
    name: 'Receipt approvals',
    permission: 'finance:approveReceipts',
  },
  {
    name: 'Receipt reimbursements',
    permission: 'finance:refundReceipts',
  },
] as const satisfies {
  name: string;
  permission: (typeof financePermissions)[number];
}[];

for (const activeLink of financeLinks) {
  test(`finance overview shows only ${activeLink.name} for ${activeLink.permission} @finance @permissions`, async ({
    page,
    permissionOverride,
  }) => {
    await permissionOverride({
      add: [activeLink.permission],
      remove: financePermissions.filter(
        (permission) => permission !== activeLink.permission,
      ),
      roleName: 'Admin',
    });

    await page.goto('/finance');

    await expect(page.getByRole('heading', { name: 'Finances' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: activeLink.name }),
    ).toBeVisible();

    for (const link of financeLinks) {
      if (link.permission === activeLink.permission) continue;
      await expect(page.getByRole('link', { name: link.name })).toHaveCount(0);
    }
  });
}
