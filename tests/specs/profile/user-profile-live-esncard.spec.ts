import { and, eq } from 'drizzle-orm';

import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

const liveEsnCardIdentifier =
  process.env['E2E_LIVE_ESN_CARD_IDENTIFIER']?.trim();
const seededEsnCardIdentifier = 'TEST-ESN-0001';

test.setTimeout(120_000);

test.use({ storageState: userStateFile });
test.skip(
  !liveEsnCardIdentifier,
  'E2E_LIVE_ESN_CARD_IDENTIFIER is required for live ESNcard provider coverage',
);

test('adds, refreshes, and removes a live ESN card @needs-live-esncard', async ({
  database,
  discounts,
  page,
}) => {
  void discounts;
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular profile user fixture');
  }

  const restoreSeededCard = async () => {
    const validFrom = new Date();
    const validTo = new Date(validFrom.getTime() + 1000 * 60 * 60 * 24 * 180);
    await database
      .insert(schema.userDiscountCards)
      .values({
        identifier: seededEsnCardIdentifier,
        status: 'verified',
        type: 'esnCard',
        userId: regularUser.id,
        validFrom,
        validTo,
      })
      .onConflictDoUpdate({
        set: {
          identifier: seededEsnCardIdentifier,
          status: 'verified',
          validFrom,
          validTo,
        },
        target: [
          schema.userDiscountCards.userId,
          schema.userDiscountCards.type,
        ],
      });
  };

  try {
    await database
      .delete(schema.userDiscountCards)
      .where(
        and(
          eq(schema.userDiscountCards.userId, regularUser.id),
          eq(schema.userDiscountCards.type, 'esnCard'),
        ),
      );

    await page.goto('/profile#discounts');

    await expect(
      page.getByRole('heading', { level: 2, name: 'Discount Cards' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No discount cards on file.')).toBeVisible();

    await page
      .getByRole('textbox', { name: 'ESN card number' })
      .fill(liveEsnCardIdentifier!);
    await page.getByRole('button', { name: 'Save ESN card' }).click();

    await expect(page.getByText(liveEsnCardIdentifier!)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/Status: Verified/)).toBeVisible();

    const savedCard = await database.query.userDiscountCards.findFirst({
      where: {
        identifier: liveEsnCardIdentifier!,
        type: 'esnCard',
        userId: regularUser.id,
      },
    });
    expect(savedCard).toEqual(
      expect.objectContaining({
        identifier: liveEsnCardIdentifier,
        status: 'verified',
        type: 'esnCard',
        userId: regularUser.id,
      }),
    );
    expect(savedCard?.lastCheckedAt).toBeInstanceOf(Date);

    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByText(/Status: Verified/)).toBeVisible({
      timeout: 20_000,
    });

    const refreshedCard = await database.query.userDiscountCards.findFirst({
      where: {
        identifier: liveEsnCardIdentifier!,
        type: 'esnCard',
        userId: regularUser.id,
      },
    });
    expect(refreshedCard).toEqual(
      expect.objectContaining({
        identifier: liveEsnCardIdentifier,
        status: 'verified',
        type: 'esnCard',
        userId: regularUser.id,
      }),
    );
    expect(refreshedCard?.lastCheckedAt).toBeInstanceOf(Date);

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('No discount cards on file.')).toBeVisible({
      timeout: 20_000,
    });

    const removedCard = await database.query.userDiscountCards.findFirst({
      where: {
        identifier: liveEsnCardIdentifier!,
        type: 'esnCard',
        userId: regularUser.id,
      },
    });
    expect(removedCard).toBeUndefined();
  } finally {
    await restoreSeededCard();
  }
});
