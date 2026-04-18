import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Admin: manage unlisted events @track(playwright-specs-track-linking_20260126) @doc(UNLISTED-ADMIN-DOC-01)', async ({
  events,
  page,
  seeded,
}, testInfo) => {
  // Use a deterministic scenario event that is approved and listed by seed contract.
  const target = events.find((event) => event.id === seeded.scenario.events.freeOpen.eventId);
  if (!target)
    throw new Error('Seeded freeOpen scenario event was not found for unlisted admin demo');

  await page.goto(`/events/${target.id}`);

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

  // Show the event details before toggling
  const eventHeader = page.getByRole('heading', {
    level: 1,
    name: target.title,
  });
  await takeScreenshot(
    testInfo,
    eventHeader,
    page,
    'Event details before toggling',
  );
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

  // Verify unlisted badge is visible for admins on the details page
  await expect(
    page.getByText('unlisted', { exact: true }).first(),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('h1').first(),
    page,
    'Unlisted badge visible to admins',
  );

  // Restore original state (toggle back to listed) to keep environment clean
  await page.getByRole('button', { name: /open event actions|menu/i }).click();
  await page.getByRole('menuitem', { name: 'Update listing' }).click();
  const toggle = page.getByRole('switch', { name: /Unlisted/ });
  if (await toggle.isChecked()) {
    await toggle.click();
  }
  await page.getByRole('button', { name: 'Save' }).click();
});
