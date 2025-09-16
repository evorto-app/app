import { expect } from '@playwright/test';
import { parallelTest } from '../../../fixtures/parallel-test';

parallelTest.describe('Contract: discounts.cards CRUD (getMyCards, upsertMyCard, deleteMyCard)', () => {
  parallelTest('should enforce immediate validation on upsert', async ({ page, tenant, user, database }) => {
    // Enable ESN provider first
    await database
      .update(database.schema.tenants)
      .set({ 
        discountProviders: { 
          esnCard: { status: 'enabled', config: {} }
        } 
      })
      .where(database.eq(database.schema.tenants.id, tenant.id));
    
    await page.goto(`/${tenant.domain}/profile`);
    
    // Test upsert with invalid ESN card number
    const invalidResponse = await page.evaluate(async () => {
      const body = {
        "0": {
          json: {
            type: 'esnCard',
            identifier: 'INVALID_ESN_NUMBER'
          }
        }
      };
      
      return fetch('/api/trpc/discounts.upsertMyCard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => ({
        status: r.status,
        data: r.json()
      }));
    });
    
    expect(invalidResponse.status).toBeGreaterThanOrEqual(400);
  });

  parallelTest('should enforce uniqueness (type, identifier) platform-wide', async ({ page, tenant, user, database }) => {
    // Enable ESN provider
    await database
      .update(database.schema.tenants)
      .set({ 
        discountProviders: { 
          esnCard: { status: 'enabled', config: {} }
        } 
      })
      .where(database.eq(database.schema.tenants.id, tenant.id));
    
    // Create another user with an ESN card
    const existingUser = await database
      .insert(database.schema.users)
      .values({
        id: 'test-user-2',
        email: 'existing@example.com',
        firstName: 'Existing',
        lastName: 'User'
      })
      .returning()[0];
    
    await database
      .insert(database.schema.userDiscountCards)
      .values({
        tenantId: tenant.id,
        userId: existingUser.id,
        type: 'esnCard',
        identifier: 'ESN12345',
        status: 'verified'
      });
    
    await page.goto(`/${tenant.domain}/profile`);
    
    // Try to use the same identifier
    const duplicateResponse = await page.evaluate(async () => {
      const body = {
        "0": {
          json: {
            type: 'esnCard',
            identifier: 'ESN12345'
          }
        }
      };
      
      return fetch('/api/trpc/discounts.upsertMyCard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => ({
        status: r.status,
        data: r.json()
      }));
    });
    
    expect(duplicateResponse.status).toBeGreaterThanOrEqual(400);
  });

  parallelTest('should block upsert when provider is disabled', async ({ page, tenant, user, database }) => {
    // Disable ESN provider
    await database
      .update(database.schema.tenants)
      .set({ 
        discountProviders: { 
          esnCard: { status: 'disabled', config: {} }
        } 
      })
      .where(database.eq(database.schema.tenants.id, tenant.id));
    
    await page.goto(`/${tenant.domain}/profile`);
    
    const blockedResponse = await page.evaluate(async () => {
      const body = {
        "0": {
          json: {
            type: 'esnCard',
            identifier: 'ESN54321'
          }
        }
      };
      
      return fetch('/api/trpc/discounts.upsertMyCard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => ({
        status: r.status,
        data: r.json()
      }));
    });
    
    expect(blockedResponse.status).toBeGreaterThanOrEqual(400);
  });

  parallelTest('should delete user card successfully', async ({ page, tenant, user, database }) => {
    // Enable ESN provider and add a card
    await database
      .update(database.schema.tenants)
      .set({ 
        discountProviders: { 
          esnCard: { status: 'enabled', config: {} }
        } 
      })
      .where(database.eq(database.schema.tenants.id, tenant.id));
    
    const card = await database
      .insert(database.schema.userDiscountCards)
      .values({
        tenantId: tenant.id,
        userId: user.id,
        type: 'esnCard',
        identifier: 'ESN99999',
        status: 'verified'
      })
      .returning()[0];
    
    await page.goto(`/${tenant.domain}/profile`);
    
    // Delete the card
    const deleteResponse = await page.evaluate(async () => {
      const body = {
        "0": {
          json: {
            type: 'esnCard'
          }
        }
      };
      
      return fetch('/api/trpc/discounts.deleteMyCard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.status);
    });
    
    expect(deleteResponse).toBe(200);
    
    // Verify card was deleted from database
    const deletedCard = await database.query.userDiscountCards.findFirst({
      where: { id: card.id }
    });
    expect(deletedCard).toBeUndefined();
  });

  parallelTest('should return user cards via getMyCards', async ({ page, tenant, user, database }) => {
    // Add a card for the user
    await database
      .insert(database.schema.userDiscountCards)
      .values({
        tenantId: tenant.id,
        userId: user.id,
        type: 'esnCard',
        identifier: 'ESN11111',
        status: 'verified'
      });
    
    await page.goto(`/${tenant.domain}/profile`);
    
    const response = await page.waitForResponse(
      (response) => response.url().includes('/api/trpc/discounts.getMyCards')
    );
    
    const data = await response.json();
    expect(data.result.data).toHaveLength(1);
    expect(data.result.data[0]).toMatchObject({
      type: 'esnCard',
      identifier: 'ESN11111',
      status: 'verified',
      userId: user.id,
      tenantId: tenant.id
    });
  });
});