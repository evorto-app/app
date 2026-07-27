import { adminStateFile, userStateFile } from '../../../helpers/user-data';
import { eq } from 'drizzle-orm';
import { getId } from '../../../helpers/get-id';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import {
  type AuthenticatedTestPage,
  openAuthenticatedTestPage,
} from '../../support/utils/authenticated-test-page';

test.use({ storageState: adminStateFile });

test('Manage announcement discovery', async ({
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
  if (!sourceFixture || !defaultUserRole) {
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
  const announcementTitle = `Welcome announcement ${announcementId.slice(0, 6)}`;
  let participantPage: AuthenticatedTestPage | undefined;
  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .delete(schema.eventInstances)
      .where(eq(schema.eventInstances.id, announcementId));
  });
  registerDatabaseCleanup(async () => participantPage?.context.close());

  await database.insert(schema.eventInstances).values({
    announcementRoleIds: [],
    creatorId: source.creatorId,
    description:
      '<p>An optionless announcement used to explain explicit role targeting.</p>',
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
{% callout type="note" title="Permission" %}
Use an account with **Change announcement discovery** access.
{% /callout %}

# Manage announcement discovery

An optionless announcement has no registration options from which Evorto could derive eligibility. It therefore uses an explicit list of organization roles for normal discovery. This is intentionally different from ordinary sign-up events, whose discovery always comes from their registration options.

Selecting announcement roles changes visibility only. It does not assign a role, grant event access, or send a notification. With no roles selected, the announcement is link-only and still opens from its complete direct link.
`,
  });

  const discoveryAction = page.getByRole('button', {
    exact: true,
    name: 'Update announcement discovery',
  });
  await expect(discoveryAction).toBeEnabled({ timeout: 20_000 });
  await discoveryAction.click();
  let dialog = page.locator('mat-dialog-container');
  await expect(
    dialog.getByRole('heading', {
      name: `Update announcement discovery for ${announcementTitle}`,
    }),
  ).toBeVisible();
  await expect(dialog).toContainText(
    'With no roles selected, the announcement is link-only',
  );
  await expect(dialog).toContainText(
    'it does not restrict direct links, grant access, or send notifications',
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
    'Target an optionless announcement to an organization role',
  );
  await dialog.getByRole('button', { exact: true, name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => {
      const announcement = await database.query.eventInstances.findFirst({
        columns: { announcementRoleIds: true },
        where: { id: announcementId, tenantId: tenant.id },
      });
      return announcement?.announcementRoleIds;
    })
    .toEqual([defaultUserRole.id]);

  participantPage = await openAuthenticatedTestPage({
    baseUrl: new URL(page.url()).origin,
    browser,
    storageState: userStateFile,
    tenantDomain: tenant.domain,
    testClock,
  });
  await participantPage.page.goto('/events');
  const announcementCard = participantPage.page.locator(
    `app-event-list nav a[href="/events/${announcementId}"]`,
  );
  await expect(announcementCard).toBeVisible({ timeout: 20_000 });
  await takeScreenshot(
    testInfo,
    announcementCard,
    participantPage.page,
    'Announcement visible to a selected signed-in role',
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
After the last selected role is removed, the announcement disappears from the member's event list. Its complete direct link still opens. The persisted readback confirms that changing discovery roles neither changed organization role assignments nor queued email.

Anonymous visitors do not borrow the organization's default new-member roles for announcements. Anonymous discovery through default roles applies only to ordinary events with registration options.
`,
  });
});
