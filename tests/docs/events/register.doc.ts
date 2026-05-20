import { and, eq } from 'drizzle-orm';
import type { Page } from '@playwright/test';

import {
  emptyStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { fillTestCard } from '../../support/utils/fill-test-card';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { seedFreeRegistrationAddon } from '../../support/utils/seed-registration-addons';

test.use({ storageState: userStateFile, trace: 'on-first-retry' });

const waitForRegistrationStatus = async (page: Page) => {
  await page
    .getByText('Loading registration status')
    .first()
    .waitFor({ state: 'detached' });
};

test.describe('Register for events', () => {
  test.describe.configure({ mode: 'serial', retries: 1 });

  test('Register for a free event', async ({
    database,
    events,
    page,
    seeded,
    tenant,
  }, testInfo) => {
    test.slow();
    const freeEventId = seeded.scenario.events.freeOpen.eventId;
    const freeOptionId = seeded.scenario.events.freeOpen.optionId;
    const freeEvent = events.find((event) => event.id === freeEventId);
    if (!freeEvent) {
      throw new Error(
        `Seeded freeOpen scenario event "${freeEventId}" was not found`,
      );
    }
    const regularUser =
      usersToAuthenticate.find((user) => user.roles === 'user') ??
      usersToAuthenticate[0];
    const addOnId = `addon-${tenant.id.slice(0, 14)}`;

    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, freeEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      );
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        confirmedSpots: 0,
        reservedSpots: 0,
        waitlistSpots: 0,
      })
      .where(eq(schema.eventRegistrationOptions.id, freeOptionId));
    await seedFreeRegistrationAddon({
      addonId: addOnId,
      database,
      eventId: freeEventId,
      registrationOptionId: freeOptionId,
      title: 'Snack voucher',
    });

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
    await waitForRegistrationStatus(page);
    await testInfo.attach('markdown', {
      body: `
  After you have selected your event, you can see the event description and your options for registration.
  _Note:_ If you are not logged it, please follow the instructions to do so.

  ### Free events
  Here we will make a distinction for free events and paid events (covered further down).
  Participant options are labeled separately from organizer/helper options, which use **Sign up as organizer/helper** copy when you are helping run the event.
  When a participant option is full, registration changes to a distinct **Join waitlist** action instead of pretending a normal spot is still available. Waitlisted participants can return to the event page and use **Leave waitlist** before the event starts.
  If you open a direct event link but your account does not match the roles required by any available option, the event remains visible and the registration area explains that registration is unavailable for your account.`,
    });
    await takeScreenshot(
      testInfo,
      page.getByRole('heading', { level: 2, name: 'Registration' }),
      page,
    );
    await testInfo.attach('markdown', {
      body: `
  Free registration cards can also offer registration-time add-ons. Choose the quantity you want before registering. After registration, selected add-ons are shown with the active registration so participants can review what they picked.`,
    });
    const participantRegistrationCard = page
      .locator('app-event-registration-option')
      .filter({ hasText: 'Participant registration' })
      .first();
    await expect(participantRegistrationCard).toBeVisible({ timeout: 20_000 });
    await expect(
      participantRegistrationCard.getByText('Snack voucher'),
    ).toBeVisible();
    await participantRegistrationCard.getByLabel('Quantity').fill('2');
    await participantRegistrationCard
      .getByRole('button', { name: 'Register' })
      .click();
    await expect(page.getByText('You are registered')).toBeVisible();
    await expect(page.getByText('2 x Snack voucher')).toBeVisible();

    await testInfo.attach('markdown', {
      body: `
  ### Successful registration
  You should now have a successful registration.
  You can see this by additional information being available and also your ticket QR code.
  Participant registrations can include guests and registration-time add-ons. Guest spots are attached to the logged-in buyer's registration and count against the same option capacity. Add-ons are shown with the confirmed registration and can be reviewed by organizers.
  This code is needed when attending the event. Keep this page available because QR email delivery is not part of the current relaunch flow.
  You can cancel a pending or confirmed registration from this event page before the event starts. Confirmed cancellation releases your selected spots, including guests when attached, but paid-registration refunds are not automatic yet.`,
    });

    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Registration' }),
      page,
      'Event details after registration',
    );
  });

  test('Review unavailable registration states', async ({
    database,
    page,
    seeded,
    tenant,
  }, testInfo) => {
    const regularUser =
      usersToAuthenticate.find((user) => user.roles === 'user') ??
      usersToAuthenticate[0];
    const closedEventId = seeded.scenario.events.closedReg.eventId;
    const fullEventId = seeded.scenario.events.freeOpen.eventId;
    const fullOptionId = seeded.scenario.events.freeOpen.optionId;
    const fullOption = await database.query.eventRegistrationOptions.findFirst({
      where: { id: fullOptionId, tenantId: tenant.id },
    });
    if (!regularUser || !fullOption) {
      throw new Error(
        'Expected regular user and seeded free registration option',
      );
    }

    await testInfo.attach('markdown', {
      body: `
  ## Registration unavailable states

  Event pages stay readable when registration is not currently possible. The registration card explains the current state instead of showing an action that cannot succeed.
`,
    });

    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, closedEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      );
    await page.goto(`/events/${closedEventId}`);
    await waitForRegistrationStatus(page);
    await expect(page.getByText('Registration is closed')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Register$/ })).toHaveCount(
      0,
    );
    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Registration' }),
      page,
      'Closed registration window',
    );

    await testInfo.attach('markdown', {
      body: `
  When the registration window is closed, participants can still read the event details, but the registration action is removed.
`,
    });

    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, fullEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      );
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        confirmedSpots: fullOption.spots,
        reservedSpots: 0,
        waitlistSpots: 0,
      })
      .where(eq(schema.eventRegistrationOptions.id, fullOptionId));
    await page.goto(`/events/${fullEventId}`);
    await waitForRegistrationStatus(page);
    await expect(page.getByText('This option is full.')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Join waitlist' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Register$/ })).toHaveCount(
      0,
    );
    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Registration' }),
      page,
      'Full registration option with waitlist',
    );

    await testInfo.attach('markdown', {
      body: `
  Full participant options expose a distinct **Join waitlist** action. Waitlist registration is separate from a confirmed registration, and a normal **Register** button is not shown while the option is full.
`,
    });
  });

  test.describe('without eligible roles', () => {
    test.use({ storageState: emptyStateFile });

    test('Review role-ineligible registration state', async ({
      page,
      seeded,
    }, testInfo) => {
      await page.goto(`/events/${seeded.scenario.events.freeOpen.eventId}`);
      await waitForRegistrationStatus(page);

      await expect(
        page.getByRole('heading', { name: 'Registration unavailable' }),
      ).toBeVisible();
      await expect(
        page.getByText(
          'This event is visible from the direct link, but your account is not eligible for the available registration options.',
        ),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^Register$/ }),
      ).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        page.locator('section').filter({ hasText: 'Registration' }),
        page,
        'Role-ineligible registration state',
      );

      await testInfo.attach('markdown', {
        body: `
  Direct event links remain readable for signed-in users without eligible tenant roles. The registration area states that the current account is not eligible instead of hiding the event or rendering an empty registration section.
`,
      });
    });
  });

  test('Register for a paid event', async ({
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
    await waitForRegistrationStatus(page);
    await takeScreenshot(
      testInfo,
      page.getByRole('heading', { level: 2, name: 'Registration' }),
      page,
    );
    const payButton = page.getByRole('button', { name: /Pay/i }).first();
    await testInfo.attach('markdown', {
      body: `
  By clicking the **Pay and register** button, you are starting the payment process.
  Paid guest spots are included in the Stripe Checkout quantity and reserve the matching capacity while payment is pending.
  Afterwards, you can either finish the registration by paying or cancel your payment and registration in case you changed your mind. Cancelling a pending payment registration releases every selected buyer and guest spot and expires the pending checkout when possible.`,
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
