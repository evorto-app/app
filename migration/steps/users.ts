import consola from 'consola';
import { count } from 'drizzle-orm';

import * as oldSchema from '../../old/drizzle';
import type { ScriptDatabaseClient } from '../../src/db/database-client';
import * as schema from '../../src/db/schema';
import { transformAuthId } from '../config';
import { legacyTimestamp } from '../legacy-timestamp';
import { oldDatabase } from '../migrator-database';

const migrationStepSize = 1000;
const numberFormat = new Intl.NumberFormat();

export const migrateUsers = async (database: ScriptDatabaseClient) => {
  consola.start('Migrating users');
  const userCountResult = await oldDatabase
    .select({ count: count() })
    .from(oldSchema.user);
  const userCount = userCountResult[0].count;
  consola.info(`Found ${numberFormat.format(userCount)} users`);
  for (let index = 0; index < userCount; index += migrationStepSize) {
    consola.info(
      `Migrating users ${numberFormat.format(index + 1)} to ${numberFormat.format(index + migrationStepSize)}`,
    );
    const oldUsers = await oldDatabase.query.user.findMany({
      limit: migrationStepSize,
      offset: index,
      orderBy: { id: 'asc' },
    });
    await database
      .insert(schema.users)
      .values(
        oldUsers.map((user) => ({
          auth0Id: transformAuthId(user.authId),
          communicationEmail: user.communicationEmail ?? user.email,
          createdAt: legacyTimestamp(
            user.createdAt,
            `Legacy user ${user.id} createdAt`,
          ),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        })),
      )
      .onConflictDoNothing({ target: [schema.users.auth0Id] });
  }
  const newUserCountResult = await database
    .select({ count: count() })
    .from(schema.users);
  const newUserCount = newUserCountResult[0].count;
  consola.success(
    `Migrated ${numberFormat.format(newUserCount)}/${numberFormat.format(userCount)} users`,
  );
};
