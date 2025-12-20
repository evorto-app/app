import { Schema } from 'effect';

import { database } from '../../../db';
import { icons } from '../../../db/schema';
import { computeIconSourceColor } from '../../utils/icon-color';
import { authenticatedProcedure, router } from '../trpc-server';

export const iconRouter = router({
  addIcon: authenticatedProcedure
    .input(Schema.standardSchemaV1(Schema.Struct({ icon: Schema.NonEmptyString })))
    .mutation(async ({ ctx, input }) => {
      const [name, set] = input.icon.split(':');
      let friendlyName = name;
      if (!name) {
        throw new Error('Invalid icon name');
      }
      if (set?.includes('-')) {
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
      const sourceColor = await computeIconSourceColor(input.icon);
      return database
        .insert(icons)
        .values({
          commonName: input.icon,
          friendlyName,
          sourceColor,
          tenantId: ctx.tenant.id,
        })
        .returning();
    }),
  search: authenticatedProcedure
    .input(Schema.standardSchemaV1(Schema.Struct({ search: Schema.String })))
    .query(async ({ ctx, input }) => {
      return await database.query.icons.findMany({
        orderBy: { commonName: 'asc' },
        where: {
          commonName: { ilike: `%${input.search}%` },
          tenantId: ctx.tenant.id,
        },
      });
    }),
});
