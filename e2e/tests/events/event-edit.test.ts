import { defaultStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';

test.use({ storageState: defaultStateFile });

test('edit event functionality', async ({ page, events }) => {
  // Use the first event from the fixtures
  const eventToEdit = events[0];
  
  // Navigate to the event details page
  await page.goto('.');
  await page.getByRole('link', { name: 'Events' }).click();
  await expect(page).toHaveURL(/\/events/);
  
  // Find and click on the event
  await page.getByRole('link', { name: eventToEdit.title }).click();
  await expect(page).toHaveURL(`/events/${eventToEdit.id}`);
  
  // Click the edit button to go to the edit page
  await page.getByRole('link', { name: 'Edit Event' }).click();
  await expect(page).toHaveURL(`/events/${eventToEdit.id}/edit`);
  
  // Verify the form loads with existing data
  await expect(page.getByLabel('Event title')).toHaveValue(eventToEdit.title);
  
  // Edit the event title
  const newTitle = `${eventToEdit.title} - Edited`;
  await page.getByLabel('Event title').fill(newTitle);
  
  // Edit the event description (this is handled by a custom editor component)
  // For now, just verify the title editing works
  const newDescription = 'This is an updated description for the event.';
  // Note: Description editing might require more complex interaction with the editor component
  
  // Save the changes
  await page.getByRole('button', { name: 'Save Changes' }).click();
  
  // Wait for the save to complete and verify redirect to event details
  await expect(page).toHaveURL(`/events/${eventToEdit.id}`);
  
  // Verify the changes were saved
  await expect(page.getByRole('heading', { name: newTitle })).toBeVisible();
  // Note: Description verification might be more complex due to custom editor
  
  // Verify success notification appeared
  await expect(page.getByText('Event updated successfully')).toBeVisible();
});

test('edit event registration options', async ({ page, events }) => {
  // Use the first event from the fixtures
  const eventToEdit = events[0];
  
  // Navigate to the event edit page
  await page.goto(`/events/${eventToEdit.id}/edit`);
  
  // Wait for the page to load
  await expect(page.getByRole('heading', { name: eventToEdit.title })).toBeVisible();
  
  // Verify registration options section is visible
  await expect(page.getByRole('heading', { name: 'Registration Options' })).toBeVisible();
  
  // Check if there are existing registration options
  if (eventToEdit.registrationOptions.length > 0) {
    // Find the first registration option form
    const registrationOptionForm = page.locator('app-registration-option-form').first();
    await expect(registrationOptionForm).toBeVisible();
    
    // Edit the number of spots for the registration option
    const spotsInput = registrationOptionForm.getByLabel('Spots');
    await spotsInput.clear();
    await spotsInput.fill('25');
    
    // Save the changes
    await page.getByRole('button', { name: 'Save Changes' }).click();
    
    // Wait for the save to complete and verify redirect
    await expect(page).toHaveURL(`/events/${eventToEdit.id}`);
    
    // Verify success notification
    await expect(page.getByText('Event updated successfully')).toBeVisible();
  }
});

test('edit event form validation', async ({ page, events }) => {
  // Use the first event from the fixtures
  const eventToEdit = events[0];
  
  // Navigate to the event edit page
  await page.goto(`/events/${eventToEdit.id}/edit`);
  
  // Wait for the page to load
  await expect(page.getByRole('heading', { name: eventToEdit.title })).toBeVisible();
  
  // Clear the required title field to test validation
  await page.getByLabel('Event title').clear();
  
  // Try to save with empty title
  await page.getByRole('button', { name: 'Save Changes' }).click();
  
  // Verify the form doesn't submit and shows validation error
  await expect(page).toHaveURL(`/events/${eventToEdit.id}/edit`);
  
  // Verify the save button is disabled when form is invalid
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  
  // Fill in the title again to make form valid
  await page.getByLabel('Event title').fill(eventToEdit.title);
  
  // Verify the save button is enabled again
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
});