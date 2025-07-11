import { defaultStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';

test.use({ storageState: defaultStateFile });

test.describe('Scanner and Event Organization', () => {
  test('should display scanner page with event context', async ({ page }) => {
    await page.goto('/scan');
    await expect(page).toHaveURL(/\/scan/);
    await expect(page.locator('h1')).toHaveText('Scanner');
    await expect(page.locator('video')).toBeVisible();
  });

  test('should display scanner with event context when navigated from event organize', async ({ page }) => {
    const eventId = 'test-event-id';
    await page.goto(`/scan?eventId=${eventId}`);
    await expect(page).toHaveURL(/\/scan/);
    await expect(page.locator('h1')).toHaveText('Scanner');
    await expect(page.getByText('Event Context')).toBeVisible();
    await expect(page.getByText(`Scanning for event: ${eventId}`)).toBeVisible();
  });

  test('should navigate to event organize page', async ({ page, events }) => {
    const event = events[0];
    await page.goto(`/events/${event.id}/organize`);
    await expect(page).toHaveURL(`/events/${event.id}/organize`);
    await expect(page.locator('h1')).toHaveText(event.title);
  });

  test('should show participants overview in event organize', async ({ page, events }) => {
    const event = events[0];
    await page.goto(`/events/${event.id}/organize`);
    
    // Check for statistics cards
    await expect(page.getByText('Total')).toBeVisible();
    await expect(page.getByText('Confirmed')).toBeVisible();
    await expect(page.getByText('Checked In')).toBeVisible();
    await expect(page.getByText('Pending')).toBeVisible();
    
    // Check for participants section
    await expect(page.getByText('Participants')).toBeVisible();
  });

  test('should have scanner button in event organize', async ({ page, events }) => {
    const event = events[0];
    await page.goto(`/events/${event.id}/organize`);
    
    // Check for scanner button
    const scannerButton = page.locator('button[title="Open Scanner"]');
    await expect(scannerButton).toBeVisible();
    
    // Click scanner button should navigate to scanner with event context
    await scannerButton.click();
    await expect(page).toHaveURL(`/scan?eventId=${event.id}`);
    await expect(page.getByText('Event Context')).toBeVisible();
  });
});