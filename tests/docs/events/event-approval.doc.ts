import { createId } from '../../../src/db/create-id';
import * as schema from '../../../src/db/schema';
import {
  adminStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Event approval workflow @track(playwright-specs-track-linking_20260126) @doc(EVENT-APPROVAL-DOC-01)', async ({
  database,
  page,
  tenant,
}, testInfo) => {
  const eventTitle = `Approval Flow ${Date.now()}`;
  const rejectionComment =
    'Please add clearer safety information for participants.';
  const adminUser = usersToAuthenticate.find((user) => user.roles === 'admin');
  if (!adminUser) {
    throw new Error('Admin test user configuration missing');
  }
  const template = await database.query.eventTemplates.findFirst({
    where: { tenantId: tenant.id },
  });
  if (!template) {
    throw new Error('No template available for approval workflow docs test');
  }
  const eventId = createId();
  const start = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  const end = new Date(start.getTime() + 1000 * 60 * 60 * 3);

  await database.insert(schema.eventInstances).values({
    creatorId: adminUser.id,
    description: 'Approval workflow event seeded for documentation test',
    end,
    icon: template.icon,
    id: eventId,
    start,
    status: 'DRAFT',
    templateId: template.id,
    tenantId: tenant.id,
    title: eventTitle,
    unlisted: false,
  });

  await database.insert(schema.eventRegistrationOptions).values({
    closeRegistrationTime: new Date(start.getTime() - 1000 * 60 * 60),
    description: 'Participant registration',
    eventId,
    isPaid: false,
    openRegistrationTime: new Date(Date.now() - 1000 * 60 * 60 * 24),
    organizingRegistration: false,
    price: 0,
    registeredDescription: 'You are registered',
    registrationMode: 'fcfs',
    roleIds: [],
    spots: 20,
    title: 'Participant registration',
  });

  await page.goto(`/events/${eventId}`);
  await expect(
    page.getByRole('heading', { level: 1, name: eventTitle }),
  ).toBeVisible();

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

  const reviewActions = page
    .locator('app-event-status')
    .locator('xpath=ancestor::div[contains(@class,"bg-surface")]')
    .first();
  await expect(
    reviewActions.getByRole('button', { name: 'Reject' }),
  ).toBeVisible();
  await expect(
    reviewActions.getByRole('button', { name: 'Approve' }),
  ).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
## 2. Review from the admin queue

After submission, reviewers can process the event from the review action surface on the event details page.
The screenshot captures the controls where reviewers approve or reject.
`,
  });
  await takeScreenshot(
    testInfo,
    reviewActions,
    page,
    'Admin review action surface',
  );

  await page.getByRole('button', { name: 'Reject' }).click();
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
