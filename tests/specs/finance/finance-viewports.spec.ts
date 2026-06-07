import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import {
  adminStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  collectBrowserLogFailures,
  expectStablePageLayout,
} from '../../support/utils/page-layout';

test.setTimeout(120_000);

test.use({ storageState: adminStateFile });

const viewportSizes = [
  { height: 740, label: 'narrow mobile', width: 320 },
  { height: 844, label: 'mobile', width: 390 },
  { height: 900, label: 'desktop', width: 1440 },
] as const;

const organizerUserId =
  usersToAuthenticate.find((user) => user.roles === 'organizer')?.id ??
  usersToAuthenticate[0].id;

const seedFinanceViewportReceipts = async ({
  approvedReceiptFileName,
  approvedReceiptId,
  database,
  eventId,
  pendingReceiptFileName,
  pendingReceiptId,
  seedDate,
  tenantId,
}: {
  approvedReceiptFileName: string;
  approvedReceiptId: string;
  database: NodePgDatabase<typeof relations>;
  eventId: string;
  pendingReceiptFileName: string;
  pendingReceiptId: string;
  seedDate: Date;
  tenantId: string;
}) => {
  await database.insert(schema.financeReceipts).values([
    {
      alcoholAmount: 0,
      attachmentFileName: pendingReceiptFileName,
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 1024,
      depositAmount: 0,
      eventId,
      hasAlcohol: false,
      hasDeposit: false,
      id: pendingReceiptId,
      purchaseCountry: 'DE',
      receiptDate: new Date(seedDate.getTime() - 1000 * 60 * 60 * 24),
      status: 'submitted',
      submittedByUserId: organizerUserId,
      taxAmount: 120,
      tenantId,
      totalAmount: 1200,
    },
    {
      alcoholAmount: 150,
      attachmentFileName: approvedReceiptFileName,
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 2048,
      depositAmount: 0,
      eventId,
      hasAlcohol: true,
      hasDeposit: false,
      id: approvedReceiptId,
      purchaseCountry: 'DE',
      receiptDate: new Date(seedDate.getTime() - 1000 * 60 * 60 * 48),
      reviewedAt: seedDate,
      reviewedByUserId: usersToAuthenticate[0].id,
      status: 'approved',
      submittedByUserId: organizerUserId,
      taxAmount: 210,
      tenantId,
      totalAmount: 2100,
    },
  ]);
};

test('finance pages have stable layouts across viewports @finance', async ({
  database,
  page,
  seedDate,
  seeded,
  tenant,
}) => {
  const browserLogFailures = collectBrowserLogFailures(page);
  const eventId = seeded.scenario.events.past.eventId;
  const pendingReceiptId = getId();
  const approvedReceiptId = getId();
  const pendingReceiptFileName = `viewport-approval-${seedDate.getTime()}.pdf`;
  const approvedReceiptFileName = `viewport-refund-${seedDate.getTime()}.pdf`;
  const organizerUser = await database.query.users.findFirst({
    where: { id: organizerUserId },
  });

  if (!organizerUser) {
    throw new Error('Expected organizer user for finance viewport coverage');
  }

  await database
    .update(schema.users)
    .set({
      iban: 'DE00123456781234567890',
      paypalEmail: 'organizer-refunds@example.com',
    })
    .where(eq(schema.users.id, organizerUserId));

  await seedFinanceViewportReceipts({
    approvedReceiptFileName,
    approvedReceiptId,
    database,
    eventId,
    pendingReceiptFileName,
    pendingReceiptId,
    seedDate,
    tenantId: tenant.id,
  });

  const routes = [
    {
      expectedHeading: 'Finances',
      extraText: 'Transactions',
      path: '/finance',
    },
    {
      expectedHeading: 'All transactions',
      extraText: 'Amount',
      path: '/finance/transactions',
    },
    {
      expectedHeading: 'Receipt approvals',
      extraText: pendingReceiptFileName,
      path: '/finance/receipts-approval',
    },
    {
      expectedHeading: 'Review receipt',
      extraText: pendingReceiptFileName,
      path: `/finance/receipts-approval/${pendingReceiptId}`,
    },
    {
      expectedHeading: 'Receipt reimbursements',
      extraText: approvedReceiptFileName,
      path: '/finance/receipts-refunds',
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
            await expectStablePageLayout(page);
            expect(
              browserLogFailures,
              `${viewport.label} ${route.path} should not emit browser warning/error logs`,
            ).toEqual([]);
          });
        }
      });
    }
  } finally {
    await database
      .delete(schema.financeReceipts)
      .where(
        inArray(schema.financeReceipts.id, [
          pendingReceiptId,
          approvedReceiptId,
        ]),
      );
    await database
      .update(schema.users)
      .set({
        iban: organizerUser.iban,
        paypalEmail: organizerUser.paypalEmail,
      })
      .where(eq(schema.users.id, organizerUserId));
  }
});
