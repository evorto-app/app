import { DateTime } from 'luxon';

import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import { fillTestCard } from '../../support/utils/fill-test-card';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.describe('Register for events', () => {
  test.use({ storageState: userStateFile });

  test('Register for a free event @track(playwright-specs-track-linking_20260126) @doc(REGISTER-DOC-01)', async ({
    events,
    page,
    registrations,
  }, testInfo) => {
    test.slow();
    const regularUser = usersToAuthenticate.find(
      (user) => user.roles === 'user',
    );
    if (!regularUser) {
      throw new Error('No regular user configured for registration docs');
    }
    const freeEvent = events.find((event) => {
      const alreadyRegistered = registrations.some(
        (registration) =>
          registration.eventId === event.id &&
          registration.userId === regularUser.id &&
          registration.status !== 'CANCELLED',
      );
      if (alreadyRegistered) {
        return false;
      }
      return (
        event.status === 'APPROVED' &&
        event.unlisted === false &&
        event.registrationOptions.some((option) => {
          return (
            DateTime.fromJSDate(option.openRegistrationTime).diffNow()
              .milliseconds < 0 &&
            !option.isPaid &&
            option.title === 'Participant registration' &&
            DateTime.fromJSDate(option.closeRegistrationTime).diffNow()
              .milliseconds > 0
          );
        }) &&
        event.registrationOptions.every((option) => !option.isPaid)
      );
    });
    if (!freeEvent) {
      throw new Error('No event found');
    }

    const freeEventLink = page
      .locator('a[href^="/events/"]')
      .filter({
        has: page.getByRole('heading', { level: 2, name: freeEvent.title }),
      })
      .first();

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
      page.locator('section').filter({ hasText: 'Registration' }),
      page,
    );
    await testInfo.attach('markdown', {
      body: `
  After selecting a free event, all left to do is press the **Register** button for the option you chose. After that, you will see your confirmation and ticket QR code.`,
    });
    await page
      .locator('app-event-registration-option')
      .filter({ hasText: 'Participant registration' })
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
    events,
    page,
    registrations,
  }, testInfo) => {
    test.slow();
    const regularUser = usersToAuthenticate.find(
      (user) => user.roles === 'user',
    );
    if (!regularUser) {
      throw new Error('No regular user configured for registration docs');
    }
    const paidEvent = events.find((event) => {
      const alreadyRegistered = registrations.some(
        (registration) =>
          registration.eventId === event.id &&
          registration.userId === regularUser.id &&
          registration.status !== 'CANCELLED',
      );
      if (alreadyRegistered) {
        return false;
      }
      return (
        event.status === 'APPROVED' &&
        event.unlisted === false &&
        event.registrationOptions.some((option) => {
          return (
            DateTime.fromJSDate(option.openRegistrationTime).diffNow()
              .milliseconds < 0 &&
            option.isPaid &&
            option.title === 'Participant registration' &&
            DateTime.fromJSDate(option.closeRegistrationTime).diffNow()
              .milliseconds > 0
          );
        }) &&
        event.registrationOptions.every((option) => option.isPaid)
      );
    });
    if (!paidEvent) throw new Error('No paid event found');

    await page.goto('.');
    await testInfo.attach('markdown', {
      body: `
  To register for a paid event, you have to pay the registration fee.`,
    });
    await page.locator(`a[href="/events/${paidEvent.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/events/${paidEvent.id}`));
    await page
      .getByText('Loading registration status')
      .first()
      .waitFor({ state: 'detached' });
    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Registration' }),
      page,
    );
    const payButton = page.getByRole('button', { name: 'Pay' }).first();
    if (await payButton.isVisible()) {
      await payButton.click();
    }
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
    await expect(payNowLink).toBeVisible();
    await payNowLink.click();
    await page.waitForURL(/checkout\.stripe\.com/);
    await takeScreenshot(testInfo, page.locator('main'), page);
    await fillTestCard(page);
    await page.getByTestId('hosted-payment-submit-button').click();

    await page.waitForURL(/\/events/);
    if (!page.url().includes(`/events/${paidEvent.id}`)) {
      await page.goto(`/events/${paidEvent.id}`);
    }
    await expect(page).toHaveURL(new RegExp(`/events/${paidEvent.id}`));
    const registrationStatus = page
      .getByText('Loading registration status')
      .first();
    await registrationStatus
      .waitFor({ state: 'attached', timeout: 10_000 })
      .catch(() => {});
    await registrationStatus.waitFor({ state: 'detached', timeout: 20_000 });
    const registeredMessage = page.getByText('You are registered');
    if (!(await registeredMessage.isVisible())) {
      await expect(page.getByRole('link', { name: 'Pay now' })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Cancel registration' }),
      ).toBeVisible();
      await testInfo.attach('markdown', {
        body: `
  ### Back on the event page
  After completing checkout, you are redirected back to the event page.
  If your payment is still being finalized, the registration can briefly remain in a pending state.
  In that case, you can use this section to continue or cancel the registration.`,
      });
      await takeScreenshot(
        testInfo,
        page.locator('section').filter({ hasText: 'Registration' }),
        page,
        'Paid registration pending after checkout',
      );
      return;
    }
    await expect(registeredMessage).toBeVisible({ timeout: 20_000 });
    await testInfo.attach('markdown', {
      body: `
  ### Successful paid registration
  After successful payment, you are redirected back to the event page and shown your registration confirmation.
  Your ticket details and QR code are now available.`,
    });
    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Registration' }),
      page,
      'Event details after successful paid registration',
    );
  });
});
