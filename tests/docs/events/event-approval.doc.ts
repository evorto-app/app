import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Event approval workflow @track(playwright-specs-track-linking_20260126) @doc(EVENT-APPROVAL-DOC-01)', async ({
  page,
}, testInfo) => {
  const eventTitle = `Approval Flow ${Date.now()}`;
  const rejectionComment =
    'Please add clearer safety information for participants.';

  await page.goto('/templates');
  await page
    .getByRole('link', { name: /Partnach Gorge hike/i })
    .first()
    .click();
  await page.getByRole('link', { name: 'Create event' }).click();
  await page.getByLabel('Event Title').fill(eventTitle);
  await page.getByRole('button', { name: 'Create Event' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: eventTitle }),
  ).toBeVisible();

  const eventId = page.url().split('/events/')[1]?.split('?')[0];
  if (!eventId) {
    throw new Error('Failed to parse event id from URL');
  }

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Permissions" %}
This workflow assumes a user can both submit and review events.

- **Submit for review** requires being an event editor (event creator or \`events:editAll\`).
- **Approve/Reject** requires \`events:review\`.
{% /callout %}

# Event Approval

The event approval lifecycle is:

- **DRAFT**
- **PENDING_REVIEW**
- **APPROVED**
- **REJECTED**

This guide demonstrates submitting an event, rejecting with feedback, re-submitting, approving, and conflict handling.
`,
  });

  const submitButton = page.getByRole('button', { name: 'Submit for Review' });
  await expect(submitButton).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
## 1. Submit a draft for review

From the event details page, creators can submit draft or rejected events for review.
The screenshot below highlights the exact action button before the status transition.
`,
  });
  await takeScreenshot(
    testInfo,
    submitButton,
    page,
    'Submit for review action on event details',
  );

  await submitButton.click();
  await page
    .locator('mat-dialog-container')
    .first()
    .getByRole('button', { name: 'Submit for Review' })
    .click();
  await expect(
    page
      .locator('app-event-status')
      .getByText('Pending Review', { exact: true }),
  ).toBeVisible();

  await page.goto('/admin/event-reviews');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Event Reviews' }),
  ).toBeVisible();
  const eventCardLink = page.locator(`a[href="/events/${eventId}"]`);
  await expect(eventCardLink).toBeVisible();
  const eventCard = eventCardLink
    .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")]')
    .first();
  await testInfo.attach('markdown', {
    body: `
## 2. Review from the admin queue

After submission, the event appears in **Event Reviews** with action buttons for approval or rejection.
The screenshot captures the review card where reviewers make the decision.
`,
  });
  await takeScreenshot(
    testInfo,
    eventCard,
    page,
    'Admin review action surface',
  );

  await eventCard.getByRole('button', { name: 'Reject' }).click();
  await page.getByLabel('Review Comment').fill(rejectionComment);
  await page.getByRole('button', { name: 'Reject Event' }).click();

  await page.goto(`/events/${eventId}`);
  await expect(
    page.locator('app-event-status').getByText('Rejected', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(rejectionComment)).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
## 3. Rejection feedback on event details

When a reviewer rejects the event, the event status changes to **Rejected** and the review comment is shown directly on the details page.
This gives creators clear guidance before they re-submit.
`,
  });
  await takeScreenshot(
    testInfo,
    page.getByText(rejectionComment).first(),
    page,
    'Rejected status with review comment',
  );

  await page.getByRole('button', { name: 'Submit for Review' }).click();
  await page
    .locator('mat-dialog-container')
    .first()
    .getByRole('button', { name: 'Submit for Review' })
    .click();
  await expect(
    page
      .locator('app-event-status')
      .getByText('Pending Review', { exact: true }),
  ).toBeVisible();

  const stalePage = await page.context().newPage();
  await stalePage.goto(`/events/${eventId}`);
  await expect(
    stalePage
      .locator('app-event-status')
      .getByText('Pending Review', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(
    page.locator('app-event-status').getByText('Approved', { exact: true }),
  ).toBeVisible();

  await stalePage.getByRole('button', { name: 'Approve' }).click();
  await expect(
    stalePage.getByText('Event status changed. Refreshed the latest state.'),
  ).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
## 4. Stale action conflict handling

If a second reviewer acts on stale data after the status has already changed, the UI shows a conflict message and refreshes to the current state.
The screenshot demonstrates the exact feedback users receive in that scenario.
`,
  });
  await takeScreenshot(
    testInfo,
    stalePage.getByText('Event status changed. Refreshed the latest state.'),
    stalePage,
    'Conflict feedback after stale review action',
  );
  await stalePage.close();

  await testInfo.attach('markdown', {
    body: `
## Expected Outcomes

- Submitting moves the event to **PENDING_REVIEW**.
- Rejecting requires a comment, and the rejection reason is shown on the event details page.
- Re-submitting returns the event to **PENDING_REVIEW**.
- Approving moves the event to **APPROVED**.
- If another reviewer already changed status, the stale reviewer gets a clear conflict message and the page refreshes to latest state.
`,
  });
});
