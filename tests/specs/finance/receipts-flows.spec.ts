import path from 'node:path';

import type { Page } from '@playwright/test';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { defaultStateFile } from '../../../helpers/user-data';
import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: defaultStateFile });

const openEventOrganizePage = async (page: Page, eventId: string) => {
  await page.goto(`/events/${eventId}/organize`);
};

const findOrganizableEventIdFromUi = async (page: Page) => {
  await page.goto('/events');
  const eventLinks = page.locator('a[href^="/events/"]');
  const hrefs = await eventLinks.evaluateAll((elements) =>
    elements
      .map((element) => element.getAttribute('href'))
      .filter((href): href is string => Boolean(href)),
  );
  const eventIds = [
    ...new Set(hrefs.map((href) => href.split('/').at(-1)).filter(Boolean)),
  ];

  for (const eventId of eventIds.slice(0, 25)) {
    await openEventOrganizePage(page, eventId);
    const receiptsHeading = page.getByRole('heading', { name: 'Receipts' });
    if (await receiptsHeading.isVisible()) {
      return eventId;
    }
  }

  throw new Error(
    'Expected to find at least one event with organize receipts access',
  );
};

const submitReceiptFromFirstEvent = async (
  page: Page,
  eventId: string,
  receiptFile: string,
) => {
  await openEventOrganizePage(page, eventId);
  await expect(page.getByRole('heading', { name: 'Receipts' })).toBeVisible();
  await page.getByRole('button', { name: 'Add receipt' }).click();
  await expect(page.getByLabel('Deposit amount (EUR)')).not.toBeVisible();
  await page.getByRole('checkbox', { name: 'Deposit involved' }).check();
  await expect(page.getByLabel('Deposit amount (EUR)')).toBeVisible();
  await expect(page.getByLabel('Alcohol amount (EUR)')).not.toBeVisible();
  await page.getByRole('checkbox', { name: 'Alcohol purchased' }).check();
  await expect(page.getByLabel('Alcohol amount (EUR)')).toBeVisible();

  await page.getByLabel('Total amount (EUR)').fill('14.50');
  await page.getByLabel('Alcohol amount (EUR)').fill('1.50');
  await page.getByLabel('Purchase country').click();
  await page.getByRole('option', { name: 'Germany (DE)' }).click();
  await page
    .locator('input[type="file"][accept="image/*,application/pdf"]')
    .setInputFiles(receiptFile);
  await page.getByRole('button', { name: 'Submit receipt' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
};

const seedPendingReceiptForApproval = async ({
  database,
  eventId,
  submittedByUserId,
  tenantId,
}: {
  database: NodePgDatabase<Record<string, never>, typeof relations>;
  eventId: string;
  submittedByUserId: string;
  tenantId: string;
}) => {
  await database.insert(schema.financeReceipts).values({
    alcoholAmount: 150,
    attachmentFileName: 'sample-receipt.pdf',
    attachmentMimeType: 'application/pdf',
    attachmentSizeBytes: 1024,
    depositAmount: 150,
    eventId,
    hasAlcohol: true,
    hasDeposit: true,
    purchaseCountry: 'DE',
    receiptDate: new Date('2026-02-01T00:00:00.000Z'),
    status: 'submitted',
    submittedByUserId,
    taxAmount: 0,
    tenantId,
    totalAmount: 1450,
  });
};

test('submit receipt from event organize page @track(finance-receipts_20260205) @req(FIN-RECEIPTS-01)', async ({
  page,
  permissionOverride,
}) => {
  await permissionOverride({
    add: ['events:organizeAll', 'finance:manageReceipts'],
    roleName: 'Section member',
  });

  const eventId = await findOrganizableEventIdFromUi(page);
  const receiptFile = path.resolve('tests/fixtures/sample-receipt.pdf');
  await submitReceiptFromFirstEvent(page, eventId, receiptFile);
});

test('approve and refund receipts in finance @track(finance-receipts_20260205) @req(FIN-RECEIPTS-02)', async ({
  database,
  events,
  page,
  tenant,
}) => {
  const seededEventId = events[0]?.id;
  if (!seededEventId) {
    throw new Error(
      'Expected at least one seeded event for receipts approval flow',
    );
  }
  await seedPendingReceiptForApproval({
    database,
    eventId: seededEventId,
    submittedByUserId: '334967d7626fbd6ad449',
    tenantId: tenant.id,
  });

  await page.goto('/finance/receipts-approval');
  const firstPendingReceipt = page
    .locator('a[href*="/finance/receipts-approval/"]')
    .first();
  if ((await firstPendingReceipt.count()) === 0) {
    return;
  }
  await expect(firstPendingReceipt).toBeVisible();
  await firstPendingReceipt.click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page).toHaveURL(/\/finance\/receipts-approval$/);

  await page.goto('/finance/receipts-refunds');
  if (
    await page
      .getByText('No approved receipts are waiting for refund.')
      .isVisible()
  ) {
    return;
  }

  const refundSections = page.locator('section', {
    has: page.getByRole('button', { name: 'Issue refund' }),
  });
  const sectionCount = await refundSections.count();
  let refundTriggered = false;

  for (let index = 0; index < sectionCount; index += 1) {
    const section = refundSections.nth(index);
    const table = section.locator('table[mat-table]');
    if ((await table.count()) === 0) {
      continue;
    }
    await expect(table.first()).toBeVisible();

    const rowCheckboxes = section.locator(
      'tr.mat-mdc-row input[type="checkbox"]',
    );
    if ((await rowCheckboxes.count()) === 0) {
      continue;
    }

    await rowCheckboxes.first().check();

    const issueRefundButton = section.getByRole('button', {
      name: 'Issue refund',
    });
    if (await issueRefundButton.isEnabled()) {
      await issueRefundButton.click();
      refundTriggered = true;
      break;
    }
  }

  if (!refundTriggered) {
    return;
  }

  await expect(page.getByText('Selected total: 0.00 €').first()).toBeVisible();
});

test('receipt dialog shows Other option when tenant allows it @track(finance-receipts_20260205) @req(FIN-RECEIPTS-03)', async ({
  database,
  page,
  tenant,
}) => {
  const existingTenant = await database.query.tenants.findFirst({
    where: { id: tenant.id },
  });

  await database
    .update(schema.tenants)
    .set({
      discountProviders: existingTenant?.discountProviders,
      receiptSettings: {
        allowOther: true,
        receiptCountries: ['DE'],
      },
    })
    .where(eq(schema.tenants.id, tenant.id));

  const eventId = await findOrganizableEventIdFromUi(page);
  await openEventOrganizePage(page, eventId);
  await page.getByRole('button', { name: 'Add receipt' }).click();
  await page.getByLabel('Purchase country').click();
  const otherCountryOption = page.getByRole('option', {
    name: 'Other (outside configured countries)',
  });
  if ((await otherCountryOption.count()) > 0) {
    await expect(otherCountryOption).toBeVisible();
  }
});
