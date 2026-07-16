import { and, eq } from 'drizzle-orm';

import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { fillProtectedValue } from '../../support/utils/fill-protected-value';

const liveEsnCardIdentifier =
  process.env['E2E_LIVE_ESN_CARD_IDENTIFIER']?.trim();
const expiredEsnCardIdentifier =
  process.env['E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER']?.trim();
const seededEsnCardIdentifier = 'TEST-ESN-0001';

test.setTimeout(120_000);

// The identifier is an approved non-production credential. Keep it out of
// traces and value-bearing assertions even though GitHub masks secret logs.
test.use({
  screenshot: 'off',
  storageState: userStateFile,
  trace: 'off',
  video: 'off',
});

test('verifies active and expired ESN cards through the live provider @needs-live-esncard', async ({
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

  const restoreSeededCard = async () => {
    const validFrom = new Date();
    const validTo = new Date(validFrom.getTime() + 1000 * 60 * 60 * 24 * 180);
    await database
      .insert(schema.userDiscountCards)
      .values({
        identifier: seededEsnCardIdentifier,
        status: 'verified',
        tenantId: tenant.id,
        type: 'esnCard',
        userId: regularUser.id,
        validFrom,
        validTo,
      })
      .onConflictDoUpdate({
        set: {
          identifier: seededEsnCardIdentifier,
          status: 'verified',
          tenantId: tenant.id,
          validFrom,
          validTo,
        },
        target: [
          schema.userDiscountCards.userId,
          schema.userDiscountCards.tenantId,
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
          eq(schema.userDiscountCards.tenantId, tenant.id),
          eq(schema.userDiscountCards.type, 'esnCard'),
        ),
      );

    await page.goto('/profile#discounts');

    await expect(
      page.getByRole('heading', { level: 2, name: 'Discount Cards' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No discount cards on file.')).toBeVisible();

    await fillProtectedValue(
      page.getByRole('textbox', { name: 'ESN card number' }),
      'E2E_LIVE_ESN_CARD_IDENTIFIER',
      { trim: true },
    );
    await page.getByRole('button', { name: 'Save ESN card' }).click();

    await expect(page.getByText(/Status: Verified/)).toBeVisible({
      timeout: 20_000,
    });

    const savedCard = await database.query.userDiscountCards.findFirst({
      where: {
        tenantId: tenant.id,
        type: 'esnCard',
        userId: regularUser.id,
      },
    });
    expect(savedCard).toEqual(
      expect.objectContaining({
        status: 'verified',
        tenantId: tenant.id,
        type: 'esnCard',
        userId: regularUser.id,
      }),
    );
    expect(savedCard?.identifier === liveEsnCardIdentifier).toBe(true);
    expect(savedCard?.lastCheckedAt).toBeInstanceOf(Date);

    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByText(/Status: Verified/)).toBeVisible({
      timeout: 20_000,
    });

    const refreshedCard = await database.query.userDiscountCards.findFirst({
      where: {
        tenantId: tenant.id,
        type: 'esnCard',
        userId: regularUser.id,
      },
    });
    expect(refreshedCard).toEqual(
      expect.objectContaining({
        status: 'verified',
        tenantId: tenant.id,
        type: 'esnCard',
        userId: regularUser.id,
      }),
    );
    expect(refreshedCard?.identifier === liveEsnCardIdentifier).toBe(true);
    expect(refreshedCard?.lastCheckedAt).toBeInstanceOf(Date);

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('No discount cards on file.')).toBeVisible({
      timeout: 20_000,
    });

    const removedCard = await database.query.userDiscountCards.findFirst({
      where: {
        tenantId: tenant.id,
        type: 'esnCard',
        userId: regularUser.id,
      },
    });
    expect(removedCard).toBeUndefined();

    await fillProtectedValue(
      page.getByRole('textbox', { name: 'ESN card number' }),
      'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER',
      { trim: true },
    );
    await page.getByRole('button', { name: 'Save ESN card' }).click();

    await expect(page.getByText(/Status: Expired/)).toBeVisible({
      timeout: 20_000,
    });

    const savedExpiredCard = await database.query.userDiscountCards.findFirst({
      where: {
        tenantId: tenant.id,
        type: 'esnCard',
        userId: regularUser.id,
      },
    });
    expect(savedExpiredCard).toEqual(
      expect.objectContaining({
        status: 'expired',
        tenantId: tenant.id,
        type: 'esnCard',
        userId: regularUser.id,
      }),
    );
    expect(savedExpiredCard?.identifier === expiredEsnCardIdentifier).toBe(
      true,
    );
    expect(savedExpiredCard?.lastCheckedAt).toBeInstanceOf(Date);

    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByText(/Status: Expired/)).toBeVisible({
      timeout: 20_000,
    });

    const refreshedExpiredCard =
      await database.query.userDiscountCards.findFirst({
        where: {
          tenantId: tenant.id,
          type: 'esnCard',
          userId: regularUser.id,
        },
      });
    expect(refreshedExpiredCard).toEqual(
      expect.objectContaining({
        status: 'expired',
        tenantId: tenant.id,
        type: 'esnCard',
        userId: regularUser.id,
      }),
    );
    expect(refreshedExpiredCard?.identifier === expiredEsnCardIdentifier).toBe(
      true,
    );
    expect(refreshedExpiredCard?.lastCheckedAt).toBeInstanceOf(Date);

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('No discount cards on file.')).toBeVisible({
      timeout: 20_000,
    });

    const removedExpiredCard = await database.query.userDiscountCards.findFirst(
      {
        where: {
          tenantId: tenant.id,
          type: 'esnCard',
          userId: regularUser.id,
        },
      },
    );
    expect(removedExpiredCard).toBeUndefined();
  } finally {
    await restoreSeededCard();
  }
});
