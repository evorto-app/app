import { expect } from '@playwright/test';
import { parallelTest } from '../../../fixtures/parallel-test';

parallelTest.describe('Contract: discounts.catalog → getTenantProviders', () => {
  parallelTest('should return provider catalog with correct schema', async ({ page, tenant }) => {
    // Navigate to admin page that would call getTenantProviders
    await page.goto(`/${tenant.domain}/admin/settings`);
    
    // Wait for the API call and intercept response
    const response = await page.waitForResponse(
      (response) =>
        response.url().includes('/api/trpc/discounts.getTenantProviders') &&
        response.status() === 200
    );
    
    const data = await response.json();
    
    // Assert output schema: { type: 'esnCard', status: 'enabled'|'disabled', config: object }[]
    expect(data).toHaveProperty('result');
    expect(data.result).toHaveProperty('data');
    
    const providers = data.result.data;
    expect(Array.isArray(providers)).toBe(true);
    
    // Should have at least ESN card provider
    const esnProvider = providers.find((p: any) => p.type === 'esnCard');
    expect(esnProvider).toBeDefined();
    expect(esnProvider).toMatchObject({
      type: 'esnCard',
      status: expect.stringMatching(/^(enabled|disabled)$/),
      config: expect.any(Object)
    });
  });

  parallelTest('should return all known providers even if not configured', async ({ page, tenant }) => {
    await page.goto(`/${tenant.domain}/admin/settings`);
    
    const response = await page.waitForResponse(
      (response) => response.url().includes('/api/trpc/discounts.getTenantProviders')
    );
    
    const data = await response.json();
    const providers = data.result.data;
    
    // Should include all known provider types from catalog
    const providerTypes = providers.map((p: any) => p.type);
    expect(providerTypes).toContain('esnCard');
    
    // Each provider should have required fields
    providers.forEach((provider: any) => {
      expect(provider).toHaveProperty('type');
      expect(provider).toHaveProperty('status');
      expect(provider).toHaveProperty('config');
      expect(['enabled', 'disabled']).toContain(provider.status);
    });
  });
});