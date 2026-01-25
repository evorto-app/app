import { Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';

import { addTaxRates } from '../../../../../helpers/add-tax-rates';
import {
  defaultStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../../../helpers/user-data';
import * as schema from '../../../../../src/db/schema';
import { test as base, expect } from '../../../../fixtures/parallel-test';
import { runWithStorageState } from '../../../../utils/auth-context';
import { fillTestCard } from '../../../../fill-test-card';

interface DiscountTemplateFixture {
  categoryTitle: string;
  discountedPrice: number;
  fullPrice: number;
  optionTitle: string;
  templateId: string;
  templateTitle: string;
}

const centsToCurrency = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    currency: 'EUR',
    style: 'currency',
  }).format(cents / 100);

const formatDateInput = (date: Date) => {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
};

const test = base.extend<{
  approveEvent: (eventId: string) => Promise<void>;
  discountTemplate: DiscountTemplateFixture;
  waitForSuccessfulRegistration: (options: {
    eventId: string;
    expectedAmount: number;
    userId: string;
  }) => Promise<void>;
}>({
  approveEvent: async ({ database, tenant }, use) => {
    await use(async (eventId: string) => {
      await database
        .update(schema.eventInstances)
        .set({ status: 'APPROVED', unlisted: false })
        .where(
          and(eq(schema.eventInstances.id, eventId), eq(schema.eventInstances.tenantId, tenant.id)),
        );
    });
  },
  discountTemplate: async ({ database, tenant }, use) => {
    const templates = await database.query.eventTemplates.findMany({
      where: { tenantId: tenant.id },
      with: {
        category: true,
        registrationOptions: true,
      },
    });

    const template = templates.find((entry) =>
      entry.registrationOptions.some((option) => option.isPaid && !option.organizingRegistration),
    );

    if (!template) {
      throw new Error('No paid template available for discount test');
    }

    const participantOption = template.registrationOptions.find(
      (option) => option.isPaid && !option.organizingRegistration,
    );
    if (!participantOption) {
      throw new Error('Unable to locate participant registration option');
    }

    let existingTaxRate = await database.query.tenantStripeTaxRates.findFirst({
      where: { tenantId: tenant.id, active: true, inclusive: true },
    });
    if (!existingTaxRate) {
      await addTaxRates(database as any, tenant);
      existingTaxRate = await database.query.tenantStripeTaxRates.findFirst({
        where: { tenantId: tenant.id, active: true, inclusive: true },
      });
      if (!existingTaxRate) {
        throw new Error('No compatible tax rate available for paid template options');
      }
    }

    const paidOptions = template.registrationOptions.filter((option) => option.isPaid);
    const originalPaidTaxRates = paidOptions.map((option) => ({
      id: option.id,
      stripeTaxRateId: option.stripeTaxRateId ?? null,
    }));
    if (paidOptions.length > 0) {
      await database
        .update(schema.templateRegistrationOptions)
        .set({ stripeTaxRateId: existingTaxRate.stripeTaxRateId })
        .where(
          and(
            eq(schema.templateRegistrationOptions.templateId, template.id),
            eq(schema.templateRegistrationOptions.isPaid, true),
          ),
        );
    }

    const originalDiscounts = participantOption.discounts ?? [];

    const discountConfiguration = [
      {
        discountedPrice: Math.max(0, (participantOption.price ?? 0) - 1000),
        discountType: 'esnCard' as const,
      },
    ];

    await database
      .update(schema.templateRegistrationOptions)
      .set({ discounts: discountConfiguration })
      .where(eq(schema.templateRegistrationOptions.id, participantOption.id));

    try {
      await use({
        categoryTitle: template.category.title,
        discountedPrice: discountConfiguration[0].discountedPrice,
        fullPrice: participantOption.price,
        optionTitle: participantOption.title,
        templateId: template.id,
        templateTitle: template.title,
      });
    } finally {
      await database
        .update(schema.templateRegistrationOptions)
        .set({ discounts: originalDiscounts })
        .where(eq(schema.templateRegistrationOptions.id, participantOption.id));
      if (paidOptions.length > 0) {
        for (const option of originalPaidTaxRates) {
          await database
            .update(schema.templateRegistrationOptions)
            .set({ stripeTaxRateId: option.stripeTaxRateId })
            .where(eq(schema.templateRegistrationOptions.id, option.id));
        }
      }
    }
  },
  waitForSuccessfulRegistration: async ({ database, tenant }, use) => {
    await use(async ({ eventId, expectedAmount, userId }) => {
      await expect
        .poll(
          async () => {
            const tx = await database.query.transactions.findFirst({
              where: {
                eventId,
                status: 'successful',
                targetUserId: userId,
                tenantId: tenant.id,
                type: 'registration',
              },
            });
            if (!tx) {
              return null;
            }
            return { amount: tx.amount, status: tx.status };
          },
          { timeout: 45_000 },
        )
        .toEqual({ amount: expectedAmount, status: 'successful' });
    });
  },
});

const ensureRegistrationSectionResets = async (page: Page) => {
  const loadingStatus = page.getByText('Loading registration status').first();
  await loadingStatus.waitFor({ state: 'detached' });

  const cancelButton = page
    .locator('app-event-active-registration')
    .getByRole('button', { name: 'Cancel registration' })
    .first();

  if (await cancelButton.isVisible()) {
    await cancelButton.click();
    await loadingStatus.waitFor({ state: 'attached' }).catch(() => {
      /* ignore */
    });
    await loadingStatus.waitFor({ state: 'detached' });
  }
};

test.describe.configure({ tag: '@contracts' });

test.use({ seedDiscounts: true, storageState: defaultStateFile });

test('Contract: templates.createEventFromTemplate keeps ESN discount configuration @slow', async ({
  browser,
  discountTemplate,
  page,
  tenant,
  approveEvent,
  waitForSuccessfulRegistration,
}) => {
  test.setTimeout(120_000);
  const uniqueTitle = `Discounted event ${Date.now()}`;

  await page.context().addCookies([
    {
      domain: 'localhost',
      name: 'evorto-tenant',
      path: '/',
      value: tenant.domain,
    },
  ]);

  await page.goto('/templates');
  await page.getByText('Loading ...', { exact: false }).first().waitFor({ state: 'detached' });
  const templateLink = page
    .getByRole('link', {
      name: new RegExp(discountTemplate.templateTitle, 'i'),
    })
    .first();

  await expect(templateLink).toBeVisible({ timeout: 15_000 });
  await templateLink.scrollIntoViewIfNeeded();
  await templateLink.click();

  const createEventButton = page.getByRole('link', { name: 'Create event' });
  await expect(createEventButton).toBeVisible({ timeout: 10_000 });
  await createEventButton.click();

  await expect(page).toHaveURL(/create-event$/);
  await expect(page.getByLabel('Event title')).toBeVisible({
    timeout: 15_000,
  });

  const eventDetails = page.locator('app-event-general-form');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 1);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);

  await eventDetails.getByLabel('Event title').fill(uniqueTitle);
  await eventDetails.getByLabel('Start date').fill(formatDateInput(startDate));
  await eventDetails.getByLabel('Start time').fill('23:00');
  await eventDetails.getByLabel('End date').fill(formatDateInput(endDate));
  await eventDetails.getByLabel('End time').fill('01:00');

  const taxRateSelects = page.locator('mat-select[formcontrolname="stripeTaxRateId"]');
  const taxRateCount = await taxRateSelects.count();
  for (let index = 0; index < taxRateCount; index += 1) {
    const select = taxRateSelects.nth(index);
    if (await select.isDisabled()) {
      continue;
    }
    await select.click();
    const option = page
      .locator('mat-option[role="option"]')
      .filter({ hasNotText: /Loading tax rates|Failed to load tax rates/ })
      .first();
    await expect(option).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  }

  await page.getByRole('button', { name: 'Create event' }).click();
  await page.waitForURL(/\/events\/[^/]+$/);

  const eventUrl = page.url();
  const eventId = eventUrl.split('/').pop();
  if (!eventId) {
    throw new Error('Unable to resolve created event id.');
  }

  await approveEvent(eventId);

  await runWithStorageState(
    browser,
    userStateFile,
    async (userPage) => {
      await userPage.context().addCookies([
        {
          domain: 'localhost',
          name: 'evorto-tenant',
          path: '/',
          value: tenant.domain,
        },
      ]);
      await userPage.goto(eventUrl, { waitUntil: 'domcontentloaded' });
      await ensureRegistrationSectionResets(userPage);

      const optionCard = userPage
        .locator('app-event-registration-option')
        .filter({ hasText: discountTemplate.optionTitle });
      await expect(optionCard).toBeVisible();

      const payButton = optionCard.getByRole('button', {
        name: /Pay .* and register/i,
      });
      await expect(optionCard).toContainText(centsToCurrency(discountTemplate.fullPrice));
      await expect(optionCard).toContainText(centsToCurrency(discountTemplate.discountedPrice));
      await expect(payButton).toContainText(centsToCurrency(discountTemplate.discountedPrice));

      await payButton.click();

      const activeRegistration = userPage.locator('app-event-active-registration');
      await expect(activeRegistration).toBeVisible({ timeout: 15_000 });

      const payNowLink = activeRegistration.getByRole('link', { name: /Pay now/i });
      await expect(payNowLink).toBeVisible({ timeout: 15_000 });

      const popupPromise = userPage.waitForEvent('popup', { timeout: 10_000 }).catch(() => null);
      await payNowLink.click();

      let checkoutPage = await popupPromise;
      if (!checkoutPage) {
        await userPage.waitForURL(/https:\/\/checkout\.stripe\.com\//, { timeout: 30_000 });
        checkoutPage = userPage;
      }
      await checkoutPage.waitForLoadState('domcontentloaded');

      await fillTestCard(checkoutPage);
      await checkoutPage.getByTestId('hosted-payment-submit-button').click();

      if (checkoutPage !== userPage) {
        await checkoutPage.waitForEvent('close', { timeout: 30_000 }).catch(() => null);
      } else {
        await userPage.waitForURL(/\/events\/[^/]+$/, { timeout: 45_000 });
      }

      await expect(userPage.getByText('You are registered')).toBeVisible({ timeout: 45_000 });
    },
    tenant.domain,
  );

  const userId = usersToAuthenticate.find((entry) => entry.roles === 'user')?.id;
  if (!userId) {
    throw new Error('Unable to resolve test user for transaction verification');
  }

  await waitForSuccessfulRegistration({
    eventId,
    expectedAmount: discountTemplate.discountedPrice,
    userId,
  });
});
