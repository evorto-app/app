import { expect } from '@playwright/test';

import { usersToAuthenticate } from '../../../helpers/user-data';
import { test } from '../../fixtures/permissions-test';

test.describe('Registration Cancellation Permissions', () => {
  test('self-cancellation permissions', async ({ page, tenant, database, events }) => {
    test.use({ storageState: usersToAuthenticate.find((u) => u.roles === 'user')!.stateFile });
    
    const paidEvent = events.find(e => 
      e.registrationOptions.some(o => o.isPaid && !o.organizingRegistration)
    );
    
    test.skip(!paidEvent, 'No paid event available for testing');

    await test.step('User can cancel their own registration', async () => {
      // First register for the event
      await page.goto(`/events/${paidEvent!.id}`);
      await page.getByRole('button', { name: 'Register' }).click();
      await expect(page.getByText('Registration successful')).toBeVisible();
      
      // Should be able to cancel own registration
      await page.goto(`/events/${paidEvent!.id}`);
      await expect(page.getByRole('button', { name: 'Cancel Registration' })).toBeVisible();
      
      await page.getByRole('button', { name: 'Cancel Registration' }).click();
      await page.getByLabel('Reason').selectOption('user-request');
      await page.getByRole('button', { name: 'Confirm Cancellation' }).click();
      
      await expect(page.getByText('Registration cancelled successfully')).toBeVisible();
    });
  });

  test('cancel others registrations requires events:registrations:cancel:any permission', async ({ 
    page, 
    tenant, 
    database, 
    events,
    permissionOverride,
  }) => {
    test.use({ storageState: usersToAuthenticate.find((u) => u.roles === 'admin')!.stateFile });
    
    const paidEvent = events.find(e => 
      e.registrationOptions.some(o => o.isPaid && !o.organizingRegistration)
    );
    
    test.skip(!paidEvent, 'No paid event available for testing');

    await test.step('Admin can cancel any registration with permission', async () => {
      // First create a user registration to cancel
      const regularUser = usersToAuthenticate.find(u => u.roles === 'user')!;
      
      await database.insert({ table: 'event_registrations' }).values({
        tenantId: tenant.id,
        eventId: paidEvent!.id,
        registrationOptionId: paidEvent!.registrationOptions[0].id,
        userId: regularUser.id,
        status: 'CONFIRMED',
        effectiveCancellationPolicy: {
          allowCancellation: true,
          includeTransactionFees: false,
          includeAppFees: true,
          cutoffDays: 1,
          cutoffHours: 0,
          source: 'tenant-default',
          variant: 'paid-regular',
        },
      });
      
      // Grant permission to cancel any registration
      await permissionOverride({
        add: ['events:registrations:cancel:any'],
      });
      
      await page.goto('/admin/events');
      await page.getByText(paidEvent!.title).click();
      await page.getByText('Registrations').click();
      
      // Should see option to cancel user's registration
      await page.getByText(regularUser.email).locator('..').getByRole('button', { name: 'Cancel' }).click();
      
      await page.getByLabel('Reason').selectOption('admin-action');
      await page.getByLabel('Notes').fill('Administrative cancellation for testing');
      await page.getByRole('button', { name: 'Confirm Cancellation' }).click();
      
      await expect(page.getByText('Registration cancelled successfully')).toBeVisible();
    });

    await test.step('User without permission cannot cancel others registrations', async () => {
      // Remove the permission
      await permissionOverride({
        remove: ['events:registrations:cancel:any'],
      });
      
      await page.reload();
      
      // Should not see cancel buttons for other users
      await expect(page.getByRole('button', { name: 'Cancel' })).not.toBeVisible();
    });
  });

  test('cancel without refund requires events:registrations:cancelWithoutRefund permission', async ({
    page,
    tenant,
    database,
    events,
    permissionOverride,
  }) => {
    test.use({ storageState: usersToAuthenticate.find((u) => u.roles === 'admin')!.stateFile });
    
    const paidEvent = events.find(e => 
      e.registrationOptions.some(o => o.isPaid && !o.organizingRegistration)
    );
    
    test.skip(!paidEvent, 'No paid event available for testing');

    await test.step('Admin can cancel without refund with permission', async () => {
      // Create a user registration to cancel
      const regularUser = usersToAuthenticate.find(u => u.roles === 'user')!;
      
      await database.insert({ table: 'event_registrations' }).values({
        tenantId: tenant.id,
        eventId: paidEvent!.id,
        registrationOptionId: paidEvent!.registrationOptions[0].id,
        userId: regularUser.id,
        status: 'CONFIRMED',
        effectiveCancellationPolicy: {
          allowCancellation: true,
          includeTransactionFees: false,
          includeAppFees: true,
          cutoffDays: 1,
          cutoffHours: 0,
          source: 'tenant-default',
          variant: 'paid-regular',
        },
      });
      
      // Grant permissions for cancelling any registration and without refund
      await permissionOverride({
        add: ['events:registrations:cancel:any', 'events:registrations:cancelWithoutRefund'],
      });
      
      await page.goto('/admin/events');
      await page.getByText(paidEvent!.title).click();
      await page.getByText('Registrations').click();
      
      await page.getByText(regularUser.email).locator('..').getByRole('button', { name: 'Cancel' }).click();
      
      // Should show option to cancel without refund
      await expect(page.getByLabel('Cancel without refund')).toBeVisible();
      await page.getByLabel('Cancel without refund').check();
      
      await page.getByLabel('Reason').selectOption('policy-violation');
      await page.getByLabel('Notes').fill('User violated terms of service');
      await page.getByRole('button', { name: 'Confirm Cancellation' }).click();
      
      await expect(page.getByText('Registration cancelled without refund')).toBeVisible();
    });

    await test.step('User without permission cannot cancel without refund', async () => {
      // Remove the specific permission but keep cancel:any
      await permissionOverride({
        remove: ['events:registrations:cancelWithoutRefund'],
      });
      
      await page.reload();
      await page.getByText(paidEvent!.title).click();
      await page.getByText('Registrations').click();
      
      // Create another registration to test
      const regularUser = usersToAuthenticate.find(u => u.roles === 'user')!;
      
      await database.insert({ table: 'event_registrations' }).values({
        tenantId: tenant.id,
        eventId: paidEvent!.id,
        registrationOptionId: paidEvent!.registrationOptions[0].id,
        userId: regularUser.id,
        status: 'CONFIRMED',
      });
      
      await page.reload();
      await page.getByText(regularUser.email).locator('..').getByRole('button', { name: 'Cancel' }).click();
      
      // Should NOT show option to cancel without refund
      await expect(page.getByLabel('Cancel without refund')).not.toBeVisible();
    });
  });

  test('cancellation UI visibility based on policy and timing', async ({
    page,
    tenant,
    database,
    events,
  }) => {
    test.use({ storageState: usersToAuthenticate.find((u) => u.roles === 'user')!.stateFile });
    
    const paidEvent = events.find(e => 
      e.registrationOptions.some(o => o.isPaid && !o.organizingRegistration)
    );
    
    test.skip(!paidEvent, 'No paid event available for testing');

    await test.step('Cancel button hidden when cancellation not allowed by policy', async () => {
      const regularUser = usersToAuthenticate.find(u => u.roles === 'user')!;
      
      // Create registration with policy that disallows cancellation
      await database.insert({ table: 'event_registrations' }).values({
        tenantId: tenant.id,
        eventId: paidEvent!.id,
        registrationOptionId: paidEvent!.registrationOptions[0].id,
        userId: regularUser.id,
        status: 'CONFIRMED',
        effectiveCancellationPolicy: {
          allowCancellation: false, // Cancellation disabled
          includeTransactionFees: false,
          includeAppFees: true,
          cutoffDays: 1,
          cutoffHours: 0,
          source: 'option-override',
          variant: 'paid-regular',
        },
      });
      
      await page.goto(`/events/${paidEvent!.id}`);
      
      // Should show registration but no cancel button
      await expect(page.getByText('Your Registration')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel Registration' })).not.toBeVisible();
      await expect(page.getByText('Cancellation not allowed for this registration')).toBeVisible();
    });

    await test.step('Cancel button hidden when past cutoff time', async () => {
      const regularUser = usersToAuthenticate.find(u => u.roles === 'user')!;
      
      // Update event to start soon (within cutoff window)
      const soonStart = new Date();
      soonStart.setHours(soonStart.getHours() + 12); // 12 hours from now
      
      await database
        .update({ table: 'event_instances' })
        .set({ start: soonStart })
        .where({ id: paidEvent!.id });
      
      // Create registration with 1 day cutoff (should be past cutoff)
      await database.insert({ table: 'event_registrations' }).values({
        tenantId: tenant.id,
        eventId: paidEvent!.id,
        registrationOptionId: paidEvent!.registrationOptions[0].id,
        userId: regularUser.id,
        status: 'CONFIRMED',
        effectiveCancellationPolicy: {
          allowCancellation: true,
          includeTransactionFees: false,
          includeAppFees: true,
          cutoffDays: 1, // 1 day cutoff, but event is in 12 hours
          cutoffHours: 0,
          source: 'tenant-default',
          variant: 'paid-regular',
        },
      });
      
      await page.goto(`/events/${paidEvent!.id}`);
      
      // Should show registration but no cancel button due to cutoff
      await expect(page.getByText('Your Registration')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel Registration' })).not.toBeVisible();
      await expect(page.getByText('Cancellation cutoff has passed')).toBeVisible();
    });

    await test.step('Cancel button visible when within allowed window', async () => {
      const regularUser = usersToAuthenticate.find(u => u.roles === 'user')!;
      
      // Update event to start well in the future
      const futureStart = new Date();
      futureStart.setDate(futureStart.getDate() + 7); // 7 days from now
      
      await database
        .update({ table: 'event_instances' })
        .set({ start: futureStart })
        .where({ id: paidEvent!.id });
      
      // Create registration with reasonable cutoff
      await database.insert({ table: 'event_registrations' }).values({
        tenantId: tenant.id,
        eventId: paidEvent!.id,
        registrationOptionId: paidEvent!.registrationOptions[0].id,
        userId: regularUser.id,
        status: 'CONFIRMED',
        effectiveCancellationPolicy: {
          allowCancellation: true,
          includeTransactionFees: false,
          includeAppFees: true,
          cutoffDays: 1,
          cutoffHours: 0,
          source: 'tenant-default',
          variant: 'paid-regular',
        },
      });
      
      await page.goto(`/events/${paidEvent!.id}`);
      
      // Should show cancel button
      await expect(page.getByText('Your Registration')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel Registration' })).toBeVisible();
    });
  });
});