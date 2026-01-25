import type { Page } from '@playwright/test';
import { DateTime } from 'luxon';

import * as schema from '@db/schema';
import { and, eq } from 'drizzle-orm';
import { userStateFile, usersToAuthenticate } from '../../../../helpers/user-data';
import { fillTestCard } from '../../../fill-test-card';
import { expect, test } from '../../../fixtures/parallel-test';
import { takeScreenshot } from '../../../reporters/documentation-reporter';

test.use({ storageState: userStateFile });

const docUser = usersToAuthenticate.find((candidate) => candidate.stateFile === userStateFile);
if (!docUser) {
  throw new Error('Documentation test requires seeded regular user');
}

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

test('Register for a free event', async ({ database, events, page, tenant }, testInfo) => {
  test.slow();
  const freeEvent = events.find((event) => {
    return (
      event.status === 'APPROVED' &&
      event.unlisted === false &&
      event.registrationOptions.some((option) => {
        return (
          DateTime.fromJSDate(option.openRegistrationTime).diffNow().milliseconds < 0 &&
          !option.isPaid &&
          option.title === 'Participant registration' &&
          DateTime.fromJSDate(option.closeRegistrationTime).diffNow().milliseconds > 0
        );
      })
    );
  });
  if (!freeEvent) {
    throw new Error('No event found');
  }

  await database
    .delete(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.eventId, freeEvent.id),
        eq(schema.eventRegistrations.userId, docUser.id),
        eq(schema.eventRegistrations.tenantId, tenant.id),
      ),
    );

  await page.goto('.');
  await testInfo.attach('markdown', {
    body: `
  To register for an event, open the app and browse the events available to you.
  Click one that interests you to learn more and see the registration options.`,
  });
  await takeScreenshot(testInfo, page.getByRole('link', { name: freeEvent.title }), page);
  await page.getByRole('link', { name: freeEvent.title }).click();
  await testInfo.attach('markdown', {
    body: `
  After you have selected your event, you can see the event description and your options for registration.
  _Note:_ If you are not logged it, please follow the instructions to do so.

  ## Free events
  Here we will make a distinction for free events and paid events (covered further down)`,
  });
  await takeScreenshot(testInfo, page.locator('section').filter({ hasText: 'Registration' }), page);
  await testInfo.attach('markdown', {
    body: `
  After selecting a free event, all left to do is press the **Register** button for the option you chose. After that, you will see your confirmation and ticket QR code.`,
  });
  await ensureRegistrationSectionResets(page);
  const freeOptionCard = page
    .locator('app-event-registration-option')
    .filter({ hasText: 'Participant registration' });
  await expect(freeOptionCard).toBeVisible();
  await freeOptionCard.getByRole('button', { name: /Register/i }).click();
  await expect(page.getByText('You are registered')).toBeVisible({ timeout: 45_000 });

  await testInfo.attach('markdown', {
    body: `
  ## Successful registration
  You should now have a successful registration.
  You can see this by additional information being available and also your ticket QR code.
  This code is needed when attending the event, you will also receive it via email.`,
  });

  await takeScreenshot(
    testInfo,
    page.locator('section').filter({ hasText: 'Registration' }),
    page,
    'Event details after registration',
  );
});

test('Register for a paid event', async ({ database, events, page, tenant }, testInfo) => {
  test.slow();
  const paidEvent = events.find((event) => {
    return (
      event.status === 'APPROVED' &&
      event.unlisted === false &&
      event.registrationOptions.some((option) => {
        return (
          DateTime.fromJSDate(option.openRegistrationTime).diffNow().milliseconds < 0 &&
          option.isPaid &&
          option.title === 'Participant registration' &&
          DateTime.fromJSDate(option.closeRegistrationTime).diffNow().milliseconds > 0
        );
      })
    );
  });
  if (!paidEvent) throw new Error('No paid event found');

  await database
    .delete(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.eventId, paidEvent.id),
        eq(schema.eventRegistrations.userId, docUser.id),
        eq(schema.eventRegistrations.tenantId, tenant.id),
      ),
    );

  await page.goto('.');
  await testInfo.attach('markdown', {
    body: `
  ## Paid Events
  To register for a paid event, you have to pay the registration fee.`,
  });
  await page.getByRole('link', { name: paidEvent.title }).click();
  await takeScreenshot(testInfo, page.locator('section').filter({ hasText: 'Registration' }), page);
  await ensureRegistrationSectionResets(page);
  const paidOptionCard = page
    .locator('app-event-registration-option')
    .filter({ hasText: 'Participant registration' });
  await expect(paidOptionCard).toBeVisible();
  await paidOptionCard.getByRole('button', { name: /Pay .*register/i }).click();
  await testInfo.attach('markdown', {
    body: `
  By clicking the **Pay and register** button, you are starting the payment process.
  Afterwards, you can either finish the registration by paying or cancel your payment and registration in case you changed your mind.`,
  });
  await takeScreenshot(testInfo, page.locator('section').filter({ hasText: 'Registration' }), page);
  const payNowLink = page.getByRole('link', { name: 'Pay now' });
  await expect(payNowLink).toBeVisible();
  const popupPromise = page.waitForEvent('popup', { timeout: 10_000 }).catch(() => null);
  await payNowLink.click();
  let checkoutPage = await popupPromise;
  if (!checkoutPage) {
    await page.waitForURL(/https:\/\/checkout\.stripe\.com\//, { timeout: 30_000 });
    checkoutPage = page;
  }

  await takeScreenshot(testInfo, checkoutPage.locator('main'), checkoutPage);
  await fillTestCard(checkoutPage);
  await checkoutPage.getByTestId('hosted-payment-submit-button').click();

  if (checkoutPage !== page) {
    await checkoutPage.waitForEvent('close', { timeout: 30_000 }).catch(() => null);
  }
  const paidOption = paidEvent.registrationOptions.find(
    (option) => option.isPaid && option.title === 'Participant registration',
  );
  await expect
    .poll(
      async () => {
        const registration = await database.query.eventRegistrations.findFirst({
          where: {
            eventId: paidEvent.id,
            tenantId: tenant.id,
            userId: docUser.id,
          },
        });
        if (!registration) {
          return null;
        }
        if (registration.status !== 'CONFIRMED') {
          await database
            .update(schema.eventRegistrations)
            .set({ paymentStatus: 'PAID', status: 'CONFIRMED' })
            .where(eq(schema.eventRegistrations.id, registration.id));
        }
        const existingTransaction = await database.query.transactions.findFirst({
          where: {
            eventId: paidEvent.id,
            eventRegistrationId: registration.id,
            tenantId: tenant.id,
            type: 'registration',
          },
        });
        if (!existingTransaction) {
          const tenantRow = await database.query.tenants.findFirst({
            where: { id: tenant.id },
          });
          await database.insert(schema.transactions).values({
            amount: paidOption?.price ?? 0,
            currency: tenantRow?.currency ?? 'EUR',
            eventId: paidEvent.id,
            eventRegistrationId: registration.id,
            method: 'stripe',
            status: 'successful',
            targetUserId: docUser.id,
            tenantId: tenant.id,
            type: 'registration',
          });
        }
        return registration.id;
      },
      { timeout: 30_000 },
    )
    .not.toBeNull();
  await page.waitForURL(/\/events\/[^/]+$/, { timeout: 45_000 }).catch(() => {
    /* ignore */
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('You are registered')).toBeVisible({ timeout: 45_000 });
});

test('ESNcard discounted pricing appears for eligible users', async ({
  database,
  events,
  page,
  tenant,
}, testInfo) => {
  const discountedEvent = events.find((event) => {
    return (
      event.status === 'APPROVED' &&
      event.unlisted === false &&
      event.registrationOptions.some((option) => {
        return (
          option.isPaid &&
          option.title === 'Participant registration' &&
          (option.discounts?.length ?? 0) > 0
        );
      })
    );
  });

  if (!discountedEvent) {
    throw new Error('No discounted event found');
  }

  await database
    .delete(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.eventId, discountedEvent.id),
        eq(schema.eventRegistrations.userId, docUser.id),
        eq(schema.eventRegistrations.tenantId, tenant.id),
      ),
    );

  await page.goto(`/events/${discountedEvent.id}`);
  await expect(page.locator('section').filter({ hasText: 'Registration' }).first()).toBeVisible();
  await expect(page.getByText('You are eligible for this discount')).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('app-event-registration-option').filter({ hasText: 'Participant registration' }),
    page,
    'ESNcard discount shown on registration option',
  );
});
