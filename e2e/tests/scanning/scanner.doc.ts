import { DateTime } from 'luxon';

import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Use the QR code scanner', async ({ page }, testInfo) => {
  await page.goto('.');
  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="User permissions" %}
For this guide, we assume you have an account with the required permissions. These are:
- **events:scan**: This permission is required to scan QR codes for event check-ins.
{% /callout %}

# QR Code Scanner

The QR code scanner allows you to check in attendees at events by scanning their ticket QR codes. This feature is typically used by event organizers or staff at the event entrance.

## Accessing the Scanner

To access the scanner, navigate to the **Scanning** section from the main menu.
`,
  });

  await page.getByRole('link', { name: 'Scanner' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('app-scanner'),
    page,
    'Scanner page',
  );

  await testInfo.attach('markdown', {
    body: `
## Scanner Interface

The scanner interface provides access to your device's camera to scan QR codes. You'll see:

- A camera viewfinder
- Instructions for scanning
- Options to toggle the camera or flash (on supported devices)

Position the QR code within the viewfinder to scan it.
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Scanning Process

When you scan a valid QR code, the system will:

1. Verify the ticket's authenticity
2. Check if the ticket is for a valid event
3. Confirm if the attendee has already been checked in
4. Display the attendee's information

This process happens in seconds, allowing for efficient check-in at busy events.
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Handling Registration

After scanning a QR code, you'll see the registration details and can take appropriate action.
`,
  });

  await page.getByRole('link', { name: 'Handle registration' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('app-handle-registration'),
    page,
    'Handle registration page',
  );

  await testInfo.attach('markdown', {
    body: `
## Registration Details

The registration details page shows:

- Attendee name and information
- Event details
- Registration type
- Check-in status
- Payment status (if applicable)

You can confirm the check-in by clicking the **Check In** button.
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Check-in Confirmation

After checking in an attendee, the system will display a confirmation message and update the attendee's status in the system.

## Handling Special Cases

The scanner can also handle special cases:

- **Already checked in**: If an attendee has already been checked in, you'll see a warning message.
- **Invalid ticket**: If the QR code is invalid or for a different event, you'll see an error message.
- **Payment issues**: If there are payment issues with the registration, you'll be notified.

These notifications help you handle exceptions quickly and efficiently.
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Offline Mode

The scanner can also work in offline mode when internet connectivity is limited. In offline mode:

- Scanned tickets are stored locally
- Basic validation is performed on the device
- Data is synchronized when connectivity is restored

This ensures the check-in process can continue even in venues with poor internet connectivity.
`,
  });
});
