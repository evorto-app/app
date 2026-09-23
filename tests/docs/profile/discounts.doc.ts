import { and, eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { userDiscountCardLockStatement } from '../../../src/server/discounts/user-discount-card-lock';
import {
  esnCardActionDisabled,
  esnCardActionLabel,
  esnCardMutationErrorMessage,
  esnCardSaveDisabled,
  esnCardStatusLabel,
  esnCardSubmitPayloadFromIdentifier,
} from '../../../src/app/profile/profile-discounts/profile-discounts.esn-card';
import { TENANT_FORMATTING_LOCALE } from '../../../src/types/custom/tenant';
import {
  expect,
  seededEsnCardIdentifier,
  test,
} from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import { fillProtectedValue } from '../../support/utils/fill-protected-value';
import type { Locator, Page } from '@playwright/test';

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
    "We couldn't confirm whether this ESNcard was saved. Select Try again to load your current cards before making another change.",
  );
  expect(
    esnCardMutationErrorMessage('save', {
      _tag: 'RpcBadRequestError',
      message: 'Invalid ESNcard number',
    }),
  ).toBe(
    "We couldn't check this ESNcard, so it was not saved. Check the number, then select Save ESNcard to try again.",
  );

  await testInfo.attach('markdown', {
    body: `

You can save one ESNcard for your account. The same card is shared across organizations, and each organization decides whether it offers ESNcard discounts. Evorto ignores accidental spaces before or after the card number. The save button says **Checking ESNcard…** while Evorto checks the card. Check again and remove show **Checking…** or **Removing…** while they are in progress.

Evorto shows the card status clearly: **Verified**, **Expired**, **Invalid**, or **Needs verification**. Save, check again, and remove remain unavailable until the current check or change finishes.

If Evorto rejects a new card, it shows **We couldn't check this ESNcard, so it was not saved. Check the number, then select Save ESNcard to try again.** Check the number before trying again.

If the save outcome cannot be confirmed, Evorto keeps the card number and all card changes unavailable until you load your current cards successfully. Select **Try again** to load your current cards without saving, checking, or removing a card. A failed or paused read keeps further changes unavailable. Do not assume the card was not saved.

A confirmed save, check, or removal can still be followed by a failed card-list update. Evorto explains which change completed and keeps further changes unavailable. Select **Try again** to load your current cards; this only reloads the list. If recovery keeps failing, contact Evorto support with the organization and exact message shown.
`,
  });
});

const visibleEsnCardStatus = (
  status: 'expired' | 'verified',
  validTo: Date | null,
  timeZone: string,
): string => {
  // Keep expected labels independent of the application's formatter so a
  // rendering regression cannot also change the test's expected output.
  const label = status === 'verified' ? 'Verified' : 'Expired';
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
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular profile user fixture');
  }
  const tenantSettings = await database.query.tenants.findFirst({
    columns: { timezone: true },
    where: { id: tenant.id },
  });
  if (!tenantSettings) {
    throw new Error('Expected persisted ESNcard tenant settings');
  }

  const seededEsnCard =
    await discounts.database.query.userDiscountCards.findFirst({
      where: {
        identifier: seededEsnCardIdentifier,
        type: 'esnCard',
        userId: regularUser.id,
      },
    });
  if (!seededEsnCard?.validTo) {
    throw new Error('Expected seeded ESNcard with a validity date');
  }
  expect(seededEsnCard).toEqual(
    expect.objectContaining({
      identifier: seededEsnCardIdentifier,
      status: 'verified',
      type: 'esnCard',
      userId: regularUser.id,
    }),
  );

  await page.goto('/profile/discounts');

  const profilePage = page.locator('app-profile-discounts');
  await expect(profilePage).toBeVisible();
  await testInfo.attach('markdown', {
    body: `

Open your profile's **Discounts** page in an organization that enables ESNcard discounts. The page shows the card saved to your account, including a card you added through another organization. Evorto checks the card with esncard.org, and the discount applies only while the card is valid.
`,
  });

  await expect(
    page.getByRole('heading', {
      exact: true,
      level: 1,
      name: 'Discount cards',
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[ngh]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('ESNcard', { exact: true })).toBeVisible();
  await expect(
    page.getByText(seededEsnCardIdentifier, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      visibleEsnCardStatus(
        'verified',
        seededEsnCard.validTo,
        tenantSettings.timezone,
      ),
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
    await discounts.database.query.userDiscountCards.findFirst({
      where: {
        id: seededEsnCard.id,
      },
    });
  expect(unchangedSeededEsnCard).toEqual(seededEsnCard);
});

test.describe('Check your ESNcard', () => {
  test.setTimeout(120_000);

  test('Add, check again, and remove active and expired cards @needs-live-esncard', async ({
    browser,
    database,
    discounts,
    page,
    registerDatabaseCleanup,
    tenant,
    testClock,
  }, testInfo) => {
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

    const tenantSettings = await database.query.tenants.findFirst({
      columns: { timezone: true },
      where: { id: tenant.id },
    });
    if (!tenantSettings) {
      throw new Error('Expected persisted ESNcard tenant settings');
    }

    const otherTenantId = getId();
    const otherTenantDomain = `esncard-${otherTenantId}.example.test`;
    const otherTenantName = 'South Bank Student Network';
    const policyVersionId = getId();
    registerDatabaseCleanup(async (cleanupDatabase) => {
      await cleanupDatabase.transaction(async (transaction) => {
        await transaction
          .delete(schema.tenantPrivacyPolicyAcceptances)
          .where(
            eq(schema.tenantPrivacyPolicyAcceptances.tenantId, otherTenantId),
          );
        await transaction
          .delete(schema.tenantPrivacyPolicyVersions)
          .where(
            eq(schema.tenantPrivacyPolicyVersions.tenantId, otherTenantId),
          );
        await transaction
          .delete(schema.usersToTenants)
          .where(eq(schema.usersToTenants.tenantId, otherTenantId));
        await transaction
          .delete(schema.tenants)
          .where(eq(schema.tenants.id, otherTenantId));
      });
    });
    await database.transaction(async (transaction) => {
      await transaction.insert(schema.tenants).values({
        currency: tenant.currency,
        discountProviders: { esnCard: { config: {}, status: 'enabled' } },
        domain: otherTenantDomain,
        id: otherTenantId,
        name: otherTenantName,
        timezone: tenantSettings.timezone,
      });
      await transaction.insert(schema.usersToTenants).values({
        tenantId: otherTenantId,
        userId: regularUser.id,
      });
      await transaction.insert(schema.tenantPrivacyPolicyVersions).values({
        id: policyVersionId,
        privacyPolicyText:
          'This organization uses your account for membership and events.',
        tenantId: otherTenantId,
        version: 1,
      });
      await transaction.insert(schema.tenantPrivacyPolicyAcceptances).values({
        policyVersionId,
        tenantId: otherTenantId,
        userId: regularUser.id,
      });
    });

    const readCurrentCard = () =>
      discounts.database.query.userDiscountCards.findFirst({
        where: {
          type: 'esnCard',
          userId: regularUser.id,
        },
      });
    const expectCurrentCardStatus = async (
      status: 'expired' | 'verified',
      cardPage: Page = page,
    ) => {
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
        cardPage.getByText(
          visibleEsnCardStatus(status, card.validTo, tenantSettings.timezone),
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

    {
      await discounts.database.transaction(async (transaction) => {
        await transaction.execute(
          userDiscountCardLockStatement(regularUser.id, 'exclusive'),
        );
        await transaction
          .delete(schema.userDiscountCards)
          .where(
            and(
              eq(schema.userDiscountCards.userId, regularUser.id),
              eq(schema.userDiscountCards.type, 'esnCard'),
            ),
          );
      });

      await page.goto('/');
      const otherOrganization = await openAuthenticatedTestPage({
        baseUrl: new URL(page.url()).origin,
        browser,
        storageState: userStateFile,
        tenantDomain: otherTenantDomain,
        testClock,
      });
      registerDatabaseCleanup(() => otherOrganization.close());
      await testInfo.attach('markdown', {
        body: `

{% callout type="note" title="Before you start" %}
- Sign in as an ordinary member of the organization whose discounts you want to use. No administrator access is required; members manage only their own card from their own profile.
- The current organization must have enabled ESNcard discounts. Organizations that do not use the program do not show the **Discounts** profile page.
- Have your current ESNcard number ready.
{% /callout %}

Your Evorto account has one ESNcard shared across your organizations. You can manage that same card through any organization that enables ESNcard discounts. Each organization decides whether it offers those discounts, and the card must be **Verified** to qualify. An expired card remains visible as **Expired** and does not receive a discount.

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
      // Retain the direct SSR arrival covered by the former provider spec.
      await page.reload();
      await expect(
        page.getByText('No discount cards added.', { exact: true }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByRole('button', { name: 'Save ESNcard' }),
      ).not.toHaveAttribute('jsaction', /click/, { timeout: 20_000 });

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
      expect(savedCard?.type).toBe('esnCard');
      expect(savedCard?.userId).toBe(regularUser.id);
      expect(savedCard?.identifier === liveEsnCardIdentifier).toBe(true);
      expect(savedCard?.lastCheckedAt).toBeInstanceOf(Date);
      const savedCheckTime = savedCard?.lastCheckedAt?.getTime();
      if (savedCheckTime === undefined) {
        throw new Error('Expected saved ESNcard check time');
      }

      await testInfo.attach('markdown', {
        body: `
## Confirm and check an active card again

A successful check shows **Verified** and records when the card was last checked.

The same card is available in every organization you have joined that enables ESNcard discounts. Open that organization's trusted link, select **Profile**, then choose **Discounts**. You do not need to add the card again. Reload an already-open page to see changes made elsewhere.

Select **Check again** to check the card again. If Evorto rejects the check, it keeps the saved card unchanged and names **Check again** as the next action. If the outcome cannot be confirmed, further card changes remain unavailable. Select **Try again** to load your current cards; this does not check the card again. If recovery keeps failing, contact Evorto support with the organization and exact message shown.
`,
      });

      await otherOrganization.page.goto('/');
      await clickHydratedAction(
        otherOrganization.page.getByRole('link', {
          name: 'Profile',
          exact: true,
        }),
      );
      await expect(
        otherOrganization.page.locator('app-profile-shell'),
      ).toBeVisible();
      await clickHydratedAction(
        otherOrganization.page
          .getByRole('navigation', { name: 'Profile sections' })
          .getByRole('link', { name: 'Discounts' }),
      );
      await expect(otherOrganization.page).toHaveTitle(
        new RegExp(otherTenantName),
      );
      const sharedCard = await expectCurrentCardStatus(
        'verified',
        otherOrganization.page,
      );
      expect(sharedCard.id).toBe(savedCard.id);
      expect(
        (
          await otherOrganization.page
            .locator('app-profile-discounts')
            .innerText()
        ).includes(liveEsnCardIdentifier),
      ).toBe(true);
      await clickHydratedAction(
        otherOrganization.page.getByRole('button', { name: 'Check again' }),
      );
      await expectCardCheckedAgain(savedCheckTime);
      const refreshedCard = await expectCurrentCardStatus(
        'verified',
        otherOrganization.page,
      );
      expect(refreshedCard.id).toBe(savedCard.id);
      expect(refreshedCard?.status).toBe('verified');
      expect(refreshedCard?.type).toBe('esnCard');
      expect(refreshedCard?.userId).toBe(regularUser.id);
      expect(refreshedCard?.identifier === liveEsnCardIdentifier).toBe(true);
      expect(refreshedCard?.lastCheckedAt).toBeInstanceOf(Date);

      await clickHydratedAction(
        otherOrganization.page.getByRole('button', { name: 'Remove' }),
      );
      await expect(
        otherOrganization.page.getByText('No discount cards added.', {
          exact: true,
        }),
      ).toBeVisible({ timeout: 20_000 });
      await page.reload();
      await expect(
        page.getByText('No discount cards added.', { exact: true }),
      ).toBeVisible({ timeout: 20_000 });
      const removedCard = await readCurrentCard();
      expect(removedCard).toBeUndefined();

      await testInfo.attach('markdown', {
        body: `
## Remove the active card and check an expired card

Select **Remove** when you no longer want this card on your account. **No discount cards added** confirms its removal across all your organizations; this does not cancel or change the ESNcard itself.

Changing or removing the card affects future discounts in every organization. Prices already recorded for sign-ups and payments stay unchanged. Applications awaiting approval may be priced using your current card when they are approved.

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
      expect(savedExpiredCard?.type).toBe('esnCard');
      expect(savedExpiredCard?.userId).toBe(regularUser.id);
      expect(savedExpiredCard?.identifier === expiredEsnCardIdentifier).toBe(
        true,
      );
      expect(savedExpiredCard?.lastCheckedAt).toBeInstanceOf(Date);
      const savedExpiredCheckTime = savedExpiredCard?.lastCheckedAt?.getTime();
      if (savedExpiredCheckTime === undefined) {
        throw new Error('Expected saved expired ESNcard check time');
      }

      await otherOrganization.page.reload();
      const sharedExpiredCard = await expectCurrentCardStatus(
        'expired',
        otherOrganization.page,
      );
      expect(sharedExpiredCard.id).toBe(savedExpiredCard.id);
      expect(
        (
          await otherOrganization.page
            .locator('app-profile-discounts')
            .innerText()
        ).includes(expiredEsnCardIdentifier),
      ).toBe(true);
      await clickHydratedAction(
        otherOrganization.page.getByRole('button', { name: 'Check again' }),
      );
      await expectCardCheckedAgain(savedExpiredCheckTime);
      const refreshedExpiredCard = await expectCurrentCardStatus(
        'expired',
        otherOrganization.page,
      );
      expect(refreshedExpiredCard.id).toBe(savedExpiredCard.id);
      expect(refreshedExpiredCard?.status).toBe('expired');
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
      const removedExpiredCard = await readCurrentCard();
      expect(removedExpiredCard).toBeUndefined();
      await otherOrganization.page.reload();
      await expect(
        otherOrganization.page.getByText('No discount cards added.', {
          exact: true,
        }),
      ).toBeVisible({ timeout: 20_000 });

      await testInfo.attach('markdown', {
        body: `
## Completion

After the final **Remove**, **No discount cards added** confirms that the card is no longer saved to your account in any organization.
`,
      });
    }
  });
});
