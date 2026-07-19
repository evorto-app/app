import { and, eq } from 'drizzle-orm';

import { createId } from '../../../src/db/create-id';
import * as schema from '../../../src/db/schema';
import {
  emptyStateFile,
  organizerStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import {
  type AuthenticatedTestPage,
  openAuthenticatedTestPage,
} from '../../support/utils/authenticated-test-page';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';
import type { Locator, Page } from '@playwright/test';

test.use({ storageState: organizerStateFile });

// This documentation journey deliberately exercises one continuous lifecycle
// across two authenticated browser contexts, including four state transitions
// and their persisted readbacks.
test.setTimeout(300_000);

const eventStatusSurface = (
  page: Page,
  requiredText: string | string[],
): Locator => {
  const texts = Array.isArray(requiredText) ? requiredText : [requiredText];
  let surface = page
    .locator('app-event-status')
    .locator('xpath=ancestor::div[contains(@class,"bg-surface")]')
    .filter({ hasText: texts[0] ?? '' });

  for (const text of texts.slice(1)) {
    surface = surface.filter({ hasText: text });
  }

  return surface.first();
};

const submitForReviewDialogSurface = (page: Page): Locator =>
  page
    .locator('mat-dialog-container')
    .filter({
      has: page.getByRole('heading', { name: 'Submit Event for Review' }),
    })
    .filter({
      hasText: 'Are you sure you want to submit this event for review?',
    })
    .filter({
      hasText:
        'locked for editing until it is either published or returned to draft with feedback',
    })
    .filter({
      has: page.getByRole('button', { name: 'Submit for Review' }),
    })
    .first();

const returnToDraftDialogSurface = (page: Page): Locator =>
  page
    .locator('mat-dialog-container')
    .filter({
      has: page.getByRole('heading', { name: 'Return Event to Draft' }),
    })
    .filter({ has: page.getByLabel('Feedback for the creator') })
    .filter({ has: page.getByRole('button', { name: 'Return to Draft' }) })
    .first();

const clickHydratedAction = async (action: Locator): Promise<void> => {
  await expect(action).not.toHaveAttribute('jsaction', /click/, {
    timeout: 20_000,
  });
  await action.click();
};

test('Event approval workflow', async ({
  browser,
  database,
  page,
  registerDatabaseCleanup,
  seedDate,
  tenant,
  testClock,
}, testInfo) => {
  const eventTitle = `Approval Flow ${seedDate.getTime()}`;
  const reviewFeedback =
    'Please add clearer safety information for participants.';
  const creator = usersToAuthenticate.find(
    (user) => user.stateFile === organizerStateFile,
  );
  const reviewer = usersToAuthenticate.find(
    (user) => user.stateFile === emptyStateFile,
  );
  if (!creator || !reviewer) {
    throw new Error('Approval workflow test users are missing');
  }
  const [template] = await database
    .select()
    .from(schema.eventTemplates)
    .where(eq(schema.eventTemplates.tenantId, tenant.id))
    .limit(1);
  if (!template) {
    throw new Error('No template available for approval workflow docs test');
  }
  const eventId = createId();
  const reviewerRoleId = createId();
  const eventWindow = futureServerEventWindow({
    durationHours: 3,
    startInDays: 7,
  });
  const { end, start } = eventWindow;
  let reviewerPage: AuthenticatedTestPage | undefined;

  const reviewerMembership = await database.query.usersToTenants.findFirst({
    where: {
      tenantId: tenant.id,
      userId: reviewer.id,
    },
  });
  if (!reviewerMembership) {
    throw new Error('Review-only user tenant membership is missing');
  }

  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .delete(schema.eventRegistrationOptions)
      .where(eq(schema.eventRegistrationOptions.eventId, eventId));
    await cleanupDatabase
      .delete(schema.eventInstances)
      .where(
        and(
          eq(schema.eventInstances.id, eventId),
          eq(schema.eventInstances.tenantId, tenant.id),
        ),
      );
    await cleanupDatabase
      .delete(schema.rolesToTenantUsers)
      .where(
        and(
          eq(schema.rolesToTenantUsers.roleId, reviewerRoleId),
          eq(schema.rolesToTenantUsers.userTenantId, reviewerMembership.id),
        ),
      );
    await cleanupDatabase
      .delete(schema.roles)
      .where(eq(schema.roles.id, reviewerRoleId));
  });
  registerDatabaseCleanup(async () => reviewerPage?.context.close());

  const readGeneratedEvent = async () => {
    const [generatedEvent] = await database
      .select()
      .from(schema.eventInstances)
      .where(
        and(
          eq(schema.eventInstances.id, eventId),
          eq(schema.eventInstances.tenantId, tenant.id),
        ),
      )
      .limit(1);
    if (!generatedEvent) {
      throw new Error('Expected generated approval docs event to exist');
    }

    return generatedEvent;
  };

  await database.insert(schema.eventInstances).values({
    creatorId: creator.id,
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

  await database.insert(schema.roles).values({
    description: 'Can review events without editing them',
    id: reviewerRoleId,
    name: `Event reviewer ${seedDate.getTime()}`,
    permissions: ['events:review'],
    tenantId: tenant.id,
  });
  await database.insert(schema.rolesToTenantUsers).values({
    roleId: reviewerRoleId,
    tenantId: tenant.id,
    userTenantId: reviewerMembership.id,
  });

  await database.insert(schema.eventRegistrationOptions).values({
    closeRegistrationTime: new Date(start.getTime() - 1000 * 60 * 60),
    description: 'Participant registration',
    eventId,
    isPaid: false,
    openRegistrationTime: new Date(start.getTime() - 1000 * 60 * 60 * 24),
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
  ).toBeVisible({ timeout: 15_000 });

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Permissions" %}
Use two different organization accounts so creation and approval remain independent:

- The **creator** needs **Create events** access and can edit the event they created. Saving a new event opens its details page, where they can submit it for review.
- **Create events** does not include **View draft events**. Without the latter access, the creator's draft is intentionally absent from **Events**, so continue from the post-save details page or reopen that exact event link.
- The **reviewer** needs **Review events** access. Start from **Admin Tools** → **Event Reviews**. Review access alone does not grant event editing.
- No payment is needed for this free event.
{% /callout %}

# Event Approval

The event publishing lifecycle is:

- **Draft**
- **Pending review**
- **Published**

Publishing is the approval act. There is no separate approved-but-unpublished state in the relaunch workflow.

Pending review and published events are both locked against material editing. A reviewer can return a pending event to draft with feedback, which restores editing so the creator can make corrections. Publishing is the final normal authoring state: approval does not reopen the editor.

This guide demonstrates submitting an event, returning it to draft with feedback, re-submitting, publishing through approval, and proving that the published event remains locked.
`,
  });

  const draftStatusSurface = eventStatusSurface(page, [
    'Draft',
    'Submit for Review',
  ]);
  await expect(draftStatusSurface).toBeVisible();
  const submitButton = draftStatusSurface.getByRole('button', {
    name: 'Submit for Review',
  });
  await expect(submitButton).toBeEnabled({ timeout: 20_000 });
  await testInfo.attach('markdown', {
    body: `
## 1. Submit a draft for review

After **Save Event** succeeds, Evorto opens the newly created event's details page. Submit the draft from that page. If you navigated away and cannot see the draft under **Events**, reopen its exact link; listing drafts requires the separate **View draft events** access.
The screenshot below highlights the draft status and exact action before the status transition.
`,
  });
  await takeScreenshot(
    testInfo,
    draftStatusSurface,
    page,
    'Draft event status with submit-for-review action',
  );

  await clickHydratedAction(submitButton);
  const submitDialog = submitForReviewDialogSurface(page);
  await expect(submitDialog).toBeVisible();
  await takeScreenshot(
    testInfo,
    submitDialog,
    page,
    'Submit event for review confirmation dialog',
  );
  await clickHydratedAction(
    submitDialog.getByRole('button', { name: 'Submit for Review' }),
  );
  await expect(
    page
      .locator('app-event-status')
      .getByText('Pending Review', { exact: true }),
  ).toBeVisible();
  await expect((await readGeneratedEvent()).status).toBe('PENDING_REVIEW');

  const creatorPendingStatus = eventStatusSurface(page, 'Pending Review');
  await expect(creatorPendingStatus).toBeVisible();
  await expect(
    creatorPendingStatus.getByRole('button', { name: 'Return to draft' }),
  ).toHaveCount(0);
  await expect(
    creatorPendingStatus.getByRole('button', { name: 'Approve' }),
  ).toHaveCount(0);

  reviewerPage = await openAuthenticatedTestPage({
    baseUrl: new URL(page.url()).origin,
    browser,
    storageState: emptyStateFile,
    tenantDomain: tenant.domain,
    testClock,
  });
  const currentReviewQueueItem = () => {
    if (!reviewerPage) {
      throw new Error('Review-only browser context is missing');
    }
    return reviewerPage.page
      .getByRole('heading', { exact: true, name: eventTitle })
      .locator('xpath=ancestor::div[contains(@class,"bg-surface")]')
      .first();
  };
  const openReviewQueue = async () => {
    if (!reviewerPage) {
      throw new Error('Review-only browser context is missing');
    }
    await reviewerPage.page.goto('/');
    await clickHydratedAction(
      reviewerPage.page.getByRole('link', {
        exact: true,
        name: 'Admin Tools',
      }),
    );
    await clickHydratedAction(
      reviewerPage.page.getByRole('link', {
        name: /^Event Reviews(?: \d+)?$/u,
      }),
    );
    await expect(
      reviewerPage.page.getByRole('heading', {
        exact: true,
        level: 1,
        name: 'Event Reviews',
      }),
    ).toBeVisible();
    return currentReviewQueueItem();
  };

  let reviewQueueItem = await openReviewQueue();
  await expect(reviewQueueItem).toBeVisible();
  await expect(
    reviewQueueItem.getByRole('button', { name: 'Reject' }),
  ).toBeVisible();
  await expect(
    reviewQueueItem.getByRole('button', { name: 'Approve' }),
  ).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
## 2. Review from the admin queue

Sign in with the review-only account, open **Admin Tools**, and select **Event Reviews**. Find the event by title and review its start time before choosing **Reject** or **Approve**.

The **Open Event** link is available for context, but this account has no **Organize this event** action. **Review events** access does not grant edit authority.
`,
  });
  await takeScreenshot(
    testInfo,
    reviewQueueItem,
    reviewerPage.page,
    'Review-only event queue with publish decision controls',
  );

  await reviewQueueItem.getByRole('link', { name: 'Open Event' }).click();
  await expect(
    reviewerPage.page.getByRole('heading', {
      exact: true,
      level: 1,
      name: eventTitle,
    }),
  ).toBeVisible();
  await expect(
    reviewerPage.page.getByRole('link', { name: 'Organize this event' }),
  ).toHaveCount(0);

  await reviewerPage.page.goBack();
  await expect(
    reviewerPage.page.getByRole('heading', {
      exact: true,
      level: 1,
      name: 'Event Reviews',
    }),
  ).toBeVisible({ timeout: 20_000 });
  reviewQueueItem = currentReviewQueueItem();
  await expect(reviewQueueItem).toBeVisible({ timeout: 20_000 });
  await clickHydratedAction(
    reviewQueueItem.getByRole('button', { name: 'Reject' }),
  );
  const returnToDraftDialog = returnToDraftDialogSurface(reviewerPage.page);
  await expect(returnToDraftDialog).toBeVisible();
  await takeScreenshot(
    testInfo,
    returnToDraftDialog,
    reviewerPage.page,
    'Return-to-draft dialog with required creator feedback',
  );
  await returnToDraftDialog
    .getByLabel('Feedback for the creator')
    .fill(reviewFeedback);
  await clickHydratedAction(
    returnToDraftDialog.getByRole('button', { name: 'Return to Draft' }),
  );
  await expect(
    reviewerPage.page.getByText(
      `Event "${eventTitle}" was returned to draft with review feedback`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(reviewQueueItem).toHaveCount(0);
  const returnedEvent = await readGeneratedEvent();
  expect(returnedEvent.status).toBe('DRAFT');
  expect(returnedEvent.statusComment).toBe(reviewFeedback);
  expect(returnedEvent.reviewedBy).toBe(reviewer.id);
  expect(returnedEvent.reviewedAt).not.toBeNull();

  await page.reload();
  const returnedDraftStatusSurface = eventStatusSurface(page, [
    'Draft',
    `Review feedback: ${reviewFeedback}`,
  ]);
  await expect(returnedDraftStatusSurface).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator('app-event-status').getByText('Draft', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(`Review feedback: ${reviewFeedback}`),
  ).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
## 3. Return-to-draft feedback on event details

When a reviewer returns the event, its status changes to **Draft** and the review feedback is shown directly on the details page.
This gives creators clear guidance before they re-submit.
`,
  });
  await takeScreenshot(
    testInfo,
    returnedDraftStatusSurface,
    page,
    'Returned draft status with review feedback',
  );

  const resubmitButton = page.getByRole('button', {
    name: 'Submit for Review',
  });
  await expect(resubmitButton).toBeEnabled({ timeout: 20_000 });
  await clickHydratedAction(resubmitButton);
  const resubmitDialog = submitForReviewDialogSurface(page);
  await expect(resubmitDialog).toBeVisible();
  await clickHydratedAction(
    resubmitDialog.getByRole('button', { name: 'Submit for Review' }),
  );
  await expect(
    page
      .locator('app-event-status')
      .getByText('Pending Review', { exact: true }),
  ).toBeVisible();
  await expect((await readGeneratedEvent()).status).toBe('PENDING_REVIEW');

  await clickHydratedAction(
    reviewerPage.page.getByRole('button', {
      name: 'Refresh pending reviews',
    }),
  );
  reviewQueueItem = currentReviewQueueItem();
  await expect(reviewQueueItem).toBeVisible({ timeout: 20_000 });
  await clickHydratedAction(
    reviewQueueItem.getByRole('button', { name: 'Approve' }),
  );
  await expect(
    reviewerPage.page.getByText(`Event "${eventTitle}" has been approved`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(reviewQueueItem).toHaveCount(0);

  await page.reload();
  await expect(
    page.locator('app-event-status').getByText('Published', { exact: true }),
  ).toBeVisible();
  const approvedEvent = await readGeneratedEvent();
  expect(approvedEvent.status).toBe('APPROVED');
  expect(approvedEvent.reviewedBy).toBe(reviewer.id);
  const publishedStatusSurface = eventStatusSurface(page, 'Published');
  await expect(publishedStatusSurface).toBeVisible();
  await expect(
    page.getByRole('link', { exact: true, name: 'Edit Event' }),
  ).toHaveCount(0);
  await testInfo.attach('markdown', {
    body: `
## 4. Approval result

Approving from **Admin Tools** → **Event Reviews** removes the item from the queue. Return to the creator account and refresh the event details page. The final status is **Published**.

Published events are locked. Even the creator no longer sees **Edit Event**. If someone follows an old bookmark or manually enters the edit URL, Evorto returns them to the event details page instead of opening an editable form.
`,
  });
  await takeScreenshot(
    testInfo,
    publishedStatusSurface,
    page,
    'Published event status chip after organizer submission and approval',
  );

  await page.goto(`/events/${eventId}/edit`);
  await expect(page).toHaveURL(
    new RegExp(`/events/${eventId}\\?error=event-locked$`),
  );
  await expect(
    page.getByRole('heading', { exact: true, level: 1, name: eventTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { exact: true, name: 'Edit Event' }),
  ).toHaveCount(0);

  await testInfo.attach('markdown', {
    body: `
## Expected Outcomes

- Submitting moves the event to **Pending review**.
- The creator cannot run review actions, and the review-only account cannot organize or edit the event.
- Returning to draft requires feedback, and that feedback is shown on the event details page.
- Re-submitting returns the event to **Pending review**.
- Approving publishes the event with the final status **Published**.
- Published events expose no edit action, and direct edit URLs return to the event details page.
`,
  });
});
