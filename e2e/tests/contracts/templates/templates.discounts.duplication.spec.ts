import { expect, test } from '../../../fixtures/parallel-test';

test.describe('Contract: templates.discounts.duplication on event create from template', () => {
  test('should copy template discounts JSON to event options', async ({ page, tenant, user, database }) => {
    // Create template with registration options that have discounts
    const eventTemplate = await database
      .insert(database.schema.eventTemplates)
      .values({
        tenantId: tenant.id,
        title: 'Template with Discounts',
        description: 'Template for testing discount duplication'
      })
      .returning()[0];
    
    const templateOption1 = await database
      .insert(database.schema.templateRegistrationOptions)
      .values({
        templateId: eventTemplate.id,
        title: 'Standard Registration',
        description: 'Standard registration with ESN discount',
        price: 2000, // €20.00
        isPaid: true,
        spots: 50,
        openRegistrationOffset: -24,
        closeRegistrationOffset: 0,
        organizingRegistration: false,
        // This field will be added in implementation
        discounts: [
          { discountType: 'esnCard', discountedPrice: 1500 } // €15.00
        ]
      })
      .returning()[0];
    
    const templateOption2 = await database
      .insert(database.schema.templateRegistrationOptions)
      .values({
        templateId: eventTemplate.id,
        title: 'Premium Registration',
        description: 'Premium registration with ESN discount',
        price: 5000, // €50.00
        isPaid: true,
        spots: 20,
        openRegistrationOffset: -24,
        closeRegistrationOffset: 0,
        organizingRegistration: false,
        discounts: [
          { discountType: 'esnCard', discountedPrice: 4000 } // €40.00
        ]
      })
      .returning()[0];
    
    await page.goto(`/${tenant.domain}/admin/templates/${eventTemplate.id}`);
    
    // Create event from template
    const createEventResponse = await page.evaluate(async (templateId) => {
      const body = {
        "0": {
          json: {
            templateId: templateId,
            title: 'Event from Template',
            start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString()
          }
        }
      };
      
      return fetch('/api/trpc/templates.createEventFromTemplate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json());
    }, eventTemplate.id);
    
    expect(createEventResponse.result).toBeDefined();
    const eventId = createEventResponse.result.data.id;
    
    // Verify event registration options have copied discounts
    const eventOptions = await database.query.eventRegistrationOptions.findMany({
      where: { eventId: eventId }
    });
    
    expect(eventOptions).toHaveLength(2);
    
    const standardOption = eventOptions.find(opt => opt.title === 'Standard Registration');
    const premiumOption = eventOptions.find(opt => opt.title === 'Premium Registration');
    
    expect(standardOption).toBeDefined();
    expect(standardOption.discounts).toEqual([
      { discountType: 'esnCard', discountedPrice: 1500 }
    ]);
    
    expect(premiumOption).toBeDefined();
    expect(premiumOption.discounts).toEqual([
      { discountType: 'esnCard', discountedPrice: 4000 }
    ]);
  });

  test('should preserve discount configurations during duplication', async ({ page, tenant, user, database }) => {
    // Create template with complex discount configuration
    const eventTemplate = await database
      .insert(database.schema.eventTemplates)
      .values({
        tenantId: tenant.id,
        title: 'Complex Discount Template',
        description: 'Template with multiple discount configurations'
      })
      .returning()[0];
    
    const templateOption = await database
      .insert(database.schema.templateRegistrationOptions)
      .values({
        templateId: eventTemplate.id,
        title: 'Multi-Discount Registration',
        description: 'Registration with multiple potential discounts',
        price: 3000, // €30.00
        isPaid: true,
        spots: 30,
        openRegistrationOffset: -48,
        closeRegistrationOffset: -2,
        organizingRegistration: false,
        discounts: [
          { discountType: 'esnCard', discountedPrice: 2000 } // €20.00
          // Future providers would add more discount types here
        ]
      })
      .returning()[0];
    
    await page.goto(`/${tenant.domain}/admin/templates/${eventTemplate.id}`);
    
    // Create event from template with specific start/end times
    const eventStart = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 2 weeks from now
    const eventEnd = new Date(eventStart.getTime() + 3 * 60 * 60 * 1000); // 3 hours duration
    
    const createEventResponse = await page.evaluate(async (templateId, start, end) => {
      const body = {
        "0": {
          json: {
            templateId: templateId,
            title: 'Complex Discount Event',
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
    
    // Verify the discount configuration was copied exactly
    const eventOption = await database.query.eventRegistrationOptions.findFirst({
      where: { eventId: eventId, title: 'Multi-Discount Registration' }
    });
    
    expect(eventOption).toBeDefined();
    expect(eventOption.discounts).toEqual([
      { discountType: 'esnCard', discountedPrice: 2000 }
    ]);
    
    // Verify other properties were also copied correctly
    expect(eventOption).toMatchObject({
      title: 'Multi-Discount Registration',
      description: 'Registration with multiple potential discounts',
      price: 3000,
      isPaid: true,
      spots: 30,
      openRegistrationOffset: -48,
      closeRegistrationOffset: -2,
      organizingRegistration: false
    });
  });

  test('should handle templates without discounts', async ({ page, tenant, user, database }) => {
    // Create template without discounts
    const eventTemplate = await database
      .insert(database.schema.eventTemplates)
      .values({
        tenantId: tenant.id,
        title: 'No Discount Template',
        description: 'Template without any discounts'
      })
      .returning()[0];
    
    const templateOption = await database
      .insert(database.schema.templateRegistrationOptions)
      .values({
        templateId: eventTemplate.id,
        title: 'Regular Registration',
        description: 'Regular registration without discounts',
        price: 1500, // €15.00
        isPaid: true,
        spots: 40,
        openRegistrationOffset: -24,
        closeRegistrationOffset: 0,
        organizingRegistration: false
        // No discounts field
      })
      .returning()[0];
    
    await page.goto(`/${tenant.domain}/admin/templates/${eventTemplate.id}`);
    
    const createEventResponse = await page.evaluate(async (templateId) => {
      const body = {
        "0": {
          json: {
            templateId: templateId,
            title: 'Regular Event',
            start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString()
          }
        }
      };
      
      return fetch('/api/trpc/templates.createEventFromTemplate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json());
    }, eventTemplate.id);
    
    const eventId = createEventResponse.result.data.id;
    
    // Verify event option was created without discounts
    const eventOption = await database.query.eventRegistrationOptions.findFirst({
      where: { eventId: eventId }
    });
    
    expect(eventOption).toBeDefined();
    expect(eventOption.discounts).toBeUndefined(); // or null/empty array depending on implementation
    expect(eventOption.title).toBe('Regular Registration');
    expect(eventOption.price).toBe(1500);
  });

  test('should maintain referential integrity after duplication', async ({ page, tenant, user, database }) => {
    // Create template with option that has discounts
    const eventTemplate = await database
      .insert(database.schema.eventTemplates)
      .values({
        tenantId: tenant.id,
        title: 'Integrity Test Template',
        description: 'Template for testing referential integrity'
      })
      .returning()[0];
    
    const templateOption = await database
      .insert(database.schema.templateRegistrationOptions)
      .values({
        templateId: eventTemplate.id,
        title: 'Integrity Test Registration',
        price: 2500,
        isPaid: true,
        spots: 25,
        openRegistrationOffset: -24,
        closeRegistrationOffset: 0,
        organizingRegistration: false,
        discounts: [
          { discountType: 'esnCard', discountedPrice: 1800 }
        ]
      })
      .returning()[0];
    
    await page.goto(`/${tenant.domain}/admin/templates/${eventTemplate.id}`);
    
    // Create multiple events from the same template
    const event1Response = await page.evaluate(async (templateId) => {
      const body = {
        "0": {
          json: {
            templateId: templateId,
            title: 'Event 1 from Template',
            start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString()
          }
        }
      };
      
      return fetch('/api/trpc/templates.createEventFromTemplate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json());
    }, eventTemplate.id);
    
    const event2Response = await page.evaluate(async (templateId) => {
      const body = {
        "0": {
          json: {
            templateId: templateId,
            title: 'Event 2 from Template',
            start: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString()
          }
        }
      };
      
      return fetch('/api/trpc/templates.createEventFromTemplate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json());
    }, eventTemplate.id);
    
    const event1Id = event1Response.result.data.id;
    const event2Id = event2Response.result.data.id;
    
    // Verify both events have independent discount configurations
    const event1Options = await database.query.eventRegistrationOptions.findMany({
      where: { eventId: event1Id }
    });
    
    const event2Options = await database.query.eventRegistrationOptions.findMany({
      where: { eventId: event2Id }
    });
    
    expect(event1Options).toHaveLength(1);
    expect(event2Options).toHaveLength(1);
    
    // Both should have identical discount configs but different IDs
    expect(event1Options[0].discounts).toEqual([
      { discountType: 'esnCard', discountedPrice: 1800 }
    ]);
    expect(event2Options[0].discounts).toEqual([
      { discountType: 'esnCard', discountedPrice: 1800 }
    ]);
    
    expect(event1Options[0].id).not.toBe(event2Options[0].id);
    expect(event1Options[0].eventId).toBe(event1Id);
    expect(event2Options[0].eventId).toBe(event2Id);
  });
});
