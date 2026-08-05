import { and, eq, inArray } from 'drizzle-orm';

import { addConsumedFinanceReceiptUpload } from '../../../helpers/add-finance-receipt-upload';
import { getId } from '../../../helpers/get-id';
import { gaStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { seedUserRoleAssignmentScenario } from '../../support/utils/user-role-assignment-scenario';

test.use({ storageState: gaStateFile });

test('Manage one organization and review change history', async ({
  database,
  events,
  page,
  registerDatabaseCleanup,
  seedDate,
  seeded,
  templates,
  tenant,
  testClock,
}, testInfo) => {
  // This guide intentionally exercises six audited operations and their
  // persisted readbacks in one continuous organization-scoped journey.
  test.setTimeout(300_000);

  const draftEvent = events.find(
    (event) => event.id === seeded.scenario.events.draft.eventId,
  );
  const checkInEvent = events.find(
    (event) => event.id === seeded.scenario.events.past.eventId,
  );
  const checkInOption = checkInEvent?.registrationOptions.find(
    (option) => !option.organizingRegistration && !option.isPaid,
  );
  const documentedTemplate = templates.find(
    (template) => template.seedKey === 'city-tour',
  );
  if (!draftEvent || !checkInEvent || !checkInOption || !documentedTemplate) {
    throw new Error(
      'Expected deterministic draft event, free past-event option, and city-tour template for platform documentation',
    );
  }

  const assignmentScenario = await seedUserRoleAssignmentScenario({
    database,
    roleName: 'Event support volunteer',
    tenant,
    userEmail: 'morgan.support@example.org',
  });
  const eventReason = 'Correct the event title';
  const templateReason = 'Clarify the template title';
  const roleAssignmentReason = 'Add event support responsibilities';
  const roleRemovalReason = 'Remove the completed support assignment';
  const receiptReason = 'The receipt file cannot be checked';
  const registrationReason = 'Confirm arrival with one guest';
  const auditReasons = [
    eventReason,
    templateReason,
    roleAssignmentReason,
    roleRemovalReason,
    receiptReason,
    registrationReason,
  ];
  const editedEventTitle = `${draftEvent.title} – evening edition`;
  const editedTemplateTitle = `${documentedTemplate.title} – volunteer edition`;
  const registrationId = getId();
  const receiptId = getId();
  const receiptFileName = 'travel-lunch.pdf';
  const rejectionReason =
    'The uploaded receipt cannot be verified, so it must be submitted again.';
  const receiptNotificationKey = `receipt-reviewed/${tenant.id}/${receiptId}/rejected`;
  const registrationSpotCount = 2;
  const originalOptionCounters =
    await database.query.eventRegistrationOptions.findFirst({
      columns: {
        checkedInSpots: true,
        confirmedSpots: true,
        reservedSpots: true,
        spots: true,
      },
      where: {
        event: { tenantId: tenant.id },
        eventId: checkInEvent.id,
        id: checkInOption.id,
      },
    });
  if (!originalOptionCounters) {
    throw new Error('Expected the documented check-in option to exist');
  }
  const originalCheckInEventWindow =
    await database.query.eventInstances.findFirst({
      columns: { end: true, start: true },
      where: { id: checkInEvent.id, tenantId: tenant.id },
    });
  if (!originalCheckInEventWindow) {
    throw new Error('Expected the documented check-in event to exist');
  }
  const confirmedSpots =
    originalOptionCounters.confirmedSpots + registrationSpotCount;
  const checkedInSpots = originalOptionCounters.checkedInSpots;
  if (
    confirmedSpots + originalOptionCounters.reservedSpots >
      originalOptionCounters.spots ||
    checkedInSpots > confirmedSpots
  ) {
    throw new Error(
      'The documented check-in option lacks coherent capacity for the confirmed registration',
    );
  }
  const scannerNow = testClock.toJSDate();
  const openCheckInEventWindow = {
    end: new Date(scannerNow.getTime() + 30 * 60 * 1000),
    start: new Date(scannerNow.getTime() - 30 * 60 * 1000),
  };

  let temporaryRecordsInserted = false;

  const expectPersistedAudit = async (
    reason: string,
    action: (typeof schema.platformAuditEntries.$inferSelect)['action'],
  ) => {
    await expect
      .poll(async () =>
        database.query.platformAuditEntries.findFirst({
          where: { action, reason, targetTenantId: tenant.id },
        }),
      )
      .toEqual(
        expect.objectContaining({
          action,
          reason,
          targetTenantId: tenant.id,
        }),
      );
  };

  const receiptUploadId = await addConsumedFinanceReceiptUpload(database, {
    eventId: checkInEvent.id,
    fileName: receiptFileName,
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    tenantId: tenant.id,
    uploadedByUserId: assignmentScenario.user.id,
  });

  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .delete(schema.emailOutbox)
      .where(eq(schema.emailOutbox.idempotencyKey, receiptNotificationKey));
    await cleanupDatabase
      .delete(schema.platformAuditEntries)
      .where(
        and(
          eq(schema.platformAuditEntries.targetTenantId, tenant.id),
          inArray(schema.platformAuditEntries.reason, auditReasons),
        ),
      );
    if (temporaryRecordsInserted) {
      await cleanupDatabase
        .delete(schema.financeReceipts)
        .where(
          and(
            eq(schema.financeReceipts.id, receiptId),
            eq(schema.financeReceipts.tenantId, tenant.id),
          ),
        );
      await cleanupDatabase
        .delete(schema.eventRegistrations)
        .where(
          and(
            eq(schema.eventRegistrations.id, registrationId),
            eq(schema.eventRegistrations.tenantId, tenant.id),
          ),
        );
      await cleanupDatabase
        .update(schema.eventRegistrationOptions)
        .set(originalOptionCounters)
        .where(
          and(
            eq(schema.eventRegistrationOptions.id, checkInOption.id),
            eq(schema.eventRegistrationOptions.eventId, checkInEvent.id),
          ),
        );
    }
    await cleanupDatabase
      .update(schema.eventInstances)
      .set(originalCheckInEventWindow)
      .where(
        and(
          eq(schema.eventInstances.id, checkInEvent.id),
          eq(schema.eventInstances.tenantId, tenant.id),
        ),
      );
    if (receiptUploadId) {
      await cleanupDatabase
        .delete(schema.financeReceiptUploads)
        .where(eq(schema.financeReceiptUploads.id, receiptUploadId));
    }
    await cleanupDatabase
      .update(schema.eventInstances)
      .set({ title: draftEvent.title })
      .where(
        and(
          eq(schema.eventInstances.id, draftEvent.id),
          eq(schema.eventInstances.tenantId, tenant.id),
        ),
      );
    await cleanupDatabase
      .update(schema.eventTemplates)
      .set({ title: documentedTemplate.title })
      .where(
        and(
          eq(schema.eventTemplates.id, documentedTemplate.id),
          eq(schema.eventTemplates.tenantId, tenant.id),
        ),
      );
    await assignmentScenario.cleanup();
  });

  await database.transaction(async (transaction) => {
    const activatedEvents = await transaction
      .update(schema.eventInstances)
      .set(openCheckInEventWindow)
      .where(
        and(
          eq(schema.eventInstances.id, checkInEvent.id),
          eq(schema.eventInstances.tenantId, tenant.id),
        ),
      )
      .returning({ id: schema.eventInstances.id });
    if (activatedEvents.length !== 1) {
      throw new Error('Could not activate the documented check-in event');
    }
    await transaction.insert(schema.financeReceipts).values({
      alcoholAmount: 0,
      attachmentFileName: receiptFileName,
      attachmentUploadId: receiptUploadId,
      currency: tenant.currency,
      depositAmount: 0,
      eventId: checkInEvent.id,
      hasAlcohol: false,
      hasDeposit: false,
      id: receiptId,
      purchaseCountry: 'DE',
      receiptDate: seedDate.toISOString().slice(0, 10),
      status: 'submitted',
      submittedByUserId: assignmentScenario.user.id,
      taxAmount: 100,
      tenantId: tenant.id,
      totalAmount: 1200,
    });
    await transaction.insert(schema.eventRegistrations).values({
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      basePriceAtRegistration: checkInOption.price,
      checkedInGuestCount: 0,
      discountAmount: 0,
      eventId: checkInEvent.id,
      guestCount: 1,
      id: registrationId,
      registrationOptionId: checkInOption.id,
      status: 'CONFIRMED',
      stripeTaxRateId: checkInOption.stripeTaxRateId,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
      tenantId: tenant.id,
      userId: assignmentScenario.user.id,
    });
    const updatedOptions = await transaction
      .update(schema.eventRegistrationOptions)
      .set({
        checkedInSpots,
        confirmedSpots,
      })
      .where(
        and(
          eq(schema.eventRegistrationOptions.id, checkInOption.id),
          eq(schema.eventRegistrationOptions.eventId, checkInEvent.id),
          eq(
            schema.eventRegistrationOptions.checkedInSpots,
            originalOptionCounters.checkedInSpots,
          ),
          eq(
            schema.eventRegistrationOptions.confirmedSpots,
            originalOptionCounters.confirmedSpots,
          ),
        ),
      )
      .returning({ id: schema.eventRegistrationOptions.id });
    if (updatedOptions.length !== 1) {
      throw new Error(
        'The documented check-in option counters changed during fixture setup',
      );
    }
  });
  temporaryRecordsInserted = true;

  await page.goto('/global-admin');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Evorto administration',
    }),
  ).toBeVisible();
  await page.getByRole('link', { exact: true, name: 'Organizations' }).click();
  await expect(page).toHaveURL(/\/global-admin\/tenants$/u);
  await page.getByLabel('Search organizations').fill(tenant.domain);
  const tenantRow = page
    .locator('app-tenant-list > div')
    .filter({ hasText: tenant.domain });
  await expect(tenantRow).toBeVisible();
  await tenantRow
    .getByRole('link', { exact: true, name: 'Review organization' })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/global-admin/tenants/${tenant.id}$`),
  );
  await expect(
    page.getByRole('navigation', { name: 'Organization management' }),
  ).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Who can do this" %}
Use this guide only when you are signed in as an Evorto administrator. An organization role is not enough.
{% /callout %}


Evorto administrators do not become organization members. Start at **Evorto administration**, open **Organizations**, search by website address, and select **Review organization**. Confirm the organization name in the page header before every action.

Every change in this guide requires a reason. The change appears in **Evorto change history**, where it can be reviewed later.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-tenant-detail'),
    page,
    'Choose the organization to support',
  );

  await page.getByRole('link', { exact: true, name: 'Manage events' }).click();
  const eventList = page.getByRole('region', {
    name: 'Organization events',
  });
  await expect(eventList).toBeVisible();
  const eventRow = eventList.locator('article').filter({
    has: page.getByText(draftEvent.title, { exact: true }),
  });
  await expect(eventRow.locator('app-event-status')).toHaveText('Draft');
  await eventRow.getByRole('link', { name: 'Review event' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/global-admin/tenants/${tenant.id}/events/${draftEvent.id}$`),
  );

  await testInfo.attach('markdown', {
    body: `
## Edit a draft event

Choose **Manage events**, find the draft, and select **Review event**. The editor shows the event owner, current status, schedule, and complete sign-up setup. Only a draft can be saved from this form. Change the title, enter a clear **Reason for this change**, and select **Save draft details**. Whether the event is published, and who can find an announcement, are changed separately.
`,
  });
  const eventEditor = page.locator('app-platform-event-detail');
  await eventEditor
    .getByRole('textbox', { exact: true, name: 'Title' })
    .first()
    .fill(editedEventTitle);
  await eventEditor.getByLabel('Reason for this change').fill(eventReason);
  await takeScreenshot(
    testInfo,
    eventEditor,
    page,
    'Edit a draft event with a reason for the change',
  );
  await eventEditor.getByRole('button', { name: 'Save draft details' }).click();
  await expect(page.getByText('Event updated')).toBeVisible();
  await expect
    .poll(async () =>
      database.query.eventInstances.findFirst({
        columns: { title: true },
        where: { id: draftEvent.id, tenantId: tenant.id },
      }),
    )
    .toEqual({ title: editedEventTitle });
  await expectPersistedAudit(eventReason, 'event.update');
  await expect(
    eventEditor.getByRole('heading', {
      exact: true,
      name: editedEventTitle,
    }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Back to organization' }).click();
  await page
    .getByRole('link', { exact: true, name: 'Manage templates' })
    .click();
  const templateList = page.getByRole('region', {
    name: 'Organization templates',
  });
  await expect(templateList).toBeVisible();
  const templateRow = templateList.locator('article').filter({
    has: page.getByText(documentedTemplate.title, { exact: true }),
  });
  await templateRow.getByRole('link', { name: 'Edit template' }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/global-admin/tenants/${tenant.id}/templates/${documentedTemplate.id}$`,
    ),
  );

  await testInfo.attach('markdown', {
    body: `
## Edit an event template

Return to the organization, choose **Manage templates**, find the reusable template, and select **Edit template**. Change the template title, add a **Reason for this change**, and select **Save template**. This changes the template only; events already created from it stay unchanged.
`,
  });
  const editor = page.locator('[data-testid="platform-template-editor"]');
  await editor
    .getByRole('textbox', { exact: true, name: 'Title' })
    .first()
    .fill(editedTemplateTitle);
  await editor.getByLabel('Reason for this change').fill(templateReason);
  const saveTemplate = editor.getByRole('button', { name: 'Save template' });
  await expect(saveTemplate).toBeEnabled();
  await takeScreenshot(
    testInfo,
    editor,
    page,
    'Edit a template with a reason for the change',
  );
  await saveTemplate.click();
  await expect(page.getByText('Template updated')).toBeVisible();
  await expect
    .poll(async () =>
      database.query.eventTemplates.findFirst({
        columns: { title: true },
        where: { id: documentedTemplate.id, tenantId: tenant.id },
      }),
    )
    .toEqual({ title: editedTemplateTitle });
  await expectPersistedAudit(templateReason, 'template.update');

  await page.getByRole('link', { name: 'Back to organization' }).click();
  await page.getByRole('link', { exact: true, name: 'Manage members' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Organization members' }),
  ).toBeVisible();
  const membersPage = page.locator('app-platform-tenant-users');
  await expect(membersPage).not.toHaveAttribute('ngh', /.*/);
  const searchMembers = membersPage.getByRole('searchbox', {
    exact: true,
    name: 'Search members',
  });
  await searchMembers.fill(assignmentScenario.user.email);
  let userRow = membersPage.getByRole('row').filter({
    has: page.getByText(assignmentScenario.user.email, { exact: true }),
  });
  await expect(userRow).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
## Assign and remove an organization role

Return to the organization and choose **Manage members**. Search by the existing member's email, then select **Manage roles** on that row. Open **Assigned roles**, choose the role, enter a **Reason for this change**, and select **Save roles**. The assignment affects only this organization.
`,
  });
  await userRow.getByRole('button', { name: 'Manage roles' }).click();
  let assignedRoles = page.getByRole('combobox', { name: 'Assigned roles' });
  await assignedRoles.click();
  let assignmentOption = page.getByRole('option', {
    exact: true,
    name: assignmentScenario.role.name,
  });
  await expect(assignmentOption).toHaveAttribute('aria-selected', 'false');
  await assignmentOption.click();
  await page.keyboard.press('Escape');
  await page.getByLabel('Reason for this change').fill(roleAssignmentReason);
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-tenant-users form'),
    page,
    'Assign an organization role with a reason for the change',
  );
  await page.getByRole('button', { name: 'Save roles' }).click();
  await expect(page.getByText('Member roles updated')).toBeVisible();
  await expect
    .poll(assignmentScenario.readAssignedRoleIds)
    .toEqual([assignmentScenario.role.id]);
  await expectPersistedAudit(roleAssignmentReason, 'user.assignRoles');

  await page.reload();
  await searchMembers.fill(assignmentScenario.user.email);
  userRow = membersPage.getByRole('row').filter({
    has: page.getByText(assignmentScenario.user.email, { exact: true }),
  });
  await expect(
    userRow.getByText(assignmentScenario.role.name, { exact: true }),
  ).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
To remove that role, select **Manage roles** again, deselect it in **Assigned roles**, enter a new reason for the change, and save. Removing every role is allowed for this member; it does not delete the member or the role itself.
`,
  });
  await userRow.getByRole('button', { name: 'Manage roles' }).click();
  assignedRoles = page.getByRole('combobox', { name: 'Assigned roles' });
  await assignedRoles.click();
  assignmentOption = page.getByRole('option', {
    exact: true,
    name: assignmentScenario.role.name,
  });
  await expect(assignmentOption).toHaveAttribute('aria-selected', 'true');
  await assignmentOption.click();
  await page.keyboard.press('Escape');
  await page.getByLabel('Reason for this change').fill(roleRemovalReason);
  await page.getByRole('button', { name: 'Save roles' }).click();
  await expect(page.getByText('Member roles updated')).toBeVisible();
  await expect.poll(assignmentScenario.readAssignedRoleIds).toEqual([]);
  await expectPersistedAudit(roleRemovalReason, 'user.assignRoles');

  await page.getByRole('link', { name: 'Back to organization' }).click();
  await page.getByRole('link', { exact: true, name: 'Review finance' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Organization finance' }),
  ).toBeVisible();
  const platformFinance = page.locator('app-platform-finance');
  await expect(platformFinance).not.toHaveAttribute('ngh', /.*/, {
    timeout: 20_000,
  });
  await platformFinance.getByRole('tab', { name: 'Receipt approval' }).click();
  const receiptSubmitter = page.getByText('Casey Member', { exact: true });
  await expect(receiptSubmitter).toBeVisible();
  const receiptRow = receiptSubmitter.locator('..').locator('..');
  await receiptRow.getByRole('button', { name: 'Review' }).click();

  await testInfo.attach('markdown', {
    body: `
## Reject an unverifiable receipt

Return to the organization, choose **Review finance**, and open **Receipt approval**. Select the submitted receipt. When its uploaded file cannot be checked, approval stays disabled, but rejection remains available. Choose **Reject**, enter a clear **Rejection reason** for the member, then enter a separate reason for the change history. Select **Save decision**.

This action records the decision and asks Evorto to email the member; delivery is separate and may take time or fail. It does not reimburse the member, transfer money, issue refunds, or add tax rates. Those are separate actions.
`,
  });
  await expect(
    page.getByText(
      'The uploaded receipt file is unavailable. Approval is disabled until it can be checked. You can still reject this receipt.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Decision' }).click();
  await page.getByRole('option', { exact: true, name: 'Reject' }).click();
  await page.getByLabel('Rejection reason').fill(rejectionReason);
  await page.getByLabel('Reason for this decision').fill(receiptReason);
  await takeScreenshot(
    testInfo,
    platformFinance,
    page,
    'Reject a receipt with reasons for the member and change history',
  );
  const saveDecision = platformFinance.getByRole('button', {
    name: 'Save decision',
  });
  await saveDecision.scrollIntoViewIfNeeded();
  await expect(saveDecision).toBeEnabled({ timeout: 20_000 });
  await saveDecision.click({ timeout: 20_000 });
  await expect(page.getByText('Receipt rejected')).toBeVisible();
  await expect
    .poll(async () =>
      database.query.financeReceipts.findFirst({
        columns: { rejectionReason: true, status: true },
        where: { id: receiptId, tenantId: tenant.id },
      }),
    )
    .toEqual({ rejectionReason, status: 'rejected' });
  await expect
    .poll(async () =>
      database.query.emailOutbox.findFirst({
        columns: { kind: true },
        where: { idempotencyKey: receiptNotificationKey },
      }),
    )
    .toEqual({ kind: 'receiptReviewed' });
  await expectPersistedAudit(receiptReason, 'receipt.review');

  await page.getByRole('link', { name: 'Back to organization' }).click();
  await page.getByRole('link', { exact: true, name: 'Ticket support' }).click();
  const lookupInput = page.getByLabel('Ticket link or ticket number');
  await expect(lookupInput).toBeEnabled({ timeout: 20_000 });
  await lookupInput.fill(
    `http://localhost:4200/scan/registration/${registrationId}`,
  );
  const openRegistration = page.getByRole('button', {
    name: 'Open ticket',
  });
  await expect(openRegistration).toBeEnabled({ timeout: 20_000 });
  await openRegistration.click();
  await expect(page).toHaveURL(
    new RegExp(`/global-admin/tenants/${tenant.id}/scanner/${registrationId}$`),
  );
  const registrationDetail = page
    .locator('app-platform-scanner section')
    .filter({
      has: page.getByRole('heading', {
        exact: true,
        level: 3,
        name: 'Help with this ticket',
      }),
    });
  await expect(registrationDetail).toBeVisible({ timeout: 20_000 });
  await expect(
    registrationDetail.getByText('Confirmed', { exact: true }),
  ).toBeVisible({ timeout: 20_000 });

  await testInfo.attach('markdown', {
    body: `
## Check in an attendee and guest

Return to the organization and choose **Ticket support**. Paste the attendee's ticket link or ticket number, then select **Open ticket**. Evorto opens it only when it belongs to this organization.

For a confirmed ticket inside the check-in window, enter the number of guests arriving now, add a **Reason for this action**, and select **Check in**. The updated totals include the attendee and the guests entered for this check-in. This action does not approve or cancel a ticket.
`,
  });
  const guestCheckInCount = registrationDetail.getByLabel(
    'Guests to check in now',
  );
  const registrationActionReason = registrationDetail.getByLabel(
    'Reason for this action',
  );
  await expect(guestCheckInCount).toBeVisible({ timeout: 20_000 });
  await guestCheckInCount.fill('1');
  await registrationActionReason.fill(registrationReason);
  await takeScreenshot(
    testInfo,
    registrationDetail,
    page,
    'Check in an attendee and guest with a reason for the action',
  );
  const checkIn = registrationDetail.getByRole('button', {
    name: 'Check in',
  });
  await expect(checkIn).toBeEnabled({ timeout: 20_000 });
  await checkIn.click({ timeout: 20_000 });
  await expect(page.getByText('Ticket checked in')).toBeVisible();
  await expect(
    registrationDetail.getByText('1 of 1 checked in', { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      database.query.eventRegistrations.findFirst({
        columns: { checkedInGuestCount: true, checkInTime: true },
        where: { id: registrationId, tenantId: tenant.id },
      }),
    )
    .toEqual({
      checkedInGuestCount: 1,
      checkInTime: expect.any(Date),
    });
  await expect
    .poll(async () =>
      database.query.eventRegistrationOptions.findFirst({
        columns: { checkedInSpots: true },
        where: {
          event: { tenantId: tenant.id },
          eventId: checkInEvent.id,
          id: checkInOption.id,
        },
      }),
    )
    .toEqual({
      checkedInSpots:
        originalOptionCounters.checkedInSpots + registrationSpotCount,
    });
  await expectPersistedAudit(registrationReason, 'registration.checkIn');

  await page.goto('/global-admin');
  await page.getByRole('link', { name: 'Evorto change history' }).click();
  await expect(page).toHaveURL(/\/global-admin\/audit$/u);
  const auditExpectations: ReadonlyArray<readonly [string, string]> = [
    [eventReason, 'Event updated'],
    [templateReason, 'Event template updated'],
    [roleAssignmentReason, 'Organization member roles changed'],
    [roleRemovalReason, 'Organization member roles changed'],
    [receiptReason, 'Receipt reviewed'],
    [registrationReason, 'Ticket checked in'],
  ];
  for (const [reason, actionLabel] of auditExpectations) {
    const auditEntry = page
      .getByRole('article')
      .filter({ has: page.getByText(reason, { exact: true }) });
    await expect(auditEntry).toBeVisible();
    await expect(
      auditEntry.getByRole('heading', { exact: true, name: actionLabel }),
    ).toBeVisible();
    await expect(auditEntry).toContainText(tenant.name);
  }
  const eventAuditEntry = page
    .getByRole('article')
    .filter({ has: page.getByText(eventReason, { exact: true }) });
  await expect(
    eventAuditEntry.getByRole('heading', { level: 3, name: 'Changes' }),
  ).toBeVisible();
  await expect(eventAuditEntry).toContainText('Title');

  await testInfo.attach('markdown', {
    body: `
## Review the change history

Return to **Evorto administration** and select **Evorto change history**. Find each change by its reason. Each entry shows the action, who made it, the organization, the reason, the time, and a short **Changes** summary. The newest 50 entries load first; use **Load older** to continue through the history. The page includes the event and template edits, role changes, receipt rejection, and ticket check-in reviewed in this guide.

Members continue to manage their own profiles, home organization, receipt submissions, and ticket transfers. Evorto administration access does not let an administrator act as the member for those tasks.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-audit'),
    page,
    'Review organization change history',
  );
});
