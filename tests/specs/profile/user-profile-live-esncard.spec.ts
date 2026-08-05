import { and, eq } from 'drizzle-orm';

import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { fillProtectedValue } from '../../support/utils/fill-protected-value';
import type { Locator } from '@playwright/test';

const clickHydratedAction = async (action: Locator): Promise<void> => {
  await expect(action).not.toHaveAttribute('jsaction', /click/, {
    timeout: 20_000,
  });
  await action.click();
};

const liveEsnCardIdentifier =
  process.env['E2E_LIVE_ESN_CARD_IDENTIFIER']?.trim();
const expiredEsnCardIdentifier =
  process.env['E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER']?.trim();
const seededEsnCardIdentifier = 'DE-2026-000184';

test.setTimeout(120_000);

// The identifier is an approved non-production credential. Keep it out of
// traces and value-bearing assertions even though GitHub masks secret logs.
test.use({
  screenshot: 'off',
  storageState: userStateFile,
  trace: 'off',
  video: 'off',
});

test('verifies active and expired ESNcards through the live provider @needs-live-esncard', async ({
  database,
  discounts,
  page,
  tenant,
}) => {
  void discounts;
  if (!liveEsnCardIdentifier) {
    throw new Error(
      'E2E_LIVE_ESN_CARD_IDENTIFIER is required for live ESNcard provider coverage',
    );
  }
  if (!expiredEsnCardIdentifier) {
    throw new Error(
      'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER is required for live expired-card provider coverage',
    );
  }
  if (expiredEsnCardIdentifier === liveEsnCardIdentifier) {
    throw new Error('Active and expired ESNcard identifiers must be different');
  }
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular profile user fixture');
  }
  const readCurrentCard = () =>
    database.query.userDiscountCards.findFirst({
      where: {
        tenantId: tenant.id,
        type: 'esnCard',
        userId: regularUser.id,
      },
    });
  type CurrentCard = Awaited<ReturnType<typeof readCurrentCard>>;

  const expectStoredCard = (
    card: CurrentCard,
    status: 'expired' | 'verified',
  ) => {
    expect({
      status: card?.status,
      tenantId: card?.tenantId,
      type: card?.type,
      userId: card?.userId,
    }).toEqual({
      status,
      tenantId: tenant.id,
      type: 'esnCard',
      userId: regularUser.id,
    });
  };

  const restoreSeededCard = async () => {
    const validFrom = new Date();
    const validTo = new Date(validFrom.getTime() + 1000 * 60 * 60 * 24 * 180);
    await database
      .delete(schema.userDiscountCards)
      .where(
        and(
          eq(schema.userDiscountCards.userId, regularUser.id),
          eq(schema.userDiscountCards.tenantId, tenant.id),
          eq(schema.userDiscountCards.type, 'esnCard'),
        ),
      );
    await database.insert(schema.userDiscountCards).values({
      identifier: seededEsnCardIdentifier,
      status: 'verified',
      tenantId: tenant.id,
      type: 'esnCard',
      userId: regularUser.id,
      validFrom,
      validTo,
    });
  };

  try {
    await database
      .delete(schema.userDiscountCards)
      .where(
        and(
          eq(schema.userDiscountCards.userId, regularUser.id),
          eq(schema.userDiscountCards.tenantId, tenant.id),
          eq(schema.userDiscountCards.type, 'esnCard'),
        ),
      );

    await page.goto('/profile/discounts');
    const profileDiscounts = page.locator('app-profile-discounts');

    await expect(
      profileDiscounts.getByRole('heading', {
        level: 1,
        name: 'Discount Cards',
      }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      profileDiscounts.getByText('No discount cards added.'),
    ).toBeVisible();

    const saveEsnCard = profileDiscounts.getByRole('button', {
      name: 'Save ESNcard',
    });
    await expect(saveEsnCard).not.toHaveAttribute('jsaction', /click/, {
      timeout: 20_000,
    });
    await fillProtectedValue(
      profileDiscounts.getByRole('textbox', { name: 'ESNcard number' }),
      'E2E_LIVE_ESN_CARD_IDENTIFIER',
      { trim: true },
    );
    await saveEsnCard.click();

    await expect(profileDiscounts.getByText(/Verified/)).toBeVisible({
      timeout: 20_000,
    });

    const savedCard = await readCurrentCard();
    expectStoredCard(savedCard, 'verified');
    expect(savedCard?.identifier === liveEsnCardIdentifier).toBe(true);
    const savedCheckTime = savedCard?.lastCheckedAt?.getTime();
    if (savedCheckTime === undefined) {
      throw new Error('Expected saved ESNcard check time');
    }

    await clickHydratedAction(
      profileDiscounts.getByRole('button', { name: 'Check again' }),
    );
    await expect
      .poll(
        async () => {
          const currentCheckTime = (
            await readCurrentCard()
          )?.lastCheckedAt?.getTime();
          return currentCheckTime ?? savedCheckTime;
        },
        { timeout: 20_000 },
      )
      .not.toBe(savedCheckTime);

    const refreshedCard = await readCurrentCard();
    expectStoredCard(refreshedCard, 'verified');
    expect(refreshedCard?.identifier === liveEsnCardIdentifier).toBe(true);
    expect(refreshedCard?.lastCheckedAt).toBeInstanceOf(Date);

    await clickHydratedAction(
      profileDiscounts.getByRole('button', { name: 'Remove' }),
    );
    await expect(
      profileDiscounts.getByText('No discount cards added.'),
    ).toBeVisible({ timeout: 20_000 });

    const removedCard = await readCurrentCard();
    expect(removedCard).toBeUndefined();

    await fillProtectedValue(
      profileDiscounts.getByRole('textbox', { name: 'ESNcard number' }),
      'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER',
      { trim: true },
    );
    await clickHydratedAction(
      profileDiscounts.getByRole('button', { name: 'Save ESNcard' }),
    );

    await expect(profileDiscounts.getByText(/Expired/)).toBeVisible({
      timeout: 20_000,
    });

    const savedExpiredCard = await readCurrentCard();
    expectStoredCard(savedExpiredCard, 'expired');
    expect(savedExpiredCard?.identifier === expiredEsnCardIdentifier).toBe(
      true,
    );
    const savedExpiredCheckTime = savedExpiredCard?.lastCheckedAt?.getTime();
    if (savedExpiredCheckTime === undefined) {
      throw new Error('Expected saved expired ESNcard check time');
    }

    await clickHydratedAction(
      profileDiscounts.getByRole('button', { name: 'Check again' }),
    );
    await expect
      .poll(
        async () => {
          const currentCheckTime = (
            await readCurrentCard()
          )?.lastCheckedAt?.getTime();
          return currentCheckTime ?? savedExpiredCheckTime;
        },
        { timeout: 20_000 },
      )
      .not.toBe(savedExpiredCheckTime);

    const refreshedExpiredCard = await readCurrentCard();
    expectStoredCard(refreshedExpiredCard, 'expired');
    expect(refreshedExpiredCard?.identifier === expiredEsnCardIdentifier).toBe(
      true,
    );
    expect(refreshedExpiredCard?.lastCheckedAt).toBeInstanceOf(Date);

    await clickHydratedAction(
      profileDiscounts.getByRole('button', { name: 'Remove' }),
    );
    await expect(
      profileDiscounts.getByText('No discount cards added.'),
    ).toBeVisible({ timeout: 20_000 });

    const removedExpiredCard = await readCurrentCard();
    expect(removedExpiredCard).toBeUndefined();
  } finally {
    await restoreSeededCard();
  }
});
