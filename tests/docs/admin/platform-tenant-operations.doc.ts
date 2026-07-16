import { and, eq, inArray, sql } from 'drizzle-orm';

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

  const suffix = seedDate.getTime().toString();
  const assignmentScenario = await seedUserRoleAssignmentScenario({
    database,
    roleName: `Platform event assistant ${suffix}`,
    tenant,
    userEmail: `platform-operator-docs-${suffix}@evorto.test`,
  });
  const eventReason = `Document target event update ${suffix}`;
  const templateReason = `Document target template update ${suffix}`;
  const roleAssignmentReason = `Document target role assignment ${suffix}`;
  const roleRemovalReason = `Document target role removal ${suffix}`;
  const receiptReason = `Document target receipt rejection ${suffix}`;
  const registrationReason = `Document target registration check-in ${suffix}`;
  const auditReasons = [
    eventReason,
    templateReason,
    roleAssignmentReason,
    roleRemovalReason,
    receiptReason,
    registrationReason,
  ];
  const editedEventTitle = `${draftEvent.title} - platform review`;
  const editedTemplateTitle = `${documentedTemplate.title} - platform review`;
  const registrationId = getId();
  const receiptId = getId();
  const receiptFileName = `platform-receipt-${suffix}.pdf`;
  const rejectionReason =
    'The uploaded receipt cannot be verified, so it must be submitted again.';
  const receiptNotificationKey = `receipt-reviewed/${tenant.id}/${receiptId}/rejected`;
  const registrationSpotCount = 2;
  const originalOptionCounters =
    await database.query.eventRegistrationOptions.findFirst({
      columns: { checkedInSpots: true, confirmedSpots: true },
      where: {
        event: { tenantId: tenant.id },
        eventId: checkInEvent.id,
        id: checkInOption.id,
      },
    });
  if (!originalOptionCounters) {
    throw new Error('Expected the documented check-in option to exist');
  }

  let receiptUploadId: string | undefined;
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

  const createdReceiptUploadId = await addConsumedFinanceReceiptUpload(
    database,
    {
      eventId: checkInEvent.id,
      fileName: receiptFileName,
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      tenantId: tenant.id,
      uploadedByUserId: assignmentScenario.user.id,
    },
  );
  receiptUploadId = createdReceiptUploadId;
  await database.transaction(async (transaction) => {
    await transaction.insert(schema.financeReceipts).values({
      alcoholAmount: 0,
      attachmentFileName: receiptFileName,
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 2048,
      attachmentUploadId: createdReceiptUploadId,
      currency: tenant.currency,
      depositAmount: 0,
      eventId: checkInEvent.id,
      hasAlcohol: false,
      hasDeposit: false,
      id: receiptId,
      purchaseCountry: 'DE',
      receiptDate: seedDate,
      status: 'submitted',
      submittedByUserId: assignmentScenario.user.id,
      taxAmount: 100,
      tenantId: tenant.id,
      totalAmount: 1200,
    });
    await transaction.insert(schema.eventRegistrations).values({
      basePriceAtRegistration: 0,
      eventId: checkInEvent.id,
      guestCount: 1,
      id: registrationId,
      registrationOptionId: checkInOption.id,
      status: 'CONFIRMED',
      tenantId: tenant.id,
      userId: assignmentScenario.user.id,
    });
    await transaction
      .update(schema.eventRegistrationOptions)
      .set({
        confirmedSpots: sql`${schema.eventRegistrationOptions.confirmedSpots} + ${registrationSpotCount}`,
      })
      .where(
        and(
          eq(schema.eventRegistrationOptions.id, checkInOption.id),
          eq(schema.eventRegistrationOptions.eventId, checkInEvent.id),
        ),
      );
  });
  temporaryRecordsInserted = true;

  await page.goto('/global-admin');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Platform administration',
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
    page.getByRole('navigation', { name: 'Organization operations' }),
  ).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Platform administrator requirements" %}
Use this guide only when you are signed in as a platform administrator. An organization role does not grant this access.
{% /callout %}

# Operate on one organization

Platform administrators do not become organization members. Start at **Platform administration**, open **Organizations**, search by primary domain, and select **Review organization**. Confirm the organization name in the page header before every operation.

Every change in this guide requires an operational reason. Evorto saves the domain change and a privacy-safe change-history entry together. The final section reads every reason back from the visible **Platform audit log**.
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

Choose **Manage events**, find the draft, and select **Review event**. The editor shows the event owner, status, schedule, and complete registration setup. Only a draft can be saved from this form. Change the title, enter a precise **Update reason**, and select **Save draft details**. Status and listing actions use their own reason field and are not performed by this walkthrough.
`,
  });
  const eventEditor = page.locator('app-platform-event-detail');
  await eventEditor
    .getByRole('textbox', { exact: true, name: 'Title' })
    .first()
    .fill(editedEventTitle);
  await eventEditor.getByLabel('Update reason').fill(eventReason);
  await takeScreenshot(
    testInfo,
    eventEditor,
    page,
    'Edit a draft event with an operational reason',
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

Return to the organization, choose **Manage templates**, find the reusable template, and select **Edit template**. Change the template title, add an **Operational reason**, and select **Save template**. This changes the template only; events already created from it stay unchanged.
`,
  });
  const templateEditor = page.locator(
    '[data-testid="platform-template-editor"]',
  );
  await templateEditor
    .getByRole('textbox', { exact: true, name: 'Title' })
    .first()
    .fill(editedTemplateTitle);
  await templateEditor.getByLabel('Operational reason').fill(templateReason);
  await takeScreenshot(
    testInfo,
    templateEditor,
    page,
    'Edit a template with an operational reason',
  );
  await templateEditor.getByRole('button', { name: 'Save template' }).click();
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
  await page.getByRole('link', { exact: true, name: 'Manage users' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Organization members' }),
  ).toBeVisible();
  const searchUsers = page.getByLabel('Search users');
  await searchUsers.fill(assignmentScenario.user.email);
  let userRow = page.getByRole('row').filter({
    has: page.getByText(assignmentScenario.user.email, { exact: true }),
  });
  await expect(userRow).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
## Assign and remove an organization role

Return to the organization and choose **Manage users**. Search by the existing member's email, then select **Manage roles** on that row. Open **Assigned roles**, choose the role, enter an **Operational reason**, and select **Save roles**. The assignment affects only this organization.
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
  await page.getByLabel('Operational reason').fill(roleAssignmentReason);
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-tenant-users form'),
    page,
    'Assign an organization role with an operational reason',
  );
  await page.getByRole('button', { name: 'Save roles' }).click();
  await expect(page.getByText('User roles updated')).toBeVisible();
  await expect
    .poll(assignmentScenario.readAssignedRoleIds)
    .toEqual([assignmentScenario.role.id]);
  await expectPersistedAudit(roleAssignmentReason, 'user.assignRoles');

  await page.reload();
  await page.getByLabel('Search users').fill(assignmentScenario.user.email);
  userRow = page.getByRole('row').filter({
    has: page.getByText(assignmentScenario.user.email, { exact: true }),
  });
  await expect(
    userRow.getByText(assignmentScenario.role.name, { exact: true }),
  ).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
To remove that role, select **Manage roles** again, deselect it in **Assigned roles**, enter a new operational reason, and save. Removing every role is allowed for this target member; it does not delete the member or the role definition.
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
  await page.getByLabel('Operational reason').fill(roleRemovalReason);
  await page.getByRole('button', { name: 'Save roles' }).click();
  await expect(page.getByText('User roles updated')).toBeVisible();
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

Return to the organization, choose **Review finance**, and open **Receipt approval**. Select the submitted receipt. When its stored evidence is unavailable, approval stays disabled, but rejection remains available. Choose **Reject**, enter a participant-facing **Rejection reason**, then enter a separate **Platform operational reason** for the change history. Select **Save decision**.

This action records a decision and schedules a receipt-review notification; it does not reimburse the member or transfer money. Reimbursement, refund recovery, and Stripe tax-rate import are separate operations and are not performed by this walkthrough.
`,
  });
  await expect(
    page.getByText('Receipt evidence is unavailable.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Decision' }).click();
  await page.getByRole('option', { exact: true, name: 'Reject' }).click();
  await page.getByLabel('Rejection reason').fill(rejectionReason);
  await page.getByLabel('Platform operational reason').fill(receiptReason);
  await takeScreenshot(
    testInfo,
    platformFinance,
    page,
    'Reject a receipt with participant and operator reasons',
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
  await page
    .getByRole('link', { exact: true, name: 'Inspect registrations' })
    .click();
  const lookupInput = page.getByLabel('Ticket link or registration ID');
  await expect(lookupInput).toBeEnabled({ timeout: 20_000 });
  await lookupInput.fill(
    `http://localhost:4200/scan/registration/${registrationId}`,
  );
  const openRegistration = page.getByRole('button', {
    name: 'Open registration',
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
        name: 'Help with this registration',
      }),
    });
  await expect(registrationDetail).toBeVisible({ timeout: 20_000 });
  await expect(
    registrationDetail.getByText('Confirmed', { exact: true }),
  ).toBeVisible({ timeout: 20_000 });

  await testInfo.attach('markdown', {
    body: `
## Check in an attendee and guest

Return to the organization and choose **Inspect registrations**. Paste either the registration ID or its attendee ticket link, then select **Open registration**. Evorto confirms that the registration belongs to this organization before showing it.

For a confirmed registration inside the check-in window, enter the number of guests arriving now, add a **Reason for this action**, and select **Check in**. This walkthrough checks in the attendee and one guest, then confirms the updated attendee and guest totals. It does not approve or cancel a registration.
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
    'Check in an attendee and guest with an operational reason',
  );
  const checkIn = registrationDetail.getByRole('button', {
    name: 'Check in',
  });
  await expect(checkIn).toBeEnabled({ timeout: 20_000 });
  await checkIn.click({ timeout: 20_000 });
  await expect(page.getByText('Registration checked in')).toBeVisible();
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
  await page.getByRole('link', { name: 'Platform audit log' }).click();
  await expect(page).toHaveURL(/\/global-admin\/audit$/u);
  const auditExpectations: ReadonlyArray<readonly [string, string]> = [
    [eventReason, 'Event updated'],
    [templateReason, 'Event template updated'],
    [roleAssignmentReason, 'Organization member roles changed'],
    [roleRemovalReason, 'Organization member roles changed'],
    [receiptReason, 'Receipt reviewed'],
    [registrationReason, 'Registration checked in'],
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
  await eventAuditEntry.getByText('Review before and after').click();
  await expect(eventAuditEntry).toContainText(draftEvent.title);
  await expect(eventAuditEntry).toContainText(editedEventTitle);

  await testInfo.attach('markdown', {
    body: `
## Verify the audit trail

Return to **Platform administration** and select **Platform audit log**. Find each operation by its reason. Verify the action label and organization, then open **Review before and after** to compare the changes. The log includes the event and template edits, role changes, receipt rejection, and registration check-in reviewed in this guide.

Participant profiles and home pages, joining or leaving an organization, personal receipt submission, and self-service registration transfer remain participant-owned. A platform administrator does not act as an organization member for those flows.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-audit'),
    page,
    'Verify organization change-history entries',
  );
});
