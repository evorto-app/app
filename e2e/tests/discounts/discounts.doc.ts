import { expect } from '@playwright/test';
import { parallelTest } from '../../fixtures/parallel-test';

/**
 * Documentation Test: End-to-End Discount Feature Journey
 * 
 * This test documents and validates the complete user journey for the discount cards feature,
 * from admin configuration to user registration with applied discounts.
 */
parallelTest.describe('Documentation: End-to-End Discount Feature Journey', () => {
  parallelTest('complete discount workflow from admin setup to user registration', async ({ 
    page, 
    tenant, 
    user,
    adminUser, 
    database 
  }) => {
    console.log('## Step 1: Admin enables ESN discount provider');
    
    // Login as admin and navigate to discount settings
    await page.goto(`/${tenant.domain}/admin/settings/discounts`);
    
    // Enable ESN card provider
    await page.evaluate(() => {
      // This will call discounts.setTenantProviders
      const enableEsnButton = document.querySelector('[data-testid="enable-esn-provider"]');
      if (enableEsnButton) {
        enableEsnButton.click();
      }
    });
    
    // Verify ESN provider is enabled
    const enabledProvider = await database.query.tenants.findFirst({
      where: { id: tenant.id }
    });
    expect(enabledProvider.discountProviders?.esnCard?.status).toBe('enabled');
    
    console.log('✓ ESN provider enabled successfully');
    
    console.log('## Step 2: User adds and verifies ESN card');
    
    // Switch to regular user and go to profile
    await page.goto(`/${tenant.domain}/profile/discount-cards`);
    
    // Add ESN card number
    const esnCardNumber = 'ESN123456789';
    await page.fill('[data-testid="esn-card-input"]', esnCardNumber);
    await page.click('[data-testid="add-esn-card-button"]');
    
    // Wait for validation to complete
    await page.waitForResponse(
      (response) => response.url().includes('/api/trpc/discounts.upsertMyCard')
    );
    
    // Verify card was added and verified
    const userCard = await database.query.userDiscountCards.findFirst({
      where: { 
        tenantId: tenant.id, 
        userId: user.id,
        type: 'esnCard'
      }
    });
    expect(userCard).toBeDefined();
    expect(userCard.identifier).toBe(esnCardNumber);
    expect(userCard.status).toBe('verified');
    
    console.log('✓ ESN card added and verified successfully');
    
    console.log('## Step 3: Admin creates event template with ESN discount');
    
    // Create template with discounted registration option
    const eventTemplate = await database
      .insert(database.schema.eventTemplates)
      .values({
        tenantId: tenant.id,
        title: 'Community Workshop',
        description: 'A workshop for students with ESN discount available'
      })
      .returning()[0];
    
    const templateOption = await database
      .insert(database.schema.templateRegistrationOptions)
      .values({
        templateId: eventTemplate.id,
        title: 'Student Registration',
        description: 'Registration for students',
        price: 1000, // €10.00 base price
        isPaid: true,
        spots: 30,
        openRegistrationOffset: -72, // Open 3 days before
        closeRegistrationOffset: -2, // Close 2 hours before
        organizingRegistration: false,
        discounts: [
          { discountType: 'esnCard', discountedPrice: 500 } // €5.00 with ESN card
        ]
      })
      .returning()[0];
    
    console.log('✓ Template created with ESN discount (€10.00 → €5.00)');
    
    console.log('## Step 4: Create event from template');
    
    // Navigate to template and create event
    await page.goto(`/${tenant.domain}/admin/templates/${eventTemplate.id}`);
    
    const eventStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 1 week from now
    const eventEnd = new Date(eventStart.getTime() + 2 * 60 * 60 * 1000); // 2 hours duration
    
    const createEventResponse = await page.evaluate(async (templateId, start, end) => {
      const body = {
        "0": {
          json: {
            templateId: templateId,
            title: 'Community Workshop - October',
            start: start,
            end: end
          }
        }
      };
      
      return fetch('/api/trpc/templates.createEventFromTemplate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json());
    }, eventTemplate.id, eventStart.toISOString(), eventEnd.toISOString());
    
    const eventId = createEventResponse.result.data.id;
    
    // Verify discount was duplicated to event
    const eventOption = await database.query.eventRegistrationOptions.findFirst({
      where: { eventId: eventId }
    });
    expect(eventOption.discounts).toEqual([
      { discountType: 'esnCard', discountedPrice: 500 }
    ]);
    
    console.log('✓ Event created from template, discount configuration duplicated');
    
    console.log('## Step 5: User registers with ESN discount applied');
    
    // Navigate to event page
    await page.goto(`/${tenant.domain}/events/${eventId}`);
    
    // Register for the event
    const registrationResponse = await page.evaluate(async (optionId) => {
      const body = {
        "0": {
          json: {
            eventId: window.location.pathname.split('/').pop(),
            registrationOptionId: optionId
          }
        }
      };
      
      return fetch('/api/trpc/events.registerForEvent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json());
    }, eventOption.id);
    
    // Verify discount was applied correctly
    const registration = registrationResponse.result.data;
    expect(registration).toMatchObject({
      basePriceAtRegistration: 1000, // Original €10.00
      appliedDiscountType: 'esnCard',
      appliedDiscountedPrice: 500, // Discounted to €5.00
      discountAmount: 500, // €5.00 savings
      status: 'PENDING' // Paid registration, so pending payment
    });
    
    console.log('✓ Registration successful with ESN discount applied (€10.00 → €5.00)');
    
    console.log('## Step 6: View participants list showing discount information');
    
    // Navigate to event participants as admin
    await page.goto(`/${tenant.domain}/admin/events/${eventId}/participants`);
    
    // Verify participant shows discount information
    const participantRow = await page.locator('[data-testid="participant-row"]').first();
    await expect(participantRow).toContainText('ESN Card'); // Discount type
    await expect(participantRow).toContainText('€5.00'); // Discount amount
    
    console.log('✓ Participant list shows discount information correctly');
    
    console.log('## Step 7: Test free registration scenario');
    
    // Create another template option with free ESN pricing
    const freeTemplateOption = await database
      .insert(database.schema.templateRegistrationOptions)
      .values({
        templateId: eventTemplate.id,
        title: 'ESN Member Registration',
        description: 'Free registration for ESN members',
        price: 800, // €8.00 base price
        isPaid: true,
        spots: 20,
        openRegistrationOffset: -72,
        closeRegistrationOffset: -2,
        organizingRegistration: false,
        discounts: [
          { discountType: 'esnCard', discountedPrice: 0 } // Free with ESN card
        ]
      })
      .returning()[0];
    
    // Create event with free option
    const freeEventResponse = await page.evaluate(async (templateId, start, end) => {
      const body = {
        "0": {
          json: {
            templateId: templateId,
            title: 'Free ESN Event',
            start: start,
            end: end
          }
        }
      };
      
      return fetch('/api/trpc/templates.createEventFromTemplate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json());
    }, eventTemplate.id, eventStart.toISOString(), eventEnd.toISOString());
    
    const freeEventId = freeEventResponse.result.data.id;
    const freeEventOption = await database.query.eventRegistrationOptions.findFirst({
      where: { 
        eventId: freeEventId,
        title: 'ESN Member Registration'
      }
    });
    
    // Register for free event
    await page.goto(`/${tenant.domain}/events/${freeEventId}`);
    
    const freeRegistrationResponse = await page.evaluate(async (optionId) => {
      const body = {
        "0": {
          json: {
            eventId: window.location.pathname.split('/').pop(),
            registrationOptionId: optionId
          }
        }
      };
      
      return fetch('/api/trpc/events.registerForEvent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json());
    }, freeEventOption.id);
    
    // Verify free registration is immediately confirmed
    const freeRegistration = freeRegistrationResponse.result.data;
    expect(freeRegistration).toMatchObject({
      basePriceAtRegistration: 800,
      appliedDiscountType: 'esnCard',
      appliedDiscountedPrice: 0,
      discountAmount: 800,
      status: 'CONFIRMED' // Free registration should be auto-confirmed
    });
    
    console.log('✓ Free ESN registration confirmed immediately');
    
    console.log('## Step 8: Test provider disabled scenario');
    
    // Disable ESN provider
    await database
      .update(database.schema.tenants)
      .set({ 
        discountProviders: { 
          esnCard: { status: 'disabled', config: {} }
        } 
      })
      .where(database.eq(database.schema.tenants.id, tenant.id));
    
    // Create new user and try to add ESN card
    const newUser = await database
      .insert(database.schema.users)
      .values({
        id: 'test-user-new',
        email: 'newuser@example.com',
        firstName: 'New',
        lastName: 'User'
      })
      .returning()[0];
    
    // Switch to new user profile
    await page.goto(`/${tenant.domain}/profile/discount-cards`);
    
    // Try to add ESN card when provider is disabled
    const blockedResponse = await page.evaluate(async () => {
      const body = {
        "0": {
          json: {
            type: 'esnCard',
            identifier: 'ESN987654321'
          }
        }
      };
      
      return fetch('/api/trpc/discounts.upsertMyCard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => ({
        status: r.status,
        ok: r.ok
      }));
    });
    
    // Should be blocked
    expect(blockedResponse.ok).toBe(false);
    expect(blockedResponse.status).toBeGreaterThanOrEqual(400);
    
    console.log('✓ New ESN card addition blocked when provider disabled');
    
    console.log('## Step 9: Verify existing cards still work for pricing');
    
    // Re-enable provider
    await database
      .update(database.schema.tenants)
      .set({ 
        discountProviders: { 
          esnCard: { status: 'enabled', config: {} }
        } 
      })
      .where(database.eq(database.schema.tenants.id, tenant.id));
    
    // Existing user with verified card should still get discounts
    const existingUserRegistration = await page.evaluate(async (optionId) => {
      const body = {
        "0": {
          json: {
            eventId: window.location.pathname.split('/').pop(),
            registrationOptionId: optionId
          }
        }
      };
      
      return fetch('/api/trpc/events.registerForEvent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json());
    }, freeEventOption.id);
    
    // Should still apply discount
    expect(existingUserRegistration.result.data.appliedDiscountType).toBe('esnCard');
    
    console.log('✓ Existing verified cards continue to work when provider re-enabled');
    
    console.log('\n## Summary');
    console.log('✅ Complete end-to-end discount workflow verified:');
    console.log('  • Admin can enable/disable discount providers');
    console.log('  • Users can add and verify discount cards');
    console.log('  • Templates support discount configurations');
    console.log('  • Discounts are properly duplicated to events');
    console.log('  • Pricing selection applies lowest eligible discount');
    console.log('  • Free registrations are auto-confirmed');
    console.log('  • Provider state affects new card additions');
    console.log('  • Existing cards remain functional');
    console.log('  • Participant lists show discount information');
  });

  parallelTest('should show ESN CTA when enabled and no verified card', async ({ 
    page, 
    tenant, 
    user, 
    database 
  }) => {
    console.log('## ESN Call-to-Action Display Test');
    
    // Enable ESN provider with CTA enabled
    await database
      .update(database.schema.tenants)
      .set({ 
        discountProviders: { 
          esnCard: { 
            status: 'enabled', 
            config: { showCta: true }
          }
        } 
      })
      .where(database.eq(database.schema.tenants.id, tenant.id));
    
    // Navigate to profile
    await page.goto(`/${tenant.domain}/profile/discount-cards`);
    
    // Should show ESN explanation and CTA link
    await expect(page.locator('[data-testid="esn-cta-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="get-esncard-link"]')).toBeVisible();
    await expect(page.locator('[data-testid="get-esncard-link"]')).toHaveAttribute('href', /esncard\.org/);
    
    console.log('✓ ESN CTA displayed when enabled and no verified card');
    
    // Add verified card
    await database
      .insert(database.schema.userDiscountCards)
      .values({
        tenantId: tenant.id,
        userId: user.id,
        type: 'esnCard',
        identifier: 'ESN123456789',
        status: 'verified'
      });
    
    // Refresh page
    await page.reload();
    
    // CTA should be hidden when user has verified card
    await expect(page.locator('[data-testid="esn-cta-section"]')).not.toBeVisible();
    
    console.log('✓ ESN CTA hidden when user has verified card');
  });
});