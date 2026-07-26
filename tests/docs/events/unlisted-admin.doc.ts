import { adminStateFile } from '../../../helpers/user-data';
import { eventListingAudienceLabels } from '../../../src/shared/event-listing-audience';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

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
- **Change event listing** access
- **See eligible unlisted events** access
{% /callout %}

# Managing Unlisted Events (Admin)

Unlisted events are hidden from public lists. Admins choose one of four explicit audiences: participants, organizers, both, or unlisted. Admins with **See eligible unlisted events** can still find unlisted events when one of their registration options is eligible, while people can open an approved event from its direct link.
`,
  });

  // Show the event details before changing the audience
  const eventHeader = page.getByRole('heading', {
    level: 1,
    name: target.title,
  });
  await takeScreenshot(
    testInfo,
    eventHeader,
    page,
    'Event details before changing the listing audience',
  );
  await takeScreenshot(
    testInfo,
    page.locator('h1').first(),
    page,
    'Event details (before)',
  );

  // Open menu and update listing
  const eventActionsButton = page.getByRole('button', {
    name: /open event actions|menu/i,
  });
  await expect(eventActionsButton).toBeEnabled({ timeout: 20_000 });
  await eventActionsButton.click();
  await page.getByRole('menuitem', { name: 'Update listing' }).click();
  const audienceSelect = page.getByRole('combobox', {
    name: 'Listing audience',
  });
  await audienceSelect.click();
  await page
    .getByRole('option', { name: eventListingAudienceLabels.unlisted })
    .click();
  await expect(page.getByText(/hidden from event discovery/i)).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('mat-dialog-container').first(),
    page,
    'Update listing dialog',
  );
  await page.getByRole('button', { name: 'Save' }).click();

  // Verify unlisted badge is visible for admins on the details page
  await expect(
    page.getByText('Unlisted', { exact: true }).first(),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('h1').first(),
    page,
    'Unlisted badge visible to admins',
  );

  // Restore the exact original audience to keep the environment clean
  await expect(eventActionsButton).toBeEnabled({ timeout: 20_000 });
  await eventActionsButton.click();
  await page.getByRole('menuitem', { name: 'Update listing' }).click();
  await page.getByRole('combobox', { name: 'Listing audience' }).click();
  await page
    .getByRole('option', {
      name: eventListingAudienceLabels[target.listingAudience],
    })
    .click();
  await page.getByRole('button', { name: 'Save' }).click();
});
