import { expect } from '@playwright/test';
import { parallelTest } from '../../../fixtures/parallel-test';

parallelTest.describe('Contract: discounts.setTenantProviders', () => {
  parallelTest('should require admin permissions', async ({ page, tenant, user }) => {
    // Navigate as non-admin user
    await page.goto(`/${tenant.domain}/admin/settings`);
    
    // Attempt to call setTenantProviders without admin permissions
    const response = await page.evaluate(async () => {
      const body = {
        "0": {
          json: {
            providers: [
              { type: 'esnCard', status: 'enabled', config: {} }
            ]
          }
        }
      };
      
      return fetch('/api/trpc/discounts.setTenantProviders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => ({
        status: r.status,
        data: r.json()
      }));
    });
    
    // Should fail with unauthorized/forbidden status
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  parallelTest('should validate input schema', async ({ page, tenant, adminUser }) => {
    // Login as admin
    await page.goto(`/${tenant.domain}/admin/settings`);
    
    // Test invalid provider type
    const invalidTypeResponse = await page.evaluate(async () => {
      const body = {
        "0": {
          json: {
            providers: [
              { type: 'invalidProvider', status: 'enabled', config: {} }
            ]
          }
        }
      };
      
      return fetch('/api/trpc/discounts.setTenantProviders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => ({
        status: r.status,
        text: r.text()
      }));
    });
    
    expect(invalidTypeResponse.status).toBeGreaterThanOrEqual(400);
    
    // Test invalid status
    const invalidStatusResponse = await page.evaluate(async () => {
      const body = {
        "0": {
          json: {
            providers: [
              { type: 'esnCard', status: 'invalid', config: {} }
            ]
          }
        }
      };
      
      return fetch('/api/trpc/discounts.setTenantProviders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => ({
        status: r.status,
        text: r.text()
      }));
    });
    
    expect(invalidStatusResponse.status).toBeGreaterThanOrEqual(400);
  });

  parallelTest('should persist valid configuration to tenants.discount_providers JSONB', async ({ page, tenant, adminUser, database }) => {
    // Login as admin
    await page.goto(`/${tenant.domain}/admin/settings`);
    
    // Make valid request
    await page.evaluate(async () => {
      const body = {
        "0": {
          json: {
            providers: [
              { 
                type: 'esnCard', 
                status: 'enabled', 
                config: { 
                  apiUrl: 'https://example.com',
                  showCta: true
                } 
              }
            ]
          }
        }
      };
      
      return fetch('/api/trpc/discounts.setTenantProviders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    });
    
    // Verify data was persisted to database
    const tenantData = await database.query.tenants.findFirst({
      where: { id: tenant.id }
    });
    
    expect(tenantData.discountProviders).toBeDefined();
    expect(tenantData.discountProviders.esnCard).toMatchObject({
      status: 'enabled',
      config: {
        apiUrl: 'https://example.com',
        showCta: true
      }
    });
  });

  parallelTest('should reject invalid provider config according to schema', async ({ page, tenant, adminUser }) => {
    await page.goto(`/${tenant.domain}/admin/settings`);
    
    // Test with config that doesn't match provider schema
    const invalidConfigResponse = await page.evaluate(async () => {
      const body = {
        "0": {
          json: {
            providers: [
              { 
                type: 'esnCard', 
                status: 'enabled', 
                config: { 
                  invalidField: 'should not be allowed'
                } 
              }
            ]
          }
        }
      };
      
      return fetch('/api/trpc/discounts.setTenantProviders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => ({
        status: r.status,
        text: r.text()
      }));
    });
    
    // Should reject invalid config
    expect(invalidConfigResponse.status).toBeGreaterThanOrEqual(400);
  });
});