import { expect } from '@playwright/test';

import { usersToAuthenticate } from '../../../helpers/user-data';
import { test } from '../../fixtures/parallel-test';

test.use({ storageState: usersToAuthenticate.find((u) => u.roles === 'admin')!.stateFile });

test.describe('Cancellation Policy Inheritance and Override', () => {
  test('template option inherits tenant default vs uses custom override', async ({
    page,
    tenant,
    database,
  }) => {
    await test.step('Configure tenant default policies', async () => {
      await page.goto('/admin/settings/cancellation');
      
      // Set tenant defaults
      const tenantPolicies = {
        'paid-regular': {
          allowCancellation: true,
          includeTransactionFees: false,
          includeAppFees: true,
          cutoffDays: 2,
          cutoffHours: 0,
        },
        'paid-organizer': {
          allowCancellation: true,
          includeTransactionFees: true,
          includeAppFees: true,
          cutoffDays: 1,
          cutoffHours: 0,
        },
        'free-regular': {
          allowCancellation: true,
          includeTransactionFees: false,
          includeAppFees: false,
          cutoffDays: 1,
          cutoffHours: 0,
        },
        'free-organizer': {
          allowCancellation: true,
          includeTransactionFees: false,
          includeAppFees: false,
          cutoffDays: 0,
          cutoffHours: 12,
        },
      };
      
      // This should save via tRPC procedure (will fail until implemented)
      await page.evaluate((policies) => {
        return (window as any).trpc.tenants.setCancellationPolicies.mutate(policies);
      }, tenantPolicies);
    });

    await test.step('Create template with inheritance enabled', async () => {
      await page.goto('/templates/create');
      
      await page.getByLabel('Title').fill('Template with Tenant Default');
      await page.getByLabel('Description').fill('Uses tenant default cancellation policy');
      
      // Configure participant registration to inherit tenant default
      await page.getByText('Participant Registration').click();
      await page.getByLabel('Enable Payment').check();
      await page.getByLabel('Price').fill('3000');
      
      // Ensure inheritance is enabled
      await expect(page.getByLabel('Use tenant default cancellation policy')).toBeChecked();
      
      // Should show preview of tenant default
      await expect(page.getByText('Preview: 2 days before event')).toBeVisible();
      await expect(page.getByText('App fees included, transaction fees excluded')).toBeVisible();
      
      await page.getByRole('button', { name: 'Create Template' }).click();
      await expect(page.getByText('Template created successfully')).toBeVisible();
    });

    await test.step('Create template with custom override', async () => {
      await page.goto('/templates/create');
      
      await page.getByLabel('Title').fill('Template with Custom Policy');
      await page.getByLabel('Description').fill('Uses custom cancellation policy override');
      
      // Configure participant registration with custom policy
      await page.getByText('Participant Registration').click();
      await page.getByLabel('Enable Payment').check();
      await page.getByLabel('Price').fill('3000');
      
      // Disable inheritance and set custom policy
      await page.getByLabel('Use tenant default cancellation policy').uncheck();
      
      await page.getByLabel('Allow cancellation').check();
      await page.getByLabel('Include transaction fees in refund').check();
      await page.getByLabel('Include app fees in refund').check();
      await page.getByLabel('Cutoff days').fill('5');
      await page.getByLabel('Cutoff hours').fill('12');
      
      await page.getByRole('button', { name: 'Create Template' }).click();
      await expect(page.getByText('Template created successfully')).toBeVisible();
    });

    await test.step('Create events and verify policy resolution', async () => {
      // Create event from tenant default template
      await page.goto('/templates');
      await page.getByText('Template with Tenant Default').click();
      await page.getByRole('button', { name: 'Create event' }).click();
      
      await page.getByLabel('Title').fill('Event Using Tenant Default');
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      await page.getByLabel('Start date').fill(futureDate.toISOString().split('T')[0]);
      await page.getByLabel('Start time').fill('14:00');
      
      await page.getByRole('button', { name: 'Create Event' }).click();
      await expect(page.getByText('Event created successfully')).toBeVisible();
      
      // Verify policy in event details
      await page.getByText('Registration Options').click();
      await expect(page.getByText('Cancellation: 2 days before event')).toBeVisible();
      await expect(page.getByText('Source: Tenant Default')).toBeVisible();
      
      // Create event from custom override template
      await page.goto('/templates');
      await page.getByText('Template with Custom Policy').click();
      await page.getByRole('button', { name: 'Create event' }).click();
      
      await page.getByLabel('Title').fill('Event Using Custom Policy');
      await page.getByLabel('Start date').fill(futureDate.toISOString().split('T')[0]);
      await page.getByLabel('Start time').fill('16:00');
      
      await page.getByRole('button', { name: 'Create Event' }).click();
      await expect(page.getByText('Event created successfully')).toBeVisible();
      
      // Verify custom policy in event details
      await page.getByText('Registration Options').click();
      await expect(page.getByText('Cancellation: 5 days, 12 hours before event')).toBeVisible();
      await expect(page.getByText('Source: Custom Override')).toBeVisible();
      await expect(page.getByText('Full refund including all fees')).toBeVisible();
    });

    await test.step('Verify policy snapshot at registration time', async () => {
      // Switch to user context for registration
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
      
      // Register for event using tenant default
      await userPage.goto('/events');
      await userPage.getByText('Event Using Tenant Default').click();
      
      await expect(userPage.getByText('Cancellation allowed until 2 days before')).toBeVisible();
      await userPage.getByRole('button', { name: 'Register' }).click();
      
      // Verify registration has policy snapshot
      const registration = await database.query.eventRegistrations.findFirst({
        where: { tenantId: tenant.id, userId: usersToAuthenticate.find(u => u.roles === 'user')!.id },
        orderBy: { createdAt: 'desc' },
      });
      
      expect(registration?.effectiveCancellationPolicy).toBeTruthy();
      expect(registration?.effectivePolicySource).toBe('tenant-default');
      expect(registration?.effectiveCancellationPolicy?.cutoffDays).toBe(2);
      expect(registration?.effectiveCancellationPolicy?.variant).toBe('paid-regular');
      
      await userContext.close();
    });

    await test.step('Verify organizer registration uses different policy variant', async () => {
      // Switch to organizer context
      const organizerState = usersToAuthenticate.find((u) => u.roles === 'organizer')!.stateFile;
      const organizerContext = await page.context().browser()!.newContext({ storageState: organizerState });
      const organizerPage = await organizerContext.newPage();
      
      await organizerPage.addCookies([{
        domain: 'localhost',
        expires: -1,
        name: 'evorto-tenant',
        path: '/',
        value: tenant.domain,
      }]);
      
      // Register for same event as organizer
      await organizerPage.goto('/events');
      await organizerPage.getByText('Event Using Tenant Default').click();
      
      // Should show organizer-specific policy
      await expect(organizerPage.getByText('Organizer Registration')).toBeVisible();
      await expect(organizerPage.getByText('Cancellation allowed until 1 day before')).toBeVisible();
      await expect(organizerPage.getByText('Full refund including all fees')).toBeVisible();
      
      await organizerPage.getByRole('button', { name: 'Register' }).nth(1).click(); // Second button for organizer
      
      // Verify organizer registration has different policy snapshot
      const organizerRegistration = await database.query.eventRegistrations.findFirst({
        where: { 
          tenantId: tenant.id, 
          userId: usersToAuthenticate.find(u => u.roles === 'organizer')!.id 
        },
        orderBy: { createdAt: 'desc' },
      });
      
      expect(organizerRegistration?.effectiveCancellationPolicy?.variant).toBe('paid-organizer');
      expect(organizerRegistration?.effectiveCancellationPolicy?.cutoffDays).toBe(1);
      expect(organizerRegistration?.effectiveCancellationPolicy?.includeTransactionFees).toBe(true);
      
      await organizerContext.close();
    });
  });

  test('event creation allows editing inherited policies', async ({
    page,
    templates,
  }) => {
    // Find a template to create event from
    const template = templates[0];
    
    await test.step('Create event and modify inherited policy', async () => {
      await page.goto(`/templates/${template.id}`);
      await page.getByRole('button', { name: 'Create event' }).click();
      
      await page.getByLabel('Title').fill('Event with Modified Policy');
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 14);
      await page.getByLabel('Start date').fill(futureDate.toISOString().split('T')[0]);
      
      // Edit registration option policy during event creation
      await page.getByText('Registration Options').click();
      await page.getByText('Participant Registration').click();
      
      // Change from inheritance to custom
      await page.getByLabel('Use tenant default cancellation policy').uncheck();
      
      await page.getByLabel('Allow cancellation').check();
      await page.getByLabel('Include transaction fees in refund').uncheck();
      await page.getByLabel('Include app fees in refund').check();
      await page.getByLabel('Cutoff days').fill('3');
      await page.getByLabel('Cutoff hours').fill('6');
      
      await page.getByRole('button', { name: 'Create Event' }).click();
      await expect(page.getByText('Event created successfully')).toBeVisible();
      
      // Verify the custom policy was saved
      await page.getByText('Registration Options').click();
      await expect(page.getByText('Cancellation: 3 days, 6 hours before event')).toBeVisible();
      await expect(page.getByText('Source: Custom Override')).toBeVisible();
      await expect(page.getByText('App fees included, transaction fees excluded')).toBeVisible();
    });
  });
});