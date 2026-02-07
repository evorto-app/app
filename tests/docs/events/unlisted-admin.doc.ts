import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Admin: manage unlisted events @track(playwright-specs-track-linking_20260126) @doc(UNLISTED-ADMIN-DOC-01)', async ({
  events,
  page,
}, testInfo) => {
  // Choose an approved, currently listed event to demonstrate toggling
  const target = events.find(
    (e) => e.status === 'APPROVED' && e.unlisted === false,
  );
  if (!target)
    throw new Error('No approved listed event found for unlisted admin demo');

  await page.goto('./events');

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Permissions" %}
To change listing, an admin needs:
- \`events:changeListing\` (toggle the unlisted flag)
- \`events:seeUnlisted\` (to see unlisted events in lists)
{% /callout %}

# Managing Unlisted Events (Admin)

Unlisted events are hidden from public lists. Admins can toggle an event's unlisted flag and still see unlisted events in the list (with a badge).
`,
  });

  // Show the event on the list before toggling
  const targetLink = page.locator(`a[href="/events/${target.id}"]`);
  await takeScreenshot(
    testInfo,
    targetLink,
    page,
    'Listed event before toggling',
  );
  await targetLink.click();
  await page.waitForSelector(`h1:has-text("${target.title}")`);
  await takeScreenshot(
    testInfo,
    page.locator('h1').first(),
    page,
    'Event details (before)',
  );

  // Open menu and update listing
  await page.getByRole('button', { name: /open event actions|menu/i }).click();
  await page.getByRole('menuitem', { name: 'Update listing' }).click();
  await page.getByRole('switch', { name: /Unlisted/ }).click();
  await takeScreenshot(
    testInfo,
    page.locator('mat-dialog-container').first(),
    page,
    'Update listing dialog',
  );
  await page.getByRole('button', { name: 'Save' }).click();

  // Back to list and verify badge is visible for admins
  await page.goto('./events');
  const adminEventCard = page.locator(`a[href="/events/${target.id}"]`);
  await expect(adminEventCard).toBeVisible();
  await expect(
    adminEventCard.getByText('unlisted', { exact: true }),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    adminEventCard,
    page,
    'Unlisted badge visible to admins',
  );

  // Restore original state (toggle back to listed) to keep environment clean
  await adminEventCard.click();
  await page.waitForSelector(`h1:has-text("${target.title}")`);
  await page.getByRole('button', { name: /open event actions|menu/i }).click();
  await page.getByRole('menuitem', { name: 'Update listing' }).click();
  const toggle = page.getByRole('switch', { name: /Unlisted/ });
  if (await toggle.isChecked()) {
    await toggle.click();
  }
  await page.getByRole('button', { name: 'Save' }).click();
});
