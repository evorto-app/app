import type { Page } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { adminStateFile, userStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { formatInclusiveTaxLabel } from '../../../src/shared/price/format-inclusive-tax-label';
import { expect, test } from '../../support/fixtures/parallel-test';

const priceText = (amountInCents: number) =>
  `€${(amountInCents / 100).toFixed(2)}`;

const registrationOptionCard = (page: Page, optionTitle: string) =>
  page.locator('app-event-registration-option').filter({
    has: page.getByRole('heading', { level: 3, name: optionTitle }),
  });

test.describe('Inclusive price labels', () => {
  test.describe('without a verified discount card', () => {
    test.use({ storageState: adminStateFile });

    test('paid prices display inclusive tax labels', async ({
      database,
      page,
      seeded,
    }) => {
      const paidEventId = seeded.scenario.events.paidOpen.eventId;
      const paidOptionId = seeded.scenario.events.paidOpen.optionId;
      const paidOption =
        await database.query.eventRegistrationOptions.findFirst({
          where: { id: paidOptionId },
        });
      if (!paidOption?.stripeTaxRateId || !paidOption.isPaid) {
        throw new Error('Expected seeded paid event option with a tax rate');
      }
      const taxRate = await database.query.tenantStripeTaxRates.findFirst({
        where: { stripeTaxRateId: paidOption.stripeTaxRateId },
      });
      if (!taxRate) {
        throw new Error('Expected seeded tax rate for paid event option');
      }

      await page.goto(`/events/${paidEventId}`);
      await expect(page).toHaveURL(`/events/${paidEventId}`);

      const card = registrationOptionCard(page, paidOption.title);
      await expect(card.getByText(priceText(paidOption.price))).toBeVisible();
      await expect(
        card.getByText(formatInclusiveTaxLabel(taxRate)),
      ).toBeVisible();
    });

    test('free prices do not show tax labels', async ({
      database,
      page,
      seeded,
    }) => {
      const freeEventId = seeded.scenario.events.freeOpen.eventId;
      const freeOptionId = seeded.scenario.events.freeOpen.optionId;
      const freeOption =
        await database.query.eventRegistrationOptions.findFirst({
          where: { id: freeOptionId },
        });
      if (!freeOption || freeOption.isPaid) {
        throw new Error('Expected seeded free event option');
      }

      await page.goto(`/events/${freeEventId}`);
      await expect(page).toHaveURL(`/events/${freeEventId}`);

      const card = registrationOptionCard(page, freeOption.title);
      await expect(card.locator('app-price-with-tax')).toHaveCount(0);
      await expect(card.getByText('Incl.')).toHaveCount(0);
      await expect(card.getByText('Tax free')).toHaveCount(0);
    });

    test('zero percent tax rate shows Tax free label', async ({
      database,
      page,
      seeded,
      tenant,
    }) => {
      const paidEventId = seeded.scenario.events.paidOpen.eventId;
      const paidOptionId = seeded.scenario.events.paidOpen.optionId;
      const paidOption =
        await database.query.eventRegistrationOptions.findFirst({
          where: { id: paidOptionId },
        });
      const zeroRate = await database.query.tenantStripeTaxRates.findFirst({
        where: {
          percentage: '0',
          tenantId: tenant.id,
        },
      });
      if (!paidOption?.stripeTaxRateId || !zeroRate) {
        throw new Error(
          'Expected seeded paid option and zero percent tax rate',
        );
      }

      await database
        .update(schema.eventRegistrationOptions)
        .set({ stripeTaxRateId: zeroRate.stripeTaxRateId })
        .where(eq(schema.eventRegistrationOptions.id, paidOptionId));

      try {
        await page.goto(`/events/${paidEventId}`);
        await expect(page).toHaveURL(`/events/${paidEventId}`);

        const card = registrationOptionCard(page, paidOption.title);
        await expect(card.getByText(priceText(paidOption.price))).toBeVisible();
        await expect(card.getByText('Tax free')).toBeVisible();
      } finally {
        await database
          .update(schema.eventRegistrationOptions)
          .set({ stripeTaxRateId: paidOption.stripeTaxRateId })
          .where(eq(schema.eventRegistrationOptions.id, paidOptionId));
      }
    });

    test('fallback label shown when tax rate details are unavailable', async ({
      database,
      page,
      seeded,
    }) => {
      const paidEventId = seeded.scenario.events.paidOpen.eventId;
      const paidOptionId = seeded.scenario.events.paidOpen.optionId;
      const paidOption =
        await database.query.eventRegistrationOptions.findFirst({
          where: { id: paidOptionId },
        });
      if (!paidOption?.stripeTaxRateId) {
        throw new Error('Expected seeded paid event option with a tax rate');
      }

      await database
        .update(schema.eventRegistrationOptions)
        .set({ stripeTaxRateId: 'txr_missing_seed_details' })
        .where(eq(schema.eventRegistrationOptions.id, paidOptionId));

      try {
        await page.goto(`/events/${paidEventId}`);
        await expect(page).toHaveURL(`/events/${paidEventId}`);

        const card = registrationOptionCard(page, paidOption.title);
        await expect(card.getByText(priceText(paidOption.price))).toBeVisible();
        await expect(card.getByText('Incl. Tax')).toBeVisible();
      } finally {
        await database
          .update(schema.eventRegistrationOptions)
          .set({ stripeTaxRateId: paidOption.stripeTaxRateId })
          .where(eq(schema.eventRegistrationOptions.id, paidOptionId));
      }
    });

    test('template detail view shows inclusive labels for paid options', async ({
      database,
      page,
      templates,
    }) => {
      const paidTemplate = templates.find(
        (template) => template.seedKey === 'sports',
      );
      if (!paidTemplate) {
        throw new Error('Expected seeded sports template');
      }
      const paidOption =
        await database.query.templateRegistrationOptions.findFirst({
          where: {
            isPaid: true,
            organizingRegistration: false,
            templateId: paidTemplate.id,
          },
        });
      if (!paidOption?.stripeTaxRateId) {
        throw new Error('Expected seeded paid template option with a tax rate');
      }
      const taxRate = await database.query.tenantStripeTaxRates.findFirst({
        where: { stripeTaxRateId: paidOption.stripeTaxRateId },
      });
      if (!taxRate) {
        throw new Error('Expected seeded template tax rate');
      }

      await page.goto(`/templates/${paidTemplate.id}`);
      await expect(page).toHaveURL(`/templates/${paidTemplate.id}`);

      const card = page
        .getByRole('heading', { level: 3, name: paidOption.title })
        .locator('..')
        .locator('..');
      await expect(card.getByText(priceText(paidOption.price))).toBeVisible();
      await expect(
        card.getByText(formatInclusiveTaxLabel(taxRate)),
      ).toBeVisible();
    });
  });

  test.describe('with a verified discount card', () => {
    test.use({ storageState: userStateFile });

    test('discounted prices maintain inclusive tax labels', async ({
      database,
      page,
      seeded,
    }) => {
      const paidEventId = seeded.scenario.events.paidOpen.eventId;
      const paidOptionId = seeded.scenario.events.paidOpen.optionId;
      const paidOption =
        await database.query.eventRegistrationOptions.findFirst({
          where: { id: paidOptionId },
        });
      if (!paidOption?.stripeTaxRateId || !paidOption.isPaid) {
        throw new Error('Expected seeded paid event option with a tax rate');
      }
      const taxRate = await database.query.tenantStripeTaxRates.findFirst({
        where: { stripeTaxRateId: paidOption.stripeTaxRateId },
      });
      if (!taxRate) {
        throw new Error('Expected seeded tax rate for paid event option');
      }
      const discountedPrice = Math.max(0, paidOption.price - 500);

      await page.goto(`/events/${paidEventId}`);
      await expect(page).toHaveURL(`/events/${paidEventId}`);

      const card = registrationOptionCard(page, paidOption.title);
      await expect(card.getByText(priceText(discountedPrice))).toBeVisible();
      await expect(
        card.getByText(formatInclusiveTaxLabel(taxRate)),
      ).toBeVisible();
      await expect(card.getByText('ESNcard discount applied')).toBeVisible();
    });
  });
});
