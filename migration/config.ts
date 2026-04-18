import { and, eq } from 'drizzle-orm';

import * as oldSchema from '../old/drizzle';
import { database } from '../src/db';
import * as newSchema from '../src/db/schema';
import { oldDatabase } from './migrator-database';

export const migrationConfig = {
  authIdMap: {
    'google-oauth2|110521442319435018423': 'auth0|6775a3a47369b902878fdc74',
  } as Record<string, string>,
  disableSpecials: false,
  iconCache: new Map<
    string,
    { iconColor: number; iconName: string } | undefined
  >(),
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

export const resolveIcon = async (
  iconName: string,
  tenantId: string,
): Promise<{ iconColor: number; iconName: string }> => {
  const cacheKey = `${iconName}:${tenantId}`;

  // Check cache first
  if (migrationConfig.iconCache.has(cacheKey)) {
    const cached = migrationConfig.iconCache.get(cacheKey);
    if (!cached) {
      throw new Error(
        `Icon with name "${iconName}" not found for tenant ${tenantId}`,
      );
    }
    return cached;
  }

  try {
    // Find icon by commonName and tenantId
    const [icon] = await database
      .select({
        commonName: newSchema.icons.commonName,
        sourceColor: newSchema.icons.sourceColor,
      })
      .from(newSchema.icons)
      .where(
        and(
          eq(newSchema.icons.commonName, iconName),
          eq(newSchema.icons.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!icon) {
      migrationConfig.iconCache.set(cacheKey, undefined);
      throw new Error(
        `Icon with name "${iconName}" not found for tenant ${tenantId}`,
      );
    }

    const iconObject = {
      iconColor: icon.sourceColor ?? 0,
      iconName: icon.commonName,
    };

    migrationConfig.iconCache.set(cacheKey, iconObject);
    return iconObject;
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      throw error;
    }
    console.error(
      `Failed to resolve icon ${iconName} for tenant ${tenantId}:`,
      error,
    );
    throw new Error(
      `Failed to resolve icon ${iconName} for tenant ${tenantId}`,
    );
  }
};
