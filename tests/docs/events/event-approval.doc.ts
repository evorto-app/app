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
import { waitForRegistrationPage } from '../../support/utils/event-registration-page';
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
      has: page.getByRole('heading', { name: 'Submit event for review' }),
    })
    .filter({
      hasText: 'Are you sure you want to submit this event for review?',
    })
    .filter({
      hasText: 'cannot edit the event while it is waiting for review',
    })
    .filter({
      has: page.getByRole('button', { name: 'Submit for review' }),
    })
    .first();

const returnToDraftDialogSurface = (page: Page): Locator =>
  page
    .locator('mat-dialog-container')
    .filter({
      has: page.getByRole('heading', { name: 'Return event to draft' }),
    })
    .filter({ has: page.getByLabel('Feedback for the creator') })
    .filter({ has: page.getByRole('button', { name: 'Return to draft' }) })
    .first();

const clickHydratedAction = async (action: Locator): Promise<void> => {
  await expect(action).not.toHaveAttribute('jsaction', /click/, {
    timeout: 20_000,
  });
  await action.click();
};

test('Review and publish an event', async ({
  browser,
  database,
  page,
  registerDatabaseCleanup,
  tenant,
  testClock,
}, testInfo) => {
  const eventTitle = 'Community garden workshop';
  const reviewFeedback = 'Please add clearer safety information for attendees.';
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
    description: 'Learn safe planting techniques in the community garden.',
    end,
    icon: template.icon,
    id: eventId,
    start,
    status: 'DRAFT',
    templateId: template.id,
    tenantId: tenant.id,
    title: eventTitle,
  });

  await database.insert(schema.roles).values({
    description: 'Can review events without editing them',
    id: reviewerRoleId,
    name: 'Event reviewer',
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
    description: 'Attend this event.',
    eventId,
    isPaid: false,
    openRegistrationTime: new Date(start.getTime() - 1000 * 60 * 60 * 24),
    organizingRegistration: false,
    price: 0,
    registeredDescription: 'Your ticket is confirmed.',
    registrationMode: 'fcfs',
    roleIds: [],
    spots: 20,
    title: 'Attendee sign-up',
  });

  await page.goto(`/events/${eventId}`);
  await expect(
    page.getByRole('heading', { level: 1, name: eventTitle }),
  ).toBeVisible({ timeout: 15_000 });

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Who can do this" %}
Creating and reviewing an event use different permissions:

- A person with **Create events** access can create an event, edit it while it is a draft, and submit it for review.
- **Create events** does not include **View draft events**. Without that additional access, the creator continues from the details page opened after saving or reopens the saved event link.
- A person with **Review events** access makes the publishing decision from **Admin Tools** → **Event reviews**. This permission does not allow editing the event.
- No payment is needed for this free event.
{% /callout %}


An event moves through these publishing stages:

- **Draft**
- **Pending Review**
- **Published**

Approving an event publishes it. There is no separate step between approval and publication.

Pending-review and published events cannot be edited. A reviewer can return a pending event to draft with feedback, which lets the creator make corrections. Once an event is published, approval does not reopen the editor.

Submit a draft for review, return it with feedback when changes are needed, and approve it when it is ready to publish. Published events can no longer be edited through the normal event form.
`,
  });

  const draftStatusSurface = eventStatusSurface(page, [
    'Draft',
    'Submit for review',
  ]);
  await expect(draftStatusSurface).toBeVisible();
  const submitButton = draftStatusSurface.getByRole('button', {
    name: 'Submit for review',
  });
  await expect(submitButton).toBeEnabled({ timeout: 20_000 });
  await testInfo.attach('markdown', {
    body: `
## 1. Submit a draft for review

After **Create event** succeeds, Evorto opens the newly created event's details page. Submit the draft from that page. If you navigated away and cannot see the draft under **Events**, reopen its saved link; seeing drafts in the event list requires the separate **View draft events** access.
Review the draft, then select **Submit for review**.
`,
  });
  await takeScreenshot(
    testInfo,
    draftStatusSurface,
    page,
    'Draft event ready to submit for review',
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
    submitDialog.getByRole('button', { name: 'Submit for review' }),
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

  const reviewerPage: AuthenticatedTestPage = await openAuthenticatedTestPage({
    baseUrl: new URL(page.url()).origin,
    browser,
    storageState: emptyStateFile,
    tenantDomain: tenant.domain,
    testClock,
  });
  registerDatabaseCleanup(async () => reviewerPage.context.close());
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
        name: /^Event reviews(?: \d+)?$/u,
      }),
    );
    await expect(
      reviewerPage.page.getByRole('heading', {
        exact: true,
        level: 1,
        name: 'Event reviews',
      }),
    ).toBeVisible();
    return currentReviewQueueItem();
  };

  let reviewQueueItem = await openReviewQueue();
  await expect(reviewQueueItem).toBeVisible();
  await expect(
    reviewQueueItem.getByRole('button', { name: 'Return to draft' }),
  ).toBeVisible();
  await expect(
    reviewQueueItem.getByRole('button', { name: 'Approve' }),
  ).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
## 2. Review the event

A person with **Review events** access opens **Admin Tools** and selects **Event reviews**. Find the event by title and review its start time before choosing **Return to draft** or **Approve**.

Use **Open event** to read the full event. **Review events** access alone does not show **Organize this event** or allow editing.
`,
  });
  await takeScreenshot(
    testInfo,
    reviewQueueItem,
    reviewerPage.page,
    'Events waiting for a publishing decision',
  );

  await reviewQueueItem.getByRole('link', { name: 'Open event' }).click();
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
      name: 'Event reviews',
    }),
  ).toBeVisible({ timeout: 20_000 });
  reviewQueueItem = currentReviewQueueItem();
  await expect(reviewQueueItem).toBeVisible({ timeout: 20_000 });
  await clickHydratedAction(
    reviewQueueItem.getByRole('button', { name: 'Return to draft' }),
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
    returnToDraftDialog.getByRole('button', { name: 'Return to draft' }),
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
  await waitForRegistrationPage(page);
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
    name: 'Submit for review',
  });
  await expect(resubmitButton).toBeEnabled({ timeout: 20_000 });
  await clickHydratedAction(resubmitButton);
  const resubmitDialog = submitForReviewDialogSurface(page);
  await expect(resubmitDialog).toBeVisible();
  await clickHydratedAction(
    resubmitDialog.getByRole('button', { name: 'Submit for review' }),
  );
  await expect(
    page
      .locator('app-event-status')
      .getByText('Pending Review', { exact: true }),
  ).toBeVisible();
  await expect((await readGeneratedEvent()).status).toBe('PENDING_REVIEW');

  await clickHydratedAction(
    reviewerPage.page.getByRole('button', {
      name: 'Check pending reviews again',
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
  await waitForRegistrationPage(page);
  await expect(
    page.getByRole('heading', { exact: true, level: 1, name: eventTitle }),
  ).toBeVisible();
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

Approving from **Admin Tools** → **Event reviews** removes the item from the review list. The creator can return to the event page to see the final status, **Published**.

Published events cannot be edited. Even the creator no longer sees **Edit Event**. An old saved edit link returns to the event details page instead of opening the form.
`,
  });
  await takeScreenshot(
    testInfo,
    publishedStatusSurface,
    page,
    'Published event after review',
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
## What changes at each stage

- After submission, the event is **Pending Review** and cannot be edited.
- A reviewer can approve the event or return it with feedback. Reviewing alone does not allow organizing or editing it.
- Returning the event changes it back to **Draft**. The creator sees the feedback and can make corrections.
- Submitting the corrected draft changes it back to **Pending Review**.
- Approving the event publishes it with the final status **Published**.
- A published event has no edit action. Old saved edit links return to its details page.
`,
  });
});
