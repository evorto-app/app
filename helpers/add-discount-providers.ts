import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { relations } from '../src/db/relations';
import { discountProviders } from '../src/db/schema';

/**
 * Seeds discount providers configuration for the tenant
 * Enables ESN card discounts by default for testing
 */
export async function addDiscountProviders(
  database: NeonDatabase<Record<string, never>, typeof relations>,
  tenantId: string,
) {
  const providers = [
    {
      id: `${tenantId}-esn-provider`,
      tenantId,
      type: 'esnCard' as const,
      status: 'enabled' as const,
      settings: {
        showCtaOnEventPage: true,
        apiEndpoint: 'https://esncard.org/api/v1/card', // This won't work in tests, but structure is correct
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  ];

  await database.insert(discountProviders).values(providers).execute();
  
  return providers;
}