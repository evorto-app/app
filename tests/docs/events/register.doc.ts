import { and, eq } from 'drizzle-orm';

import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { fillTestCard } from '../../support/utils/fill-test-card';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: userStateFile, trace: 'on-first-retry' });

test.describe('Register for events', () => {
  test.describe.configure({ retries: 1 });

  test('Register for a free event @track(playwright-specs-track-linking_20260126) @doc(REGISTER-DOC-01)', async ({
    events,
    page,
    seeded,
  }, testInfo) => {
    test.slow();
    const freeEventId = seeded.scenario.events.freeOpen.eventId;
    const freeEvent = events.find((event) => event.id === freeEventId);
    if (!freeEvent) {
      throw new Error(
        `Seeded freeOpen scenario event "${freeEventId}" was not found`,
      );
    }

    const freeEventHref = `/events/${freeEvent.id}`;
    const freeEventLink = page.locator(`a[href="${freeEventHref}"]`).first();

    await page.goto('.');
    await testInfo.attach('markdown', {
      body: `
  To register for an event, open the app and browse the events available to you.
  Click one that interests you to learn more and see the registration options.`,
    });
    await takeScreenshot(testInfo, freeEventLink, page);
    await freeEventLink.click();
    await expect(page).toHaveURL(/\/events\/[a-z0-9]+$/i);
    await expect(
      page.getByRole('heading', { level: 1, name: freeEvent.title }),
    ).toBeVisible();
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'detached' });
    await testInfo.attach('markdown', {
      body: `
  After you have selected your event, you can see the event description and your options for registration.
  _Note:_ If you are not logged it, please follow the instructions to do so.

  ### Free events
  Here we will make a distinction for free events and paid events (covered further down)`,
    });
    await takeScreenshot(
      testInfo,
      page.getByRole('heading', { level: 2, name: 'Registration' }),
      page,
    );
    await testInfo.attach('markdown', {
      body: `
  After selecting a free event, all left to do is press the **Register** button for the option you chose. After that, you will see your confirmation and ticket QR code.`,
    });
    const participantRegistrationCard = page
      .locator('app-event-registration-option')
      .filter({ hasText: 'Participant registration' })
      .first();
    await expect(participantRegistrationCard).toBeVisible({ timeout: 20_000 });
    await participantRegistrationCard
      .getByRole('button', { name: 'Register' })
      .click();
    await expect(page.getByText('You are registered')).toBeVisible();

    await testInfo.attach('markdown', {
      body: `
  ### Successful registration
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

  test('Register for a paid event @track(playwright-specs-track-linking_20260126) @doc(REGISTER-DOC-02)', async ({
    database,
    events,
    page,
    seeded,
    tenant,
  }, testInfo) => {
    test.slow();
    const paidEventId = seeded.scenario.events.paidOpen.eventId;
    const paidOptionId = seeded.scenario.events.paidOpen.optionId;
    const paidEvent = events.find((event) => event.id === paidEventId);
    if (!paidEvent) {
      throw new Error(
        `Seeded paidOpen scenario event "${paidEventId}" was not found`,
      );
    }
    const regularUserId =
      usersToAuthenticate.find((user) => user.roles === 'user')?.id ??
      usersToAuthenticate[0].id;
    if (!regularUserId) {
      throw new Error(
        'Regular user configuration missing for paid registration',
      );
    }

    await database
      .delete(schema.transactions)
      .where(
        and(
          eq(schema.transactions.eventId, paidEvent.id),
          eq(schema.transactions.method, 'stripe'),
          eq(schema.transactions.targetUserId, regularUserId),
          eq(schema.transactions.tenantId, tenant.id),
          eq(schema.transactions.type, 'registration'),
        ),
      );
    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, paidEvent.id),
          eq(schema.eventRegistrations.registrationOptionId, paidOptionId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUserId),
        ),
      );
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        confirmedSpots: 0,
        reservedSpots: 0,
        waitlistSpots: 0,
      })
      .where(eq(schema.eventRegistrationOptions.id, paidOptionId));

    await page.goto('.');
    await testInfo.attach('markdown', {
      body: `
  To register for a paid event, you have to pay the registration fee.`,
    });
    await page.goto(`/events/${paidEvent.id}`);
    await expect(page).toHaveURL(new RegExp(`/events/${paidEvent.id}`));
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'detached' });
    await takeScreenshot(
      testInfo,
      page.getByRole('heading', { level: 2, name: 'Registration' }),
      page,
    );
    const payButton = page.getByRole('button', { name: /Pay/i }).first();
    await testInfo.attach('markdown', {
      body: `
  By clicking the **Pay and register** button, you are starting the payment process.
  Afterwards, you can either finish the registration by paying or cancel your payment and registration in case you changed your mind.`,
    });
    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Registration' }),
      page,
    );
    const payNowLink = page.getByRole('link', { name: 'Pay now' }).first();
    let checkoutUrl: null | string = null;
    if ((await payNowLink.count()) > 0) {
      checkoutUrl = await payNowLink.getAttribute('href');
    }
    if (!checkoutUrl) {
      await expect(payButton).toBeVisible({ timeout: 20_000 });
      await payButton.click();
      await expect
        .poll(
          async () => {
            const pendingTransaction =
              await database.query.transactions.findFirst({
                orderBy: { createdAt: 'desc' },
                where: {
                  eventId: paidEvent.id,
                  method: 'stripe',
                  status: 'pending',
                  targetUserId: regularUserId,
                  tenantId: tenant.id,
                  type: 'registration',
                },
              });
            return pendingTransaction?.stripeCheckoutUrl ?? null;
          },
          {
            intervals: [1_000, 2_000, 4_000],
            message:
              'Timed out waiting for a pending Stripe checkout transaction URL',
            timeout: 90_000,
          },
        )
        .not.toBeNull();
      const pendingTransaction = await database.query.transactions.findFirst({
        orderBy: { createdAt: 'desc' },
        where: {
          eventId: paidEvent.id,
          method: 'stripe',
          status: 'pending',
          targetUserId: regularUserId,
          tenantId: tenant.id,
          type: 'registration',
        },
      });
      checkoutUrl = pendingTransaction?.stripeCheckoutUrl ?? null;
    }
    const checkoutPagePromise = page.context().waitForEvent('page', {
      timeout: 5_000,
    });
    if (await payNowLink.isVisible().catch(() => false)) {
      await payNowLink.click();
    } else if (checkoutUrl) {
      await page.goto(checkoutUrl);
    } else {
      throw new Error(
        'Stripe checkout URL missing after creating pending payment',
      );
    }
    const checkoutPopup = await checkoutPagePromise.catch(() => null);
    const checkoutPage = checkoutPopup ?? page;
    await expect
      .poll(() => checkoutPage.url(), {
        message: 'Timed out waiting for Stripe Checkout page navigation',
        timeout: 30_000,
      })
      .toMatch(/checkout\.stripe\.com/);
    await takeScreenshot(testInfo, checkoutPage.locator('main'), checkoutPage);
    await fillTestCard(checkoutPage);
    const submitButton = checkoutPage.getByTestId(
      'hosted-payment-submit-button',
    );
    await submitButton.click();

    const getStripeRegistrationState = async () => {
      const transaction = await database.query.transactions.findFirst({
        orderBy: { createdAt: 'desc' },
        where: {
          eventId: paidEvent.id,
          method: 'stripe',
          targetUserId: regularUserId,
          tenantId: tenant.id,
          type: 'registration',
        },
      });
      if (!transaction) {
        return 'missing-transaction';
      }

      const registration = transaction.eventRegistrationId
        ? await database.query.eventRegistrations.findFirst({
            where: {
              id: transaction.eventRegistrationId,
              tenantId: tenant.id,
            },
          })
        : await database.query.eventRegistrations.findFirst({
            orderBy: { createdAt: 'desc' },
            where: {
              eventId: paidEvent.id,
              tenantId: tenant.id,
              userId: regularUserId,
            },
          });

      return `${transaction.status}:${registration?.status ?? 'missing-registration'}`;
    };

    try {
      await expect
        .poll(getStripeRegistrationState, {
          intervals: [1_000, 2_000, 4_000],
          message:
            'Timed out waiting for Stripe checkout side-effects to be mirrored in the application database',
          timeout: 90_000,
        })
        .toBe('successful:CONFIRMED');
    } catch (error) {
      const checkoutUrl = checkoutPage.isClosed()
        ? 'closed'
        : checkoutPage.url();
      const submitButtonText =
        (await submitButton.textContent().catch(() => null))?.trim() ??
        'missing';
      const postalCodeValue = await checkoutPage
        .locator('input[aria-label="ZIP"], input[aria-label*="Postal"]')
        .first()
        .inputValue()
        .catch(() => '');
      const phoneValue = await checkoutPage
        .locator('input[aria-label="Phone number"], input[aria-label*="Phone"]')
        .first()
        .inputValue()
        .catch(() => '');
      throw new Error(
        `Timed out waiting for Stripe checkout side-effects to be mirrored in the application database (checkoutUrl=${checkoutUrl}, submitButton=${submitButtonText}, zip=${postalCodeValue || 'empty'}, phone=${phoneValue || 'empty'})`,
        { cause: error },
      );
    }

    await page.goto(`/events/${paidEvent.id}`);
    await expect(page).toHaveURL(new RegExp(`/events/${paidEvent.id}`));
    const registrationStatus = page
      .getByText('Loading registration status')
      .first();
    await registrationStatus
      .waitFor({ state: 'attached', timeout: 10_000 })
      .catch(() => {});
    await registrationStatus.waitFor({ state: 'detached', timeout: 20_000 });
    const registeredMessage = page.getByText('You are registered');
    await expect(registeredMessage).toBeVisible({ timeout: 20_000 });
    await testInfo.attach('markdown', {
      body: `
  ### Successful paid registration
  After successful payment, you are redirected back to the event page and shown your registration confirmation.
  Your ticket details and QR code are now available.`,
    });
    await takeScreenshot(
      testInfo,
      page.getByRole('heading', { level: 2, name: 'Registration' }),
      page,
      'Event details after successful paid registration',
    );
  });
});
