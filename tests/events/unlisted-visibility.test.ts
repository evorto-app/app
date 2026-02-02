import { adminStateFile, userStateFile } from '../../helpers/user-data';
import { expect, test } from '../fixtures/parallel-test';

const findUnlistedEvent = (
  events: {
    id: string;
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';
    title: string;
    unlisted: boolean;
  }[],
) => events.find((event) => event.status === 'APPROVED' && event.unlisted);

test.describe('Unlisted events visibility', () => {
  test.use({ storageState: userStateFile });

  test('regular user does not see unlisted in list @track(playwright-specs-track-linking_20260126) @req(UNLISTED-VISIBILITY-TEST-01)', async ({
    events,
    page,
  }) => {
    const unlisted = findUnlistedEvent(events);
    if (!unlisted) {
      test.skip(true, 'No unlisted event seeded');
      return;
    }
    await page.goto('/events');
    // Should not appear in listing for regular user
    await expect(page.getByRole('link', { name: unlisted.title })).toHaveCount(
      0,
    );
    // No unlisted badges for regular users
    await expect(
      page.locator('app-event-list nav').getByText('unlisted'),
    ).toHaveCount(0);
  });

  test('regular user can open unlisted via direct link @track(playwright-specs-track-linking_20260126) @req(UNLISTED-VISIBILITY-TEST-02)', async ({
    events,
    page,
  }) => {
    const unlisted = findUnlistedEvent(events);
    if (!unlisted) {
      test.skip(true, 'No unlisted event seeded');
      return;
    }
    await page.goto(`/events/${unlisted.id}`);
    // Title should be visible on event details page
    await expect(
      page.getByRole('heading', { name: unlisted.title }),
    ).toBeVisible();
  });
});

test.describe('Admin can see unlisted', () => {
  test.use({ storageState: adminStateFile });

  test('admin sees unlisted in list with indicator @track(playwright-specs-track-linking_20260126) @req(UNLISTED-VISIBILITY-TEST-03)', async ({
    events,
    page,
  }) => {
    const unlisted = findUnlistedEvent(events);
    if (!unlisted) {
      test.skip(true, 'No unlisted event seeded');
      return;
    }
    await page.goto('/events');
    const eventCard = page.locator(`a[href="/events/${unlisted.id}"]`);
    await expect(eventCard).toBeVisible();
    // The card contains an "unlisted" indicator element
    await expect(
      eventCard.getByText('unlisted', { exact: true }),
    ).toBeVisible();
  });
});
