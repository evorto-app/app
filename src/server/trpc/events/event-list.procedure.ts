import { TRPCError } from '@trpc/server';
import consola from 'consola';
import { and, arrayOverlaps, asc, eq, exists, gt, inArray, not, sql } from 'drizzle-orm';
import { Schema } from 'effect';
import { isEqual } from 'es-toolkit';
import { Writable } from 'type-fest';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { eventReviewStatus } from '../../../db/schema';
import { publicProcedure } from '../trpc-server';

export const eventListProcedure = publicProcedure
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({
        includeUnlisted: Schema.optional(Schema.Boolean),
        limit: Schema.optionalWith(Schema.Number.pipe(Schema.nonNegative()), {
          default: () => 100,
        }),
        offset: Schema.optionalWith(Schema.Number.pipe(Schema.nonNegative()), {
          default: () => 0,
        }),
        startAfter: Schema.optionalWith(Schema.ValidDateFromSelf, {
          default: () => new Date(),
        }),
        status: Schema.optionalWith(Schema.Array(Schema.Literal(...eventReviewStatus.enumValues)), {
          default: () => [],
        }),
        userId: Schema.optional(Schema.NonEmptyString),
      }),
    ),
  )
  .use(
    async ({
      ctx,
      input: { includeUnlisted, limit, offset, startAfter, status, userId },
      next,
    }) => {
      if (ctx.user?.id !== userId) {
        consola.warn(
          `Supplied query parameter userId (${userId}) does not match the actual state (${ctx.user?.id})!`,
        );
      }

      if (!isEqual(status, ['APPROVED']) && !ctx.user?.permissions?.includes('events:seeDrafts')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `User tried to see events with status ${status} but is missing the 'events:seeDrafts' permission!`,
        });
      }

      if (includeUnlisted && !ctx.user?.permissions?.includes('events:seeUnlisted')) {
        consola.debug('User permissions', ctx.user?.permissions);
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            "User tried to include unlisted events but is missing the 'events:seeUnlisted' permission!",
        });
      }

      const fallbackRoles = await database.query.roles
        .findMany({
          columns: { id: true },
          where: {
            defaultUserRole: true,
            tenantId: ctx.tenant.id,
          },
        })
        .then((roles) => roles.map((role) => role.id));
      const rolesToFilterBy = [
        ...(ctx.user?.roleIds && ctx.user.roleIds.length > 0 ? ctx.user.roleIds : fallbackRoles),
      ];

      const queryResult = await database
        .select({
          icon: schema.eventInstances.icon,
          id: schema.eventInstances.id,
          start: schema.eventInstances.start,
          status: schema.eventInstances.status,
          title: schema.eventInstances.title,
          unlisted: schema.eventInstances.unlisted,
          userIsCreator: sql`${schema.eventInstances.creatorId}=${ctx.user?.id ?? 'not'}`,
          userRegistered: exists(
            database
              .select()
              .from(schema.eventRegistrations)
              .where(
                and(
                  eq(schema.eventRegistrations.eventId, schema.eventInstances.id),
                  eq(schema.eventRegistrations.userId, ctx.user?.id ?? ''),
                  not(eq(schema.eventRegistrations.status, 'CANCELLED')),
                ),
              ),
          ),
        })
        .from(schema.eventInstances)
        .where(
          and(
            gt(schema.eventInstances.start, startAfter),
            eq(schema.eventInstances.tenantId, ctx.tenant.id),
            inArray(schema.eventInstances.status, status as Writable<typeof status>),
            ...(includeUnlisted ? [] : [eq(schema.eventInstances.unlisted, false)]),
            exists(
              database
                .select()
                .from(schema.eventRegistrationOptions)
                .where(
                  and(
                    eq(schema.eventRegistrationOptions.eventId, schema.eventInstances.id),
                    arrayOverlaps(
                      schema.eventRegistrationOptions.roleIds,
                      rolesToFilterBy.length > 0 ? rolesToFilterBy : [''],
                    ),
                  ),
                ),
            ),
          ),
        )
        .limit(limit)
        .offset(offset)
        .orderBy(asc(schema.eventInstances.start));
      return next({
        ctx: {
          events: queryResult,
        },
      });
    },
  );
