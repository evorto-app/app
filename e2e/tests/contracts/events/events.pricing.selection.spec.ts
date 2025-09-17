import { expect, test } from '../../../fixtures/parallel-test';

test.describe('Contract: events.pricing.selection applied during registerForEvent', () => {
  test('should apply lowest eligible discount', async ({ page, tenant, user, database }) => {
    // Enable ESN provider
    await database
      .update(database.schema.tenants)
      .set({ 
        discountProviders: { 
          esnCard: { status: 'enabled', config: {} }
        } 
      })
      .where(database.eq(database.schema.tenants.id, tenant.id));
    
    // Create user with verified ESN card
    await database
      .insert(database.schema.userDiscountCards)
      .values({
        tenantId: tenant.id,
        userId: user.id,
        type: 'esnCard',
        identifier: 'ESN12345',
        status: 'verified',
        validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // Valid for 1 year
      });
    
    // Create event with registration option that has discount
    const eventTemplate = await database
      .insert(database.schema.eventTemplates)
      .values({
        tenantId: tenant.id,
        title: 'Test Event',
        description: 'Test event for discount pricing'
      })
      .returning()[0];
    
    const registrationOption = await database
      .insert(database.schema.templateRegistrationOptions)
      .values({
        templateId: eventTemplate.id,
        title: 'Standard Registration',
        description: 'Standard registration option',
        price: 2000, // €20.00
        isPaid: true,
        spots: 50,
        openRegistrationOffset: -24,
        closeRegistrationOffset: 0,
        organizingRegistration: false,
        // New field to be added - for now this test will fail
        discounts: [{ discountType: 'esnCard', discountedPrice: 1000 }] // €10.00
      })
      .returning()[0];
    
    const event = await database
      .insert(database.schema.eventInstances)
      .values({
        templateId: eventTemplate.id,
        title: 'Test Event Instance',
        start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Event in 1 week
        end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000) // 2 hours long
      })
      .returning()[0];
    
    const eventOption = await database
      .insert(database.schema.eventRegistrationOptions)
      .values({
        eventId: event.id,
        title: 'Standard Registration',
        description: 'Standard registration option',
        price: 2000, // €20.00
        isPaid: true,
        spots: 50,
        openRegistrationOffset: -24,
        closeRegistrationOffset: 0,
        organizingRegistration: false,
        // New field to be added - for now this test will fail
        discounts: [{ discountType: 'esnCard', discountedPrice: 1000 }] // €10.00
      })
      .returning()[0];
    
    await page.goto(`/${tenant.domain}/events/${event.id}`);
    
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
    
    // Should apply the lowest eligible discount (€10.00 instead of €20.00)
    expect(registrationResponse.result.data).toMatchObject({
      basePriceAtRegistration: 2000,
      appliedDiscountType: 'esnCard',
      appliedDiscountedPrice: 1000,
      discountAmount: 1000
    });
  });

  test('should handle tie-breakers correctly', async ({ page, tenant, user, database }) => {
    // Enable ESN provider
    await database
      .update(database.schema.tenants)
      .set({ 
        discountProviders: { 
          esnCard: { status: 'enabled', config: {} }
        } 
      })
      .where(database.eq(database.schema.tenants.id, tenant.id));
    
    // Create user with verified ESN card
    await database
      .insert(database.schema.userDiscountCards)
      .values({
        tenantId: tenant.id,
        userId: user.id,
        type: 'esnCard',
        identifier: 'ESN12345',
        status: 'verified',
        validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      });
    
    // Create event with multiple discounts at same price
    const event = await database
      .insert(database.schema.eventInstances)
      .values({
        title: 'Tie-breaker Test Event',
        start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000)
      })
      .returning()[0];
    
    const eventOption = await database
      .insert(database.schema.eventRegistrationOptions)
      .values({
        eventId: event.id,
        title: 'Tie-breaker Registration',
        price: 2000, // €20.00
        isPaid: true,
        spots: 50,
        openRegistrationOffset: -24,
        closeRegistrationOffset: 0,
        organizingRegistration: false,
        // Discount equals base price - should prefer base
        discounts: [{ discountType: 'esnCard', discountedPrice: 2000 }]
      })
      .returning()[0];
    
    await page.goto(`/${tenant.domain}/events/${event.id}`);
    
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
    
    // Should prefer base price when discount equals base
    expect(registrationResponse.result.data).toMatchObject({
      basePriceAtRegistration: 2000,
      appliedDiscountType: null,
      appliedDiscountedPrice: null,
      discountAmount: null
    });
  });

  test('should check validity on event start date', async ({ page, tenant, user, database }) => {
    // Enable ESN provider
    await database
      .update(database.schema.tenants)
      .set({ 
        discountProviders: { 
          esnCard: { status: 'enabled', config: {} }
        } 
      })
      .where(database.eq(database.schema.tenants.id, tenant.id));
    
    // Create user with ESN card that expires before event
    const eventStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const cardExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // Expires in 3 days
    
    await database
      .insert(database.schema.userDiscountCards)
      .values({
        tenantId: tenant.id,
        userId: user.id,
        type: 'esnCard',
        identifier: 'ESN12345',
        status: 'verified',
        validTo: cardExpiry
      });
    
    const event = await database
      .insert(database.schema.eventInstances)
      .values({
        title: 'Future Event',
        start: eventStart,
        end: new Date(eventStart.getTime() + 2 * 60 * 60 * 1000)
      })
      .returning()[0];
    
    const eventOption = await database
      .insert(database.schema.eventRegistrationOptions)
      .values({
        eventId: event.id,
        title: 'Registration with Expired Discount',
        price: 2000,
        isPaid: true,
        spots: 50,
        openRegistrationOffset: -24,
        closeRegistrationOffset: 0,
        organizingRegistration: false,
        discounts: [{ discountType: 'esnCard', discountedPrice: 1000 }]
      })
      .returning()[0];
    
    await page.goto(`/${tenant.domain}/events/${event.id}`);
    
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
    
    // Should not apply discount since card expires before event
    expect(registrationResponse.result.data).toMatchObject({
      basePriceAtRegistration: 2000,
      appliedDiscountType: null,
      appliedDiscountedPrice: null,
      discountAmount: null
    });
  });

  test('should set confirmed status for zero-price registrations', async ({ page, tenant, user, database }) => {
    // Enable ESN provider
    await database
      .update(database.schema.tenants)
      .set({ 
        discountProviders: { 
          esnCard: { status: 'enabled', config: {} }
        } 
      })
      .where(database.eq(database.schema.tenants.id, tenant.id));
    
    // Create user with verified ESN card
    await database
      .insert(database.schema.userDiscountCards)
      .values({
        tenantId: tenant.id,
        userId: user.id,
        type: 'esnCard',
        identifier: 'ESN12345',
        status: 'verified',
        validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      });
    
    const event = await database
      .insert(database.schema.eventInstances)
      .values({
        title: 'Free Event with Discount',
        start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000)
      })
      .returning()[0];
    
    const eventOption = await database
      .insert(database.schema.eventRegistrationOptions)
      .values({
        eventId: event.id,
        title: 'Free with ESN',
        price: 1000, // €10.00
        isPaid: true,
        spots: 50,
        openRegistrationOffset: -24,
        closeRegistrationOffset: 0,
        organizingRegistration: false,
        discounts: [{ discountType: 'esnCard', discountedPrice: 0 }] // Free
      })
      .returning()[0];
    
    await page.goto(`/${tenant.domain}/events/${event.id}`);
    
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
    
    // Should be immediately confirmed for zero price
    expect(registrationResponse.result.data).toMatchObject({
      basePriceAtRegistration: 1000,
      appliedDiscountType: 'esnCard',
      appliedDiscountedPrice: 0,
      discountAmount: 1000,
      status: 'CONFIRMED'
    });
  });
});
