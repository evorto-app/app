import { and, eq } from 'drizzle-orm';

import { createId } from '../../../src/db/create-id';
import * as schema from '../../../src/db/schema';
import {
  adminStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import type { Locator, Page } from '@playwright/test';

test.use({ storageState: adminStateFile });

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

test('Event approval workflow', async ({
  database,
  page,
  seedDate,
  tenant,
}, testInfo) => {
  const eventStartMs = Date.now() + 1000 * 60 * 60 * 24 * 7;
  const eventTitle = `Approval Flow ${seedDate.getTime()}`;
  const reviewFeedback =
    'Please add clearer safety information for participants.';
  const adminUser = usersToAuthenticate.find((user) => user.roles === 'admin');
  if (!adminUser) {
    throw new Error('Admin test user configuration missing');
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
  const start = new Date(eventStartMs);
  const end = new Date(start.getTime() + 1000 * 60 * 60 * 3);

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
    openRegistrationTime: new Date(eventStartMs - 1000 * 60 * 60 * 24),
    organizingRegistration: false,
    price: 0,
    registeredDescription: 'You are registered',
    registrationMode: 'fcfs',
    roleIds: [],
    spots: 20,
    title: 'Participant registration',
  });

  try {
    await page.goto(`/events/${eventId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: eventTitle }),
    ).toBeVisible({ timeout: 15_000 });

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Permissions" %}
This workflow assumes a user can both submit and review events.

- **Submit for review** requires being an event editor (event creator or \`events:editAll\`).
- **Publish/Return to draft** requires \`events:review\`.
{% /callout %}

# Event Approval

The user-facing event publishing lifecycle is:

- **DRAFT**
- **PENDING_REVIEW**
- **Published** (stored event status: APPROVED)

Publishing is the approval act. There is no separate approved-but-unpublished state in the relaunch workflow.

Pending review locks material event editing until the event is published or returned to draft. Reviewers use the review action surface to publish or return the event with feedback; they do not edit material event fields from that review action.

This guide demonstrates submitting an event, returning it to draft with feedback, re-submitting, publishing through approval, and conflict handling.
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
    await expect(submitButton).toBeVisible();
    await testInfo.attach('markdown', {
      body: `
## 1. Submit a draft for review

From the event details page, creators can submit draft events for review.
The screenshot below highlights the draft status and exact action before the status transition.
`,
    });
    await takeScreenshot(
      testInfo,
      draftStatusSurface,
      page,
      'Draft event status with submit-for-review action',
    );

    await submitButton.click();
    const submitDialog = submitForReviewDialogSurface(page);
    await expect(submitDialog).toBeVisible();
    await takeScreenshot(
      testInfo,
      submitDialog,
      page,
      'Submit event for review confirmation dialog',
    );
    await submitDialog
      .getByRole('button', { name: 'Submit for Review' })
      .click();
    await expect(
      page
        .locator('app-event-status')
        .getByText('Pending Review', { exact: true }),
    ).toBeVisible();
    await expect((await readGeneratedEvent()).status).toBe('PENDING_REVIEW');

    const reviewActions = eventStatusSurface(page, 'Pending Review');
    await expect(
      reviewActions.getByRole('button', { name: 'Return to draft' }),
    ).toBeVisible();
    await expect(
      reviewActions.getByRole('button', { name: 'Approve' }),
    ).toBeVisible();
    await testInfo.attach('markdown', {
      body: `
## 2. Review from the admin queue

After submission, reviewers can process the event from the review action surface on the event details page.
The screenshot captures the controls where reviewers publish or return the event to draft.
`,
    });
    await takeScreenshot(
      testInfo,
      reviewActions,
      page,
      'Admin review action surface with publish decision controls',
    );

    await page.getByRole('button', { name: 'Return to draft' }).click();
    const returnToDraftDialog = returnToDraftDialogSurface(page);
    await expect(returnToDraftDialog).toBeVisible();
    await takeScreenshot(
      testInfo,
      returnToDraftDialog,
      page,
      'Return-to-draft dialog with required creator feedback',
    );
    await returnToDraftDialog
      .getByLabel('Feedback for the creator')
      .fill(reviewFeedback);
    await returnToDraftDialog
      .getByRole('button', { name: 'Return to Draft' })
      .click();
    await expect(
      page.locator('app-event-status').getByText('Draft', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`Review feedback: ${reviewFeedback}`),
    ).toBeVisible();
    const returnedEvent = await readGeneratedEvent();
    expect(returnedEvent.status).toBe('DRAFT');
    expect(returnedEvent.statusComment).toBe(reviewFeedback);
    expect(returnedEvent.reviewedBy).toBe(adminUser.id);
    expect(returnedEvent.reviewedAt).not.toBeNull();

    await page.goto(`/events/${eventId}`);
    await expect(
      page.locator('app-event-status').getByText('Draft', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`Review feedback: ${reviewFeedback}`),
    ).toBeVisible();
    const returnedDraftStatusSurface = eventStatusSurface(page, [
      'Draft',
      `Review feedback: ${reviewFeedback}`,
    ]);
    await expect(returnedDraftStatusSurface).toBeVisible();
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

    await page.getByRole('button', { name: 'Submit for Review' }).click();
    const resubmitDialog = submitForReviewDialogSurface(page);
    await expect(resubmitDialog).toBeVisible();
    await resubmitDialog
      .getByRole('button', { name: 'Submit for Review' })
      .click();
    await expect(
      page
        .locator('app-event-status')
        .getByText('Pending Review', { exact: true }),
    ).toBeVisible();
    await expect((await readGeneratedEvent()).status).toBe('PENDING_REVIEW');

    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(
      page.locator('app-event-status').getByText('Published', { exact: true }),
    ).toBeVisible();
    const approvedEvent = await readGeneratedEvent();
    expect(approvedEvent.status).toBe('APPROVED');
    expect(approvedEvent.reviewedBy).toBe(adminUser.id);
    const publishedStatusSurface = eventStatusSurface(page, 'Published');
    await expect(publishedStatusSurface).toBeVisible();
    await testInfo.attach('markdown', {
      body: `
## 4. Approval result

Approving the event publishes it and removes the pending-review actions from the event details page.
The screenshot demonstrates the final **Published** state.
`,
    });
    await takeScreenshot(
      testInfo,
      publishedStatusSurface,
      page,
      'Published event status chip after organizer submission and approval',
    );

    await testInfo.attach('markdown', {
      body: `
## Expected Outcomes

- Submitting moves the event to **PENDING_REVIEW**.
- Returning to draft requires feedback, and that feedback is shown on the event details page.
- Re-submitting returns the event to **PENDING_REVIEW**.
- Approving publishes the event and stores the final status as **APPROVED**.
`,
    });
  } finally {
    await database
      .delete(schema.eventRegistrationOptions)
      .where(eq(schema.eventRegistrationOptions.eventId, eventId));
    await database
      .delete(schema.eventInstances)
      .where(
        and(
          eq(schema.eventInstances.id, eventId),
          eq(schema.eventInstances.tenantId, tenant.id),
        ),
      );
  }
});
