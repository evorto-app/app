import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  seedProfileEventCards,
  type SeededProfileEventCards,
} from '../../support/utils/profile-event-cards';

test.use({ storageState: userStateFile });

test('profile event cards show implemented registration actions', async ({
  database,
  page,
  seedDate,
  seeded,
}) => {
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular profile user fixture');
  }

  let profileEventCards: SeededProfileEventCards | undefined;

  try {
    profileEventCards = await seedProfileEventCards({
      database,
      seedDate,
      seeded,
      userId: regularUser.id,
    });

    await page.goto('/profile');
    await page.getByRole('button', { name: 'Events' }).click();
    await expect(
      page.getByRole('heading', { name: 'Your Event Registrations' }),
    ).toBeVisible();

    const confirmedCard = page
      .locator('article')
      .filter({ hasText: profileEventCards.confirmed.addOnTitle });
    await expect(confirmedCard).toBeVisible({ timeout: 15_000 });
    await expect(confirmedCard.getByText('Confirmed')).toBeVisible();
    await expect(confirmedCard.getByText('Includes 1 guest')).toBeVisible();
    await expect(
      confirmedCard.getByText(`2 x ${profileEventCards.confirmed.addOnTitle}`),
    ).toBeVisible();
    await expect(
      confirmedCard.getByText('Available on the event page.'),
    ).toBeVisible();
    await expect(
      confirmedCard.getByRole('link', { name: 'Open event page' }),
    ).toHaveAttribute('href', `/events/${profileEventCards.confirmed.eventId}`);

    const pendingCheckoutCard = page
      .locator('article')
      .filter({ hasText: profileEventCards.pendingCheckout.title });
    await expect(
      pendingCheckoutCard.getByText('Pending', { exact: true }),
    ).toBeVisible();
    await expect(
      pendingCheckoutCard.getByText('Payment pending'),
    ).toBeVisible();
    await expect(
      pendingCheckoutCard.getByText(
        'Finish the checkout payment to confirm your spot.',
      ),
    ).toBeVisible();
    await expect(
      pendingCheckoutCard.getByRole('link', { name: 'Continue payment' }),
    ).toHaveAttribute('href', profileEventCards.pendingCheckout.checkoutUrl);
    await expect(
      pendingCheckoutCard.getByRole('link', { name: 'Open event page' }),
    ).toHaveAttribute(
      'href',
      `/events/${profileEventCards.pendingCheckout.eventId}`,
    );

    const waitlistCard = page
      .locator('article')
      .filter({ hasText: profileEventCards.waitlist.title });
    await expect(
      waitlistCard.getByText('Waitlist', { exact: true }),
    ).toBeVisible();
    await expect(
      waitlistCard.getByText(
        'Open the event page for waitlist details and the leave-waitlist action.',
      ),
    ).toBeVisible();
    await expect(
      waitlistCard.getByRole('link', { name: 'Open event page' }),
    ).toHaveAttribute('href', `/events/${profileEventCards.waitlist.eventId}`);

    const checkedInCard = page
      .locator('article')
      .filter({ hasText: profileEventCards.checkedIn.addOnTitle });
    await expect(checkedInCard.getByText('Confirmed')).toBeVisible();
    await expect(checkedInCard.getByText('Checked in:')).toBeVisible();
    await expect(
      checkedInCard.getByText(
        'You are checked in. Open the event page for ticket details. Cancellation and transfer are no longer available after check-in.',
      ),
    ).toBeVisible();
    await expect(
      checkedInCard.getByText('Available on the event page.'),
    ).toHaveCount(0);
    await expect(
      checkedInCard.getByRole('link', { name: 'Open event page' }),
    ).toHaveAttribute('href', `/events/${profileEventCards.checkedIn.eventId}`);
  } finally {
    await profileEventCards?.cleanup();
  }
});
