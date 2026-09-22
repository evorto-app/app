import { adminStateFile, userStateFile } from '../../../helpers/user-data';
import { and, eq } from 'drizzle-orm';
import { getId } from '../../../helpers/get-id';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import {
  type AuthenticatedTestPage,
  openAuthenticatedTestPage,
} from '../../support/utils/authenticated-test-page';

test.use({ storageState: adminStateFile });

test('Choose who can find an announcement', async ({
  browser,
  database,
  events,
  page,
  registerDatabaseCleanup,
  roles,
  seeded,
  tenant,
  testClock,
}, testInfo) => {
  const sourceFixture = events.find(
    (event) => event.id === seeded.scenario.events.freeOpen.eventId,
  );
  const defaultUserRole = roles.find((role) => role.defaultUserRole);
  if (
    !sourceFixture ||
    sourceFixture.status !== 'APPROVED' ||
    sourceFixture.tenantId !== tenant.id ||
    !defaultUserRole
  ) {
    throw new Error(
      'Expected an approved source event and default-user role for announcement discovery',
    );
  }
  const source = await database.query.eventInstances.findFirst({
    where: { id: sourceFixture.id, tenantId: tenant.id },
  });
  if (!source?.reviewedAt || !source.reviewedBy) {
    throw new Error(
      'Expected approved source event metadata for announcement discovery',
    );
  }

  const announcementId = getId();
  const announcementTitle = 'Welcome week announcement';
  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .delete(schema.eventInstances)
      .where(
        and(
          eq(schema.eventInstances.id, announcementId),
          eq(schema.eventInstances.tenantId, tenant.id),
        ),
      );
  });

  await database.insert(schema.eventInstances).values({
    announcementRoleIds: [],
    creatorId: source.creatorId,
    description:
      '<p>Important information for selected organization members.</p>',
    end: source.end,
    icon: source.icon,
    id: announcementId,
    reviewedAt: source.reviewedAt,
    reviewedBy: source.reviewedBy,
    start: source.start,
    status: 'APPROVED',
    templateId: source.templateId,
    tenantId: tenant.id,
    title: announcementTitle,
  });

  const roleAssignmentsBefore =
    await database.query.rolesToTenantUsers.findMany({
      columns: { roleId: true, userTenantId: true },
      where: { tenantId: tenant.id },
    });
  const emailOutboxBefore = await database.query.emailOutbox.findMany({
    columns: { id: true },
    where: { tenantId: tenant.id },
  });

  await page.goto(`/events/${announcementId}`);
  await expect(
    page.getByRole('heading', {
      exact: true,
      level: 1,
      name: announcementTitle,
    }),
  ).toBeVisible({ timeout: 20_000 });

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Who can do this" %}
Sign in to the organization that owns the announcement with **Change who can find announcements** access. Have the shared link to a published announcement that has no sign-up choices.
{% /callout %}


For an announcement without sign-up choices, select the organization roles that should see it in **Events**. This is different from a sign-up event, which appears to signed-in members who can use at least one of its sign-up choices.

This choice only controls whether the announcement appears in **Events**. It does not give anyone a role or send a message. Without a selected role, members can open the announcement only through a shared link.

1. Open the announcement's shared link. If it already appears in **Events**, you can select it there instead.
2. Choose **Choose who can find this announcement**.
3. Select the organization roles whose members should see it, then choose **Save**.
4. Look for **Who can find the announcement was updated**. A member with a selected role can now find it in **Events**.
`,
  });

  const discoveryAction = page.getByRole('button', {
    exact: true,
    name: 'Choose who can find this announcement',
  });
  const discoveryUpdatedNotice = page
    .locator('mat-snack-bar-container')
    .filter({ hasText: 'Who can find the announcement was updated' });
  await expect(discoveryAction).toBeEnabled({ timeout: 20_000 });
  await discoveryAction.click();
  let dialog = page.locator('mat-dialog-container');
  await expect(
    dialog.getByRole('heading', {
      name: `Choose who can find ${announcementTitle}`,
    }),
  ).toBeVisible();
  await expect(dialog).toContainText(
    'Without a selected role, this announcement is available only through its direct link',
  );
  await expect(dialog).toContainText(
    'Selecting roles only changes whether it appears in Events. It does not give anyone a role or send a message',
  );

  const roleInput = dialog.getByRole('combobox', {
    name: 'Selected roles',
  });
  await roleInput.fill(defaultUserRole.name);
  await page
    .getByRole('option', { exact: true, name: defaultUserRole.name })
    .click();
  await takeScreenshot(
    testInfo,
    dialog,
    page,
    'Choose an organization role that should see the announcement',
  );
  await dialog.getByRole('button', { exact: true, name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    discoveryUpdatedNotice.getByText(
      'Who can find the announcement was updated',
      { exact: true },
    ),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const announcement = await database.query.eventInstances.findFirst({
        columns: { announcementRoleIds: true },
        where: { id: announcementId, tenantId: tenant.id },
      });
      return announcement?.announcementRoleIds;
    })
    .toEqual([defaultUserRole.id]);
  await discoveryUpdatedNotice
    .getByRole('button', { exact: true, name: 'Close' })
    .click();
  await expect(discoveryUpdatedNotice).toHaveCount(0);

  const participantPage: AuthenticatedTestPage =
    await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: userStateFile,
      tenantDomain: tenant.domain,
      testClock,
    });
  registerDatabaseCleanup(async () => participantPage.close());
  await participantPage.page.goto('/events');
  const announcementCard = participantPage.page.locator(
    `app-event-list nav a[href="/events/${announcementId}"]`,
  );
  await expect(announcementCard).toBeVisible({ timeout: 20_000 });
  await takeScreenshot(
    testInfo,
    announcementCard,
    participantPage.page,
    'Announcement visible to a member with the selected role',
  );

  await discoveryAction.click();
  dialog = page.locator('mat-dialog-container');
  await dialog
    .getByRole('button', {
      exact: true,
      name: `Remove ${defaultUserRole.name}`,
    })
    .click();
  await expect(roleInput).toBeFocused();
  await expect(roleInput).toHaveAttribute('aria-expanded', 'true');
  await roleInput.press('Escape');
  await expect(roleInput).toHaveAttribute('aria-expanded', 'false');
  await dialog.getByRole('button', { exact: true, name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    discoveryUpdatedNotice.getByText(
      'Who can find the announcement was updated',
      { exact: true },
    ),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const announcement = await database.query.eventInstances.findFirst({
        columns: { announcementRoleIds: true },
        where: { id: announcementId, tenantId: tenant.id },
      });
      return announcement?.announcementRoleIds;
    })
    .toEqual([]);

  await participantPage.page.goto('/events');
  await expect(announcementCard).toHaveCount(0);
  await participantPage.page.goto(`/events/${announcementId}`);
  await expect(
    participantPage.page.getByRole('heading', {
      exact: true,
      level: 1,
      name: announcementTitle,
    }),
  ).toBeVisible({ timeout: 20_000 });

  const roleAssignmentsAfter = await database.query.rolesToTenantUsers.findMany(
    {
      columns: { roleId: true, userTenantId: true },
      where: { tenantId: tenant.id },
    },
  );
  const emailOutboxAfter = await database.query.emailOutbox.findMany({
    columns: { id: true },
    where: { tenantId: tenant.id },
  });
  expect(
    roleAssignmentsAfter
      .map(({ roleId, userTenantId }) => `${roleId}:${userTenantId}`)
      .toSorted(),
  ).toEqual(
    roleAssignmentsBefore
      .map(({ roleId, userTenantId }) => `${roleId}:${userTenantId}`)
      .toSorted(),
  );
  expect(emailOutboxAfter.map(({ id }) => id).toSorted()).toEqual(
    emailOutboxBefore.map(({ id }) => id).toSorted(),
  );

  await testInfo.attach('markdown', {
    body: `
After the last selected role is removed, the announcement disappears from the member's event list. The announcement still opens from its full shared link. Changing who can find the announcement does not give anyone a role or send a message.

Announcements do not appear in the event list before someone signs in. Shared links still open their public details.
`,
  });
});
