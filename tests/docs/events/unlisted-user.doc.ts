import { userStateFile } from '../../../helpers/user-data';
import { test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: userStateFile });

test('User: understanding unlisted events @track(playwright-specs-track-linking_20260126) @doc(UNLISTED-USER-DOC-01)', async ({
  page,
}, testInfo) => {
  await page.goto('./events');

  await testInfo.attach('markdown', {
    body: `
# Unlisted Events (User)

Some events are marked as "unlisted" by organizers. These events do not appear in public event lists. If you receive a direct link (and have access to the registration options), you can still open the event page.

What this means for you:

- Event list shows only visible, approved events
- Unlisted events are hidden from the list
- A direct link to an unlisted event will still work when shared with you
`,
  });

  // Show the events page from the user perspective
  await takeScreenshot(
    testInfo,
    page.locator('h1:has-text("Events")').first(),
    page,
    'Events list (user view)',
  );

  await testInfo.attach('markdown', {
    body: `
If an event is shared with you directly, open the link you were given to access the event details and register (if registration options are available to your account).
`,
  });
});
