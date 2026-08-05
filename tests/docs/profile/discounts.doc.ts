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
} from '../../../src/app/profile/profile-discounts/profile-discounts.esn-card';
import { TENANT_FORMATTING_LOCALE } from '../../../src/types/custom/tenant';
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

test('Understand your ESNcard status', async ({}, testInfo) => {
  expect(esnCardStatusLabel('verified')).toBe('Verified');
  expect(esnCardStatusLabel('expired')).toBe('Expired');
  expect(esnCardStatusLabel('invalid')).toBe('Invalid');
  expect(esnCardStatusLabel('unverified')).toBe('Needs verification');
  expect(esnCardActionLabel('save', true)).toBe('Checking ESNcard…');
  expect(esnCardActionLabel('refresh', true)).toBe('Checking…');
  expect(esnCardActionLabel('remove', true)).toBe('Removing…');
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
      _tag: 'RpcInternalServerError',
      message: 'ESNcard validation provider is unavailable',
    }),
  ).toBe(
    "We couldn't check this ESNcard, so it was not saved. Check the number, then select Save ESNcard to try again.",
  );

  await testInfo.attach('markdown', {
    body: `

You can save one ESNcard for your account in each organization that enables ESNcard discounts. Evorto ignores accidental spaces before or after the card number. The save button says **Checking ESNcard…** while Evorto checks the card. Check again and remove show **Checking…** or **Removing…** while they are in progress.

Evorto shows the card status clearly: **Verified**, **Expired**, **Invalid**, or **Needs verification**. Save, check again, and remove remain unavailable until the current check or change finishes.

If Evorto cannot check a new card, it shows **We couldn't check this ESNcard, so it was not saved. Check the number, then select Save ESNcard to try again.** Check the number and select **Save ESNcard** once more. If the same message remains, contact Evorto support and include the organization and exact message shown.
`,
  });
});

const seededEsnCardIdentifier = 'DE-2026-000184';

const visibleEsnCardStatus = (
  status: 'expired' | 'verified',
  validTo: Date | null,
  timeZone: string,
): string => {
  const label = esnCardStatusLabel(status);
  if (!validTo) {
    return label;
  }
  const validUntil = new Intl.DateTimeFormat(TENANT_FORMATTING_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).format(validTo);
  return `${label} — valid until ${validUntil}`;
};

test('Manage ESNcard @finance', async ({
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
  const seededEsnCard = await database.query.userDiscountCards.findFirst({
    where: {
      identifier: seededEsnCardIdentifier,
      tenantId: tenant.id,
      type: 'esnCard',
      userId: regularUser.id,
    },
  });
  if (!seededEsnCard) {
    throw new Error('Expected seeded ESNcard');
  }
  expect(seededEsnCard).toEqual(
    expect.objectContaining({
      identifier: seededEsnCardIdentifier,
      status: 'verified',
      tenantId: tenant.id,
      type: 'esnCard',
      userId: regularUser.id,
    }),
  );

  await page.goto('/profile/discounts');

  const profilePage = page.locator('app-profile-discounts');
  await expect(profilePage).toBeVisible();
  await testInfo.attach('markdown', {
    body: `

Open your profile's **Discounts** page in the organization whose event discounts you want to use. Each organization that enables ESNcard discounts manages its own saved ESNcard. Evorto checks the card with esncard.org, and the discount applies only while the card is valid.
`,
  });

  await expect(
    page.getByRole('heading', {
      exact: true,
      level: 1,
      name: 'Discount cards',
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('ESNcard', { exact: true })).toBeVisible();
  await expect(
    page.getByText(seededEsnCardIdentifier, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      visibleEsnCardStatus('verified', seededEsnCard.validTo, tenant.timezone),
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', {
      exact: true,
      level: 1,
      name: 'Discount cards',
    }),
    page,
    'Discount cards section',
  );

  await testInfo.attach('markdown', {
    body: `
If you already added an ESNcard, Evorto shows its status and, when available, the date through which it is valid. You can check its status again or remove it. Use the **ESNcard number** field to add or replace the card. The profile page shows when a check is in progress and explains any problem that needs your attention.
`,
  });

  await page.getByRole('textbox', { name: 'ESNcard number' }).fill('short');
  await page.getByRole('textbox', { name: 'ESNcard number' }).press('Tab');
  await expect(page.getByText(/Enter a valid ESNcard number/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save ESNcard' }),
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

test.describe('Check your ESNcard', () => {
  test.setTimeout(120_000);

  test('Add, check again, and remove active and expired cards @needs-live-esncard', async ({
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

    const readCurrentCard = () =>
      database.query.userDiscountCards.findFirst({
        where: {
          tenantId: tenant.id,
          type: 'esnCard',
          userId: regularUser.id,
        },
      });
    const expectCurrentCardStatus = async (status: 'expired' | 'verified') => {
      await expect
        .poll(async () => (await readCurrentCard())?.status, {
          timeout: 20_000,
        })
        .toBe(status);
      const card = await readCurrentCard();
      if (!card) {
        throw new Error(`Expected saved ${status} ESNcard`);
      }
      await expect(
        page.getByText(
          visibleEsnCardStatus(status, card.validTo, tenant.timezone),
          { exact: true },
        ),
      ).toBeVisible({ timeout: 20_000 });
      return card;
    };
    const expectCardCheckedAgain = async (previousCheckTime: number) => {
      await expect
        .poll(
          async () => {
            const currentCheckTime = (
              await readCurrentCard()
            )?.lastCheckedAt?.getTime();
            return currentCheckTime ?? previousCheckTime;
          },
          { timeout: 20_000 },
        )
        .not.toBe(previousCheckTime);
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

      await page.goto('/');
      await testInfo.attach('markdown', {
        body: `

{% callout type="note" title="Before you start" %}
- Sign in as an ordinary member of the organization whose discounts you want to use. No administrator access is required; members manage only their own card from their own profile.
- The current organization must have enabled ESNcard discounts. Organizations that do not use the program do not show the **Discounts** profile page.
- Have your current ESNcard number ready.
{% /callout %}

The card belongs to your Evorto account, but you manage it inside the current organization. You can receive that organization's ESNcard discounts only while the card is **Verified**. An expired card remains visible as **Expired** and does not receive a discount.

From the main navigation, select **Profile**, then choose **Discounts**. Before saving, check that you entered the intended card number. Selecting **Save ESNcard** checks whether it is currently valid.
`,
      });

      await clickHydratedAction(
        page.getByRole('link', { name: 'Profile', exact: true }),
      );
      await expect(page.locator('app-profile-shell')).toBeVisible();
      await clickHydratedAction(
        page
          .getByRole('navigation', { name: 'Profile sections' })
          .getByRole('link', { name: 'Discounts' }),
      );
      await expect(
        page.getByRole('heading', {
          exact: true,
          level: 1,
          name: 'Discount cards',
        }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText('No discount cards added.', { exact: true }),
      ).toBeVisible();

      await fillProtectedValue(
        page.getByRole('textbox', { name: 'ESNcard number' }),
        'E2E_LIVE_ESN_CARD_IDENTIFIER',
        { trim: true },
      );
      await clickHydratedAction(
        page.getByRole('button', { name: 'Save ESNcard' }),
      );
      const savedCard = await expectCurrentCardStatus('verified');
      expect(savedCard?.status).toBe('verified');
      expect(savedCard?.tenantId).toBe(tenant.id);
      expect(savedCard?.type).toBe('esnCard');
      expect(savedCard?.userId).toBe(regularUser.id);
      expect(savedCard?.identifier === liveEsnCardIdentifier).toBe(true);
      const savedCheckTime = savedCard?.lastCheckedAt?.getTime();
      if (savedCheckTime === undefined) {
        throw new Error('Expected saved ESNcard check time');
      }

      await testInfo.attach('markdown', {
        body: `
## Confirm and check an active card again

A successful check shows **Verified** and records when the card was last checked.

Select **Check again** to check the card again. If Evorto cannot complete the check, it keeps the saved card unchanged and names **Check again** as the next action. Select **Check again** once more. If the same message remains, contact Evorto support and include the organization and exact message shown.
`,
      });

      await clickHydratedAction(
        page.getByRole('button', { name: 'Check again' }),
      );
      await expectCardCheckedAgain(savedCheckTime);
      const refreshedCard = await expectCurrentCardStatus('verified');
      expect(refreshedCard?.status).toBe('verified');
      expect(refreshedCard?.tenantId).toBe(tenant.id);
      expect(refreshedCard?.type).toBe('esnCard');
      expect(refreshedCard?.userId).toBe(regularUser.id);
      expect(refreshedCard?.identifier === liveEsnCardIdentifier).toBe(true);
      expect(refreshedCard?.lastCheckedAt).toBeInstanceOf(Date);

      await clickHydratedAction(page.getByRole('button', { name: 'Remove' }));
      await expect(
        page.getByText('No discount cards added.', { exact: true }),
      ).toBeVisible({ timeout: 20_000 });
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

Select **Remove** when you no longer want this card on your profile. **No discount cards added** confirms its removal from Evorto; this does not cancel or change the ESNcard itself.

An expired card remains visible as **Expired** and no longer grants discounts. Enter a current ESNcard number and select **Save ESNcard** to replace it, or select **Remove** if you no longer want a card on your profile.
`,
      });

      await fillProtectedValue(
        page.getByRole('textbox', { name: 'ESNcard number' }),
        'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER',
        { trim: true },
      );
      await clickHydratedAction(
        page.getByRole('button', { name: 'Save ESNcard' }),
      );
      const savedExpiredCard = await expectCurrentCardStatus('expired');
      expect(savedExpiredCard?.status).toBe('expired');
      expect(savedExpiredCard?.tenantId).toBe(tenant.id);
      expect(savedExpiredCard?.type).toBe('esnCard');
      expect(savedExpiredCard?.userId).toBe(regularUser.id);
      expect(savedExpiredCard?.identifier === expiredEsnCardIdentifier).toBe(
        true,
      );
      const savedExpiredCheckTime = savedExpiredCard?.lastCheckedAt?.getTime();
      if (savedExpiredCheckTime === undefined) {
        throw new Error('Expected saved expired ESNcard check time');
      }

      await clickHydratedAction(
        page.getByRole('button', { name: 'Check again' }),
      );
      await expectCardCheckedAgain(savedExpiredCheckTime);
      const refreshedExpiredCard = await expectCurrentCardStatus('expired');
      expect(refreshedExpiredCard?.status).toBe('expired');
      expect(refreshedExpiredCard?.tenantId).toBe(tenant.id);
      expect(refreshedExpiredCard?.type).toBe('esnCard');
      expect(refreshedExpiredCard?.userId).toBe(regularUser.id);
      expect(
        refreshedExpiredCard?.identifier === expiredEsnCardIdentifier,
      ).toBe(true);
      expect(refreshedExpiredCard?.lastCheckedAt).toBeInstanceOf(Date);

      await clickHydratedAction(page.getByRole('button', { name: 'Remove' }));
      await expect(
        page.getByText('No discount cards added.', { exact: true }),
      ).toBeVisible({ timeout: 20_000 });
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

After the final **Remove**, **No discount cards added** confirms that the card is no longer on your profile.
`,
      });
    } finally {
      await restoreSeededCard();
    }
  });
});
