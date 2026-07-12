import path from 'node:path';

import { expect, type Locator, type Page } from '@playwright/test';

import type { SupportedTenantCurrency } from '../../../src/types/custom/tenant';

export const formatTenantCurrency = (
  amountInMinorUnits: number,
  currency: SupportedTenantCurrency,
): string =>
  new Intl.NumberFormat('de-DE', {
    currency,
    style: 'currency',
  }).format(amountInMinorUnits / 100);

export const expectReceiptPdfPreviewAvailable = async ({
  page,
}: {
  page: Page;
}): Promise<void> => {
  const preview = page.locator('iframe[title="Receipt preview"]');
  await expect(preview).toBeVisible();

  const previewUrl = await preview.getAttribute('src');
  if (!previewUrl) {
    throw new Error('Expected the receipt preview to have a signed URL');
  }

  expect(new URL(previewUrl).hostname).not.toBe('minio');
  const iframe = await preview.elementHandle();
  if (!iframe) {
    throw new Error('Expected the receipt preview iframe to be attached');
  }

  await iframe.evaluate((element) => {
    (element as HTMLIFrameElement).src = 'about:blank';
  });
  await expect
    .poll(async () => (await iframe.contentFrame())?.url())
    .toBe('about:blank');

  const browserResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === previewUrl &&
      response.request().resourceType() === 'document',
  );
  await iframe.evaluate((element, source) => {
    (element as HTMLIFrameElement).src = source;
  }, previewUrl);

  const browserResponse = await browserResponsePromise;
  expect(browserResponse.status()).toBe(200);
  expect(browserResponse.headers()['content-type']).toContain(
    'application/pdf',
  );
  await expect
    .poll(async () => (await iframe.contentFrame())?.url())
    .toBe(previewUrl);

  const response = await page.request.get(previewUrl);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  const body = await response.body();
  expect(body.byteLength).toBeGreaterThan(4);
  expect(body.toString('ascii', 0, 4)).toBe('%PDF');
};

export const openEventFromEventsNavigation = async ({
  eventId,
  eventTitle,
  page,
}: {
  eventId: string;
  eventTitle: string;
  page: Page;
}): Promise<void> => {
  await page.goto('.');
  const eventsNavigation = page.getByRole('link', { name: 'Events' });
  await expect(eventsNavigation).toBeVisible();
  await eventsNavigation.click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Events' }).first(),
  ).toBeVisible();

  const eventLink = page.locator(`a[href="/events/${eventId}"]`).first();
  await expect(eventLink).toBeVisible({ timeout: 20_000 });
  await eventLink.click();
  await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));
  await expect(
    page.getByRole('heading', { level: 1, name: eventTitle }),
  ).toBeVisible({ timeout: 20_000 });
};

export const openOrganizerReceiptsFromNavigation = async ({
  eventId,
  eventTitle,
  page,
}: {
  eventId: string;
  eventTitle: string;
  page: Page;
}): Promise<Locator> => {
  await openEventFromEventsNavigation({ eventId, eventTitle, page });
  const organizeLink = page.getByRole('link', {
    name: 'Organize this event',
  });
  await expect(organizeLink).toBeVisible();
  await organizeLink.click();

  const receiptSection = page.locator('section', {
    has: page.getByRole('heading', { level: 2, name: 'Receipts' }),
  });
  await expect(receiptSection).toBeVisible({ timeout: 20_000 });
  await expect(receiptSection.getByText('Loading receipts...')).not.toBeVisible(
    { timeout: 20_000 },
  );
  await expect(
    receiptSection.getByText(
      'Receipts can be added after the event has loaded.',
    ),
  ).not.toBeVisible({ timeout: 20_000 });
  await expect(
    receiptSection.getByRole('button', { name: 'Add receipt' }),
  ).toBeEnabled({ timeout: 20_000 });

  return receiptSection;
};

export const openReceiptSubmissionDialog = async ({
  page,
  receiptSection,
}: {
  page: Page;
  receiptSection: Locator;
}): Promise<Locator> => {
  await receiptSection.getByRole('button', { name: 'Add receipt' }).click();
  const dialog = page.locator('app-receipt-submit-dialog');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('heading', { level: 1, name: 'Add receipt' }),
  ).toBeVisible();
  return dialog;
};

export const completeReceiptSubmissionForm = async ({
  alcoholAmount,
  attachmentName,
  countryOption = 'Germany (DE)',
  currency,
  depositAmount,
  dialog,
  page,
  receiptFile,
  taxAmount,
  totalAmount,
}: {
  alcoholAmount?: string;
  attachmentName?: string;
  countryOption?: string;
  currency: SupportedTenantCurrency;
  depositAmount?: string;
  dialog: Locator;
  page: Page;
  receiptFile: string;
  taxAmount: string;
  totalAmount: string;
}): Promise<void> => {
  const depositInput = dialog.getByLabel(`Deposit amount (${currency})`);
  await expect(depositInput).not.toBeVisible();
  if (depositAmount !== undefined) {
    await dialog.getByRole('checkbox', { name: 'Deposit involved' }).check();
    await expect(depositInput).toBeVisible();
    await depositInput.fill(depositAmount);
  }

  const alcoholInput = dialog.getByLabel(`Alcohol amount (${currency})`);
  await expect(alcoholInput).not.toBeVisible();
  if (alcoholAmount !== undefined) {
    await dialog.getByRole('checkbox', { name: 'Alcohol purchased' }).check();
    await expect(alcoholInput).toBeVisible();
    await alcoholInput.fill(alcoholAmount);
  }

  await dialog.getByLabel(`Total amount (${currency})`).fill(totalAmount);
  await dialog.getByLabel(`Tax amount (${currency})`).fill(taxAmount);
  await dialog.getByLabel('Purchase country').click();
  await page.getByRole('option', { name: countryOption }).click();
  await dialog
    .locator('input[type="file"][accept="image/*,application/pdf"]')
    .setInputFiles(receiptFile);
  await expect(
    dialog.getByText(path.basename(receiptFile), { exact: true }),
  ).toBeVisible();

  if (attachmentName !== undefined) {
    await dialog.getByLabel('Receipt name').fill(attachmentName);
  }
};
