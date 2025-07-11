import { defaultStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/base-test';

test.use({ storageState: defaultStateFile });

test.describe('Scanner and Check-In Documentation', () => {
  test('QR Code Scanner for Event Check-In', async ({ page, takeScreenshot }) => {
    await page.goto('/scan');
    
    // Take screenshot of the scanner page
    await takeScreenshot({
      element: page.locator('main'),
      filename: 'scanner-main-page.png',
      message: 'The main scanner page shows camera permissions instructions and a video preview for QR code scanning.',
    });

    // Test scanner with event context
    const eventId = 'test-event-id';
    await page.goto(`/scan?eventId=${eventId}`);
    
    await takeScreenshot({
      element: page.locator('main'),
      filename: 'scanner-with-event-context.png',
      message: 'Scanner page with event context shows which event the scanned registrations will be validated against.',
    });
  });

  test('Event Organization Dashboard', async ({ page, events, takeScreenshot }) => {
    const event = events[0];
    await page.goto(`/events/${event.id}/organize`);
    
    // Take screenshot of the event organize page
    await takeScreenshot({
      element: page.locator('main'),
      filename: 'event-organize-dashboard.png',
      message: 'The event organization dashboard provides an overview of participants with statistics and a scanner button for easy check-in access.',
    });

    // Highlight the scanner button
    const scannerButton = page.locator('button[title="Open Scanner"]');
    await scannerButton.hover();
    
    await takeScreenshot({
      element: page.locator('main'),
      filename: 'event-organize-scanner-button.png',
      message: 'The scanner button in the event organize view opens the scanner with the event context automatically set.',
    });
  });

  test('Registration Check-In Flow', async ({ page, takeScreenshot }) => {
    // Navigate to a mock registration scan result
    await page.goto('/scan/registration/test-registration-id');
    
    // Take screenshot of the check-in page
    await takeScreenshot({
      element: page.locator('main'),
      filename: 'registration-check-in-page.png',
      message: 'The registration check-in page shows user details, event information, and allows organizers to confirm check-in.',
    });

    // Test with event context
    await page.goto('/scan/registration/test-registration-id?eventId=test-event-id');
    
    await takeScreenshot({
      element: page.locator('main'),
      filename: 'registration-check-in-with-event-context.png',
      message: 'When scanning from a specific event context, the system validates that the registration matches the expected event.',
    });
  });
});

test.describe('Scanner Features', () => {
  test('Event-Specific Scanner', async ({ page, markdownAttachment }) => {
    await markdownAttachment(`
# Event-Specific QR Code Scanner

The scanner now supports event-specific contexts, making it easier for event organizers to manage check-ins during events.

## Key Features

### 1. Context-Aware Scanning
- Scanner can be opened with a specific event context
- Validates that scanned registrations match the expected event
- Provides clear warnings when registration doesn't match the event

### 2. Event Organization Dashboard
- Overview of all participants for an event
- Statistics showing total, confirmed, checked-in, and pending registrations
- Quick access to scanner with event context pre-set

### 3. Enhanced Navigation
- Smart back navigation based on context
- Seamless flow between event management and check-in processes

### 4. Registration Validation
- Prevents check-in of registrations for different events
- Clear error messages and warnings
- Maintains data integrity during event check-in

## Usage Flow

1. Navigate to the event organization page
2. Click the scanner button to open QR scanner with event context
3. Scan participant QR codes
4. System validates registration against the event
5. Confirm check-in if validation passes
6. Navigate back to event organization dashboard

This streamlined process makes it much easier for event organizers to manage participant check-ins during events.
    `);
  });
});