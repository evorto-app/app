import { DateTime } from 'luxon';

import { userStateFile } from '../../../helpers/user-data';
import { fillTestCard } from '../../fill-test-card';
import { expect, test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

test.use({ storageState: userStateFile });

test('Register for an event', async ({ events, page }, testInfo) => {
  test.slow();
  const freeEvent = events.find((event) => {
    return (
      event.status === 'APPROVED' &&
      event.visibility === 'PUBLIC' &&
      event.registrationOptions.some((option) => {
        return (
          DateTime.fromJSDate(option.openRegistrationTime).diffNow()
            .milliseconds < 0 &&
          !option.isPaid &&
          option.title === 'Participant registration' &&
          DateTime.fromJSDate(option.closeRegistrationTime).diffNow()
            .milliseconds > 0
        );
      })
    );
  });
  const paidEvent = events.find((event) => {
    return (
      event.status === 'APPROVED' &&
      event.visibility === 'PUBLIC' &&
      event.registrationOptions.some((option) => {
        return (
          DateTime.fromJSDate(option.openRegistrationTime).diffNow()
            .milliseconds < 0 &&
          option.isPaid &&
          option.title === 'Participant registration' &&
          DateTime.fromJSDate(option.closeRegistrationTime).diffNow()
            .milliseconds > 0
        );
      })
    );
  });
  if (!freeEvent || !paidEvent) {
    throw new Error('No event found');
  }

  await page.goto('.');
  await testInfo.attach('markdown', {
    body: `
  To register for an event, open the app and browse the events available to you.
  Click one that interests you to learn more and see the registration options.`,
  });
  await takeScreenshot(
    testInfo,
    page.getByRole('link', { name: freeEvent.title }),
    page,
  );
  await page.getByRole('link', { name: freeEvent.title }).click();
  await testInfo.attach('markdown', {
    body: `
  After you have selected your event, you can see the event description and your options for registration.
  _Note:_ If you are not logged it, please follow the instructions to do so.

  ## Free events
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

  ## Paid Events
  To register for a paid event, you have to pay the registration fee.`,
  });
  await page.getByRole('link', { name: paidEvent.title }).click();
  await takeScreenshot(
    testInfo,
    page.locator('section').filter({ hasText: 'Registration' }),
    page,
  );
  await page.getByRole('button', { name: 'Pay' }).click();
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
  await page.getByRole('link', { name: 'Pay now' }).click();
  await testInfo.attach('markdown', {
    body: `
  If you choose to continue, the app will redirect your to stripe to process the payment.
  This way your payment information will never be stored in the app, but only in stripe.
  You can select any of the payment methods available to you, note, that they may be different than in this guide.`,
  });
  await page.waitForTimeout(2000);
  await takeScreenshot(testInfo, page.locator('main'), page);
  await fillTestCard(page);
  await page.getByTestId('hosted-payment-submit-button').click();

  await page.waitForURL('./events/*');
  await expect(page.getByText('You are registered')).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
  ## Successful registration
  For both paid and free events you should now have a successful registration.
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
