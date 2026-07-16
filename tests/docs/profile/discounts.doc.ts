import { and, eq } from 'drizzle-orm';

import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import {
  esnCardActionDisabled,
  esnCardActionLabel,
  esnCardMutationErrorMessage,
  esnCardSaveDisabled,
  esnCardStatusLabel,
  esnCardSubmitPayloadFromIdentifier,
} from '../../../src/app/profile/user-profile/user-profile.esn-card';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { fillProtectedValue } from '../../support/utils/fill-protected-value';
import type { Locator } from '@playwright/test';

// Approved provider identifiers are sensitive test credentials. The profile
// renders them, so this file must never produce a trace, automatic screenshot,
// or video, including after a live-provider test failure. Explicitly attached
// documentation screenshots remain available to the non-live seeded journey.
test.use({
  screenshot: 'off',
  storageState: userStateFile,
  trace: 'off',
  video: 'off',
});

const clickHydratedAction = async (action: Locator): Promise<void> => {
  await expect(action).not.toHaveAttribute('jsaction', /click/, {
    timeout: 20_000,
  });
  await action.click();
};

test('Understand ESN discount card states', async ({}, testInfo) => {
  expect(esnCardStatusLabel('verified')).toBe('Verified');
  expect(esnCardStatusLabel('expired')).toBe('Expired');
  expect(esnCardStatusLabel('invalid')).toBe('Invalid');
  expect(esnCardStatusLabel('unverified')).toBe('Needs verification');
  expect(esnCardActionLabel('save', true)).toBe('Checking ESN card...');
  expect(esnCardActionLabel('refresh', true)).toBe('Refreshing...');
  expect(esnCardActionLabel('remove', true)).toBe('Removing...');
  expect(
    esnCardSaveDisabled({
      formInvalid: false,
      formSubmitting: false,
      mutationPending: true,
    }),
  ).toBe(true);
  expect(
    esnCardActionDisabled({
      deletePending: false,
      refreshPending: true,
      upsertPending: false,
    }),
  ).toBe(true);
  expect(esnCardSubmitPayloadFromIdentifier('  ESN-1234  ')).toEqual({
    identifier: 'ESN-1234',
    type: 'esnCard',
  });
  expect(
    esnCardMutationErrorMessage('save', {
      message: 'ESNcard validation provider is unavailable',
    }),
  ).toBe("We couldn't check this ESN card. Check the number and try again.");

  await testInfo.attach('markdown', {
    body: `
# ESN Discount Card States

The profile discount-card form accepts one ESN card per person and ignores spaces around the card number before validation. The save button says **Checking ESN card...** while Evorto validates the card, and refresh/remove actions show their own pending labels while those actions are in progress.

Evorto shows readable card statuses: **Verified**, **Expired**, **Invalid**, and **Needs verification**. Save, refresh, and remove stay disabled while any ESNcard action is pending, so overlapping changes cannot occur.

A temporary verification problem is not treated as an invalid card. Evorto shows **We couldn't check this ESN card. Check the number and try again.** and leaves the saved ESNcard unchanged so you can try again later.
`,
  });
});

const seededEsnCardIdentifier = 'TEST-ESN-0001';

test('Manage ESN discount card @finance', async ({
  discounts,
  database,
  page,
  tenant,
}, testInfo) => {
  void discounts;
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular profile user fixture');
  }

  await page.goto('/profile#discounts');

  const profilePage = page.locator('app-user-profile');
  await expect(profilePage).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
# ESN Discount Card

Open your profile's **Discounts** section directly when you want to review or update discount cards. Add your ESN card to receive discounted prices on eligible events. Your card is validated against esncard.org and discounts apply only while the card is valid.
`,
  });

  await expect(
    page.getByRole('heading', { level: 2, name: 'Discount Cards' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('ESN card', { exact: true })).toBeVisible();
  await expect(page.getByText(seededEsnCardIdentifier)).toBeVisible();
  await expect(page.getByText(/Status: Verified/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  const seededEsnCard = await database.query.userDiscountCards.findFirst({
    where: {
      identifier: seededEsnCardIdentifier,
      tenantId: tenant.id,
      type: 'esnCard',
      userId: regularUser.id,
    },
  });
  expect(seededEsnCard).toEqual(
    expect.objectContaining({
      identifier: seededEsnCardIdentifier,
      status: 'verified',
      tenantId: tenant.id,
      type: 'esnCard',
      userId: regularUser.id,
    }),
  );
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { level: 2, name: 'Discount Cards' }),
    page,
    'Discount cards section',
  );

  await testInfo.attach('markdown', {
    body: `
If you already added your ESN card, you will see a readable verification status and validity here. You can refresh its status or remove it. Use the form to add or update your ESN card number. The profile page shows when a check is in progress and explains any problem that needs your attention.
`,
  });

  await page.getByRole('textbox', { name: 'ESN card number' }).fill('short');
  await page.getByRole('textbox', { name: 'ESN card number' }).press('Tab');
  await expect(page.getByText(/Enter a valid ESN card number/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save ESN card' }),
  ).toBeDisabled();
  const unchangedSeededEsnCard =
    await database.query.userDiscountCards.findFirst({
      where: {
        identifier: seededEsnCardIdentifier,
        type: 'esnCard',
        userId: regularUser.id,
      },
    });
  expect(unchangedSeededEsnCard).toEqual(
    expect.objectContaining({
      identifier: seededEsnCardIdentifier,
      status: 'verified',
      type: 'esnCard',
      userId: regularUser.id,
    }),
  );
});

test.describe('Live ESNcard verification', () => {
  test.setTimeout(120_000);

  test('Add, refresh, and remove active and expired cards @needs-live-esncard', async ({
    database,
    discounts,
    page,
    tenant,
  }, testInfo) => {
    void discounts;
    const liveEsnCardIdentifier =
      process.env['E2E_LIVE_ESN_CARD_IDENTIFIER']?.trim();
    const expiredEsnCardIdentifier =
      process.env['E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER']?.trim();
    if (!liveEsnCardIdentifier) {
      throw new Error(
        'E2E_LIVE_ESN_CARD_IDENTIFIER is required for live ESNcard documentation',
      );
    }
    if (!expiredEsnCardIdentifier) {
      throw new Error(
        'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER is required for live expired-card documentation',
      );
    }
    if (expiredEsnCardIdentifier === liveEsnCardIdentifier) {
      throw new Error(
        'Active and expired ESNcard identifiers must be different',
      );
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

      await page.goto('/');
      await testInfo.attach('markdown', {
        body: `
# Verify an ESNcard

{% callout type="note" title="Before you start" %}
- Sign in as an ordinary member of the organization whose discounts you want to use. No administrator access is required; members manage only their own card from their own profile.
- The current organization must have enabled ESNcard discounts. Organizations that do not use the program do not show the **Discounts** profile section.
- Have your current ESNcard number ready.
{% /callout %}

The card belongs to your Evorto account, but you manage its status inside the current organization. Only a **Verified** card makes you eligible for that organization's ESNcard discounts. An expired card remains visible as **Expired** and does not grant a discount.

Starting from the normal application navigation, select **Profile**, then choose **Discounts**. Before saving, check that you entered the intended card number. Selecting **Save ESN card** checks whether it is currently valid.
`,
      });

      await clickHydratedAction(
        page.getByRole('link', { name: 'Profile', exact: true }),
      );
      await expect(page.locator('app-user-profile')).toBeVisible();
      await clickHydratedAction(
        page.getByRole('button', { name: 'Discounts' }),
      );
      await expect(
        page.getByRole('heading', { level: 2, name: 'Discount Cards' }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('No discount cards on file.')).toBeVisible();

      await fillProtectedValue(
        page.getByRole('textbox', { name: 'ESN card number' }),
        'E2E_LIVE_ESN_CARD_IDENTIFIER',
        { trim: true },
      );
      await clickHydratedAction(
        page.getByRole('button', { name: 'Save ESN card' }),
      );
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
      expect(savedCard?.status).toBe('verified');
      expect(savedCard?.tenantId).toBe(tenant.id);
      expect(savedCard?.type).toBe('esnCard');
      expect(savedCard?.userId).toBe(regularUser.id);
      expect(savedCard?.identifier === liveEsnCardIdentifier).toBe(true);
      expect(savedCard?.lastCheckedAt).toBeInstanceOf(Date);

      await testInfo.attach('markdown', {
        body: `
## Confirm and refresh an active card

A successful check shows **Status: Verified** and records when the card was last checked.

Select **Refresh** to check the card's current state again. If verification is temporarily unavailable, Evorto shows **We couldn't check this ESN card. Check the number and try again.** and keeps the saved card unchanged; try again later.
`,
      });

      await clickHydratedAction(page.getByRole('button', { name: 'Refresh' }));
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
      expect(refreshedCard?.status).toBe('verified');
      expect(refreshedCard?.tenantId).toBe(tenant.id);
      expect(refreshedCard?.type).toBe('esnCard');
      expect(refreshedCard?.userId).toBe(regularUser.id);
      expect(refreshedCard?.identifier === liveEsnCardIdentifier).toBe(true);
      expect(refreshedCard?.lastCheckedAt).toBeInstanceOf(Date);

      await clickHydratedAction(page.getByRole('button', { name: 'Remove' }));
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

      await testInfo.attach('markdown', {
        body: `
## Remove the active card and check an expired card

Select **Remove** when this card should no longer be associated with your profile. **No discount cards on file** confirms that the card is no longer linked to your Evorto profile; removing it does not cancel or change the ESNcard itself.

An expired card remains visible as **Status: Expired** and no longer grants discounts. Enter a current ESN card number and select **Save ESN card** to replace it, or select **Remove** if you no longer want a card on your profile.
`,
      });

      await fillProtectedValue(
        page.getByRole('textbox', { name: 'ESN card number' }),
        'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER',
        { trim: true },
      );
      await clickHydratedAction(
        page.getByRole('button', { name: 'Save ESN card' }),
      );
      await expect(page.getByText(/Status: Expired/)).toBeVisible({
        timeout: 20_000,
      });

      const savedExpiredCard = await database.query.userDiscountCards.findFirst(
        {
          where: {
            tenantId: tenant.id,
            type: 'esnCard',
            userId: regularUser.id,
          },
        },
      );
      expect(savedExpiredCard?.status).toBe('expired');
      expect(savedExpiredCard?.tenantId).toBe(tenant.id);
      expect(savedExpiredCard?.type).toBe('esnCard');
      expect(savedExpiredCard?.userId).toBe(regularUser.id);
      expect(savedExpiredCard?.identifier === expiredEsnCardIdentifier).toBe(
        true,
      );
      expect(savedExpiredCard?.lastCheckedAt).toBeInstanceOf(Date);

      await clickHydratedAction(page.getByRole('button', { name: 'Refresh' }));
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
      expect(refreshedExpiredCard?.status).toBe('expired');
      expect(refreshedExpiredCard?.tenantId).toBe(tenant.id);
      expect(refreshedExpiredCard?.type).toBe('esnCard');
      expect(refreshedExpiredCard?.userId).toBe(regularUser.id);
      expect(
        refreshedExpiredCard?.identifier === expiredEsnCardIdentifier,
      ).toBe(true);
      expect(refreshedExpiredCard?.lastCheckedAt).toBeInstanceOf(Date);

      await clickHydratedAction(page.getByRole('button', { name: 'Remove' }));
      await expect(page.getByText('No discount cards on file.')).toBeVisible({
        timeout: 20_000,
      });
      const removedExpiredCard =
        await database.query.userDiscountCards.findFirst({
          where: {
            tenantId: tenant.id,
            type: 'esnCard',
            userId: regularUser.id,
          },
        });
      expect(removedExpiredCard).toBeUndefined();

      await testInfo.attach('markdown', {
        body: `
## Completion

After the final **Remove**, **No discount cards on file** confirms that the card is no longer linked to your profile.
`,
      });
    } finally {
      await restoreSeededCard();
    }
  });
});
