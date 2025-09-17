import { promises as fs } from 'node:fs';

import { Page } from '@playwright/test';
import { eq } from 'drizzle-orm';

import {
  adminStateFile,
  defaultStateFile,
  userStateFile,
} from '../../../../helpers/user-data';
import { createId } from '../../../../src/db/create-id';
import * as schema from '../../../../src/db/schema';
import { expect, test as base } from '../../../fixtures/parallel-test';

interface DiscountTemplateFixture {
  categoryTitle: string;
  templateId: string;
  templateTitle: string;
  optionTitle: string;
  fullPrice: number;
  discountedPrice: number;
}

const centsToCurrency = (cents: number) =>
  new Intl.NumberFormat('de-DE', {
    currency: 'EUR',
    style: 'currency',
  }).format(cents / 100);

const loadState = async (statePath: string, tenantDomain: string) => {
  const raw = await fs.readFile(statePath, 'utf-8');
  const state = JSON.parse(raw) as {
    cookies: Array<{
      domain: string;
      expires?: number;
      name: string;
      path: string;
      value: string;
    }>;
    origins: unknown[];
  };

  const cookie = {
    domain: 'localhost',
    expires: -1,
    httpOnly: false,
    name: 'evorto-tenant',
    path: '/',
    sameSite: 'Lax' as const,
    secure: false,
    value: tenantDomain,
  };

  state.cookies = state.cookies.filter((c) => c.name !== 'evorto-tenant');
  state.cookies.push(cookie);
  return state;
};

const test = base.extend<{
  discountTemplate: DiscountTemplateFixture;
}>({
  discountTemplate: async ({ database, tenant }, use) => {
    const templates = await database.query.eventTemplates.findMany({
      where: { tenantId: tenant.id },
      with: {
        category: true,
        registrationOptions: true,
      },
    });

    const template = templates.find((entry) =>
      entry.registrationOptions.some(
        (option) => option.isPaid && !option.organizingRegistration,
      ),
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

    const originalTitle = template.title;
    const originalDiscounts = participantOption.discounts ?? [];
    const originalPrice = participantOption.price;

    const patchedTitle = `Discount template ${createId().slice(-6)}`;
    const discountConfiguration = [
      { discountType: 'esnCard' as const, discountedPrice: Math.max(0, originalPrice - 1000) },
    ];

    await database
      .update(schema.eventTemplates)
      .set({ title: patchedTitle })
      .where(eq(schema.eventTemplates.id, template.id));

    await database
      .update(schema.templateRegistrationOptions)
      .set({ discounts: discountConfiguration })
      .where(eq(schema.templateRegistrationOptions.id, participantOption.id));

    try {
      await use({
        categoryTitle: template.category.title,
        discountedPrice: discountConfiguration[0].discountedPrice,
        fullPrice: originalPrice,
        optionTitle: participantOption.title,
        templateId: template.id,
        templateTitle: patchedTitle,
      });
    } finally {
      await database
        .update(schema.templateRegistrationOptions)
        .set({ discounts: originalDiscounts })
        .where(eq(schema.templateRegistrationOptions.id, participantOption.id));

      await database
        .update(schema.eventTemplates)
        .set({ title: originalTitle })
        .where(eq(schema.eventTemplates.id, template.id));
    }
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

const verifyTransactionAmount = async (
  browser: Parameters<typeof test>[0]['browser'],
  tenantDomain: string,
  eventTitle: string,
  expectedAmount: number,
) => {
  const context = await browser.newContext({
    storageState: await loadState(adminStateFile, tenantDomain),
  });
  const financePage = await context.newPage();
  try {
    await financePage.goto('/finance/transactions', {
      waitUntil: 'domcontentloaded',
    });

    const expectedText = centsToCurrency(expectedAmount);
    const row = financePage
      .getByRole('row', { name: new RegExp(eventTitle, 'i') })
      .first();
    await expect(row).toBeVisible();
    await expect(row.getByRole('cell').first()).toContainText(expectedText);
  } finally {
    await context.close();
  }
};

test.describe.configure({ tag: '@contracts' });

test.use({ storageState: defaultStateFile });

test(
  'Contract: templates.createEventFromTemplate keeps ESN discount configuration @slow',
  async ({ browser, discountTemplate, page, tenant }) => {
    test.fixme(true, 'Template creation flow is not accessible via UI navigation yet.');
    const uniqueTitle = `Discounted event ${Date.now()}`;

    await page.goto('/templates');
    await page
      .getByText('Loading ...', { exact: false })
      .first()
      .waitFor({ state: 'detached' });
    // Template navigation collapses on smaller breakpoints; when the nav is hidden
    // the router link is not rendered. Fall back to direct navigation when the link
    // is not immediately available.
    await page.goto(`/templates/${discountTemplate.templateId}/create-event`);
    await page.waitForURL(/create-event$/);
    await expect(page.getByLabel('Event title')).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('Event title').fill(uniqueTitle);
    await page.getByLabel('Start date').fill('12/31/2030');
    await page.getByLabel('Start time').fill('09:00');
    await page.getByLabel('End date').fill('01/01/2031');
    await page.getByLabel('End time').fill('18:00');

    await page.getByRole('button', { name: 'Create event' }).click();
    await page.waitForURL(/\/events\/[^/]+$/);

    const eventUrl = page.url();

    const userContext = await browser.newContext({
      storageState: await loadState(userStateFile, tenant.domain),
    });
    const userPage = await userContext.newPage();

    try {
      await userPage.goto(eventUrl, { waitUntil: 'domcontentloaded' });
      await ensureRegistrationSectionResets(userPage);

      const optionCard = userPage
        .locator('app-event-registration-option')
        .filter({ hasText: discountTemplate.optionTitle });
      await expect(optionCard).toBeVisible();

      const payButton = optionCard.getByRole('button', {
        name: /Pay .* and register/i,
      });
      await expect(payButton).toContainText(
        centsToCurrency(discountTemplate.fullPrice),
      );
      await payButton.click();

      const loadingStatus = userPage
        .getByText('Loading registration status')
        .first();
      await loadingStatus.waitFor({ state: 'attached' }).catch(() => {
        /* noop */
      });
      await loadingStatus.waitFor({ state: 'detached' });

      await verifyTransactionAmount(
        browser,
        tenant.domain,
        uniqueTitle,
        discountTemplate.discountedPrice,
      );

      const cancelButton = userPage
        .locator('app-event-active-registration')
        .getByRole('button', { name: 'Cancel registration' })
        .first();
      await expect(cancelButton).toBeVisible();
      await cancelButton.click();

      await loadingStatus.waitFor({ state: 'attached' }).catch(() => {
        /* noop */
      });
      await loadingStatus.waitFor({ state: 'detached' });

      await expect(optionCard).toBeVisible();
    } finally {
      await userContext.close();
    }
  },
);
