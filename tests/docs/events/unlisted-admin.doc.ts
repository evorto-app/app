import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import type { Page } from '@playwright/test';

test.use({ storageState: adminStateFile });

const openUpdateListingDialog = async (page: Page) => {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page
      .getByRole('button', { name: /open event actions|menu/i })
      .click();

    const updateListingMenuItem = page.getByRole('menuitem', {
      name: 'Update listing',
    });
    await expect(updateListingMenuItem).toBeVisible();

    try {
      await updateListingMenuItem.click({ timeout: 10_000 });
      await expect(
        page.getByRole('switch', { name: /Unlisted/ }),
      ).toBeVisible();
      return;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
    }
  }
};

test('Admin: manage unlisted events', async ({
  events,
  page,
  seeded,
}, testInfo) => {
  // Use a deterministic scenario event that is approved and listed by seed contract.
  const target = events.find(
    (event) => event.id === seeded.scenario.events.freeOpen.eventId,
  );
  if (!target)
    throw new Error(
      'Seeded freeOpen scenario event was not found for unlisted admin demo',
    );

  await page.goto(`/events/${target.id}`);

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Permissions" %}
To change listing, an admin needs:
- \`events:changeListing\` (toggle the unlisted flag)
- \`events:seeUnlisted\` (to see unlisted events in lists)
{% /callout %}

# Managing Unlisted Events (Admin)

Unlisted events are hidden from public lists. Admins can toggle an event's unlisted flag and still see unlisted events in the list (with a badge). Eligible people can still open an unlisted event when they receive its direct link.
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
  await openUpdateListingDialog(page);
  await page.getByRole('switch', { name: /Unlisted/ }).click();
  await expect(
    page.getByText(/eligible people can still open the event/i),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('mat-dialog-container').first(),
    page,
    'Update listing dialog',
  );
  await page.getByRole('button', { name: 'Save' }).click();

  // Verify unlisted badge is visible for admins on the details page
  await expect(
    page.getByText(/Unlisted: hidden from event lists/i).first(),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('h1').first(),
    page,
    'Unlisted badge visible to admins',
  );

  // Restore original state (toggle back to listed) to keep environment clean
  await openUpdateListingDialog(page);
  const toggle = page.getByRole('switch', { name: /Unlisted/ });
  if (await toggle.isChecked()) {
    await toggle.click();
  }
  await page.getByRole('button', { name: 'Save' }).click();
});
