import { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { DateTime } from 'luxon';

import { relations } from '../src/db/relations';
import { userDiscountCards } from '../src/db/schema';
import { usersToAuthenticate } from './user-data';

/**
 * Seeds discount cards for test users to enable testing of discount functionality
 * without relying on external validation APIs
 */
export async function addDiscountCards(
  database: NeonDatabase<Record<string, never>, typeof relations>,
  tenantId: string,
  baseDate?: DateTime,
) {
  // Add a verified ESNcard for one test user to enable discount testing
  const testUser = usersToAuthenticate.find((u) => u.roles === 'user' && u.addToDb);

  if (!testUser) {
    return [];
  }

  const identifierSuffix = tenantId.slice(0, 6).toUpperCase();
  const discountCards = [
    {
      id: `test-esncard-${identifierSuffix}`,
      tenantId,
      userId: testUser.id,
      type: 'esnCard' as const,
      identifier: `TEST-${identifierSuffix}`,
      status: 'verified' as const,
      validFrom: new Date('2024-01-01'),
      validTo: new Date('2026-12-31'),
      lastCheckedAt: (baseDate ?? DateTime.now().startOf('day')).toJSDate(),
      metadata: {
        holderName: 'Test User',
        university: 'Test University',
        country: 'TestLand',
      },
    },
  ];

  await database.insert(userDiscountCards).values(discountCards).execute();

  return discountCards;
}
