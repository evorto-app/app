import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { eventTemplateCategories } from '../../../db/schema';
import { authenticatedProcedure, router } from '../trpc-server';

interface IconValue { iconColor: number; iconName: string }

const iconSchema = Schema.Unknown;

const isIconValue = (value: unknown): value is IconValue => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as { iconColor?: unknown; iconName?: unknown };
  return (
    typeof record.iconColor === 'number' && typeof record.iconName === 'string'
  );
};

const resolveIconInput = async (
  icon: unknown,
  tenantId: string,
): Promise<IconValue> => {
  if (isIconValue(icon)) {
    return icon;
  }
  if (typeof icon !== 'string' || icon.trim().length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Invalid icon input',
    });
  }
  const iconRecord = await database.query.icons.findFirst({
    where: { commonName: icon, tenantId },
  });
  return {
    iconColor: iconRecord?.sourceColor ?? 0,
    iconName: icon,
  };
};

export const templateCategoryRouter = router({
  create: authenticatedProcedure
    .meta({ requiredPermissions: ['templates:manageCategories'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          icon: iconSchema,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const resolvedIcon = await resolveIconInput(input.icon, ctx.tenant.id);
      return await database.insert(eventTemplateCategories).values({
        icon: resolvedIcon,
        tenantId: ctx.tenant.id,
        title: input.title,
      });
    }),
  findMany: authenticatedProcedure.query(async ({ ctx }) => {
    return await database.query.eventTemplateCategories.findMany({
      where: { tenantId: ctx.tenant.id },
    });
  }),
  update: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          id: Schema.NonEmptyString,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .meta({ requiredPermissions: ['templates:manageCategories'] })
    .mutation(async ({ ctx, input }) => {
      return await database
        .update(eventTemplateCategories)
        .set({
          title: input.title,
        })
        .where(
          and(
            eq(eventTemplateCategories.tenantId, ctx.tenant.id),
            eq(eventTemplateCategories.id, input.id),
          ),
        )
        .returning()
        .then((result) => result[0]);
    }),
});
