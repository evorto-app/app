import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { authenticatedProcedure, router } from '../trpc-server';

export const userRouter = router({
  // findMany: authenticatedProcedure
  //   .input(
  //     Schema.decodeUnknownSync(
  //       Schema.Struct({
  //         // limit: Schema.NumberFromString.pipe(
  //         //   Schema.Number.pipe(Schema.Between(1, 100)),
  //         // ),
  //         // offset: Schema.NumberFromString.pipe(Schema.NonNegative),
  //         search: Schema.Optional(Schema.NonEmptyString),
  //       }),
  //     ),
  //   )
  //   .query(async ({ ctx, input }) => {
  //     const query = database.select().from(schema.users);
  //     if (input.search) {
  //       query.where(
  //         or(
  //           ilike(
  //             schema.users.searchableInfo,
  //             `%${input.search.toLowerCase()}%`,
  //           ),
  //         ),
  //       );
  //     }
  //     const [data, total] = await Promise.all([
  //       query.limit(input.limit).offset(input.offset),
  //       database
  //         .select({ count: sql<number>`count(*)` })
  //         .from(schema.users)
  //         .then((result) => result[0].count),
  //     ]);
  //     return { data, total };
  //   }),

  findMany: authenticatedProcedure.query(async ({ ctx }) => {
    const users = await database
      .select({
        email: schema.users.email,
        firstName: schema.users.firstName,
        id: schema.users.id,
        lastName: schema.users.lastName,
        role: schema.roles.name,
      })
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
      )
      .leftJoin(
        schema.roles,
        eq(schema.rolesToTenantUsers.roleId, schema.roles.id),
      );
    // console.log(users);
    const userMap = users.reduce(
      (accumulator, user) => {
        if (accumulator[user.id]) {
          if (user.role) {
            accumulator[user.id].roles.push(user.role);
          }
        } else {
          accumulator[user.id] = {
            ...user,
            roles: user.role ? [user.role] : [],
          };
        }
        return accumulator;
      },
      {} as Record<
        string,
        {
          email: string;
          firstName: string;
          id: string;
          lastName: string;
          roles: string[];
        }
      >,
    );
    return Object.values(userMap);
  }),

  findOne: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          id: Schema.NonEmptyString,
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const result = await database
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, input.id))
        .limit(1);
      return result[0];
    }),

  self: authenticatedProcedure.query(async ({ ctx }) => {
    return ctx.user;
  }),
});
