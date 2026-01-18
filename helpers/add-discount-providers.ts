import { eq } from 'drizzle-orm';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { relations } from '../src/db/relations';
import { tenants } from '../src/db/schema';

/**
 * Seeds discount providers configuration for the tenant
 * Enables ESNcard discounts by default for testing
 */
export async function addDiscountProviders(
  database: NeonDatabase<Record<string, never>, typeof relations>,
  tenantId: string,
) {
  const discountProvidersConfig = {
    esnCard: {
      enabled: true as const,
      config: {
        ctaEnabled: true,
        ctaLink: 'https://esncard.org',
      },
    },
  } as const;

  await database
    .update(tenants)
    .set({ discountProviders: discountProvidersConfig })
    .where(eq(tenants.id, tenantId));

  return discountProvidersConfig;
}
