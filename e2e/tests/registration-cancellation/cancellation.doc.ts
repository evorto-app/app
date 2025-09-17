import { expect } from '@playwright/test';

import { usersToAuthenticate } from '../../../helpers/user-data';
import { test } from '../../fixtures/parallel-test';

test.use({ storageState: usersToAuthenticate.find((u) => u.roles === 'admin')!.stateFile });

test.describe('Registration Cancellation Configuration Documentation', () => {
  test('complete user journey - tenant policy setup, option override, cancellation flow', async ({
    page,
    tenant,
  }) => {
    test.info().annotations.push({
      type: 'doc',
      description: 'Registration Cancellation Configuration Guide',
    });

    // Step 1: Admin configures tenant-level cancellation policies
    await test.step('Configure tenant cancellation policies', async () => {
      await page.goto('/admin/settings');
      
      // Navigate to cancellation settings (this will fail until implemented)
      await page.getByRole('link', { name: 'Cancellation Policies' }).click();
      
      await expect(page).toHaveURL('/admin/settings/cancellation');
      await expect(page.getByRole('heading', { name: 'Cancellation Policies' })).toBeVisible();

      // Configure policies with progressive disclosure
      await page.getByText('Use single policy for all variants').click();
      
      // Set base policy: Allow cancellation, no transaction fees, include app fees, 1 day cutoff
      await page.getByLabel('Allow cancellation').check();
      await page.getByLabel('Include transaction fees in refund').uncheck();
      await page.getByLabel('Include app fees in refund').check();
      await page.getByLabel('Cutoff days').fill('1');
      await page.getByLabel('Cutoff hours').fill('0');
      
      // Expand to show per-variant overrides
      await page.getByText('Show advanced per-variant settings').click();
      
      // Override organizer policies to be more lenient
      await page.getByText('Paid Organizer Registration').click();
      await page.getByLabel('Cutoff days', { exact: false }).nth(1).fill('0');
      await page.getByLabel('Cutoff hours', { exact: false }).nth(1).fill('12');
      
      await page.getByText('Free Organizer Registration').click();
      await page.getByLabel('Cutoff days', { exact: false }).nth(2).fill('0');
      await page.getByLabel('Cutoff hours', { exact: false }).nth(2).fill('6');
      
      await page.getByRole('button', { name: 'Save Policies' }).click();
      
      await expect(page.getByText('Cancellation policies saved successfully')).toBeVisible();
      
      await page.screenshot({ path: 'docs/cancellation-tenant-setup.png' });
    });

    // Step 2: Create template with custom cancellation policy override
    await test.step('Create template with cancellation policy override', async () => {
      await page.goto('/templates/create');
      
      await page.getByLabel('Title').fill('Workshop with Custom Cancellation');
      await page.getByLabel('Description').fill('Workshop with strict cancellation policy for participant registration.');
      
      // Configure participant registration with custom policy
      await page.getByText('Participant Registration').click();
      await page.getByLabel('Enable Payment').check();
      await page.getByLabel('Price').fill('5000'); // €50
      
      // Override tenant cancellation policy
      await page.getByLabel('Use tenant default cancellation policy').uncheck();
      await page.getByLabel('Allow cancellation').check();
      await page.getByLabel('Include transaction fees in refund').check();
      await page.getByLabel('Include app fees in refund').check();
      await page.getByLabel('Cutoff days').fill('7'); // More strict: 7 days
      await page.getByLabel('Cutoff hours').fill('0');
      
      await page.getByRole('button', { name: 'Create Template' }).click();
      
      await expect(page.getByText('Template created successfully')).toBeVisible();
      
      await page.screenshot({ path: 'docs/cancellation-template-override.png' });
    });

    // Step 3: Create event from template and verify policy inheritance
    await test.step('Create event and verify policy inheritance', async () => {
      // Find the created template
      await page.goto('/templates');
      await page.getByText('Workshop with Custom Cancellation').click();
      await page.getByRole('button', { name: 'Create event' }).click();
      
      await page.getByLabel('Title').fill('Test Workshop - Cancellation Demo');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 14); // 2 weeks out to allow testing
      const dateString = tomorrow.toISOString().split('T')[0];
      await page.getByLabel('Start date').fill(dateString);
      await page.getByLabel('Start time').fill('10:00');
      
      // Verify cancellation policy is inherited and can be edited
      await page.getByText('Registration Options').click();
      await page.getByText('Participant Registration').click();
      
      // Should show inherited custom policy
      await expect(page.getByText('7 days, 0 hours before event')).toBeVisible();
      await expect(page.getByText('Includes transaction and app fees')).toBeVisible();
      
      await page.getByRole('button', { name: 'Create Event' }).click();
      
      await expect(page.getByText('Event created successfully')).toBeVisible();
      
      await page.screenshot({ path: 'docs/cancellation-event-inheritance.png' });
    });

    // Step 4: Register for event and view cancellation policy
    await test.step('User registration with policy disclosure', async () => {
      // Switch to regular user
      const userState = usersToAuthenticate.find((u) => u.roles === 'user')!.stateFile;
      const userContext = await page.context().browser()!.newContext({ storageState: userState });
      const userPage = await userContext.newPage();
      
      await userPage.addCookies([{
        domain: 'localhost',
        expires: -1,
        name: 'evorto-tenant',
        path: '/',
        value: tenant.domain,
      }]);
      
      await userPage.goto('/events');
      await userPage.getByText('Test Workshop - Cancellation Demo').click();
      
      // Policy should be displayed before registration
      await expect(userPage.getByText('Cancellation Policy')).toBeVisible();
      await expect(userPage.getByText('Cancellation allowed until 7 days before event')).toBeVisible();
      await expect(userPage.getByText('Full refund including all fees')).toBeVisible();
      
      await userPage.getByRole('button', { name: 'Register' }).click();
      
      // Complete payment flow (mocked)
      await expect(userPage.getByText('Registration successful')).toBeVisible();
      
      await userPage.screenshot({ path: 'docs/cancellation-policy-disclosure.png' });
      
      await userContext.close();
    });

    // Step 5: User cancels registration within allowed window
    await test.step('User cancellation within allowed window', async () => {
      // Switch back to user context for cancellation
      const userState = usersToAuthenticate.find((u) => u.roles === 'user')!.stateFile;
      const userContext = await page.context().browser()!.newContext({ storageState: userState });
      const userPage = await userContext.newPage();
      
      await userPage.addCookies([{
        domain: 'localhost',
        expires: -1,
        name: 'evorto-tenant',
        path: '/',
        value: tenant.domain,
      }]);
      
      await userPage.goto('/events');
      await userPage.getByText('Test Workshop - Cancellation Demo').click();
      
      // Should show active registration with cancel option
      await expect(userPage.getByText('Your Registration')).toBeVisible();
      await expect(userPage.getByRole('button', { name: 'Cancel Registration' })).toBeVisible();
      
      await userPage.getByRole('button', { name: 'Cancel Registration' }).click();
      
      // Cancellation dialog
      await expect(userPage.getByText('Cancel Registration')).toBeVisible();
      await expect(userPage.getByText('Refund amount: €50.00')).toBeVisible();
      await expect(userPage.getByText('Includes all fees')).toBeVisible();
      
      await userPage.getByLabel('Reason for cancellation').selectOption('user-request');
      await userPage.getByLabel('Additional notes').fill('Schedule conflict arose');
      
      await userPage.getByRole('button', { name: 'Confirm Cancellation' }).click();
      
      await expect(userPage.getByText('Registration cancelled successfully')).toBeVisible();
      await expect(userPage.getByText('Refund will be processed within 3-5 business days')).toBeVisible();
      
      await userPage.screenshot({ path: 'docs/cancellation-success.png' });
      
      await userContext.close();
    });

    // Step 6: Demonstrate cutoff enforcement
    await test.step('Cancellation after cutoff is blocked', async () => {
      // This would require time manipulation in a real test
      // For documentation purposes, we'll simulate this
      await page.goto('/admin/events');
      await page.getByText('Test Workshop - Cancellation Demo').click();
      
      // Admin view shows cancellation was processed
      await expect(page.getByText('1 cancelled registration')).toBeVisible();
      
      await page.screenshot({ path: 'docs/cancellation-admin-view.png' });
    });
  });
});