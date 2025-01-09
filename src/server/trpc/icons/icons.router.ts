import { and, eq, ilike } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { icons } from '../../../db/schema';
import { authenticatedProcedure, router } from '../trpc-server';

export const iconRouter = router({
  addIcon: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(Schema.Struct({ icon: Schema.NonEmptyString })),
    )
    .mutation(async ({ ctx, input }) => {
      const [name, set] = input.icon.split(':');
      let friendlyName = name;
      if (!name) {
        throw new Error('Invalid icon name');
      }
      if (set.includes('-')) {
        const setParts = set.split('-');
        for (const part of setParts) {
          friendlyName = friendlyName.replaceAll(part, '');
        }
      }
      friendlyName = friendlyName.replaceAll('-', ' ').trim();
      // Capitalize first letter of each word
      friendlyName = friendlyName
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      return database
        .insert(icons)
        .values({
          commonName: input.icon,
          friendlyName,
          tenantId: ctx.tenant.id,
        })
        .returning();
    }),
  search: authenticatedProcedure
    .input(Schema.decodeUnknownSync(Schema.Struct({ search: Schema.String })))
    .query(async ({ ctx, input }) => {
      return await database.query.icons.findMany({
        where: and(
          ilike(icons.commonName, `%${input.search}%`),
          eq(icons.tenantId, ctx.tenant.id),
        ),
      });
    }),
});
