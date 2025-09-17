import { expect, test } from '../fixtures/parallel-test';

test.describe('Registration Cancellation Configuration Documentation', () => {
  test('configure and use registration cancellation policies', async ({ page }) => {
    test.info().annotations.push({
      type: 'documentation',
      description: 'Demonstrates how to configure and use registration cancellation policies',
    });

    // Start by showing the admin overview
    await page.goto('/admin');
    await page.screenshot({ path: 'docs/cancellation-01-admin-overview.png' });
    
    // Navigate to cancellation settings
    await page.getByRole('link', { name: /cancellation settings/i }).click();
    await expect(page.getByRole('heading', { name: /cancellation settings/i })).toBeVisible();
    await page.screenshot({ path: 'docs/cancellation-02-settings-page.png' });
    
    // Configure a basic tenant-wide policy
    await page.getByLabel(/allow cancellation/i).check();
    await page.getByLabel(/cutoff days/i).fill('7');
    await page.getByLabel(/cutoff hours/i).fill('0');
    await page.getByLabel(/refund transaction fees/i).uncheck();
    await page.getByLabel(/refund application fees/i).check();
    
    await page.screenshot({ path: 'docs/cancellation-03-basic-policy.png' });
    
    // Switch to advanced mode to show per-variant configuration
    await page.getByRole('checkbox', { name: /use same policy for all/i }).uncheck();
    await page.getByRole('button', { name: /show advanced settings/i }).click();
    
    await page.screenshot({ path: 'docs/cancellation-04-advanced-policies.png' });
    
    // Save the policies
    await page.getByRole('button', { name: /save policies/i }).click();
    await expect(page.getByText(/policies updated successfully/i)).toBeVisible();
    
    await page.screenshot({ path: 'docs/cancellation-05-policies-saved.png' });
    
    // Navigate to an event to show how cancellation works for users
    await page.goto('/events');
    
    // Find an event with registrations
    const eventLinks = page.getByRole('link').filter({ hasText: /workshop|seminar|meeting/i });
    if (await eventLinks.count() > 0) {
      await eventLinks.first().click();
      
      // Look for registration status
      const registrationSection = page.locator('[data-testid="registration-status"]').or(
        page.locator('text=registration').locator('..')
      );
      
      if (await registrationSection.count() > 0) {
        await page.screenshot({ path: 'docs/cancellation-06-event-with-registration.png' });
        
        // Look for cancel button
        const cancelButton = page.getByRole('button', { name: /cancel registration/i });
        if (await cancelButton.count() > 0) {
          await cancelButton.click();
          
          // Should show cancel dialog
          if (await page.getByRole('dialog').count() > 0) {
            await page.screenshot({ path: 'docs/cancellation-07-cancel-dialog.png' });
            
            // Close dialog without cancelling
            await page.getByRole('button', { name: /keep registration/i }).click();
          }
        }
      }
    }
    
    // Document the help section
    await page.goto('/admin/cancellation-settings');
    await page.locator('text=How Cancellation Policies Work').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'docs/cancellation-08-help-section.png' });
  });

  test('generate cancellation policy documentation', async ({ page }) => {
    test.info().annotations.push({
      type: 'documentation-content',
      description: 'Generates markdown content for cancellation policy documentation',
    });

    const documentation = `
# Registration Cancellation Configuration

The registration cancellation system allows tenant administrators to configure flexible cancellation policies for different types of registrations.

## Key Features

### Tenant-Level Default Policies
- Configure default cancellation policies at the tenant level
- Support for up to four different policy variants:
  - Paid registrations for regular participants
  - Paid registrations for organizers
  - Free registrations for regular participants  
  - Free registrations for organizers

### Policy Configuration Options
- **Allow Cancellation**: Enable or disable cancellation for the registration type
- **Cutoff Time**: Set deadline before event start (days + hours)
- **Transaction Fee Refunds**: Choose whether to refund payment processor fees
- **Application Fee Refunds**: Choose whether to refund platform fees

### Registration Option Inheritance
- Registration options can inherit tenant defaults
- Options can override with custom policies
- Effective policy is captured at registration time

### User Cancellation Experience
- Clear cancellation buttons when allowed by policy
- Reason selection with optional notes
- Automatic refund processing for paid registrations
- Real-time policy enforcement

## Configuration Modes

### Simple Mode (Apply to All)
Use the same cancellation policy for all registration types. Ideal for most tenants with consistent cancellation needs.

### Advanced Mode (Per-Variant)
Configure different policies for each combination of paid/free and regular/organizer registrations. Provides maximum flexibility.

## Best Practices

1. **Set Reasonable Cutoffs**: Consider your event planning needs when setting cancellation deadlines
2. **Be Clear About Fees**: Decide upfront whether you'll absorb transaction fees for cancellations
3. **Communicate Policies**: Ensure users understand cancellation terms before registration
4. **Test Scenarios**: Verify policies work as expected for different registration types

## Technical Implementation

The system uses:
- Database schema with JSONB policy storage
- Policy inheritance and effective snapshots
- Stripe integration for automated refunds
- Angular Material 3 UI components
- End-to-end type safety with Effect Schema
`;

    // Store the documentation content
    await page.evaluate((content) => {
      (window as any).documentationContent = content;
    }, documentation);
  });
});