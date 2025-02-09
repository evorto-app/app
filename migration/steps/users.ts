import consola from 'consola';
import { count, InferSelectModel } from 'drizzle-orm';

import * as oldSchema from '../../old/drizzle';
import { database } from '../../src/db';
import * as schema from '../../src/db/schema';
import { transformAuthId } from '../config';
import { oldDatabase } from '../migrator-database';

const migrationStepSize = 1000;
const numberFormat = new Intl.NumberFormat();

export const migrateUsers = async () => {
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
    });
    await database
      .insert(schema.users)
      .values(
        oldUsers.map((user) => ({
          auth0Id: transformAuthId(user.authId),
          communicationEmail: user.communicationEmail ?? user.email,
          createdAt: new Date(user.createdAt),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        })),
      )
      .returning();
  }
  const newUserCountResult = await database
    .select({ count: count() })
    .from(schema.users);
  const newUserCount = newUserCountResult[0].count;
  consola.success(
    `Migrated ${numberFormat.format(newUserCount)}/${numberFormat.format(userCount)} users`,
  );
};
