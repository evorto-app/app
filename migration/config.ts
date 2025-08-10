import { eq } from 'drizzle-orm';

import * as oldSchema from '../old/drizzle';
import { database } from '../src/db';
import * as newSchema from '../src/db/schema';
import { oldDatabase } from './migrator-database';

export const migrationConfig = {
  authIdMap: {
    'google-oauth2|110521442319435018423': 'auth0|6775a3a47369b902878fdc74',
  } as Record<string, string>,
  disableSpecials: false,
  userIdCache: new Map<string, string>(),
};

export const transformAuthId = (authId: string) => {
  if (migrationConfig.disableSpecials) {
    return authId;
  }
  return migrationConfig.authIdMap[authId] ?? authId;
};

export const resolveUserId = async (
  oldUserId: string,
): Promise<string | undefined> => {
  // Check cache first
  if (migrationConfig.userIdCache.has(oldUserId)) {
    const cached = migrationConfig.userIdCache.get(oldUserId);
    return cached === '' ? undefined : cached;
  }

  try {
    // Get old user's authId
    const [oldUser] = await oldDatabase
      .select({ authId: oldSchema.user.authId })
      .from(oldSchema.user)
      .where(eq(oldSchema.user.id, oldUserId))
      .limit(1);

    if (!oldUser) {
      migrationConfig.userIdCache.set(oldUserId, '');
      return undefined;
    }

    // Transform the authId and find corresponding new user
    const transformedAuthId = transformAuthId(oldUser.authId);
    const [newUser] = await database
      .select({ id: newSchema.users.id })
      .from(newSchema.users)
      .where(eq(newSchema.users.auth0Id, transformedAuthId))
      .limit(1);

    const newUserId = newUser?.id;
    migrationConfig.userIdCache.set(oldUserId, newUserId ?? '');
    return newUserId;
  } catch (error) {
    console.error(`Failed to resolve user ID ${oldUserId}:`, error);
    migrationConfig.userIdCache.set(oldUserId, '');
    return undefined;
  }
};

export const mapUserId = resolveUserId;
