import { expect } from '@playwright/test';

import { usersToAuthenticate } from '../../../helpers/user-data';
import { test } from '../../fixtures/parallel-test';

test.use({ storageState: usersToAuthenticate.find((u) => u.roles === 'user')!.stateFile });

test.describe('Registration Cancellation Happy Path', () => {
  test('paid registration cancellation with partial fee retention', async ({
    page,
    tenant,
    database,
    events,
  }) => {
    // Find a paid event to register for
    const paidEvent = events.find(e => 
      e.registrationOptions.some(o => o.isPaid && !o.organizingRegistration)
    );
    
    test.skip(!paidEvent, 'No paid event available for testing');
    
    const paidOption = paidEvent!.registrationOptions.find(o => o.isPaid && !o.organizingRegistration)!;
    
    // Set up tenant with cancellation policy that excludes transaction fees but includes app fees
    await test.step('Setup tenant cancellation policy', async () => {
      const tenantPolicies = {
        'paid-regular': {
          allowCancellation: true,
          includeTransactionFees: false,
          includeAppFees: true,
          cutoffDays: 1,
          cutoffHours: 0,
        },
        'paid-organizer': {
          allowCancellation: true,
          includeTransactionFees: false,
          includeAppFees: true,
          cutoffDays: 0,
          cutoffHours: 12,
        },
        'free-regular': {
          allowCancellation: true,
          includeTransactionFees: false,
          includeAppFees: false,
          cutoffDays: 0,
          cutoffHours: 6,
        },
        'free-organizer': {
          allowCancellation: true,
          includeTransactionFees: false,
          includeAppFees: false,
          cutoffDays: 0,
          cutoffHours: 3,
        },
      };
      
      // This will fail until the backend is implemented
      await database
        .update({ table: 'tenants' })
        .set({ cancellationPolicies: tenantPolicies })
        .where({ id: tenant.id });
    });

    await test.step('Register for paid event', async () => {
      await page.goto(`/events/${paidEvent!.id}`);
      
      // Should show cancellation policy before registration
      await expect(page.getByText('Cancellation Policy')).toBeVisible();
      await expect(page.getByText('until 1 day before event')).toBeVisible();
      await expect(page.getByText('App fees included')).toBeVisible();
      await expect(page.getByText('Transaction fees excluded')).toBeVisible();
      
      await page.getByRole('button', { name: 'Register' }).click();
      
      // This would normally redirect to Stripe, but in test we'll mock success
      await expect(page.getByText('Registration successful')).toBeVisible();
    });

    await test.step('Cancel registration within allowed window', async () => {
      await page.goto(`/events/${paidEvent!.id}`);
      
      // Should show active registration
      await expect(page.getByText('Your Registration')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel Registration' })).toBeVisible();
      
      await page.getByRole('button', { name: 'Cancel Registration' }).click();
      
      // Cancellation dialog should show refund breakdown
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByText('Cancel Registration')).toBeVisible();
      
      // Should show partial refund (excluding transaction fees)
      await expect(page.getByText('Refund amount:')).toBeVisible();
      await expect(page.getByText('App fees: Included')).toBeVisible();
      await expect(page.getByText('Transaction fees: Excluded')).toBeVisible();
      
      await page.getByLabel('Reason').selectOption('user-request');
      await page.getByRole('button', { name: 'Confirm Cancellation' }).click();
      
      await expect(page.getByText('Registration cancelled successfully')).toBeVisible();
      
      // Should no longer show cancel button
      await expect(page.getByRole('button', { name: 'Cancel Registration' })).not.toBeVisible();
      await expect(page.getByText('Registration: Cancelled')).toBeVisible();
    });

    await test.step('Verify cancellation was recorded', async () => {
      // Check database for cancellation record
      const registration = await database.query.eventRegistrations.findFirst({
        where: {
          eventId: paidEvent!.id,
          tenantId: tenant.id,
          status: 'CANCELLED',
        },
      });
      
      expect(registration).toBeTruthy();
      expect(registration?.cancellationReason).toBe('user-request');
      expect(registration?.cancelledAt).toBeTruthy();
    });
  });

  test('cancellation blocked after cutoff time', async ({
    page,
    tenant,
    database,
    events,
  }) => {
    const paidEvent = events.find(e => 
      e.registrationOptions.some(o => o.isPaid && !o.organizingRegistration)
    );
    
    test.skip(!paidEvent, 'No paid event available for testing');
    
    // Set up event that starts soon (within cutoff window)
    await test.step('Setup event within cutoff window', async () => {
      const soonStart = new Date();
      soonStart.setHours(soonStart.getHours() + 12); // 12 hours from now
      
      // Update event start time to be within cutoff
      await database
        .update({ table: 'event_instances' })
        .set({ start: soonStart })
        .where({ id: paidEvent!.id });
    });

    await test.step('Attempt cancellation after cutoff', async () => {
      await page.goto(`/events/${paidEvent!.id}`);
      
      // Should show registration but no cancel button
      await expect(page.getByText('Your Registration')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel Registration' })).not.toBeVisible();
      
      // Should show cutoff message
      await expect(page.getByText('Cancellation no longer allowed')).toBeVisible();
      await expect(page.getByText('cutoff time has passed')).toBeVisible();
    });
  });
});