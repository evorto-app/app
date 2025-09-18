import { Page } from '@playwright/test';
import { eq } from 'drizzle-orm';

import {
  adminStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../../../helpers/user-data';
import * as schema from '../../../../../src/db/schema';
import { test as base, expect } from '../../../../fixtures/parallel-test';
import { runWithStorageState } from '../../../../utils/auth-context';

const regularUser = usersToAuthenticate.find((entry) => entry.roles === 'user');
if (!regularUser) {
  throw new Error('Regular user fixture is missing.');
}

interface DiscountOption {
  discountedPrice: number;
  discountType: 'esnCard';
}

const centsToCurrency = (cents: number) =>
  new Intl.NumberFormat('de-DE', {
    currency: 'EUR',
    style: 'currency',
  }).format(cents / 100);

const test = base.extend({
  expiredCard: [
    async ({ database, tenant }, use) => {
      const card = await database.query.userDiscountCards.findFirst({
        where: {
          tenantId: tenant.id,
          userId: regularUser.id,
        },
      });

      if (!card) {
        await use();
        return;
      }

      const originalValidTo = card.validTo;

      await database
        .update(schema.userDiscountCards)
        .set({ validTo: new Date(Date.now() - 24 * 60 * 60 * 1000) })
        .where(eq(schema.userDiscountCards.id, card.id));

      await use();

      await database
        .update(schema.userDiscountCards)
        .set({ validTo: originalValidTo })
        .where(eq(schema.userDiscountCards.id, card.id));
    },
    { auto: false },
  ],
});

test.describe.configure({ mode: 'serial', tag: '@contracts' });

test.use({ storageState: userStateFile });

const findDiscountedEvent = (events: any[], registrations: any[]) => {
  const alreadyRegistered = new Set(
    registrations
      .filter((registration) => registration.userId === regularUser.id)
      .map((registration) => registration.eventId),
  );

  return events.find((event) => {
    if (event.status !== 'APPROVED' || event.unlisted) {
      return false;
    }
    if (alreadyRegistered.has(event.id)) {
      return false;
    }
    return event.registrationOptions.some((option: any) => {
      if (option.organizingRegistration || !option.isPaid) {
        return false;
      }
      const discounts = (option.discounts ?? []) as DiscountOption[];
      return discounts.some(
        (discount) => discount.discountedPrice < (option.price ?? 0),
      );
    });
  });
};

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
  eventTitle: string,
  expectedAmount: number,
) => {
  await runWithStorageState(browser, adminStateFile, async (financePage) => {
    await financePage.goto('/finance/transactions', {
      waitUntil: 'domcontentloaded',
    });

    const expectedText = centsToCurrency(expectedAmount);
    const row = financePage
      .getByRole('row', { name: new RegExp(eventTitle, 'i') })
      .first();
    await expect(row).toBeVisible();
    await expect(row.getByRole('cell').first()).toContainText(expectedText);
  });
};

test('Contract: events.pricing.selection applies ESN discount @slow', async ({
  browser,
  events,
  page,
  registrations,
  tenant,
}) => {
  const event = findDiscountedEvent(events, registrations);
  if (!event) {
    test.skip(true, 'No discounted paid event available for testing.');
  }

  const option = event.registrationOptions.find((candidate: any) => {
    if (candidate.organizingRegistration || !candidate.isPaid) {
      return false;
    }
    const discounts = (candidate.discounts ?? []) as DiscountOption[];
    return discounts.some(
      (discount) => discount.discountedPrice < (candidate.price ?? 0),
    );
  });

  if (!option || option.price == undefined) {
    test.skip(true, 'No registration option with discount found.');
  }

  const discounts = (option.discounts ?? []) as DiscountOption[];
  const lowest = discounts.reduce<DiscountOption | null>((best, candidate) => {
    if (candidate.discountedPrice >= option.price) {
      return best;
    }
    if (!best) {
      return candidate;
    }
    if (candidate.discountedPrice < best.discountedPrice) {
      return candidate;
    }
    if (candidate.discountedPrice === best.discountedPrice) {
      return candidate.discountType.localeCompare(best.discountType) < 0
        ? candidate
        : best;
    }
    return best;
  }, null);

  if (!lowest) {
    test.skip(true, 'Discount configuration missing eligible prices.');
  }

  await page.goto('/events');
  const eventLink = page.getByRole('link', { name: event.title }).first();
  await expect(eventLink).toBeVisible();
  await eventLink.click();

  await ensureRegistrationSectionResets(page);

  const optionCard = page
    .locator('app-event-registration-option')
    .filter({ hasText: option.title });
  await expect(optionCard).toBeVisible();

  const payButton = optionCard.getByRole('button', {
    name: /Pay .* and register/i,
  });
  await expect(payButton).toContainText(centsToCurrency(option.price));
  await payButton.click();

  const loadingStatus = page.getByText('Loading registration status').first();
  await loadingStatus.waitFor({ state: 'attached' }).catch(() => {
    /* noop */
  });
  await loadingStatus.waitFor({ state: 'detached' });

  const activeRegistration = page.locator('app-event-active-registration');
  await expect(activeRegistration).toBeVisible();

  await verifyTransactionAmount(browser, event.title, lowest.discountedPrice);

  const cancelButton = activeRegistration
    .getByRole('button', { name: 'Cancel registration' })
    .first();
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();

  await loadingStatus.waitFor({ state: 'attached' }).catch(() => {
    /* noop */
  });
  await loadingStatus.waitFor({ state: 'detached' });

  await expect(optionCard).toBeVisible();
});

test('Contract: events.pricing.selection falls back to base price for expired ESNcard @slow', async ({
  browser,
  events,
  expiredCard,
  page,
  registrations,
  tenant,
}) => {
  await expiredCard;

  const event = findDiscountedEvent(events, registrations);
  if (!event) {
    test.skip(true, 'No discounted paid event available for testing.');
  }

  const option = event.registrationOptions.find((candidate: any) => {
    if (candidate.organizingRegistration || !candidate.isPaid) {
      return false;
    }
    const discounts = (candidate.discounts ?? []) as DiscountOption[];
    return discounts.length > 0;
  });

  if (!option || option.price == undefined) {
    test.skip(true, 'No registration option with discount found.');
  }

  await page.goto('/events');
  const eventLink = page.getByRole('link', { name: event.title }).first();
  await expect(eventLink).toBeVisible();
  await eventLink.click();

  const warning = page.getByText(
    'Your discount card expires before the event starts',
  );
  await expect(warning).toBeVisible();

  await ensureRegistrationSectionResets(page);

  const optionCard = page
    .locator('app-event-registration-option')
    .filter({ hasText: option.title });
  await expect(optionCard).toBeVisible();

  const payButton = optionCard.getByRole('button', {
    name: /Pay .* and register/i,
  });
  await expect(payButton).toContainText(centsToCurrency(option.price));
  await payButton.click();

  const loadingStatus = page.getByText('Loading registration status').first();
  await loadingStatus.waitFor({ state: 'attached' }).catch(() => {
    /* noop */
  });
  await loadingStatus.waitFor({ state: 'detached' });

  await verifyTransactionAmount(browser, event.title, option.price);

  const cancelButton = page
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
});
