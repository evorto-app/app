import { eq } from 'drizzle-orm';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { relations } from '../src/db/relations';
import { tenants } from '../src/db/schema';

/**
 * Seeds discount providers configuration for the tenant
 * Enables ESN card discounts by default for testing
 */
export async function addDiscountProviders(
  database: NeonDatabase<Record<string, never>, typeof relations>,
  tenantId: string,
) {
  const discountProvidersConfig = {
    esnCard: {
      status: 'enabled' as const,
      config: {
        apiKey: 'test-key', // For testing purposes
        apiUrl: 'https://esncard.org/services/1.0/card.json',
      },
    },
  };

  await database
    .update(tenants)
    .set({ discountProviders: discountProvidersConfig })
    .where(eq(tenants.id, tenantId));
  
  return discountProvidersConfig;
}