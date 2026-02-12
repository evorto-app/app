import { and, count, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import {
  authenticatedProcedure,
  router,
} from '../trpc-server';

export const userRouter = router({
  findMany: authenticatedProcedure
    .meta({ requiredPermissions: ['users:viewAll'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          limit: Schema.optional(Schema.Number),
          offset: Schema.optional(Schema.Number),
          search: Schema.optional(Schema.NonEmptyString),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const usersCountResult = await database
        .select({ count: count() })
        .from(schema.users)
        .innerJoin(
          schema.usersToTenants,
          and(
            eq(schema.usersToTenants.userId, schema.users.id),
            eq(schema.usersToTenants.tenantId, ctx.tenant.id),
          ),
        )
        .leftJoin(
          schema.rolesToTenantUsers,
          eq(schema.usersToTenants.id, schema.rolesToTenantUsers.userTenantId),
        );
      const usersCount = usersCountResult[0].count;
      const users = await database
        .select({
          email: schema.users.email,
          firstName: schema.users.firstName,
          id: schema.users.id,
          lastName: schema.users.lastName,
          role: schema.roles.name,
        })
        .from(schema.users)
        .orderBy(schema.users.lastName, schema.users.firstName)
        .offset(input.offset ?? 0)
        .limit(input.limit ?? 100)
        .innerJoin(
          schema.usersToTenants,
          and(
            eq(schema.usersToTenants.userId, schema.users.id),
            eq(schema.usersToTenants.tenantId, ctx.tenant.id),
          ),
        )
        .leftJoin(
          schema.rolesToTenantUsers,
          eq(schema.usersToTenants.id, schema.rolesToTenantUsers.userTenantId),
        )
        .leftJoin(
          schema.roles,
          eq(schema.rolesToTenantUsers.roleId, schema.roles.id),
        );
      const userMap: Record<
        string,
        {
          email: string;
          firstName: string;
          id: string;
          lastName: string;
          roles: string[];
        }
      > = {};
      for (const user of users) {
        if (userMap[user.id]) {
          if (user.role) {
            userMap[user.id].roles.push(user.role);
          }
          continue;
        }
        userMap[user.id] = {
          ...user,
          roles: user.role ? [user.role] : [],
        };
      }
      return { users: Object.values(userMap), usersCount };
    }),

  findOne: authenticatedProcedure
    .meta({ requiredPermissions: ['users:viewAll'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          id: Schema.NonEmptyString,
        }),
      ),
    )
    .query(async ({ input }) => {
      const result = await database
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, input.id))
        .limit(1);
      return result[0];
    }),

});
