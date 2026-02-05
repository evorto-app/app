import { TRPCError } from '@trpc/server';
import consola from 'consola';
import { and, count, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import {
  authenticatedProcedure,
  publicProcedure,
  router,
} from '../trpc-server';

export const userRouter = router({
  authData: publicProcedure.query(async ({ ctx }) => {
    consola.info('Auth data', ctx.request.oidc.user);
    return ctx.request.oidc.user as Record<string, unknown>;
  }),

  createAccount: publicProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          communicationEmail: Schema.NonEmptyString,
          firstName: Schema.NonEmptyString,
          lastName: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const authData = ctx.request.oidc.user;
      if (!authData) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
        });
      }
      const auth0Id = authData.sub;
      const existingUser = await database
        .select()
        .from(schema.users)
        .where(eq(schema.users.auth0Id, auth0Id))
        .limit(1);
      if (existingUser.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'User already exists',
        });
      }
      const defaultUserRoles = await database.query.roles.findMany({
        where: { defaultUserRole: true, tenantId: ctx.tenant.id },
      });
      const userCreateResponse = await database
        .insert(schema.users)
        .values({
          auth0Id,
          communicationEmail: input.communicationEmail,
          email: authData.email,
          firstName: input.firstName,
          lastName: input.lastName,
        })
        .returning();
      const createdUser = userCreateResponse[0];

      const userTenantCreateResponse = await database
        .insert(schema.usersToTenants)
        .values({
          tenantId: ctx.tenant.id,
          userId: createdUser.id,
        })
        .returning();
      const createdUserTenant = userTenantCreateResponse[0];

      await database.insert(schema.rolesToTenantUsers).values(
        defaultUserRoles.map((role) => ({
          roleId: role.id,
          userTenantId: createdUserTenant.id,
        })),
      );

      return createdUser;
    }),

  events: router({
    findMany: authenticatedProcedure.query(async ({ ctx }) => {
      // Get all event registrations for the current user
      const registrations = await database
        .select({
          eventId: schema.eventRegistrations.eventId,
        })
        .from(schema.eventRegistrations)
        .where(eq(schema.eventRegistrations.userId, ctx.user.id));

      if (registrations.length === 0) {
        return [];
      }

      // Get the events for these registrations
      const events = await database
        .select({
          description: schema.eventInstances.description,
          end: schema.eventInstances.end,
          id: schema.eventInstances.id,
          start: schema.eventInstances.start,
          title: schema.eventInstances.title,
        })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.tenantId, ctx.tenant.id))
        .orderBy(schema.eventInstances.start);

      return events;
    }),
  }),

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

  maybeSelf: publicProcedure.query(async ({ ctx }) => {
    return ctx.user ?? undefined;
  }),

  self: authenticatedProcedure.query(async ({ ctx }) => {
    return ctx.user;
  }),

  updateProfile: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          firstName: Schema.NonEmptyString,
          lastName: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const updatedUser = await database
        .update(schema.users)
        .set({
          firstName: input.firstName,
          lastName: input.lastName,
        })
        .where(eq(schema.users.id, ctx.user.id))
        .returning();

      return updatedUser[0];
    }),

  userAssigned: publicProcedure.query(async ({ ctx }) => {
    return !!ctx.user;
  }),
});
