import { TRPCError } from '@trpc/server';
import consola from 'consola';
import {
  and,
  arrayOverlaps,
  asc,
  eq,
  exists,
  gt,
  inArray,
  not,
  sql,
} from 'drizzle-orm';
import { Schema } from 'effect';
import { isEqual } from 'es-toolkit';
import { Writable } from 'type-fest';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { eventReviewStatus, eventVisibility } from '../../../db/schema';
import { publicProcedure } from '../trpc-server';

export const eventListProcedure = publicProcedure
  .input(
    Schema.decodeUnknownSync(
      Schema.Struct({
        limit: Schema.optionalWith(Schema.Number.pipe(Schema.nonNegative()), {
          default: () => 100,
        }),
        offset: Schema.optionalWith(Schema.Number.pipe(Schema.nonNegative()), {
          default: () => 0,
        }),
        startAfter: Schema.optionalWith(Schema.ValidDateFromSelf, {
          default: () => new Date(),
        }),
        status: Schema.optionalWith(
          Schema.Array(Schema.Literal(...eventReviewStatus.enumValues)),
          { default: () => [] },
        ),
        userId: Schema.optional(Schema.NonEmptyString),
        visibility: Schema.optionalWith(
          Schema.Array(Schema.Literal(...eventVisibility.enumValues)),
          {
            default: () => [],
          },
        ),
      }),
    ),
  )
  .use(
    async ({
      ctx,
      input: { limit, offset, startAfter, status, userId, visibility },
      next,
    }) => {
      if (ctx.user?.id !== userId) {
        consola.warn(
          `Supplied query parameter userId (${userId}) does not match the actual state (${ctx.user?.id})!`,
        );
      }

      if (
        !isEqual(status, ['APPROVED']) &&
        !ctx.user?.permissions?.includes('events:seeDrafts')
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `User tried to see events with status ${status} but is missing the 'events:seeDrafts' permission!`,
        });
      }

      if (
        visibility.includes('PRIVATE') &&
        !ctx.user?.permissions?.includes('events:seePrivate')
      ) {
        consola.debug('User permissions', ctx.user?.permissions);
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `User tried to see events with visibility ${visibility} but is missing the 'events:seePrivate' permission!`,
        });
      }

      if (
        visibility.includes('HIDDEN') &&
        !ctx.user?.permissions?.includes('events:seeHidden')
      ) {
        consola.debug('User permissions', ctx.user?.permissions);
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `User tried to see events with visibility ${visibility} but is missing the 'events:seeHidden' permission!`,
        });
      }

      const rolesToFilterBy = (ctx.user?.roleIds ??
        (await database.query.roles
          .findMany({
            columns: { id: true },
            where: and(
              eq(schema.roles.tenantId, ctx.tenant.id),
              eq(schema.roles.defaultUserRole, true),
            ),
          })
          .then((roles) => roles.map((role) => role.id))) ??
        []) as string[];

      const queryResult = await database
        .select({
          icon: schema.eventInstances.icon,
          id: schema.eventInstances.id,
          start: schema.eventInstances.start,
          status: schema.eventInstances.status,
          title: schema.eventInstances.title,
          userIsCreator: sql`${schema.eventInstances.creatorId}=${ctx.user?.id ?? 'not'}`,
          userRegistered: exists(
            database
              .select()
              .from(schema.eventRegistrations)
              .where(
                and(
                  eq(
                    schema.eventRegistrations.eventId,
                    schema.eventInstances.id,
                  ),
                  eq(schema.eventRegistrations.userId, ctx.user?.id ?? ''),
                  not(eq(schema.eventRegistrations.status, 'CANCELLED')),
                ),
              ),
          ),
          visibility: schema.eventInstances.visibility,
        })
        .from(schema.eventInstances)
        .where(
          and(
            gt(schema.eventInstances.start, startAfter),
            eq(schema.eventInstances.tenantId, ctx.tenant.id),
            inArray(
              schema.eventInstances.status,
              status as Writable<typeof status>,
            ),
            inArray(
              schema.eventInstances.visibility,
              visibility as Writable<typeof visibility>,
            ),
            exists(
              database
                .select()
                .from(schema.eventRegistrationOptions)
                .where(
                  and(
                    eq(
                      schema.eventRegistrationOptions.eventId,
                      schema.eventInstances.id,
                    ),
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
